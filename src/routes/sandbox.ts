// ============================================================
// SANDBOX API ROUTES — Docker container management per workspace
// ============================================================
import { Hono } from 'hono';
import { createLogger } from '../utils/index.js';
import {
  sandboxManager,
  resourceMonitor,
  getSandboxEnvironment,
} from '../sandbox/index.js';

const logger = createLogger('SandboxRoute');
const sandboxRoutes = new Hono();

// ============================================================
// GET /api/sandbox — List all sandboxes with overview
// ============================================================
sandboxRoutes.get('/', async (c) => {
  const sandboxes = sandboxManager.listSandboxes();
  const overview = resourceMonitor.getSystemOverview();

  return c.json({
    success: true,
    data: {
      overview,
      dockerAvailable: sandboxManager.isDockerAvailable(),
      sandboxes: sandboxes.map(s => ({
        id: s.id,
        workspaceId: s.workspaceId,
        containerName: s.containerName,
        containerId: s.containerId?.substring(0, 12),
        status: s.status,
        ipAddress: s.ipAddress,
        port: s.allocatedPort,
        resources: s.resources,
        metrics: s.metrics,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        lastActiveAt: s.lastActiveAt,
        restartCount: s.restartCount,
        lastError: s.lastError,
      })),
    },
  });
});

// ============================================================
// POST /api/sandbox — Create a new sandbox for a workspace
// ============================================================
sandboxRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { workspaceId, cpuLimit, memoryMB, diskMB, pidsLimit, environment } = body;

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'workspaceId is required' } }, 400);
  }

  if (!sandboxManager.isDockerAvailable()) {
    return c.json({
      success: false,
      error: {
        code: 'DOCKER_UNAVAILABLE',
        message: 'Docker is not available. Sandbox isolation requires Docker Engine.',
      },
    }, 503);
  }

  try {
    const sandbox = await sandboxManager.create({
      workspaceId,
      cpuLimit,
      memoryMB,
      diskMB,
      pidsLimit,
      environment,
    });

    return c.json({
      success: true,
      data: {
        id: sandbox.id,
        workspaceId: sandbox.workspaceId,
        containerName: sandbox.containerName,
        containerId: sandbox.containerId?.substring(0, 12),
        status: sandbox.status,
        ipAddress: sandbox.ipAddress,
        port: sandbox.allocatedPort,
        resources: sandbox.resources,
      },
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: { code: 'CREATE_ERROR', message: error.message },
    }, 500);
  }
});

// ============================================================
// GET /api/sandbox/:workspaceId — Get sandbox details
// ============================================================
sandboxRoutes.get('/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const sandbox = sandboxManager.getSandbox(workspaceId);

  if (!sandbox) {
    return c.json({
      success: true,
      data: {
        workspaceId,
        status: 'no_sandbox',
        dockerAvailable: sandboxManager.isDockerAvailable(),
        mode: sandboxManager.isDockerAvailable() ? 'docker_ready' : 'host',
      },
    });
  }

  const env = await getSandboxEnvironment(workspaceId);
  const snapshot = resourceMonitor.getLatestSnapshot(workspaceId);

  return c.json({
    success: true,
    data: {
      ...sandbox,
      containerId: sandbox.containerId?.substring(0, 12),
      environment: env,
      resourceSnapshot: snapshot,
    },
  });
});

// ============================================================
// POST /api/sandbox/:workspaceId/start — Start sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/start', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    const sandbox = await sandboxManager.start(workspaceId);
    return c.json({ success: true, data: { status: sandbox.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'START_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// POST /api/sandbox/:workspaceId/stop — Stop sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/stop', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    const sandbox = await sandboxManager.stop(workspaceId);
    return c.json({ success: true, data: { status: sandbox.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'STOP_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// POST /api/sandbox/:workspaceId/restart — Restart sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/restart', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    const sandbox = await sandboxManager.restart(workspaceId);
    return c.json({ success: true, data: { status: sandbox.status, restartCount: sandbox.restartCount } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'RESTART_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// DELETE /api/sandbox/:workspaceId — Destroy sandbox
// ============================================================
sandboxRoutes.delete('/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    await sandboxManager.destroy(workspaceId);
    return c.json({ success: true, data: { destroyed: true } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'DESTROY_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// POST /api/sandbox/:workspaceId/pause — Pause sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/pause', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    const sandbox = await sandboxManager.pause(workspaceId);
    return c.json({ success: true, data: { status: sandbox.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'PAUSE_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// POST /api/sandbox/:workspaceId/unpause — Resume sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/unpause', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  try {
    const sandbox = await sandboxManager.unpause(workspaceId);
    return c.json({ success: true, data: { status: sandbox.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'UNPAUSE_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// GET /api/sandbox/:workspaceId/health — Health check
// ============================================================
sandboxRoutes.get('/:workspaceId/health', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const health = await sandboxManager.healthCheck(workspaceId);
  return c.json({ success: true, data: health });
});

// ============================================================
// GET /api/sandbox/:workspaceId/metrics — Resource metrics
// ============================================================
sandboxRoutes.get('/:workspaceId/metrics', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const metrics = await sandboxManager.getMetrics(workspaceId);
  const snapshot = resourceMonitor.getLatestSnapshot(workspaceId);
  const history = resourceMonitor.getHistory(workspaceId, 60);

  return c.json({
    success: true,
    data: {
      current: metrics,
      snapshot,
      history: history.map(h => ({
        timestamp: h.timestamp,
        cpu: h.cpu.usagePercent,
        memory: h.memory.percent,
        disk: h.disk.percent,
        processes: h.processes.count,
        status: h.status,
      })),
    },
  });
});

// ============================================================
// GET /api/sandbox/:workspaceId/logs — Container logs
// ============================================================
sandboxRoutes.get('/:workspaceId/logs', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const tail = parseInt(c.req.query('tail') || '100');
  const logs = await sandboxManager.getLogs(workspaceId, tail);
  return c.json({ success: true, data: { logs, lines: logs.split('\n').length } });
});

// ============================================================
// GET /api/sandbox/:workspaceId/exec-history — Exec history
// ============================================================
sandboxRoutes.get('/:workspaceId/exec-history', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const limit = parseInt(c.req.query('limit') || '50');
  const history = await sandboxManager.getExecHistory(workspaceId, limit);
  return c.json({ success: true, data: { entries: history, count: history.length } });
});

// ============================================================
// GET /api/sandbox/:workspaceId/events — Lifecycle events
// ============================================================
sandboxRoutes.get('/:workspaceId/events', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const limit = parseInt(c.req.query('limit') || '100');
  const events = await sandboxManager.getEvents(workspaceId, limit);
  return c.json({ success: true, data: { events, count: events.length } });
});

// ============================================================
// POST /api/sandbox/:workspaceId/exec — Execute command in sandbox
// ============================================================
sandboxRoutes.post('/:workspaceId/exec', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const body = await c.req.json();
  const { command, cwd, timeout } = body;

  if (!command) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'command is required' } }, 400);
  }

  try {
    const result = await sandboxManager.exec(workspaceId, command, { cwd, timeout });
    return c.json({
      success: true,
      data: {
        exitCode: result.exitCode,
        stdout: result.stdout.substring(0, 50000),
        stderr: result.stderr.substring(0, 10000),
        durationMs: result.durationMs,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'EXEC_ERROR', message: error.message } }, 500);
  }
});

export default sandboxRoutes;
