import {
  LLMProvider, LLMCompletionRequest, LLMCompletionResponse,
  LLMStreamChunk, LLMMessage, LLMToolDefinition, EmbeddingRequest, EmbeddingResponse
} from '../types/index.js';
import { llmApiKeys, MODEL_REGISTRY, getModelConfig } from '../config/index.js';
import { createLogger, generateId, costTracker, retry } from '../utils/index.js';
import { cacheGet, cacheSet } from '../database/redis.js';
import { createHash } from 'crypto';

const logger = createLogger('LLM-Router');

// ============================================================
// PROVIDER HEALTH TRACKING
// ============================================================
interface ProviderHealth {
  available: boolean;
  lastError?: string;
  lastErrorAt?: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
}

const providerHealth: Record<string, ProviderHealth> = {};

function recordSuccess(provider: string, latencyMs: number) {
  if (!providerHealth[provider]) {
    providerHealth[provider] = { available: true, successCount: 0, errorCount: 0, avgLatencyMs: 0 };
  }
  const h = providerHealth[provider];
  h.available = true;
  h.successCount++;
  h.avgLatencyMs = (h.avgLatencyMs * (h.successCount - 1) + latencyMs) / h.successCount;
}

function recordError(provider: string, error: string) {
  if (!providerHealth[provider]) {
    providerHealth[provider] = { available: true, successCount: 0, errorCount: 0, avgLatencyMs: 0 };
  }
  const h = providerHealth[provider];
  h.errorCount++;
  h.lastError = error;
  h.lastErrorAt = Date.now();
  // Mark unavailable after 3 consecutive errors within 60s
  if (h.errorCount >= 3 && h.lastErrorAt && Date.now() - h.lastErrorAt < 60_000) {
    h.available = false;
  }
}

export function getProviderHealth(): Record<string, ProviderHealth> {
  return { ...providerHealth };
}

// ============================================================
// PROVIDER ADAPTERS
// ============================================================

async function callOpenAI(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: llmApiKeys.openai });

  const params: any = {
    model: req.model,
    messages: req.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };

  if (req.tools?.length) {
    params.tools = req.tools;
    params.tool_choice = req.tool_choice || 'auto';
  }
  if (req.responseFormat === 'json') {
    params.response_format = { type: 'json_object' };
  }

  const start = Date.now();
  const response = await client.chat.completions.create(params);
  const latencyMs = Date.now() - start;
  const choice = response.choices[0];
  const config = getModelConfig(req.model);

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const costUSD = config
    ? (inputTokens / 1000) * config.costPer1kInput + (outputTokens / 1000) * config.costPer1kOutput
    : 0;

  costTracker.addCost(req.model, costUSD);

  return {
    id: response.id,
    provider: 'openai',
    model: req.model,
    content: choice.message.content,
    toolCalls: (choice.message.tool_calls || []).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
    finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'stop' ? 'stop' : 'stop',
    latencyMs,
  };
}

async function callAnthropic(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: llmApiKeys.anthropic });

  const systemMsg = req.messages.find(m => m.role === 'system');
  const otherMsgs = req.messages.filter(m => m.role !== 'system');

  const messages = otherMsgs.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user' as const,
        content: [{
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id || '',
          content: m.content,
        }],
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text' as const, text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      return { role: 'assistant' as const, content: blocks };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });

  const params: any = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
  };

  if (systemMsg) params.system = systemMsg.content;

  if (req.tools?.length) {
    params.tools = req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const start = Date.now();
  const response = await client.messages.create(params);
  const latencyMs = Date.now() - start;
  const config = getModelConfig(req.model);

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUSD = config
    ? (inputTokens / 1000) * config.costPer1kInput + (outputTokens / 1000) * config.costPer1kOutput
    : 0;

  costTracker.addCost(req.model, costUSD);

  let content: string | null = null;
  const toolCalls: LLMCompletionResponse['toolCalls'] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      content = (content || '') + block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  return {
    id: response.id,
    provider: 'anthropic',
    model: req.model,
    content,
    toolCalls,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
    finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    latencyMs,
  };
}

async function callGoogle(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(llmApiKeys.google);

  const model = genAI.getGenerativeModel({ model: req.model });

  const systemInstruction = req.messages.find(m => m.role === 'system')?.content;
  const history = req.messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const lastMessage = req.messages[req.messages.length - 1];

  const chat = model.startChat({
    history,
    ...(systemInstruction ? { systemInstruction } : {}),
  });

  const start = Date.now();
  const result = await chat.sendMessage(lastMessage.content);
  const latencyMs = Date.now() - start;
  const response = result.response;
  const text = response.text();
  const config = getModelConfig(req.model);

  const inputTokens = req.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  const outputTokens = Math.ceil(text.length / 4);
  const costUSD = config
    ? (inputTokens / 1000) * config.costPer1kInput + (outputTokens / 1000) * config.costPer1kOutput
    : 0;

  costTracker.addCost(req.model, costUSD);

  return {
    id: generateId('google'),
    provider: 'google',
    model: req.model,
    content: text,
    toolCalls: [],
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
    finishReason: 'stop',
    latencyMs,
  };
}

async function callGroq(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: llmApiKeys.groq, baseURL: 'https://api.groq.com/openai/v1' });
  return callOpenAICompatible(client, req, 'groq');
}

async function callMistral(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: llmApiKeys.mistral, baseURL: 'https://api.mistral.ai/v1' });
  return callOpenAICompatible(client, req, 'mistral');
}

// Shared adapter for OpenAI-compatible providers
async function callOpenAICompatible(client: any, req: LLMCompletionRequest, provider: LLMProvider): Promise<LLMCompletionResponse> {
  const params: any = {
    model: req.model,
    messages: req.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };

  if (req.tools?.length) {
    params.tools = req.tools;
    params.tool_choice = req.tool_choice || 'auto';
  }

  const start = Date.now();
  const response = await client.chat.completions.create(params);
  const latencyMs = Date.now() - start;
  const choice = response.choices[0];
  const config = getModelConfig(req.model);

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const costUSD = config
    ? (inputTokens / 1000) * config.costPer1kInput + (outputTokens / 1000) * config.costPer1kOutput
    : 0;

  costTracker.addCost(req.model, costUSD);

  return {
    id: response.id,
    provider,
    model: req.model,
    content: choice.message.content,
    toolCalls: (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
    finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    latencyMs,
  };
}

async function callOllama(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const baseUrl = llmApiKeys.ollama;
  const model = req.model.replace('ollama:', '');

  const body: any = {
    model,
    messages: req.messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
    options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens ?? 4096 },
  };

  if (req.tools?.length) {
    body.tools = req.tools.map(t => ({
      type: 'function',
      function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
    }));
  }

  const start = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;
  const latencyMs = Date.now() - start;

  const toolCalls: LLMCompletionResponse['toolCalls'] = [];
  if (data.message?.tool_calls) {
    for (const tc of data.message.tool_calls) {
      toolCalls.push({
        id: generateId('tc'),
        type: 'function',
        function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
      });
    }
  }

  const inputTokens = data.prompt_eval_count || 0;
  const outputTokens = data.eval_count || 0;

  return {
    id: generateId('ollama'),
    provider: 'ollama',
    model: req.model,
    content: data.message?.content || null,
    toolCalls,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD: 0 },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    latencyMs,
  };
}

// ============================================================
// STREAMING PROVIDERS
// ============================================================

async function* streamOpenAICompatible(req: LLMCompletionRequest, apiKeyOrClient?: any, baseURL?: string): AsyncGenerator<LLMStreamChunk> {
  const { default: OpenAI } = await import('openai');

  let client: any;
  if (typeof apiKeyOrClient === 'object' && apiKeyOrClient !== null) {
    client = apiKeyOrClient;
  } else {
    const opts: any = { apiKey: apiKeyOrClient || llmApiKeys.openai };
    if (baseURL) opts.baseURL = baseURL;
    client = new OpenAI(opts);
  }

  const params: any = {
    model: req.model,
    messages: req.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (req.tools?.length) {
    params.tools = req.tools;
    params.tool_choice = req.tool_choice || 'auto';
  }

  const stream = await client.chat.completions.create(params) as any;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];

    if (choice?.delta?.content) {
      yield { type: 'text_delta', content: choice.delta.content };
    }

    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        yield {
          type: 'tool_call_delta',
          toolCallId: tc.id || undefined,
          toolName: tc.function?.name || undefined,
          toolArgs: tc.function?.arguments || undefined,
        };
      }
    }

    if (chunk.usage) {
      const config = getModelConfig(req.model);
      const costUSD = config
        ? (chunk.usage.prompt_tokens / 1000) * config.costPer1kInput +
          (chunk.usage.completion_tokens / 1000) * config.costPer1kOutput
        : 0;
      costTracker.addCost(req.model, costUSD);

      yield {
        type: 'usage',
        usage: {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
          costUSD,
        },
      };
    }
  }

  yield { type: 'done' };
}

async function* streamAnthropic(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: llmApiKeys.anthropic });

  const systemMsg = req.messages.find(m => m.role === 'system');
  const otherMsgs = req.messages.filter(m => m.role !== 'system');

  const messages = otherMsgs.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user' as const,
        content: [{ type: 'tool_result' as const, tool_use_id: m.tool_call_id || '', content: m.content }],
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text' as const, text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({ type: 'tool_use' as const, id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
      }
      return { role: 'assistant' as const, content: blocks };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });

  const params: any = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    stream: true,
  };

  if (systemMsg) params.system = systemMsg.content;
  if (req.tools?.length) {
    params.tools = req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const stream = client.messages.stream(params);

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream as any) {
    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        yield { type: 'text_delta', content: event.delta.text };
      } else if (event.delta?.type === 'input_json_delta') {
        yield { type: 'tool_call_delta', toolArgs: event.delta.partial_json };
      }
    } else if (event.type === 'content_block_start') {
      if (event.content_block?.type === 'tool_use') {
        yield { type: 'tool_call_delta', toolCallId: event.content_block.id, toolName: event.content_block.name };
      }
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage?.output_tokens || 0;
    } else if (event.type === 'message_start') {
      inputTokens = event.message?.usage?.input_tokens || 0;
    }
  }

  const config = getModelConfig(req.model);
  const costUSD = config
    ? (inputTokens / 1000) * config.costPer1kInput + (outputTokens / 1000) * config.costPer1kOutput
    : 0;
  costTracker.addCost(req.model, costUSD);

  yield {
    type: 'usage',
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
  };
  yield { type: 'done' };
}

// ============================================================
// EMBEDDING FUNCTION
// ============================================================
export async function createEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  const inputs = Array.isArray(req.input) ? req.input : [req.input];

  if (req.provider === 'openai') {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: llmApiKeys.openai });

    const response = await client.embeddings.create({ model: req.model, input: inputs });

    const config = getModelConfig(req.model);
    const totalTokens = response.usage.total_tokens;
    const costUSD = config ? (totalTokens / 1000) * config.costPer1kInput : 0;
    costTracker.addCost(req.model, costUSD);

    return {
      embeddings: response.data.map(d => d.embedding),
      model: req.model,
      usage: { totalTokens, costUSD },
    };
  }

  if (req.provider === 'ollama') {
    const model = req.model.replace('ollama:', '');
    const embeddings: number[][] = [];

    for (const input of inputs) {
      const response = await fetch(`${llmApiKeys.ollama}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: input }),
      });
      const data = await response.json() as any;
      embeddings.push(data.embedding);
    }

    return {
      embeddings,
      model: req.model,
      usage: { totalTokens: 0, costUSD: 0 },
    };
  }

  throw new Error(`Embedding not supported for provider: ${req.provider}`);
}

// ============================================================
// MAIN ROUTER — MoE dispatch with retry and health tracking
// ============================================================
const PROVIDER_MAP: Record<LLMProvider, (req: LLMCompletionRequest) => Promise<LLMCompletionResponse>> = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  google: callGoogle,
  mistral: callMistral,
  groq: callGroq,
  ollama: callOllama,
};

export async function callLLM(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const provider = req.provider;

  // Validate API key
  if (provider !== 'ollama' && !llmApiKeys[provider]) {
    throw new Error(`No API key configured for ${provider}. Add ${provider.toUpperCase()}_API_KEY to .env`);
  }

  // Cache check (non-tool calls only)
  if (!req.tools?.length) {
    try {
      const cacheKey = `llm:${createHash('md5').update(JSON.stringify(req)).digest('hex')}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for ${req.model}`);
        return JSON.parse(cached);
      }
    } catch {
      // Cache miss or Redis unavailable — continue
    }
  }

  logger.info(`Calling ${provider}/${req.model}`, {
    messages: req.messages.length,
    tools: req.tools?.length || 0,
  });

  const callFn = PROVIDER_MAP[provider];
  if (!callFn) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  // Execute with retry (max 2 attempts for transient errors)
  const response = await retry(
    () => callFn(req),
    2,     // maxRetries
    1000,  // initial delay
    2      // backoff factor
  );

  recordSuccess(provider, response.latencyMs);

  // Cache non-tool responses for 1 hour
  if (!req.tools?.length && response.content) {
    try {
      const cacheKey = `llm:${createHash('md5').update(JSON.stringify(req)).digest('hex')}`;
      await cacheSet(cacheKey, JSON.stringify(response), 3600);
    } catch {
      // Redis unavailable — skip caching
    }
  }

  logger.info(`${provider}/${req.model} responded`, {
    tokens: response.usage.totalTokens,
    cost: `$${response.usage.costUSD.toFixed(6)}`,
    latency: `${response.latencyMs}ms`,
    toolCalls: response.toolCalls.length,
  });

  return response;
}

// ============================================================
// STREAMING ROUTER — supports OpenAI, Anthropic, Groq, Mistral
// ============================================================
export async function* streamLLM(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
  const provider = req.provider;

  if (provider === 'openai') {
    yield* streamOpenAICompatible(req, llmApiKeys.openai);
  } else if (provider === 'groq') {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: llmApiKeys.groq, baseURL: 'https://api.groq.com/openai/v1' });
    yield* streamOpenAICompatible(req, client);
  } else if (provider === 'mistral') {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: llmApiKeys.mistral, baseURL: 'https://api.mistral.ai/v1' });
    yield* streamOpenAICompatible(req, client);
  } else if (provider === 'anthropic') {
    yield* streamAnthropic(req);
  } else {
    // Simulate streaming for providers without native support
    const response = await callLLM(req);
    if (response.content) {
      const words = response.content.split(' ');
      for (const word of words) {
        yield { type: 'text_delta', content: word + ' ' };
      }
    }
    if (response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call_delta', toolCallId: tc.id, toolName: tc.function.name, toolArgs: tc.function.arguments };
      }
    }
    yield { type: 'usage', usage: response.usage };
    yield { type: 'done' };
  }
}
