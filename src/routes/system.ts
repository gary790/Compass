import { Hono } from 'hono';
import { getAvailableProviders, MODEL_REGISTRY, getModelsForProvider, MOE_ROUTING, llmApiKeys } from '../config/index.js';
import { toolRegistry } from '../tools/index.js';
import { costTracker } from '../utils/index.js';
import { testConnection } from '../database/client.js';

const systemRoutes = new Hono();

// GET /api/system/status — Platform health check
systemRoutes.get('/status', async (c) => {
  const dbConnected = await testConnection();
  const providers = getAvailableProviders();

  return c.json({
    success: true,
    data: {
      status: 'running',
      version: '1.0.0',
      uptime: process.uptime(),
      database: dbConnected ? 'connected' : 'disconnected',
      llmProviders: providers,
      toolCount: toolRegistry.getAll().length,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      },
    },
  });
});

// GET /api/system/models — List available models
systemRoutes.get('/models', (c) => {
  const providers = getAvailableProviders();
  const models: Record<string, any[]> = {};

  for (const provider of providers) {
    models[provider] = getModelsForProvider(provider).map(m => ({
      id: m.model,
      name: m.displayName,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      supportsTools: m.supportsTools,
      supportsStreaming: m.supportsStreaming,
      supportsVision: m.supportsVision,
      speed: m.speed,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
      bestFor: m.bestFor,
    }));
  }

  return c.json({ success: true, data: { providers, models, routing: MOE_ROUTING } });
});

// GET /api/system/tools — List all tools
systemRoutes.get('/tools', (c) => {
  const tools = toolRegistry.getAll();
  const byCategory: Record<string, any[]> = {};

  for (const tool of tools) {
    if (!byCategory[tool.category]) byCategory[tool.category] = [];
    byCategory[tool.category].push({
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval || false,
    });
  }

  return c.json({
    success: true,
    data: { tools: byCategory, totalCount: tools.length, categories: Object.keys(byCategory) },
  });
});

// GET /api/system/costs — Usage and cost tracking
systemRoutes.get('/costs', (c) => {
  return c.json({
    success: true,
    data: costTracker.getSummary(),
  });
});

// GET /api/system/config — Non-sensitive configuration
systemRoutes.get('/config', (c) => {
  const providers = getAvailableProviders();
  return c.json({
    success: true,
    data: {
      configuredProviders: providers.filter(p => p !== 'ollama'),
      ollamaConfigured: !!llmApiKeys.ollama,
      defaultProvider: providers[0] || 'none',
      toolCategories: [...new Set(toolRegistry.getAll().map(t => t.category))],
      totalTools: toolRegistry.getAll().length,
    },
  });
});

export default systemRoutes;
