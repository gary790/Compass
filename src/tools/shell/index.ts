import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { sandboxExec, sandboxManager } from '../../sandbox/index.js';

const execAsync = promisify(exec);

// Helper: detect if workspace has an active sandbox
function shouldUseSandbox(workspacePath: string): boolean {
  if (!sandboxManager.isDockerAvailable()) return false;
  const wsId = path.basename(workspacePath);
  const sandbox = sandboxManager.getSandbox(wsId);
  return !!(sandbox && sandbox.status === 'running');
}

// ============================================================
// SHELL EXECUTE — Sandboxed or host fallback
// ============================================================
toolRegistry.register(
  {
    name: 'shell_exec',
    category: 'shell',
    description: 'Execute a shell command in the workspace directory. Runs inside a sandboxed Docker container when available, otherwise falls back to host execution. Returns stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (relative to workspace, default: workspace root)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)', default: 30000 },
      },
      required: ['command'],
    },
    requiresApproval: false,
    riskLevel: 'moderate',
    timeout: 60000,
  },
  z.object({ command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    // Try sandboxed execution first
    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxExec(wsId, args.command, {
        cwd: args.cwd,
        timeout: args.timeout || 30000,
        userId: ctx.userId,
        toolName: 'shell_exec',
      });

      return {
        stdout: result.stdout.substring(0, 50000),
        stderr: result.stderr.substring(0, 10000),
        exitCode: result.exitCode,
        command: args.command,
        sandboxed: true,
      };
    }

    // Host fallback (original behavior)
    const cwd = args.cwd
      ? path.resolve(ctx.workspacePath, args.cwd)
      : ctx.workspacePath;

    if (!cwd.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }

    // Block dangerous commands
    const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
    for (const d of dangerous) {
      if (args.command.includes(d)) {
        throw new Error(`Blocked dangerous command: ${d}`);
      }
    }

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout: args.timeout || 30000,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, HOME: ctx.workspacePath },
      });

      return {
        stdout: stdout.substring(0, 50000),
        stderr: stderr.substring(0, 10000),
        exitCode: 0,
        command: args.command,
        sandboxed: false,
      };
    } catch (error: any) {
      return {
        stdout: (error.stdout || '').substring(0, 50000),
        stderr: (error.stderr || error.message || '').substring(0, 10000),
        exitCode: error.code || 1,
        command: args.command,
        sandboxed: false,
      };
    }
  }
);

// ============================================================
// NPM INSTALL — Sandboxed
// ============================================================
toolRegistry.register(
  {
    name: 'npm_install',
    category: 'shell',
    description: 'Install npm packages in the workspace (runs inside sandbox container when available).',
    parameters: {
      type: 'object',
      properties: {
        packages: { type: 'array', items: { type: 'string' }, description: 'Package names to install (empty = install all from package.json)' },
        dev: { type: 'boolean', description: 'Install as devDependency', default: false },
      },
    },
    riskLevel: 'moderate',
    timeout: 120000,
  },
  z.object({ packages: z.array(z.string()).optional(), dev: z.boolean().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);
    const pkgs = args.packages?.join(' ') || '';
    const devFlag = args.dev ? '--save-dev' : '';
    const command = pkgs ? `npm install ${devFlag} ${pkgs}` : 'npm install';

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxExec(wsId, command, {
        timeout: 120000,
        userId: ctx.userId,
        toolName: 'npm_install',
      });
      return {
        stdout: result.stdout.substring(0, 5000),
        stderr: result.stderr.substring(0, 2000),
        packages: args.packages || ['all'],
        sandboxed: true,
      };
    }

    // Host fallback
    const { stdout, stderr } = await execAsync(command, {
      cwd: ctx.workspacePath,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });

    return { stdout: stdout.substring(0, 5000), stderr: stderr.substring(0, 2000), packages: args.packages || ['all'], sandboxed: false };
  }
);

// ============================================================
// NPM RUN — Sandboxed
// ============================================================
toolRegistry.register(
  {
    name: 'npm_run',
    category: 'shell',
    description: 'Run an npm script defined in package.json (runs inside sandbox container when available).',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script name from package.json' },
        args: { type: 'string', description: 'Additional arguments to pass to the script' },
      },
      required: ['script'],
    },
    riskLevel: 'moderate',
    timeout: 120000,
  },
  z.object({ script: z.string(), args: z.string().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);
    const command = args.args ? `npm run ${args.script} -- ${args.args}` : `npm run ${args.script}`;

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxExec(wsId, command, {
        timeout: 120000,
        userId: ctx.userId,
        toolName: 'npm_run',
      });
      return {
        script: args.script,
        stdout: result.stdout.substring(0, 10000),
        stderr: result.stderr.substring(0, 5000),
        exitCode: result.exitCode,
        sandboxed: true,
      };
    }

    // Host fallback
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.workspacePath,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      });
      return { script: args.script, stdout: stdout.substring(0, 10000), stderr: stderr.substring(0, 5000), exitCode: 0, sandboxed: false };
    } catch (error: any) {
      return {
        script: args.script,
        stdout: (error.stdout || '').substring(0, 10000),
        stderr: (error.stderr || error.message).substring(0, 5000),
        exitCode: error.code || 1,
        sandboxed: false,
      };
    }
  }
);

// ============================================================
// PROCESS LIST
// ============================================================
toolRegistry.register(
  {
    name: 'process_list',
    category: 'shell',
    description: 'List running processes in the workspace sandbox.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter processes by name' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ filter: z.string().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);
    const command = args.filter
      ? `ps aux | grep -i "${args.filter}" | grep -v grep`
      : 'ps aux --sort=-%mem | head -20';

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxExec(wsId, command, { timeout: 5000 });
      return { processes: result.stdout.trim().split('\n'), sandboxed: true };
    }

    try {
      const { stdout } = await execAsync(command, { timeout: 5000 });
      return { processes: stdout.trim().split('\n'), sandboxed: false };
    } catch {
      return { processes: [], sandboxed: false };
    }
  }
);

// ============================================================
// SYSTEM INFO — Shows sandbox or host info
// ============================================================
toolRegistry.register(
  {
    name: 'system_info',
    category: 'system',
    description: 'Get system information for the workspace sandbox (CPU, memory, disk).',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
  },
  z.object({}),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    // If sandboxed, get info from container
    if (shouldUseSandbox(ctx.workspacePath)) {
      const sandbox = sandboxManager.getSandbox(wsId);
      const commands = {
        hostname: 'hostname',
        uptime: 'uptime',
        memory: 'free -h 2>/dev/null || echo "N/A"',
        disk: 'df -h /workspace 2>/dev/null | tail -1 || echo "N/A"',
        cpu: 'nproc 2>/dev/null || echo "1"',
        node: 'node --version 2>/dev/null || echo "N/A"',
      };

      const info: Record<string, string> = {
        mode: 'sandbox',
        containerId: sandbox?.containerId?.substring(0, 12) || 'unknown',
        containerName: sandbox?.containerName || 'unknown',
        cpuLimit: `${sandbox?.resources.cpuLimit || 0} cores`,
        memoryLimit: `${sandbox?.resources.memoryLimitMB || 0} MB`,
        diskLimit: `${sandbox?.resources.diskLimitMB || 0} MB`,
      };

      for (const [key, cmd] of Object.entries(commands)) {
        try {
          const result = await sandboxExec(wsId, cmd, { timeout: 5000 });
          info[key] = result.stdout.trim();
        } catch {
          info[key] = 'unavailable';
        }
      }
      return info;
    }

    // Host info
    const commands = {
      hostname: 'hostname',
      uptime: 'uptime',
      memory: 'free -h',
      disk: 'df -h / | tail -1',
      cpu: 'nproc',
      os: 'cat /etc/os-release | head -2',
    };

    const info: Record<string, string> = { mode: 'host' };
    for (const [key, cmd] of Object.entries(commands)) {
      try {
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        info[key] = stdout.trim();
      } catch {
        info[key] = 'unavailable';
      }
    }
    return info;
  }
);

export default toolRegistry;
