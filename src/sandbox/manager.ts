// ============================================================
// SANDBOX MANAGER — Docker container lifecycle per workspace
// Creates, starts, stops, destroys containers with full isolation
// Uses Docker Engine API via HTTP (Unix socket /var/run/docker.sock)
// ============================================================
import http from 'http';
import { createLogger, generateId } from '../utils/index.js';
import { query as dbQuery } from '../database/client.js';
import { cacheGet, cacheSet, cacheDelete } from '../database/redis.js';
import { eventBus } from '../utils/index.js';

const logger = createLogger('SandboxManager');

// ============================================================
// CONFIGURATION
// ============================================================
export const sandboxConfig = {
  // Docker socket path
  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  // Sandbox base image
  baseImage: process.env.SANDBOX_IMAGE || 'agentic-sandbox:latest',
  // Network
  networkName: process.env.SANDBOX_NETWORK || 'sandbox-network',
  networkSubnet: process.env.SANDBOX_SUBNET || '172.30.0.0/16',
  // Resource defaults
  defaultCpuLimit: parseFloat(process.env.SANDBOX_CPU_LIMIT || '1.0'),
  defaultMemoryMB: parseInt(process.env.SANDBOX_MEMORY_MB || '512'),
  defaultDiskMB: parseInt(process.env.SANDBOX_DISK_MB || '1024'),
  defaultPidsLimit: parseInt(process.env.SANDBOX_PIDS_LIMIT || '256'),
  // Lifecycle
  maxContainersPerHost: parseInt(process.env.SANDBOX_MAX_CONTAINERS || '20'),
  idleTimeoutMs: parseInt(process.env.SANDBOX_IDLE_TIMEOUT_MS || '1800000'), // 30 min
  maxRestarts: parseInt(process.env.SANDBOX_MAX_RESTARTS || '5'),
  // Port range for preview
  portRangeStart: parseInt(process.env.SANDBOX_PORT_START || '4000'),
  portRangeEnd: parseInt(process.env.SANDBOX_PORT_END || '4100'),
  // Workspace root on host
  hostWorkspaceRoot: process.env.WORKSPACE_ROOT || './workspaces',
  // Container workspace mount point
  containerWorkspacePath: '/workspace',
};

// ============================================================
// TYPES
// ============================================================
export interface SandboxInfo {
  id: string;
  workspaceId: string;
  containerId: string | null;
  containerName: string;
  image: string;
  status: SandboxStatus;
  ipAddress: string | null;
  allocatedPort: number | null;
  resources: {
    cpuLimit: number;
    memoryLimitMB: number;
    diskLimitMB: number;
    pidsLimit: number;
  };
  metrics: {
    cpuUsagePercent: number;
    memoryUsageMB: number;
    diskUsageMB: number;
    processCount: number;
  };
  createdAt: string;
  startedAt: string | null;
  lastActiveAt: string;
  lastError: string | null;
  restartCount: number;
}

export type SandboxStatus =
  | 'pending' | 'creating' | 'running' | 'paused'
  | 'stopping' | 'stopped' | 'failed' | 'destroyed';

export interface SandboxCreateOptions {
  workspaceId: string;
  cpuLimit?: number;
  memoryMB?: number;
  diskMB?: number;
  pidsLimit?: number;
  environment?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ============================================================
// DOCKER ENGINE API — HTTP over Unix Socket
// ============================================================
async function dockerAPI(
  method: string,
  path: string,
  body?: any,
  timeout: number = 30000
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: sandboxConfig.dockerSocket,
      path: `/v1.43${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode || 500, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode || 500, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Docker API timeout')); });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Raw exec that returns the output stream
async function dockerExecRaw(
  containerId: string,
  command: string[],
  workDir?: string,
  envVars?: string[],
  timeout: number = 60000
): Promise<ExecResult> {
  const start = Date.now();

  // 1. Create exec instance
  const execCreate = await dockerAPI('POST', `/containers/${containerId}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: command,
    WorkingDir: workDir || sandboxConfig.containerWorkspacePath,
    Env: envVars || [],
  });

  if (execCreate.statusCode !== 201) {
    throw new Error(`Failed to create exec: ${JSON.stringify(execCreate.body)}`);
  }

  const execId = execCreate.body.Id;

  // 2. Start exec and capture output
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: sandboxConfig.dockerSocket,
      path: `/v1.43/exec/${execId}/start`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        const raw = Buffer.concat(chunks);
        // Docker multiplex stream: first 8 bytes per frame = header
        // [stream_type(1), 0, 0, 0, size(4 big-endian)]
        let stdout = '';
        let stderr = '';
        let offset = 0;
        while (offset + 8 <= raw.length) {
          const streamType = raw[offset];
          const frameSize = raw.readUInt32BE(offset + 4);
          offset += 8;
          if (offset + frameSize > raw.length) break;
          const payload = raw.subarray(offset, offset + frameSize).toString('utf-8');
          if (streamType === 1) stdout += payload;
          else if (streamType === 2) stderr += payload;
          offset += frameSize;
        }

        // 3. Inspect exec for exit code
        try {
          const inspect = await dockerAPI('GET', `/exec/${execId}/json`);
          resolve({
            exitCode: inspect.body.ExitCode ?? -1,
            stdout: stdout.substring(0, 100000),
            stderr: stderr.substring(0, 50000),
            durationMs: Date.now() - start,
          });
        } catch {
          resolve({
            exitCode: -1,
            stdout: stdout.substring(0, 100000),
            stderr: stderr.substring(0, 50000),
            durationMs: Date.now() - start,
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Exec timeout')); });
    req.write(JSON.stringify({ Detach: false, Tty: false }));
    req.end();
  });
}

// ============================================================
// PORT ALLOCATOR — Track and assign preview ports
// ============================================================
const allocatedPorts = new Set<number>();

async function allocatePort(): Promise<number> {
  // Load already-allocated ports from DB
  try {
    const result = await dbQuery(
      `SELECT allocated_port FROM sandbox_containers
       WHERE allocated_port IS NOT NULL AND status NOT IN ('destroyed','stopped','failed')`
    );
    for (const row of result.rows) {
      allocatedPorts.add(row.allocated_port);
    }
  } catch { /* DB not available */ }

  for (let port = sandboxConfig.portRangeStart; port <= sandboxConfig.portRangeEnd; port++) {
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      return port;
    }
  }
  throw new Error('No available ports in sandbox range');
}

function releasePort(port: number | null) {
  if (port) allocatedPorts.delete(port);
}

// ============================================================
// NETWORK MANAGEMENT — Isolated Docker network for sandboxes
// ============================================================
async function ensureSandboxNetwork(): Promise<string> {
  // Check if network exists
  try {
    const resp = await dockerAPI('GET', `/networks/${sandboxConfig.networkName}`);
    if (resp.statusCode === 200) {
      return resp.body.Id;
    }
  } catch { /* doesn't exist */ }

  // Create the network
  const createResp = await dockerAPI('POST', '/networks/create', {
    Name: sandboxConfig.networkName,
    Driver: 'bridge',
    Internal: false, // Allow outbound (for npm install, git clone)
    IPAM: {
      Config: [{ Subnet: sandboxConfig.networkSubnet }],
    },
    Labels: {
      'agentic.type': 'sandbox-network',
      'agentic.managed': 'true',
    },
  });

  if (createResp.statusCode !== 201) {
    throw new Error(`Failed to create sandbox network: ${JSON.stringify(createResp.body)}`);
  }

  logger.info(`Created sandbox network: ${sandboxConfig.networkName} (${createResp.body.Id?.substring(0, 12)})`);
  return createResp.body.Id;
}

// ============================================================
// SANDBOX MANAGER CLASS — Central lifecycle controller
// ============================================================
class SandboxManager {
  private containers: Map<string, SandboxInfo> = new Map(); // workspaceId -> SandboxInfo
  private networkId: string | null = null;
  private initialized: boolean = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // ============================================================
  // INITIALIZATION
  // ============================================================
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Test Docker connectivity
      const ping = await dockerAPI('GET', '/_ping');
      if (ping.statusCode !== 200) {
        throw new Error('Docker daemon not responding');
      }
      logger.info('Docker Engine connected');

      // Ensure sandbox network exists
      this.networkId = await ensureSandboxNetwork();

      // Load existing containers from DB
      await this.loadFromDB();

      // Reconcile: check actual Docker state vs DB
      await this.reconcile();

      // Start idle cleanup timer (every 60s)
      this.cleanupInterval = setInterval(() => this.cleanupIdleContainers(), 60000);

      this.initialized = true;
      logger.info(`SandboxManager initialized: ${this.containers.size} sandboxes loaded`);
    } catch (err: any) {
      logger.warn(`SandboxManager init failed (Docker may not be available): ${err.message}`);
      // Manager works in fallback mode — commands run on host
    }
  }

  isDockerAvailable(): boolean {
    return this.initialized;
  }

  // ============================================================
  // CREATE — Provision a new sandbox container for a workspace
  // ============================================================
  async create(options: SandboxCreateOptions): Promise<SandboxInfo> {
    const { workspaceId } = options;

    // Check if sandbox already exists
    const existing = this.containers.get(workspaceId);
    if (existing && existing.status !== 'destroyed' && existing.status !== 'failed') {
      logger.info(`Sandbox already exists for workspace ${workspaceId}: ${existing.status}`);
      if (existing.status === 'stopped') {
        return await this.start(workspaceId);
      }
      return existing;
    }

    // Check max container limit
    const activeCount = Array.from(this.containers.values())
      .filter(c => ['running', 'creating', 'paused'].includes(c.status)).length;
    if (activeCount >= sandboxConfig.maxContainersPerHost) {
      throw new Error(`Maximum sandbox limit reached (${sandboxConfig.maxContainersPerHost})`);
    }

    const sandboxId = generateId('sbx');
    const containerName = `sandbox-${workspaceId.replace(/[^a-z0-9-]/gi, '-')}`;
    const port = await allocatePort();

    const cpuLimit = options.cpuLimit || sandboxConfig.defaultCpuLimit;
    const memoryMB = options.memoryMB || sandboxConfig.defaultMemoryMB;
    const diskMB = options.diskMB || sandboxConfig.defaultDiskMB;
    const pidsLimit = options.pidsLimit || sandboxConfig.defaultPidsLimit;

    const info: SandboxInfo = {
      id: sandboxId,
      workspaceId,
      containerId: null,
      containerName,
      image: sandboxConfig.baseImage,
      status: 'creating',
      ipAddress: null,
      allocatedPort: port,
      resources: { cpuLimit, memoryLimitMB: memoryMB, diskLimitMB: diskMB, pidsLimit },
      metrics: { cpuUsagePercent: 0, memoryUsageMB: 0, diskUsageMB: 0, processCount: 0 },
      createdAt: new Date().toISOString(),
      startedAt: null,
      lastActiveAt: new Date().toISOString(),
      lastError: null,
      restartCount: 0,
    };

    this.containers.set(workspaceId, info);

    try {
      // Ensure network
      if (!this.networkId) {
        this.networkId = await ensureSandboxNetwork();
      }

      // Create container via Docker API
      const containerConfig = {
        Image: sandboxConfig.baseImage,
        Hostname: containerName,
        Env: [
          `WORKSPACE_ID=${workspaceId}`,
          `WORKSPACE_PATH=${sandboxConfig.containerWorkspacePath}`,
          'NODE_ENV=development',
          'HOME=/home/sandbox',
          ...Object.entries(options.environment || {}).map(([k, v]) => `${k}=${v}`),
        ],
        WorkingDir: sandboxConfig.containerWorkspacePath,
        Labels: {
          'agentic.sandbox': 'true',
          'agentic.workspace': workspaceId,
          'agentic.sandbox.id': sandboxId,
          ...options.labels,
        },
        // Security: drop all capabilities, add back only what's needed
        HostConfig: {
          Memory: memoryMB * 1024 * 1024,            // bytes
          MemorySwap: memoryMB * 1024 * 1024 * 2,    // 2x memory for swap
          NanoCPUs: Math.round(cpuLimit * 1e9),       // nanoseconds
          PidsLimit: pidsLimit,
          // Storage driver limit (requires overlay2 with quota)
          StorageOpt: diskMB > 0 ? { size: `${diskMB}M` } : undefined,
          // Bind mount workspace directory
          Binds: [
            `${sandboxConfig.hostWorkspaceRoot}/${workspaceId}:${sandboxConfig.containerWorkspacePath}`,
          ],
          // Port mapping for preview server
          PortBindings: {
            '3000/tcp': [{ HostPort: port.toString() }],
          },
          // Network
          NetworkMode: sandboxConfig.networkName,
          // Security
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
          CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID', 'NET_BIND_SERVICE'],
          // Read-only root fs with specific writable dirs
          ReadonlyRootfs: false, // npm needs write access
          // Temp filesystems
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=256m',
            '/run': 'rw,noexec,nosuid,size=64m',
          },
          // Restart policy
          RestartPolicy: {
            Name: 'on-failure',
            MaximumRetryCount: sandboxConfig.maxRestarts,
          },
        },
        ExposedPorts: {
          '3000/tcp': {},
        },
        // Healthcheck
        Healthcheck: {
          Test: ['CMD-SHELL', 'node -e "process.exit(0)" || exit 1'],
          Interval: 30000000000, // 30s in nanoseconds
          Timeout: 10000000000,  // 10s
          StartPeriod: 15000000000, // 15s
          Retries: 3,
        },
      };

      const createResp = await dockerAPI('POST', `/containers/create?name=${containerName}`, containerConfig);

      if (createResp.statusCode !== 201) {
        throw new Error(`Container create failed: ${JSON.stringify(createResp.body)}`);
      }

      info.containerId = createResp.body.Id;
      logger.info(`Container created: ${containerName} (${info.containerId?.substring(0, 12)})`);

      // Start the container
      const startResp = await dockerAPI('POST', `/containers/${info.containerId}/start`);
      if (startResp.statusCode !== 204 && startResp.statusCode !== 304) {
        throw new Error(`Container start failed: ${JSON.stringify(startResp.body)}`);
      }

      info.status = 'running';
      info.startedAt = new Date().toISOString();

      // Inspect for IP address
      const inspectResp = await dockerAPI('GET', `/containers/${info.containerId}/json`);
      if (inspectResp.statusCode === 200) {
        const networks = inspectResp.body?.NetworkSettings?.Networks;
        const sandboxNet = networks?.[sandboxConfig.networkName];
        if (sandboxNet) {
          info.ipAddress = sandboxNet.IPAddress;
        }
      }

      // Persist to DB
      await this.persistSandbox(info);
      await this.logEvent(info.id, 'created', { containerName, port, image: sandboxConfig.baseImage });
      await this.logEvent(info.id, 'started', { containerId: info.containerId?.substring(0, 12) });

      // Emit event
      eventBus.emit('workspace:create', {
        workspaceId,
        sandboxId: info.id,
        status: 'running',
        port,
      });

      logger.info(`Sandbox running: ${containerName} → :${port} (IP: ${info.ipAddress})`);
      return info;

    } catch (err: any) {
      info.status = 'failed';
      info.lastError = err.message;
      await this.persistSandbox(info);
      await this.logEvent(info.id, 'error', { error: err.message });
      releasePort(port);
      logger.error(`Sandbox creation failed for ${workspaceId}: ${err.message}`);
      throw err;
    }
  }

  // ============================================================
  // START — Resume a stopped container
  // ============================================================
  async start(workspaceId: string): Promise<SandboxInfo> {
    const info = this.containers.get(workspaceId);
    if (!info) throw new Error(`No sandbox for workspace: ${workspaceId}`);
    if (!info.containerId) throw new Error('No container ID — sandbox was never created');
    if (info.status === 'running') return info;

    const startResp = await dockerAPI('POST', `/containers/${info.containerId}/start`);
    if (startResp.statusCode !== 204 && startResp.statusCode !== 304) {
      throw new Error(`Start failed: ${JSON.stringify(startResp.body)}`);
    }

    info.status = 'running';
    info.startedAt = new Date().toISOString();
    info.lastActiveAt = new Date().toISOString();
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'started', {});
    logger.info(`Sandbox started: ${info.containerName}`);
    return info;
  }

  // ============================================================
  // STOP — Gracefully stop a container
  // ============================================================
  async stop(workspaceId: string): Promise<SandboxInfo> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) throw new Error(`No sandbox for workspace: ${workspaceId}`);

    info.status = 'stopping';
    await this.persistSandbox(info);

    const stopResp = await dockerAPI('POST', `/containers/${info.containerId}/stop?t=10`);
    if (stopResp.statusCode !== 204 && stopResp.statusCode !== 304) {
      logger.warn(`Stop returned ${stopResp.statusCode}: ${JSON.stringify(stopResp.body)}`);
    }

    info.status = 'stopped';
    (info as any).stoppedAt = new Date().toISOString();
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'stopped', {});
    logger.info(`Sandbox stopped: ${info.containerName}`);
    return info;
  }

  // ============================================================
  // DESTROY — Remove container and release resources
  // ============================================================
  async destroy(workspaceId: string): Promise<void> {
    const info = this.containers.get(workspaceId);
    if (!info) return;

    if (info.containerId) {
      // Force stop + remove
      try {
        await dockerAPI('POST', `/containers/${info.containerId}/stop?t=5`);
      } catch { /* might already be stopped */ }
      try {
        await dockerAPI('DELETE', `/containers/${info.containerId}?force=true&v=true`);
      } catch { /* might already be removed */ }
    }

    releasePort(info.allocatedPort);
    info.status = 'destroyed';
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'destroyed', {});
    this.containers.delete(workspaceId);
    logger.info(`Sandbox destroyed: ${info.containerName}`);
  }

  // ============================================================
  // RESTART — Stop + Start
  // ============================================================
  async restart(workspaceId: string): Promise<SandboxInfo> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) throw new Error(`No sandbox for workspace: ${workspaceId}`);

    const resp = await dockerAPI('POST', `/containers/${info.containerId}/restart?t=10`);
    if (resp.statusCode !== 204) {
      throw new Error(`Restart failed: ${JSON.stringify(resp.body)}`);
    }

    info.status = 'running';
    info.restartCount++;
    info.lastActiveAt = new Date().toISOString();
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'restarted', { restartCount: info.restartCount });
    logger.info(`Sandbox restarted: ${info.containerName} (restart #${info.restartCount})`);
    return info;
  }

  // ============================================================
  // PAUSE / UNPAUSE — Freeze container (saves CPU)
  // ============================================================
  async pause(workspaceId: string): Promise<SandboxInfo> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) throw new Error(`No sandbox for workspace: ${workspaceId}`);

    await dockerAPI('POST', `/containers/${info.containerId}/pause`);
    info.status = 'paused';
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'paused', {});
    return info;
  }

  async unpause(workspaceId: string): Promise<SandboxInfo> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) throw new Error(`No sandbox for workspace: ${workspaceId}`);

    await dockerAPI('POST', `/containers/${info.containerId}/unpause`);
    info.status = 'running';
    info.lastActiveAt = new Date().toISOString();
    await this.persistSandbox(info);
    await this.logEvent(info.id, 'resumed', {});
    return info;
  }

  // ============================================================
  // EXEC — Execute a command inside a sandbox container
  // ============================================================
  async exec(
    workspaceId: string,
    command: string | string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
      userId?: string;
      toolName?: string;
    } = {}
  ): Promise<ExecResult> {
    const info = this.containers.get(workspaceId);

    // Fallback: if Docker not available, run on host
    if (!info || !info.containerId || info.status !== 'running') {
      return this.execFallback(workspaceId, command, options);
    }

    // Parse command
    const cmd = typeof command === 'string'
      ? ['sh', '-c', command]
      : command;

    const workDir = options.cwd
      ? `${sandboxConfig.containerWorkspacePath}/${options.cwd}`.replace(/\/+/g, '/')
      : sandboxConfig.containerWorkspacePath;

    const envVars = options.env
      ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    info.lastActiveAt = new Date().toISOString();

    try {
      const result = await dockerExecRaw(
        info.containerId,
        cmd,
        workDir,
        envVars,
        options.timeout || 60000
      );

      // Log exec to DB
      this.logExec(info.id, typeof command === 'string' ? command : command.join(' '), result, options);

      return result;
    } catch (err: any) {
      const result: ExecResult = {
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        durationMs: 0,
      };
      this.logExec(info.id, typeof command === 'string' ? command : command.join(' '), result, options);
      throw err;
    }
  }

  // Host-level fallback when Docker is not available
  private async execFallback(
    workspaceId: string,
    command: string | string[],
    options: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<ExecResult> {
    const { exec: cpExec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(cpExec);
    const path = await import('path');

    const wsPath = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId);
    const cwd = options.cwd ? path.resolve(wsPath, options.cwd) : wsPath;
    const cmd = typeof command === 'string' ? command : command.join(' ');

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, HOME: wsPath, ...options.env },
      });
      return {
        exitCode: 0,
        stdout: stdout.substring(0, 100000),
        stderr: stderr.substring(0, 50000),
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        exitCode: err.code || 1,
        stdout: (err.stdout || '').substring(0, 100000),
        stderr: (err.stderr || err.message || '').substring(0, 50000),
        durationMs: Date.now() - start,
      };
    }
  }

  // ============================================================
  // HEALTH CHECK — Verify container is responsive
  // ============================================================
  async healthCheck(workspaceId: string): Promise<{
    healthy: boolean;
    status: string;
    details: Record<string, any>;
  }> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) {
      return { healthy: false, status: 'not_found', details: {} };
    }

    try {
      const inspectResp = await dockerAPI('GET', `/containers/${info.containerId}/json`);
      if (inspectResp.statusCode !== 200) {
        return { healthy: false, status: 'inspect_failed', details: {} };
      }

      const state = inspectResp.body.State;
      const healthy = state.Running && !state.OOMKilled && !state.Dead;

      // Update status in memory
      if (state.Running) info.status = state.Paused ? 'paused' : 'running';
      else if (state.Dead) info.status = 'failed';
      else info.status = 'stopped';

      const details = {
        running: state.Running,
        paused: state.Paused,
        oomKilled: state.OOMKilled,
        pid: state.Pid,
        exitCode: state.ExitCode,
        startedAt: state.StartedAt,
        health: state.Health?.Status || 'none',
      };

      await this.logEvent(info.id, 'health_check', { healthy, ...details });
      return { healthy, status: info.status, details };
    } catch (err: any) {
      return { healthy: false, status: 'error', details: { error: err.message } };
    }
  }

  // ============================================================
  // RESOURCE METRICS — Fetch CPU/memory/disk/process stats
  // ============================================================
  async getMetrics(workspaceId: string): Promise<SandboxInfo['metrics']> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId || info.status !== 'running') {
      return { cpuUsagePercent: 0, memoryUsageMB: 0, diskUsageMB: 0, processCount: 0 };
    }

    try {
      // Docker stats (one-shot)
      const statsResp = await dockerAPI('GET', `/containers/${info.containerId}/stats?stream=false`, null, 10000);
      if (statsResp.statusCode !== 200) {
        return info.metrics;
      }

      const stats = statsResp.body;

      // CPU calculation
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const numCPUs = stats.cpu_stats.online_cpus || 1;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCPUs * 100 : 0;

      // Memory
      const memUsageMB = Math.round((stats.memory_stats.usage || 0) / 1024 / 1024);

      // PIDs
      const processCount = stats.pids_stats?.current || 0;

      // Disk usage (exec du in container)
      let diskUsageMB = 0;
      try {
        const duResult = await this.exec(workspaceId, 'du -sm /workspace 2>/dev/null | cut -f1', { timeout: 5000 });
        diskUsageMB = parseInt(duResult.stdout.trim()) || 0;
      } catch { /* skip disk check */ }

      info.metrics = {
        cpuUsagePercent: Math.round(cpuPercent * 100) / 100,
        memoryUsageMB: memUsageMB,
        diskUsageMB,
        processCount,
      };

      // Persist metrics
      await this.updateMetrics(info);

      // Alert if resources exceed limits
      if (memUsageMB > info.resources.memoryLimitMB * 0.9) {
        await this.logEvent(info.id, 'resource_alert', {
          type: 'memory',
          usage: memUsageMB,
          limit: info.resources.memoryLimitMB,
        });
      }
      if (cpuPercent > 90) {
        await this.logEvent(info.id, 'resource_alert', {
          type: 'cpu',
          usage: cpuPercent,
          limit: info.resources.cpuLimit * 100,
        });
      }

      return info.metrics;
    } catch (err: any) {
      logger.warn(`Failed to get metrics for ${workspaceId}: ${err.message}`);
      return info.metrics;
    }
  }

  // ============================================================
  // GET / LIST
  // ============================================================
  getSandbox(workspaceId: string): SandboxInfo | undefined {
    return this.containers.get(workspaceId);
  }

  listSandboxes(): SandboxInfo[] {
    return Array.from(this.containers.values());
  }

  getRunningCount(): number {
    return Array.from(this.containers.values()).filter(c => c.status === 'running').length;
  }

  // ============================================================
  // CONTAINER LOGS — Fetch stdout/stderr from container
  // ============================================================
  async getLogs(workspaceId: string, tail: number = 100): Promise<string> {
    const info = this.containers.get(workspaceId);
    if (!info || !info.containerId) return '';

    try {
      const resp = await dockerAPI(
        'GET',
        `/containers/${info.containerId}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`
      );
      if (typeof resp.body === 'string') return resp.body;
      return JSON.stringify(resp.body);
    } catch {
      return '';
    }
  }

  // ============================================================
  // EXEC HISTORY — Get recent commands for a sandbox
  // ============================================================
  async getExecHistory(workspaceId: string, limit: number = 50): Promise<any[]> {
    const info = this.containers.get(workspaceId);
    if (!info) return [];

    try {
      const result = await dbQuery(
        `SELECT id, command, exit_code, stdout, stderr, duration_ms, user_id, tool_name, created_at
         FROM sandbox_exec_log WHERE sandbox_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [info.id, limit]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  // ============================================================
  // EVENTS HISTORY — Get lifecycle events for a sandbox
  // ============================================================
  async getEvents(workspaceId: string, limit: number = 100): Promise<any[]> {
    const info = this.containers.get(workspaceId);
    if (!info) return [];

    try {
      const result = await dbQuery(
        `SELECT id, event_type, details, created_at
         FROM sandbox_events WHERE sandbox_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [info.id, limit]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  // ============================================================
  // IDLE CLEANUP — Pause or stop containers not used recently
  // ============================================================
  private async cleanupIdleContainers(): Promise<void> {
    const now = Date.now();
    for (const [wsId, info] of this.containers) {
      if (info.status !== 'running') continue;

      const lastActive = new Date(info.lastActiveAt).getTime();
      const idle = now - lastActive;

      if (idle > sandboxConfig.idleTimeoutMs) {
        logger.info(`Auto-stopping idle sandbox: ${info.containerName} (idle ${Math.round(idle / 60000)}m)`);
        try {
          await this.stop(wsId);
        } catch (err: any) {
          logger.warn(`Failed to stop idle sandbox ${wsId}: ${err.message}`);
        }
      }
    }
  }

  // ============================================================
  // RECONCILIATION — Sync DB state with actual Docker state
  // ============================================================
  private async reconcile(): Promise<void> {
    try {
      const resp = await dockerAPI('GET', '/containers/json?all=true&filters=' +
        encodeURIComponent(JSON.stringify({ label: ['agentic.sandbox=true'] })));

      if (resp.statusCode !== 200) return;

      const dockerContainers = resp.body as any[];
      const dockerMap = new Map(dockerContainers.map(c => [c.Names?.[0]?.replace('/', ''), c]));

      for (const [wsId, info] of this.containers) {
        const dc = dockerMap.get(info.containerName);
        if (dc) {
          // Update status from Docker
          const state = dc.State;
          if (state === 'running') info.status = 'running';
          else if (state === 'exited') info.status = 'stopped';
          else if (state === 'paused') info.status = 'paused';
          else if (state === 'dead') info.status = 'failed';
          info.containerId = dc.Id;
        } else if (info.status === 'running' || info.status === 'creating') {
          // Container no longer exists in Docker
          info.status = 'destroyed';
          releasePort(info.allocatedPort);
        }
      }

      logger.info(`Reconciled: ${dockerContainers.length} Docker containers, ${this.containers.size} DB entries`);
    } catch (err: any) {
      logger.warn(`Reconciliation failed: ${err.message}`);
    }
  }

  // ============================================================
  // PERSISTENCE — PostgreSQL
  // ============================================================
  private async persistSandbox(info: SandboxInfo): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO sandbox_containers (
          id, workspace_id, container_id, container_name, image, status,
          network_id, ip_address, allocated_port,
          cpu_limit, memory_limit_mb, disk_limit_mb, pids_limit,
          cpu_usage_percent, memory_usage_mb, disk_usage_mb, process_count,
          created_at, started_at, last_active_at, stopped_at,
          environment, labels, last_error, restart_count, max_restarts
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        ON CONFLICT (id) DO UPDATE SET
          container_id = EXCLUDED.container_id,
          status = EXCLUDED.status,
          ip_address = EXCLUDED.ip_address,
          allocated_port = EXCLUDED.allocated_port,
          cpu_usage_percent = EXCLUDED.cpu_usage_percent,
          memory_usage_mb = EXCLUDED.memory_usage_mb,
          disk_usage_mb = EXCLUDED.disk_usage_mb,
          process_count = EXCLUDED.process_count,
          started_at = EXCLUDED.started_at,
          last_active_at = EXCLUDED.last_active_at,
          stopped_at = EXCLUDED.stopped_at,
          last_error = EXCLUDED.last_error,
          restart_count = EXCLUDED.restart_count`,
        [
          info.id, info.workspaceId, info.containerId, info.containerName,
          info.image, info.status,
          this.networkId, info.ipAddress, info.allocatedPort,
          info.resources.cpuLimit, info.resources.memoryLimitMB,
          info.resources.diskLimitMB, info.resources.pidsLimit,
          info.metrics.cpuUsagePercent, info.metrics.memoryUsageMB,
          info.metrics.diskUsageMB, info.metrics.processCount,
          info.createdAt, info.startedAt, info.lastActiveAt, null,
          JSON.stringify({}), JSON.stringify({}),
          info.lastError, info.restartCount, sandboxConfig.maxRestarts,
        ]
      );
    } catch { /* DB not available */ }
  }

  private async updateMetrics(info: SandboxInfo): Promise<void> {
    try {
      await dbQuery(
        `UPDATE sandbox_containers SET
          cpu_usage_percent = $1, memory_usage_mb = $2,
          disk_usage_mb = $3, process_count = $4,
          last_active_at = NOW()
        WHERE id = $5`,
        [
          info.metrics.cpuUsagePercent, info.metrics.memoryUsageMB,
          info.metrics.diskUsageMB, info.metrics.processCount,
          info.id,
        ]
      );
    } catch { /* DB not available */ }
  }

  private async logEvent(sandboxId: string, eventType: string, details: Record<string, any>): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO sandbox_events (id, sandbox_id, event_type, details)
         VALUES ($1, $2, $3, $4)`,
        [generateId('sevt'), sandboxId, eventType, JSON.stringify(details)]
      );
    } catch { /* DB not available */ }
  }

  private async logExec(
    sandboxId: string,
    command: string,
    result: ExecResult,
    options: { userId?: string; toolName?: string }
  ): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO sandbox_exec_log (id, sandbox_id, command, exit_code, stdout, stderr, duration_ms, user_id, tool_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          generateId('sexec'), sandboxId,
          command.substring(0, 5000),
          result.exitCode,
          result.stdout.substring(0, 10000),
          result.stderr.substring(0, 5000),
          result.durationMs,
          options.userId || null,
          options.toolName || null,
        ]
      );
    } catch { /* DB not available */ }
  }

  private async loadFromDB(): Promise<void> {
    try {
      const result = await dbQuery(
        `SELECT * FROM sandbox_containers
         WHERE status NOT IN ('destroyed') ORDER BY created_at DESC`
      );
      for (const row of result.rows) {
        const info: SandboxInfo = {
          id: row.id,
          workspaceId: row.workspace_id,
          containerId: row.container_id,
          containerName: row.container_name,
          image: row.image,
          status: row.status,
          ipAddress: row.ip_address,
          allocatedPort: row.allocated_port,
          resources: {
            cpuLimit: parseFloat(row.cpu_limit),
            memoryLimitMB: row.memory_limit_mb,
            diskLimitMB: row.disk_limit_mb,
            pidsLimit: row.pids_limit,
          },
          metrics: {
            cpuUsagePercent: parseFloat(row.cpu_usage_percent),
            memoryUsageMB: row.memory_usage_mb,
            diskUsageMB: row.disk_usage_mb,
            processCount: row.process_count,
          },
          createdAt: row.created_at,
          startedAt: row.started_at,
          lastActiveAt: row.last_active_at,
          lastError: row.last_error,
          restartCount: row.restart_count,
        };
        this.containers.set(row.workspace_id, info);
        if (row.allocated_port) allocatedPorts.add(row.allocated_port);
      }
      logger.info(`Loaded ${result.rows.length} sandboxes from DB`);
    } catch { /* DB not available */ }
  }

  // ============================================================
  // CLEANUP — Destroy all containers (for shutdown)
  // ============================================================
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger.info('SandboxManager shutting down...');
    for (const [wsId] of this.containers) {
      try {
        await this.stop(wsId);
      } catch { /* ignore errors during shutdown */ }
    }
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================
export const sandboxManager = new SandboxManager();
