import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

// ============================================================
// SHELL EXECUTE
// ============================================================
toolRegistry.register(
  {
    name: 'shell_exec',
    category: 'shell',
    description: 'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code. Use for running build commands, tests, or any CLI operation.',
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
        maxBuffer: 1024 * 1024 * 10, // 10MB
        env: { ...process.env, HOME: ctx.workspacePath },
      });

      return {
        stdout: stdout.substring(0, 50000), // Limit output size
        stderr: stderr.substring(0, 10000),
        exitCode: 0,
        command: args.command,
      };
    } catch (error: any) {
      return {
        stdout: (error.stdout || '').substring(0, 50000),
        stderr: (error.stderr || error.message || '').substring(0, 10000),
        exitCode: error.code || 1,
        command: args.command,
      };
    }
  }
);

// ============================================================
// NPM INSTALL
// ============================================================
toolRegistry.register(
  {
    name: 'npm_install',
    category: 'shell',
    description: 'Install npm packages in the workspace. Can install specific packages or all dependencies from package.json.',
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
    const pkgs = args.packages?.join(' ') || '';
    const devFlag = args.dev ? '--save-dev' : '';
    const command = pkgs
      ? `npm install ${devFlag} ${pkgs}`
      : 'npm install';

    const { stdout, stderr } = await execAsync(command, {
      cwd: ctx.workspacePath,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });

    return { stdout: stdout.substring(0, 5000), stderr: stderr.substring(0, 2000), packages: args.packages || ['all'] };
  }
);

// ============================================================
// NPM RUN
// ============================================================
toolRegistry.register(
  {
    name: 'npm_run',
    category: 'shell',
    description: 'Run an npm script defined in package.json (e.g., build, test, lint).',
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
    const command = args.args
      ? `npm run ${args.script} -- ${args.args}`
      : `npm run ${args.script}`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.workspacePath,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      });
      return { script: args.script, stdout: stdout.substring(0, 10000), stderr: stderr.substring(0, 5000), exitCode: 0 };
    } catch (error: any) {
      return {
        script: args.script,
        stdout: (error.stdout || '').substring(0, 10000),
        stderr: (error.stderr || error.message).substring(0, 5000),
        exitCode: error.code || 1,
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
    description: 'List running processes, optionally filtered by name.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter processes by name' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ filter: z.string().optional() }),
  async (args) => {
    const command = args.filter
      ? `ps aux | grep -i "${args.filter}" | grep -v grep`
      : 'ps aux --sort=-%mem | head -20';

    try {
      const { stdout } = await execAsync(command, { timeout: 5000 });
      return { processes: stdout.trim().split('\n') };
    } catch {
      return { processes: [] };
    }
  }
);

// ============================================================
// SYSTEM INFO
// ============================================================
toolRegistry.register(
  {
    name: 'system_info',
    category: 'system',
    description: 'Get system information including CPU, memory, disk usage.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
  },
  z.object({}),
  async () => {
    const commands = {
      hostname: 'hostname',
      uptime: 'uptime',
      memory: 'free -h',
      disk: 'df -h / | tail -1',
      cpu: 'nproc',
      os: 'cat /etc/os-release | head -2',
    };

    const info: Record<string, string> = {};
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
