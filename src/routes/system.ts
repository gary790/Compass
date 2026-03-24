import { Hono } from 'hono';
import { getAvailableProviders, MODEL_REGISTRY, getModelsForProvider, MOE_ROUTING, llmApiKeys, serverConfig } from '../config/index.js';
import { toolRegistry } from '../tools/index.js';
import { costTracker, performanceTracker } from '../utils/index.js';
import { testConnection } from '../database/client.js';
import { getProviderHealth } from '../llm/router.js';
import { getConnectedClients, getPendingApprovalCount } from './websocket.js';
import { execSync } from 'child_process';

const PLATFORM_VERSION = '1.8.0';
const systemRoutes = new Hono();

// Request timing middleware for system routes
systemRoutes.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const duration = performance.now() - start;
  c.header('X-Response-Time', `${duration.toFixed(2)}ms`);
  c.header('X-Platform-Version', PLATFORM_VERSION);
});

// GET /api/system/status — Platform health check (comprehensive)
systemRoutes.get('/status', async (c) => {
  const dbConnected = await testConnection();
  const providers = getAvailableProviders();
  const mem = process.memoryUsage();
  const perf = performanceTracker.getSnapshot();
  const tools = toolRegistry.getAll();
  const categories = [...new Set(tools.map(t => t.category))];

  return c.json({
    success: true,
    data: {
      status: 'running',
      version: PLATFORM_VERSION,
      uptime: process.uptime(),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      llmProviders: providers,
      toolCount: tools.length,
      toolCategories: categories,
      memory: {
        used: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(mem.heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
        external: Math.round((mem.external || 0) / 1024 / 1024) + ' MB',
        heapUsedPercent: Math.round(mem.heapUsed / mem.heapTotal * 100),
      },
      websocket: {
        connectedClients: getConnectedClients().length,
        pendingApprovals: getPendingApprovalCount(),
      },
      providerHealth: getProviderHealth(),
      costs: costTracker.getDetailedSummary(),
      performance: perf,
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

// GET /api/system/costs — Detailed usage and cost tracking
systemRoutes.get('/costs', (c) => {
  return c.json({
    success: true,
    data: costTracker.getDetailedSummary(),
  });
});

// GET /api/system/performance — Performance metrics
systemRoutes.get('/performance', (c) => {
  return c.json({
    success: true,
    data: performanceTracker.getSnapshot(),
  });
});

// POST /api/terminal/exec — Execute terminal commands
systemRoutes.post('/terminal/exec', async (c) => {
  const { command, workspaceId } = await c.req.json();
  if (!command || typeof command !== 'string') {
    return c.json({ success: false, error: { message: 'Command required' } }, 400);
  }

  // Block dangerous commands
  const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb', 'shutdown', 'reboot', 'halt'];
  if (blocked.some(b => command.includes(b))) {
    return c.json({ success: false, error: { message: 'Command blocked for safety' } }, 403);
  }

  try {
    const cwd = workspaceId ? `./workspaces/${workspaceId}` : './workspaces/default';
    const output = execSync(command, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 512,
      encoding: 'utf-8',
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    return c.json({
      success: true,
      data: {
        command,
        output: output.substring(0, 50000),
        exitCode: 0,
        cwd,
      },
    });
  } catch (err: any) {
    return c.json({
      success: true,
      data: {
        command,
        output: (err.stdout || '').substring(0, 50000),
        stderr: (err.stderr || '').substring(0, 10000),
        exitCode: err.status || 1,
        cwd: workspaceId ? `./workspaces/${workspaceId}` : './workspaces/default',
      },
    });
  }
});

// GET /api/system/deploy/status — Deployment status
systemRoutes.get('/deploy/status', async (c) => {
  const deployments = performanceTracker.getDeployments();
  return c.json({
    success: true,
    data: {
      deployments,
      platforms: ['cloudflare', 'vercel'],
      currentPlatform: 'cloudflare',
    },
  });
});

// GET /api/system/git/status — Git status for workspace
systemRoutes.get('/git/status', async (c) => {
  const workspaceId = c.req.query('workspaceId') || 'default';
  const cwd = `./workspaces/${workspaceId}`;
  try {
    const status = execSync('git status --porcelain 2>/dev/null || echo "NOT_A_GIT_REPO"', { cwd, encoding: 'utf-8', timeout: 5000 });
    const branch = execSync('git branch --show-current 2>/dev/null || echo ""', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    const logRaw = execSync('git log --oneline -20 2>/dev/null || echo ""', { cwd, encoding: 'utf-8', timeout: 5000 });
    const remoteUrl = execSync('git remote get-url origin 2>/dev/null || echo ""', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    const isGitRepo = !status.includes('NOT_A_GIT_REPO');
    
    const commits = logRaw.trim().split('\n').filter(Boolean).map(line => {
      const [hash, ...rest] = line.split(' ');
      return { hash, message: rest.join(' ') };
    });

    const changes = isGitRepo ? status.trim().split('\n').filter(Boolean).map(line => ({
      status: line.substring(0, 2).trim(),
      file: line.substring(3),
    })) : [];

    return c.json({
      success: true,
      data: {
        isGitRepo,
        branch,
        remoteUrl,
        commits,
        changes,
        changedFileCount: changes.length,
        isClean: changes.length === 0,
      },
    });
  } catch (err: any) {
    return c.json({
      success: true,
      data: { isGitRepo: false, branch: '', remoteUrl: '', commits: [], changes: [], changedFileCount: 0, isClean: true },
    });
  }
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

// GET /api/system/websocket — WebSocket client info
systemRoutes.get('/websocket', (c) => {
  return c.json({
    success: true,
    data: {
      clients: getConnectedClients(),
      pendingApprovals: getPendingApprovalCount(),
    },
  });
});

export default systemRoutes;
