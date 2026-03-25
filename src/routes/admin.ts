import { Hono } from 'hono';
import {
  getAvailableProviders,
  MODEL_REGISTRY,
  getModelsForProvider,
  MOE_ROUTING,
  llmApiKeys,
  serverConfig,
  agentConfig,
  ragConfig,
  rateLimitConfig,
  authConfig,
} from '../config/index.js';
import { toolRegistry } from '../tools/index.js';
import { costTracker, performanceTracker } from '../utils/index.js';
import { testConnection } from '../database/client.js';
import { getRedis } from '../database/redis.js';
import { getProviderHealth } from '../llm/router.js';
import { getConnectedClients, getPendingApprovalCount } from './websocket.js';
import { sandboxManager } from '../sandbox/index.js';

const adminRoutes = new Hono();

// ============================================================
// MIDDLEWARE — Timing + version header
// ============================================================
adminRoutes.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  c.header('X-Response-Time', `${(performance.now() - start).toFixed(2)}ms`);
});

// ============================================================
// DASHBOARD — Aggregated overview metrics
// ============================================================
adminRoutes.get('/dashboard', async (c) => {
  const costs = costTracker.getDetailedSummary();
  const perf = performanceTracker.getSnapshot();
  const mem = process.memoryUsage();
  const providers = getAvailableProviders();
  const tools = toolRegistry.getAll();
  const dbConnected = await testConnection();

  let redisStatus = 'disconnected';
  try {
    const redis = getRedis();
    if (redis && redis.status === 'ready') redisStatus = 'connected';
  } catch {}

  return c.json({
    success: true,
    data: {
      uptime: process.uptime(),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      services: {
        database: dbConnected ? 'connected' : 'disconnected',
        redis: redisStatus,
        sandbox: sandboxManager.isDockerAvailable() ? 'running' : 'unavailable',
      },
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        heapPercent: Math.round(mem.heapUsed / mem.heapTotal * 100),
      },
      websocket: {
        clients: getConnectedClients().length,
        pendingApprovals: getPendingApprovalCount(),
      },
      costs: costs,
      performance: perf,
      providers: providers.filter(p => p !== 'ollama'),
      providerCount: providers.filter(p => p !== 'ollama').length,
      toolCount: tools.length,
      toolCategories: [...new Set(tools.map(t => t.category))],
      providerHealth: getProviderHealth(),
    },
  });
});

// ============================================================
// API KEYS — List configured provider keys (masked)
// ============================================================
adminRoutes.get('/api-keys', (c) => {
  const providerKeys: any[] = [];
  const providerMeta: Record<string, { icon: string; color: string; label: string }> = {
    openai:    { icon: 'fa-bolt',        color: 'green',  label: 'OpenAI' },
    anthropic: { icon: 'fa-comment-dots', color: 'purple', label: 'Anthropic' },
    google:    { icon: 'fa-google',      color: 'blue',   label: 'Google AI' },
    mistral:   { icon: 'fa-wind',        color: 'orange', label: 'Mistral' },
    groq:      { icon: 'fa-gauge-high',  color: 'yellow', label: 'Groq' },
  };

  for (const [key, val] of Object.entries(llmApiKeys)) {
    if (key === 'ollama') continue;
    const meta = providerMeta[key] || { icon: 'fa-key', color: 'gray', label: key };
    providerKeys.push({
      id: key,
      provider: meta.label,
      icon: meta.icon,
      color: meta.color,
      configured: !!val && val.length > 5,
      maskedKey: val ? `${val.substring(0, 6)}...${val.substring(val.length - 4)}` : '',
      keyLength: val?.length || 0,
      models: getModelsForProvider(key as any).map(m => m.displayName),
    });
  }

  // Service-level keys
  const serviceKeys = [
    { id: 'github', label: 'GitHub', icon: 'fa-brands fa-github', configured: !!process.env.GITHUB_TOKEN, envVar: 'GITHUB_TOKEN' },
    { id: 'cloudflare', label: 'Cloudflare', icon: 'fa-cloud', configured: !!process.env.CLOUDFLARE_API_TOKEN, envVar: 'CLOUDFLARE_API_TOKEN' },
    { id: 'vercel', label: 'Vercel', icon: 'fa-triangle', configured: !!process.env.VERCEL_TOKEN, envVar: 'VERCEL_TOKEN' },
    { id: 'database', label: 'PostgreSQL', icon: 'fa-database', configured: !!process.env.DATABASE_URL, envVar: 'DATABASE_URL' },
    { id: 'redis', label: 'Redis', icon: 'fa-server', configured: !!process.env.REDIS_URL, envVar: 'REDIS_URL' },
    { id: 'chroma', label: 'ChromaDB', icon: 'fa-magnifying-glass', configured: !!process.env.CHROMA_URL, envVar: 'CHROMA_URL' },
  ];

  return c.json({ success: true, data: { providerKeys, serviceKeys } });
});

// ============================================================
// AGENTS — Configuration for each agent/service page
// ============================================================
adminRoutes.get('/agents', (c) => {
  const agents = [
    { id: 'ai-chat',     name: 'AI Chat',          icon: 'fa-comments',    route: '/',              model: 'gpt-4o', status: 'active', description: 'Agentic RAG conversation engine with tool use' },
    { id: 'ai-slides',   name: 'AI Slides',        icon: 'fa-presentation', route: '/ai-slides',    model: 'gpt-4o', status: 'active', description: 'Generate presentation slides from prompts' },
    { id: 'ai-sheets',   name: 'AI Sheets',        icon: 'fa-table',       route: '/ai-sheets',     model: 'gpt-4o-mini', status: 'active', description: 'Spreadsheet generation and data analysis' },
    { id: 'ai-docs',     name: 'AI Docs',          icon: 'fa-file-alt',    route: '/ai-docs',       model: 'gpt-4o', status: 'active', description: 'Document creation and editing' },
    { id: 'ai-designer', name: 'AI Designer',      icon: 'fa-palette',     route: '/ai-designer',   model: 'gpt-4o', status: 'active', description: 'UI/UX design and mockup generation' },
    { id: 'ai-image',    name: 'AI Image',         icon: 'fa-image',       route: '/ai-image',      model: 'dall-e-3', status: 'active', description: 'Image generation and editing' },
    { id: 'ai-music',    name: 'AI Music',         icon: 'fa-music',       route: '/ai-music',      model: 'gpt-4o-mini', status: 'active', description: 'Music composition and audio generation' },
    { id: 'ai-video',    name: 'AI Video',         icon: 'fa-video',       route: '/ai-video',      model: 'gpt-4o', status: 'active', description: 'Video creation and editing' },
    { id: 'ai-meeting',  name: 'AI Meeting Notes', icon: 'fa-clipboard',   route: '/ai-meeting-notes', model: 'gpt-4o-mini', status: 'active', description: 'Meeting transcription and summarization' },
    { id: 'ai-agents',   name: 'All Agents Hub',   icon: 'fa-robot',       route: '/ai-agents',     model: 'gpt-4o', status: 'active', description: 'Multi-agent orchestration hub' },
  ];

  return c.json({ success: true, data: { agents } });
});

// ============================================================
// MODELS — Full model registry with usage stats
// ============================================================
adminRoutes.get('/models', (c) => {
  const providers = getAvailableProviders();
  const models = Object.entries(MODEL_REGISTRY).map(([id, m]) => ({
    id,
    name: m.displayName,
    provider: m.provider,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    costPer1kInput: m.costPer1kInput,
    costPer1kOutput: m.costPer1kOutput,
    supportsTools: m.supportsTools,
    supportsStreaming: m.supportsStreaming,
    supportsVision: m.supportsVision,
    speed: m.speed,
    bestFor: m.bestFor,
    isAvailable: providers.includes(m.provider),
    isDefault: id === 'gpt-4o',
  }));

  return c.json({ success: true, data: { models, routing: MOE_ROUTING } });
});

// ============================================================
// USERS — Placeholder user management
// ============================================================
adminRoutes.get('/users', (c) => {
  // In a full system this would query the database.
  // For now return the owner and sample data so the UI works.
  const users = [
    { id: 1, name: 'Gary Bruckelmeyer', email: 'gary@eagleworks.com', role: 'owner', status: 'active', requests: 12847, lastActive: new Date().toISOString(), avatar: 'GB' },
    { id: 2, name: 'Demo User',          email: 'demo@example.com',    role: 'user',  status: 'active', requests: 342,   lastActive: new Date(Date.now() - 3600000).toISOString(), avatar: 'DU' },
  ];
  return c.json({ success: true, data: { users, total: users.length } });
});

// ============================================================
// BILLING — Cost breakdown and history
// ============================================================
adminRoutes.get('/billing', (c) => {
  const costs = costTracker.getDetailedSummary();
  return c.json({
    success: true,
    data: {
      currentMonth: costs,
      budget: {
        limit: agentConfig.maxBudgetPerRequest * 1000,
        used: costs.total || 0,
        percent: Math.min(100, Math.round(((costs.total || 0) / (agentConfig.maxBudgetPerRequest * 1000)) * 100)),
      },
    },
  });
});

// ============================================================
// LOGS — Recent request/error log entries
// ============================================================
adminRoutes.get('/logs', (c) => {
  const perf = performanceTracker.getSnapshot();
  // Build simulated log entries from performance data
  const logs: any[] = [];
  const levels = ['info', 'info', 'info', 'warn', 'error'];
  const msgs = [
    { level: 'info', msg: 'Chat completion request processed' },
    { level: 'info', msg: 'RAG pipeline: 5 documents retrieved' },
    { level: 'info', msg: 'Tool execution: file_read completed' },
    { level: 'warn', msg: 'Rate limit threshold 80% reached' },
    { level: 'info', msg: 'WebSocket client connected' },
    { level: 'info', msg: 'Embedding generated (1536 dims)' },
    { level: 'error', msg: 'Provider timeout: anthropic (retrying)' },
    { level: 'info', msg: 'Memory scan completed: 12 facts indexed' },
    { level: 'warn', msg: 'High memory usage detected: 85% heap' },
    { level: 'info', msg: 'Agent iteration 3/25 completed' },
  ];

  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const entry = msgs[i % msgs.length];
    logs.push({
      id: i,
      timestamp: new Date(now - i * 30000).toISOString(),
      level: entry.level,
      message: entry.msg,
      source: ['chat', 'rag', 'tools', 'system', 'websocket'][i % 5],
    });
  }

  return c.json({ success: true, data: { logs, total: logs.length } });
});

// ============================================================
// SETTINGS — Current platform configuration
// ============================================================
adminRoutes.get('/settings', (c) => {
  return c.json({
    success: true,
    data: {
      platform: {
        name: 'Agentic RAG Platform',
        version: '1.9.0',
        domain: process.env.PLATFORM_DOMAIN || '',
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'openai',
        defaultModel: process.env.DEFAULT_MODEL || 'gpt-4o',
      },
      rateLimit: rateLimitConfig,
      agent: {
        maxIterations: agentConfig.maxIterations,
        timeoutMs: agentConfig.timeoutMs,
        maxConcurrentTools: agentConfig.maxConcurrentTools,
        enableHumanBreakpoints: agentConfig.enableHumanBreakpoints,
        maxBudgetPerRequest: agentConfig.maxBudgetPerRequest,
      },
      rag: ragConfig,
      auth: {
        enabled: authConfig.enableAuth,
        jwtExpiresIn: authConfig.jwtExpiresIn,
      },
      featureFlags: {
        ragEnabled: true,
        sandboxEnabled: sandboxManager.isDockerAvailable(),
        memoryEnabled: true,
        workflowsEnabled: true,
        multiAgentEnabled: true,
        codeExecutionEnabled: true,
        deploymentEnabled: !!process.env.CLOUDFLARE_API_TOKEN || !!process.env.VERCEL_TOKEN,
        gitEnabled: !!process.env.GITHUB_TOKEN,
      },
    },
  });
});

// ============================================================
// SECURITY — Auth and security settings
// ============================================================
adminRoutes.get('/security', (c) => {
  return c.json({
    success: true,
    data: {
      auth: {
        enabled: authConfig.enableAuth,
        emailVerification: false,
        twoFactor: false,
        oauthProviders: ['google', 'github'],
      },
      cors: {
        origins: serverConfig.corsOrigins,
      },
      rateLimit: rateLimitConfig,
      requestLogging: true,
    },
  });
});

export default adminRoutes;
