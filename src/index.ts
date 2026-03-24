import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { serverConfig } from './config/index.js';
import { createLogger } from './utils/index.js';
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

import fs from 'fs/promises';
import path from 'path';

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

// ============================================================
// HEALTH CHECK — Enhanced with detailed system state
// ============================================================
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '1.1.0',
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
  logger.info('');
  logger.info('╔══════════════════════════════════════╗');
  logger.info('║   Agentic RAG Platform v1.1.0       ║');
  logger.info('║   MoE · Hybrid RAG · 45+ Tools      ║');
  logger.info('║   GenUI · WebSocket · Graph Orch.    ║');
  logger.info('╚══════════════════════════════════════╝');
  logger.info('');

  // Initialize tools
  initializeTools();

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.warn('⚠ PostgreSQL not connected — some features will be limited');
    logger.warn('  Run: docker-compose up -d');
  }

  // Connect Redis
  const redisConnected = await connectRedis();
  if (!redisConnected) {
    logger.warn('⚠ Redis not connected — caching and rate limiting disabled');
  }

  // Ensure workspace directory
  try {
    await fs.mkdir(path.resolve('./workspaces/default'), { recursive: true });
  } catch {}

  // Start server with WebSocket support
  const server = serve({
    fetch: app.fetch,
    hostname: serverConfig.host,
    port: serverConfig.port,
  }, (info) => {
    logger.info(`🚀 Server:    http://${info.address}:${info.port}`);
    logger.info(`📊 Dashboard: http://localhost:${serverConfig.port}`);
    logger.info(`🔌 WebSocket: ws://localhost:${serverConfig.port}/ws`);
    logger.info(`📡 API:       http://localhost:${serverConfig.port}/api`);
    logger.info(`❤️  Health:    http://localhost:${serverConfig.port}/api/health`);
    logger.info('');
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
<h1>Agentic RAG Platform v1.1.0</h1>
<p>The dashboard will appear once the frontend is loaded.</p>
<p>API: <a href="/api/health">/api/health</a></p>
<p>Status: <a href="/api/system/status">/api/system/status</a></p>
<p>Tools: <a href="/api/system/tools">/api/system/tools</a></p>
<p>WebSocket: <code>ws://localhost:3000/ws</code></p>
</div></body></html>`;
}

startup().catch((error) => {
  logger.error(`Startup failed: ${error.message}`);
  process.exit(1);
});

export default app;
