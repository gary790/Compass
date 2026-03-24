import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import path from 'path';
import {
  sandboxManager,
  resourceMonitor,
  getSandboxEnvironment,
} from '../../sandbox/index.js';

// ============================================================
// SANDBOX STATUS — Get current sandbox info for workspace
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_status',
    category: 'system',
    description: 'Get the sandbox container status, resource usage, and configuration for the current workspace.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID (default: current workspace)' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ workspaceId: z.string().optional() }),
  async (args, ctx) => {
    const wsId = args.workspaceId || path.basename(ctx.workspacePath);
    const sandbox = sandboxManager.getSandbox(wsId);
    const env = await getSandboxEnvironment(wsId);
    const snapshot = resourceMonitor.getLatestSnapshot(wsId);

    if (!sandbox) {
      return {
        mode: env.mode,
        status: 'no_sandbox',
        dockerAvailable: sandboxManager.isDockerAvailable(),
        message: env.mode === 'host'
          ? 'Workspace running on host (no Docker isolation). Docker may not be available.'
          : 'No sandbox container found for this workspace.',
      };
    }

    return {
      id: sandbox.id,
      workspaceId: sandbox.workspaceId,
      containerName: sandbox.containerName,
      containerId: sandbox.containerId?.substring(0, 12),
      status: sandbox.status,
      mode: 'docker',
      resources: sandbox.resources,
      metrics: snapshot || sandbox.metrics,
      network: {
        ipAddress: sandbox.ipAddress,
        previewPort: sandbox.allocatedPort,
      },
      environment: env,
      uptime: sandbox.startedAt
        ? `${Math.round((Date.now() - new Date(sandbox.startedAt).getTime()) / 60000)} minutes`
        : 'not started',
      restartCount: sandbox.restartCount,
      lastError: sandbox.lastError,
    };
  }
);

// ============================================================
// SANDBOX CREATE — Create a new sandbox for workspace
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_create',
    category: 'system',
    description: 'Create a new sandboxed Docker container for the workspace with resource limits.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
        cpuLimit: { type: 'number', description: 'CPU cores limit (e.g. 0.5, 1.0, 2.0)', default: 1.0 },
        memoryMB: { type: 'number', description: 'Memory limit in MB', default: 512 },
        diskMB: { type: 'number', description: 'Disk quota in MB', default: 1024 },
      },
      required: ['workspaceId'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({
    workspaceId: z.string(),
    cpuLimit: z.number().optional(),
    memoryMB: z.number().optional(),
    diskMB: z.number().optional(),
  }),
  async (args) => {
    if (!sandboxManager.isDockerAvailable()) {
      return {
        success: false,
        error: 'Docker is not available. Sandbox isolation requires Docker Engine.',
        suggestion: 'Install Docker and ensure /var/run/docker.sock is accessible.',
      };
    }

    const sandbox = await sandboxManager.create({
      workspaceId: args.workspaceId,
      cpuLimit: args.cpuLimit,
      memoryMB: args.memoryMB,
      diskMB: args.diskMB,
    });

    return {
      success: true,
      sandbox: {
        id: sandbox.id,
        containerName: sandbox.containerName,
        status: sandbox.status,
        port: sandbox.allocatedPort,
        resources: sandbox.resources,
      },
    };
  }
);

// ============================================================
// SANDBOX RESTART — Restart the sandbox container
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_restart',
    category: 'system',
    description: 'Restart the sandbox container for a workspace.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
      },
      required: ['workspaceId'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({ workspaceId: z.string() }),
  async (args) => {
    if (!sandboxManager.isDockerAvailable()) {
      return { success: false, error: 'Docker not available' };
    }

    const sandbox = await sandboxManager.restart(args.workspaceId);
    return {
      success: true,
      status: sandbox.status,
      restartCount: sandbox.restartCount,
    };
  }
);

// ============================================================
// SANDBOX STOP — Stop a sandbox container
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_stop',
    category: 'system',
    description: 'Stop the sandbox container for a workspace (preserves workspace files).',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
      },
      required: ['workspaceId'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({ workspaceId: z.string() }),
  async (args) => {
    if (!sandboxManager.isDockerAvailable()) {
      return { success: false, error: 'Docker not available' };
    }

    const sandbox = await sandboxManager.stop(args.workspaceId);
    return { success: true, status: sandbox.status };
  }
);

// ============================================================
// SANDBOX DESTROY — Remove the sandbox entirely
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_destroy',
    category: 'system',
    description: 'Destroy the sandbox container for a workspace (removes container, keeps workspace files).',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
      },
      required: ['workspaceId'],
    },
    requiresApproval: true,
    riskLevel: 'dangerous',
  },
  z.object({ workspaceId: z.string() }),
  async (args) => {
    if (!sandboxManager.isDockerAvailable()) {
      return { success: false, error: 'Docker not available' };
    }

    await sandboxManager.destroy(args.workspaceId);
    return { success: true, destroyed: true };
  }
);

// ============================================================
// SANDBOX LOGS — Get container logs
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_logs',
    category: 'system',
    description: 'Retrieve recent logs from the sandbox container.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
        tail: { type: 'number', description: 'Number of log lines to retrieve', default: 50 },
      },
      required: ['workspaceId'],
    },
    riskLevel: 'safe',
  },
  z.object({ workspaceId: z.string(), tail: z.number().optional() }),
  async (args) => {
    const logs = await sandboxManager.getLogs(args.workspaceId, args.tail || 50);
    return { logs, lineCount: logs.split('\n').length };
  }
);

// ============================================================
// SANDBOX LIST — List all sandbox containers
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_list',
    category: 'system',
    description: 'List all sandbox containers and their statuses.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
  },
  z.object({}),
  async () => {
    const sandboxes = sandboxManager.listSandboxes();
    const overview = resourceMonitor.getSystemOverview();

    return {
      overview,
      sandboxes: sandboxes.map(s => ({
        id: s.id,
        workspaceId: s.workspaceId,
        containerName: s.containerName,
        status: s.status,
        port: s.allocatedPort,
        resources: s.resources,
        metrics: s.metrics,
        uptime: s.startedAt
          ? `${Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000)}m`
          : null,
      })),
    };
  }
);

// ============================================================
// SANDBOX HEALTH — Health check a sandbox
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_health',
    category: 'system',
    description: 'Perform a health check on a sandbox container.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
      },
      required: ['workspaceId'],
    },
    riskLevel: 'safe',
  },
  z.object({ workspaceId: z.string() }),
  async (args) => {
    return await sandboxManager.healthCheck(args.workspaceId);
  }
);

// ============================================================
// SANDBOX EXEC HISTORY — Get recent command history
// ============================================================
toolRegistry.register(
  {
    name: 'sandbox_exec_history',
    category: 'system',
    description: 'Get recent command execution history for a sandbox.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID' },
        limit: { type: 'number', description: 'Number of entries (default: 20)', default: 20 },
      },
      required: ['workspaceId'],
    },
    riskLevel: 'safe',
  },
  z.object({ workspaceId: z.string(), limit: z.number().optional() }),
  async (args) => {
    const history = await sandboxManager.getExecHistory(args.workspaceId, args.limit || 20);
    return { entries: history, count: history.length };
  }
);

export default toolRegistry;
