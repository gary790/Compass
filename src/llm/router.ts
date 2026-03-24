import {
  LLMProvider, LLMCompletionRequest, LLMCompletionResponse,
  LLMStreamChunk, LLMMessage, LLMToolDefinition, EmbeddingRequest, EmbeddingResponse
} from '../types/index.js';
import { llmApiKeys, MODEL_REGISTRY, getModelConfig } from '../config/index.js';
import { createLogger, generateId, costTracker } from '../utils/index.js';
import { cacheGet, cacheSet } from '../database/redis.js';
import { createHash } from 'crypto';

const logger = createLogger('LLM-Router');

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

  // Extract system message
  const systemMsg = req.messages.find(m => m.role === 'system');
  const otherMsgs = req.messages.filter(m => m.role !== 'system');

  // Convert messages to Anthropic format
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
      return {
        role: 'assistant' as const,
        content: m.tool_calls.map(tc => ({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })),
      };
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

  // Convert messages to Google format
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

  // Estimate tokens for Google (they don't always return usage)
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
  // Groq uses OpenAI-compatible API
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: llmApiKeys.groq,
    baseURL: 'https://api.groq.com/openai/v1',
  });

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
    provider: 'groq',
    model: req.model,
    content: choice.message.content,
    toolCalls: (choice.message.tool_calls || []).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUSD },
    finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    latencyMs,
  };
}

async function callMistral(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  // Mistral also uses OpenAI-compatible API
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: llmApiKeys.mistral,
    baseURL: 'https://api.mistral.ai/v1',
  });

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
    provider: 'mistral',
    model: req.model,
    content: choice.message.content,
    toolCalls: (choice.message.tool_calls || []).map(tc => ({
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
    messages: req.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    stream: false,
    options: {
      temperature: req.temperature ?? 0.7,
      num_predict: req.maxTokens ?? 4096,
    },
  };

  if (req.tools?.length) {
    body.tools = req.tools.map(t => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
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

async function* streamOpenAI(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
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

// ============================================================
// EMBEDDING FUNCTION
// ============================================================
export async function createEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  const inputs = Array.isArray(req.input) ? req.input : [req.input];

  if (req.provider === 'openai') {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: llmApiKeys.openai });

    const response = await client.embeddings.create({
      model: req.model,
      input: inputs,
    });

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
// MAIN ROUTER — The MoE dispatch function
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

  // Check if provider has API key
  if (provider !== 'ollama' && !llmApiKeys[provider]) {
    throw new Error(`No API key configured for ${provider}. Add ${provider.toUpperCase()}_API_KEY to .env`);
  }

  // Check cache for identical requests (non-tool calls only)
  if (!req.tools?.length) {
    const cacheKey = `llm:${createHash('md5').update(JSON.stringify(req)).digest('hex')}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for ${req.model}`);
      return JSON.parse(cached);
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

  const response = await callFn(req);

  // Cache non-tool responses for 1 hour
  if (!req.tools?.length && response.content) {
    const cacheKey = `llm:${createHash('md5').update(JSON.stringify(req)).digest('hex')}`;
    await cacheSet(cacheKey, JSON.stringify(response), 3600);
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
// STREAMING ROUTER
// ============================================================
export async function* streamLLM(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
  if (req.provider === 'openai' || req.provider === 'groq' || req.provider === 'mistral') {
    // All OpenAI-compatible providers
    yield* streamOpenAI({
      ...req,
      ...(req.provider === 'groq' ? {} : {}),
    });
  } else {
    // For providers without native streaming, simulate it
    const response = await callLLM(req);
    if (response.content) {
      // Simulate streaming by chunking the response
      const words = response.content.split(' ');
      for (const word of words) {
        yield { type: 'text_delta', content: word + ' ' };
      }
    }
    if (response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        yield {
          type: 'tool_call_delta',
          toolCallId: tc.id,
          toolName: tc.function.name,
          toolArgs: tc.function.arguments,
        };
      }
    }
    yield {
      type: 'usage',
      usage: response.usage,
    };
    yield { type: 'done' };
  }
}
