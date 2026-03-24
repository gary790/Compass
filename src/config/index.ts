import dotenv from 'dotenv';
import { LLMProvider, LLMModelConfig } from '../types/index.js';

dotenv.config();

function env(key: string, defaultVal: string = ''): string {
  return process.env[key] || defaultVal;
}

function envInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultVal;
}

function envBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val === 'true' || val === '1';
}

// ============================================================
// SERVER CONFIG
// ============================================================
export const serverConfig = {
  port: envInt('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  nodeEnv: env('NODE_ENV', 'development'),
  secretKey: env('SECRET_KEY', 'change-this-in-production-' + Date.now()),
  corsOrigins: env('CORS_ORIGINS', '*').split(','),
  previewPort: envInt('PREVIEW_PORT', 3001),
};

// ============================================================
// DATABASE CONFIG
// ============================================================
export const dbConfig = {
  url: env('DATABASE_URL', 'postgresql://agentic:agentic_password@localhost:5432/agentic_rag'),
  maxConnections: envInt('DB_MAX_CONNECTIONS', 20),
  idleTimeout: envInt('DB_IDLE_TIMEOUT', 30000),
};

export const redisConfig = {
  url: env('REDIS_URL', 'redis://localhost:6379'),
  maxRetries: envInt('REDIS_MAX_RETRIES', 3),
};

export const chromaConfig = {
  url: env('CHROMA_URL', 'http://localhost:8000'),
  collection: env('CHROMA_COLLECTION', 'agentic_rag_docs'),
  codeCollection: env('CHROMA_CODE_COLLECTION', 'code_embeddings'),
  memoryCollection: env('CHROMA_MEMORY_COLLECTION', 'conversation_memory'),
};

// ============================================================
// LLM PROVIDER CONFIGS
// ============================================================
export const llmApiKeys: Record<LLMProvider, string> = {
  openai: env('OPENAI_API_KEY'),
  anthropic: env('ANTHROPIC_API_KEY'),
  google: env('GOOGLE_AI_API_KEY'),
  mistral: env('MISTRAL_API_KEY'),
  groq: env('GROQ_API_KEY'),
  ollama: env('OLLAMA_BASE_URL', 'http://localhost:11434'),
};

export const defaultLLMConfig = {
  provider: env('DEFAULT_LLM_PROVIDER', 'openai') as LLMProvider,
  model: env('DEFAULT_MODEL', 'gpt-4o'),
  embedModel: env('DEFAULT_EMBED_MODEL', 'text-embedding-3-small'),
  embedDimensions: envInt('EMBED_DIMENSIONS', 1536),
  temperature: 0.7,
  maxTokens: 4096,
};

// ============================================================
// MODEL REGISTRY — All supported models with metadata
// ============================================================
export const MODEL_REGISTRY: Record<string, LLMModelConfig> = {
  // OpenAI
  'gpt-4o': {
    provider: 'openai', model: 'gpt-4o', displayName: 'GPT-4o',
    maxTokens: 16384, contextWindow: 128000,
    costPer1kInput: 0.0025, costPer1kOutput: 0.01,
    supportsTools: true, supportsStreaming: true, supportsVision: true,
    speed: 'medium', bestFor: ['code_generation', 'planning', 'general_reasoning', 'tool_use'],
  },
  'gpt-4o-mini': {
    provider: 'openai', model: 'gpt-4o-mini', displayName: 'GPT-4o Mini',
    maxTokens: 16384, contextWindow: 128000,
    costPer1kInput: 0.00015, costPer1kOutput: 0.0006,
    supportsTools: true, supportsStreaming: true, supportsVision: true,
    speed: 'fast', bestFor: ['classification', 'quick_tasks', 'rag_query', 'summarization'],
  },
  'text-embedding-3-small': {
    provider: 'openai', model: 'text-embedding-3-small', displayName: 'Embedding 3 Small',
    maxTokens: 8191, contextWindow: 8191,
    costPer1kInput: 0.00002, costPer1kOutput: 0,
    supportsTools: false, supportsStreaming: false, supportsVision: false,
    speed: 'fast', bestFor: ['embedding'],
  },
  // Anthropic
  'claude-3-5-sonnet-20241022': {
    provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet',
    maxTokens: 8192, contextWindow: 200000,
    costPer1kInput: 0.003, costPer1kOutput: 0.015,
    supportsTools: true, supportsStreaming: true, supportsVision: true,
    speed: 'medium', bestFor: ['code_review', 'long_context', 'safety_analysis', 'writing'],
  },
  'claude-3-5-haiku-20241022': {
    provider: 'anthropic', model: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku',
    maxTokens: 8192, contextWindow: 200000,
    costPer1kInput: 0.0008, costPer1kOutput: 0.004,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'fast', bestFor: ['quick_tasks', 'classification', 'extraction'],
  },
  // Google
  'gemini-2.0-flash': {
    provider: 'google', model: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash',
    maxTokens: 8192, contextWindow: 1048576,
    costPer1kInput: 0.0001, costPer1kOutput: 0.0004,
    supportsTools: true, supportsStreaming: true, supportsVision: true,
    speed: 'fast', bestFor: ['multimodal', 'large_context', 'fast_reasoning'],
  },
  'gemini-2.0-pro': {
    provider: 'google', model: 'gemini-2.0-pro', displayName: 'Gemini 2.0 Pro',
    maxTokens: 8192, contextWindow: 2097152,
    costPer1kInput: 0.00125, costPer1kOutput: 0.005,
    supportsTools: true, supportsStreaming: true, supportsVision: true,
    speed: 'medium', bestFor: ['complex_reasoning', 'huge_context', 'multimodal'],
  },
  // Mistral
  'mistral-large-latest': {
    provider: 'mistral', model: 'mistral-large-latest', displayName: 'Mistral Large',
    maxTokens: 8192, contextWindow: 128000,
    costPer1kInput: 0.002, costPer1kOutput: 0.006,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'medium', bestFor: ['multilingual', 'european_compliance', 'reasoning'],
  },
  'mistral-small-latest': {
    provider: 'mistral', model: 'mistral-small-latest', displayName: 'Mistral Small',
    maxTokens: 8192, contextWindow: 128000,
    costPer1kInput: 0.0002, costPer1kOutput: 0.0006,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'fast', bestFor: ['quick_tasks', 'cost_efficient'],
  },
  // Groq
  'llama-3.1-70b-versatile': {
    provider: 'groq', model: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B (Groq)',
    maxTokens: 8192, contextWindow: 131072,
    costPer1kInput: 0.00059, costPer1kOutput: 0.00079,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'fastest', bestFor: ['fast_inference', 'prototyping', 'classification'],
  },
  'llama-3.1-8b-instant': {
    provider: 'groq', model: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B (Groq)',
    maxTokens: 8192, contextWindow: 131072,
    costPer1kInput: 0.00005, costPer1kOutput: 0.00008,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'fastest', bestFor: ['ultra_fast', 'routing', 'simple_tasks'],
  },
  // Ollama (local)
  'ollama:llama3.1:8b': {
    provider: 'ollama', model: 'llama3.1:8b', displayName: 'Llama 3.1 8B (Local)',
    maxTokens: 4096, contextWindow: 131072,
    costPer1kInput: 0, costPer1kOutput: 0,
    supportsTools: true, supportsStreaming: true, supportsVision: false,
    speed: 'medium', bestFor: ['local', 'privacy', 'offline'],
  },
  'ollama:codellama:7b': {
    provider: 'ollama', model: 'codellama:7b', displayName: 'CodeLlama 7B (Local)',
    maxTokens: 4096, contextWindow: 16384,
    costPer1kInput: 0, costPer1kOutput: 0,
    supportsTools: false, supportsStreaming: true, supportsVision: false,
    speed: 'medium', bestFor: ['local_code', 'code_completion'],
  },
  'ollama:nomic-embed-text': {
    provider: 'ollama', model: 'nomic-embed-text', displayName: 'Nomic Embed (Local)',
    maxTokens: 8192, contextWindow: 8192,
    costPer1kInput: 0, costPer1kOutput: 0,
    supportsTools: false, supportsStreaming: false, supportsVision: false,
    speed: 'fast', bestFor: ['local_embedding'],
  },
};

// ============================================================
// MoE ROUTING RULES — Task type to model mapping
// ============================================================
export type TaskType = 
  | 'code_generation' | 'code_review' | 'rag_query' | 'planning' 
  | 'classification' | 'long_context' | 'embedding' | 'local'
  | 'fast_inference' | 'general_reasoning' | 'summarization';

export const MOE_ROUTING: Record<TaskType, { primary: string; fallback: string }> = {
  code_generation:   { primary: 'gpt-4o', fallback: 'claude-3-5-sonnet-20241022' },
  code_review:       { primary: 'claude-3-5-sonnet-20241022', fallback: 'gpt-4o' },
  rag_query:         { primary: 'gpt-4o-mini', fallback: 'gemini-2.0-flash' },
  planning:          { primary: 'gpt-4o', fallback: 'claude-3-5-sonnet-20241022' },
  classification:    { primary: 'llama-3.1-8b-instant', fallback: 'gpt-4o-mini' },
  long_context:      { primary: 'claude-3-5-sonnet-20241022', fallback: 'gemini-2.0-pro' },
  embedding:         { primary: 'text-embedding-3-small', fallback: 'ollama:nomic-embed-text' },
  local:             { primary: 'ollama:llama3.1:8b', fallback: 'llama-3.1-8b-instant' },
  fast_inference:    { primary: 'llama-3.1-70b-versatile', fallback: 'gpt-4o-mini' },
  general_reasoning: { primary: 'gpt-4o', fallback: 'claude-3-5-sonnet-20241022' },
  summarization:     { primary: 'gpt-4o-mini', fallback: 'claude-3-5-haiku-20241022' },
};

// ============================================================
// GITHUB CONFIG
// ============================================================
export const githubConfig = {
  token: env('GITHUB_TOKEN'),
  defaultOrg: env('GITHUB_DEFAULT_ORG'),
};

// ============================================================
// DEPLOYMENT CONFIG
// ============================================================
export const deployConfig = {
  cloudflare: {
    apiToken: env('CLOUDFLARE_API_TOKEN'),
    accountId: env('CLOUDFLARE_ACCOUNT_ID'),
  },
  vercel: {
    token: env('VERCEL_TOKEN'),
  },
};

// ============================================================
// WORKSPACE CONFIG
// ============================================================
export const workspaceConfig = {
  root: env('WORKSPACE_ROOT', './workspaces'),
  maxWorkspaces: envInt('MAX_WORKSPACES', 50),
  maxSizeMB: envInt('MAX_WORKSPACE_SIZE_MB', 500),
};

// ============================================================
// SANDBOX CONFIG — Docker container isolation
// ============================================================
export const sandboxConfigRef = {
  dockerSocket: env('DOCKER_SOCKET', '/var/run/docker.sock'),
  baseImage: env('SANDBOX_IMAGE', 'agentic-sandbox:latest'),
  networkName: env('SANDBOX_NETWORK', 'sandbox-network'),
  defaultCpuLimit: parseFloat(env('SANDBOX_CPU_LIMIT', '1.0')),
  defaultMemoryMB: envInt('SANDBOX_MEMORY_MB', 512),
  defaultDiskMB: envInt('SANDBOX_DISK_MB', 1024),
  maxContainers: envInt('SANDBOX_MAX_CONTAINERS', 20),
  idleTimeoutMs: envInt('SANDBOX_IDLE_TIMEOUT_MS', 1800000), // 30 min
  portRangeStart: envInt('SANDBOX_PORT_START', 4000),
  portRangeEnd: envInt('SANDBOX_PORT_END', 4100),
};

// ============================================================
// AGENT CONFIG
// ============================================================
export const agentConfig = {
  maxIterations: envInt('AGENT_MAX_ITERATIONS', 25),
  timeoutMs: envInt('AGENT_TIMEOUT_MS', 120000),
  maxConcurrentTools: envInt('AGENT_MAX_CONCURRENT_TOOLS', 5),
  enableHumanBreakpoints: envBool('AGENT_HUMAN_BREAKPOINTS', true),
  maxBudgetPerRequest: parseFloat(env('AGENT_MAX_BUDGET_PER_REQUEST', '1.0')),
};

// ============================================================
// RAG CONFIG
// ============================================================
export const ragConfig = {
  defaultChunkSize: envInt('RAG_CHUNK_SIZE', 500),
  defaultChunkOverlap: envInt('RAG_CHUNK_OVERLAP', 50),
  defaultTopK: envInt('RAG_TOP_K', 5),
  rrfK: envInt('RAG_RRF_K', 60),
  bm25Weight: parseFloat(env('RAG_BM25_WEIGHT', '0.4')),
  vectorWeight: parseFloat(env('RAG_VECTOR_WEIGHT', '0.6')),
  enableReranking: envBool('RAG_ENABLE_RERANKING', true),
};

// ============================================================
// AUTH CONFIG
// ============================================================
export const authConfig = {
  jwtSecret: env('JWT_SECRET', serverConfig.secretKey),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '24h'),
  bcryptRounds: envInt('BCRYPT_ROUNDS', 10),
  enableAuth: envBool('ENABLE_AUTH', false),  // Disabled by default for easy setup
};

// ============================================================
// RATE LIMITING
// ============================================================
export const rateLimitConfig = {
  chat: { windowMs: 60000, maxRequests: envInt('RATE_LIMIT_CHAT', 30) },
  rag: { windowMs: 60000, maxRequests: envInt('RATE_LIMIT_RAG', 60) },
  deploy: { windowMs: 300000, maxRequests: envInt('RATE_LIMIT_DEPLOY', 5) },
  general: { windowMs: 60000, maxRequests: envInt('RATE_LIMIT_GENERAL', 120) },
};

// ============================================================
// HELPER: Check which providers are configured
// ============================================================
export function getAvailableProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];
  if (llmApiKeys.openai) providers.push('openai');
  if (llmApiKeys.anthropic) providers.push('anthropic');
  if (llmApiKeys.google) providers.push('google');
  if (llmApiKeys.mistral) providers.push('mistral');
  if (llmApiKeys.groq) providers.push('groq');
  // Ollama is always "available" — it just might not be running
  providers.push('ollama');
  return providers;
}

export function getModelConfig(modelId: string): LLMModelConfig | undefined {
  return MODEL_REGISTRY[modelId];
}

export function getModelsForProvider(provider: LLMProvider): LLMModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.provider === provider);
}

export function getBestModelForTask(task: TaskType): LLMModelConfig {
  const route = MOE_ROUTING[task];
  const available = getAvailableProviders();
  
  const primaryConfig = MODEL_REGISTRY[route.primary];
  if (primaryConfig && available.includes(primaryConfig.provider)) {
    return primaryConfig;
  }
  
  const fallbackConfig = MODEL_REGISTRY[route.fallback];
  if (fallbackConfig && available.includes(fallbackConfig.provider)) {
    return fallbackConfig;
  }
  
  // Last resort: use any available model
  for (const provider of available) {
    const models = getModelsForProvider(provider);
    if (models.length > 0) return models[0];
  }
  
  throw new Error(`No LLM providers configured. Add at least one API key to .env`);
}
