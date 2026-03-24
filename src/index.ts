import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { serverConfig, chromaConfig } from './config/index.js';
import { createLogger, performanceTracker } from './utils/index.js';
import { initializeTools } from './tools/index.js';
import { testConnection } from './database/client.js';
import { connectRedis } from './database/redis.js';
import { setupWebSocket, getConnectedClients, getPendingApprovalCount } from './routes/websocket.js';
import { getProviderHealth } from './llm/router.js';

// Import routes
import chatRoutes from './routes/chat.js';
import ragRoutes from './routes/rag.js';
import workspaceRoutes from './routes/workspace.js';
import systemRoutes from './routes/system.js';
import authRoutes from './routes/auth.js';
import memoryRoutes from './routes/memory.js';
import sandboxRoutes from './routes/sandbox.js';

import fs from 'fs/promises';
import path from 'path';
import { sandboxManager, resourceMonitor } from './sandbox/index.js';

const logger = createLogger('Server');

// ============================================================
// CREATE HONO APP
// ============================================================
const app = new Hono();

// ============================================================
// WEBSOCKET SETUP (must happen before middleware)
// ============================================================
const { injectWebSocket } = setupWebSocket(app);

// ============================================================
// MIDDLEWARE
// ============================================================
app.use('*', cors({
  origin: serverConfig.corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Conversation-Id'],
  credentials: true,
}));

app.use('*', honoLogger());

// Error handler
app.onError((err, c) => {
  logger.error(`Unhandled error: ${err.message}`);
  return c.json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: err.message },
  }, 500);
});

// ============================================================
// STATIC FILES
// ============================================================
app.use('/static/*', serveStatic({ root: './public' }));

// ============================================================
// API ROUTES
// ============================================================
app.route('/api/chat', chatRoutes);
app.route('/api/rag', ragRoutes);
app.route('/api/workspace', workspaceRoutes);
app.route('/api/system', systemRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/memory', memoryRoutes);
app.route('/api/sandbox', sandboxRoutes);

// ============================================================
// HEALTH CHECK — Enhanced with detailed system state
// ============================================================
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '1.9.0',
    sandbox: {
      dockerAvailable: sandboxManager.isDockerAvailable(),
      runningContainers: sandboxManager.getRunningCount(),
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    websocket: {
      clients: getConnectedClients().length,
      pendingApprovals: getPendingApprovalCount(),
    },
  });
});

// ============================================================
// PROVIDER HEALTH ENDPOINT
// ============================================================
app.get('/api/system/health/providers', (c) => {
  return c.json({
    success: true,
    data: getProviderHealth(),
  });
});

// ============================================================
// MAIN DASHBOARD — Serve the GenUI frontend
// ============================================================
app.get('/', async (c) => {
  try {
    const html = await fs.readFile(path.resolve('public/index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.html(generateFallbackHTML());
  }
});

// ============================================================
// AI AGENT PAGES — Each service icon has its own full-page agent
// ============================================================
const agentPages: Record<string, string> = {
  '/ai-slides': 'public/ai-slides.html',
  '/ai-sheets': 'public/ai-sheets.html',
  '/ai-docs': 'public/ai-slides.html',     // Placeholder
  '/ai-designer': 'public/ai-slides.html', // Placeholder
  '/ai-image': 'public/ai-slides.html',    // Placeholder
  '/ai-music': 'public/ai-slides.html',    // Placeholder
  '/ai-video': 'public/ai-slides.html',    // Placeholder
  '/ai-meeting-notes': 'public/ai-slides.html', // Placeholder
  '/ai-agents': 'public/ai-slides.html',   // Placeholder
};

for (const [route, file] of Object.entries(agentPages)) {
  app.get(route, async (c) => {
    try {
      const html = await fs.readFile(path.resolve(file), 'utf-8');
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });
}

// Catch-all for SPA routing (but NOT for /api/* or /ws)
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
    return c.notFound();
  }
  try {
    const html = await fs.readFile(path.resolve('public/index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.notFound();
  }
});

// ============================================================
// STARTUP
// ============================================================
async function startup() {
  console.log('');
  console.log('  Agentic RAG Platform v1.9.0 — Maximum Performance');
  console.log('  Starting up...');
  console.log('');

  logger.info('╔══════════════════════════════════════╗');
  logger.info('║   Agentic RAG Platform v1.9.0       ║');
  logger.info('║   MoE · Hybrid RAG · 60 Tools        ║');
  logger.info('║   Full Stack · 100% Connected         ║');
  logger.info('╚══════════════════════════════════════╝');
  logger.info('');

  // Initialize tools
  initializeTools();

  // Initialize sandbox manager (Docker container isolation)
  try {
    await sandboxManager.initialize();
    if (sandboxManager.isDockerAvailable()) {
      resourceMonitor.start(60000); // Collect metrics every 60s
      logger.info('✅ Docker sandbox isolation enabled');
    } else {
      logger.warn('⚠ Docker not available — running in host mode (no sandbox isolation)');
    }
  } catch (err: any) {
    logger.warn(`Sandbox init skipped: ${err.message}`);
  }

  // Test database connection (non-blocking — app works without it)
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.warn('⚠ PostgreSQL not connected — some features will be limited');
    logger.warn('  (Optional) Run: docker-compose up -d');
  }

  // Connect Redis (non-blocking — app works without it)
  const redisConnected = await connectRedis();
  if (!redisConnected) {
    logger.warn('⚠ Redis not connected — caching and rate limiting disabled');
  }

  // Test ChromaDB connection (non-blocking — app works without it)
  try {
    const chromaRes = await fetch(`${chromaConfig.url}/api/v2/heartbeat`, { signal: AbortSignal.timeout(3000) });
    if (chromaRes.ok) {
      logger.info('✅ ChromaDB connected (vector store ready)');
    } else {
      logger.warn('⚠ ChromaDB returned non-OK — vector search may be limited');
    }
  } catch {
    logger.warn('⚠ ChromaDB not available — vector search disabled');
  }

  // Ensure workspace directory
  try {
    await fs.mkdir(path.resolve('./workspaces/default'), { recursive: true });
  } catch {}

  // Start server with WebSocket support
  // Use localhost instead of 0.0.0.0 on Windows to avoid firewall popups
  const host = serverConfig.host;
  const port = serverConfig.port;

  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port: port,
  }, (info) => {
    console.log('');
    console.log(`  ✔ Server running at http://localhost:${port}`);
    console.log(`  ✔ Open http://localhost:${port} in your browser`);
    console.log('');
    logger.info(`🚀 Server:    http://${info.address}:${info.port}`);
    logger.info(`📊 Dashboard: http://localhost:${port}`);
    logger.info(`🔌 WebSocket: ws://localhost:${port}/ws`);
    logger.info(`📡 API:       http://localhost:${port}/api`);
    logger.info(`❤️  Health:    http://localhost:${port}/api/health`);
    logger.info('');
  });

  // Handle server errors (e.g., port already in use)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ERROR: Port ${port} is already in use.`);
      console.error(`  Fix: Close the other program using port ${port}, or`);
      console.error(`  set PORT=3001 in your .env file and try again.\n`);
    } else {
      console.error(`\n  ERROR: ${err.message}\n`);
    }
    process.exit(1);
  });

  // Inject WebSocket into the HTTP server
  injectWebSocket(server);
}

function generateFallbackHTML(): string {
  return `<!DOCTYPE html>
<html><head><title>Agentic RAG Platform</title>
<style>body{font-family:system-ui;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:500px}
h1{color:#e94560}a{color:#74b9ff}</style></head>
<body><div class="card">
<h1>Agentic RAG Platform v1.9.0</h1>
<p>The dashboard will appear once the frontend is loaded.</p>
<p>API: <a href="/api/health">/api/health</a></p>
<p>Status: <a href="/api/system/status">/api/system/status</a></p>
<p>Tools: <a href="/api/system/tools">/api/system/tools</a></p>
<p>WebSocket: <code>ws://localhost:3000/ws</code></p>
</div></body></html>`;
}

// Catch unhandled errors so Windows doesn't silently close the terminal
process.on('uncaughtException', (err) => {
  console.error(`\n  FATAL ERROR: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  console.error(`\n  UNHANDLED PROMISE: ${reason?.message || reason}\n`);
});

startup().catch((error) => {
  console.error(`\n  STARTUP FAILED: ${error.message}\n`);
  console.error(error.stack);
  logger.error(`Startup failed: ${error.message}`);
  process.exit(1);
});

export default app;
