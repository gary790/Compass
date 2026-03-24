import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================
// GIT INIT
// ============================================================
toolRegistry.register(
  {
    name: 'git_init',
    category: 'git',
    description: 'Initialize a new git repository in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        defaultBranch: { type: 'string', description: 'Default branch name', default: 'main' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ defaultBranch: z.string().optional() }),
  async (args, ctx) => {
    const branch = args.defaultBranch || 'main';
    await execAsync(`git init -b ${branch}`, { cwd: ctx.workspacePath });
    await execAsync('git config user.email "agent@agentic-rag.local"', { cwd: ctx.workspacePath });
    await execAsync('git config user.name "Agentic RAG Agent"', { cwd: ctx.workspacePath });
    return { initialized: true, branch };
  }
);

// ============================================================
// GIT STATUS
// ============================================================
toolRegistry.register(
  {
    name: 'git_status',
    category: 'git',
    description: 'Get the current git status of the workspace (modified, staged, untracked files).',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
  },
  z.object({}),
  async (_, ctx) => {
    const { stdout } = await execAsync('git status --porcelain', { cwd: ctx.workspacePath });
    const { stdout: branch } = await execAsync('git branch --show-current', { cwd: ctx.workspacePath });
    const lines = stdout.trim().split('\n').filter(Boolean);

    return {
      branch: branch.trim(),
      modified: lines.filter(l => l.startsWith(' M')).map(l => l.substring(3)),
      staged: lines.filter(l => l.startsWith('M ') || l.startsWith('A ')).map(l => l.substring(3)),
      untracked: lines.filter(l => l.startsWith('??')).map(l => l.substring(3)),
      totalChanges: lines.length,
    };
  }
);

// ============================================================
// GIT COMMIT
// ============================================================
toolRegistry.register(
  {
    name: 'git_commit',
    category: 'git',
    description: 'Stage files and create a git commit with a message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        files: { type: 'array', items: { type: 'string' }, description: 'Specific files to stage (default: all)' },
      },
      required: ['message'],
    },
    riskLevel: 'safe',
  },
  z.object({ message: z.string(), files: z.array(z.string()).optional() }),
  async (args, ctx) => {
    if (args.files?.length) {
      await execAsync(`git add ${args.files.join(' ')}`, { cwd: ctx.workspacePath });
    } else {
      await execAsync('git add -A', { cwd: ctx.workspacePath });
    }

    const { stdout } = await execAsync(`git commit -m "${args.message.replace(/"/g, '\\"')}"`, { cwd: ctx.workspacePath });
    return { committed: true, message: args.message, output: stdout.trim() };
  }
);

// ============================================================
// GIT LOG
// ============================================================
toolRegistry.register(
  {
    name: 'git_log',
    category: 'git',
    description: 'Get recent git commit history.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show', default: 10 },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ count: z.number().optional() }),
  async (args, ctx) => {
    const count = args.count || 10;
    try {
      const { stdout } = await execAsync(
        `git log --oneline --format="%h|%s|%an|%ar" -${count}`,
        { cwd: ctx.workspacePath }
      );
      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });
      return { commits, count: commits.length };
    } catch {
      return { commits: [], count: 0, error: 'Not a git repository or no commits yet' };
    }
  }
);

// ============================================================
// GIT DIFF
// ============================================================
toolRegistry.register(
  {
    name: 'git_diff',
    category: 'git',
    description: 'Show git diff of changes (staged or unstaged).',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged changes only', default: false },
        file: { type: 'string', description: 'Show diff for specific file' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ staged: z.boolean().optional(), file: z.string().optional() }),
  async (args, ctx) => {
    const flags = args.staged ? '--staged' : '';
    const file = args.file || '';
    const { stdout } = await execAsync(`git diff ${flags} ${file}`, { cwd: ctx.workspacePath });
    return { diff: stdout.substring(0, 50000), truncated: stdout.length > 50000 };
  }
);

// ============================================================
// GIT PUSH
// ============================================================
toolRegistry.register(
  {
    name: 'git_push',
    category: 'git',
    description: 'Push commits to a remote repository.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name', default: 'origin' },
        branch: { type: 'string', description: 'Branch name', default: 'main' },
        force: { type: 'boolean', description: 'Force push', default: false },
      },
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({ remote: z.string().optional(), branch: z.string().optional(), force: z.boolean().optional() }),
  async (args, ctx) => {
    const remote = args.remote || 'origin';
    const branch = args.branch || 'main';
    const forceFlag = args.force ? '--force' : '';
    const { stdout, stderr } = await execAsync(
      `git push ${forceFlag} ${remote} ${branch}`,
      { cwd: ctx.workspacePath, timeout: 30000 }
    );
    return { pushed: true, remote, branch, output: (stdout + stderr).trim() };
  }
);

// ============================================================
// GIT BRANCH
// ============================================================
toolRegistry.register(
  {
    name: 'git_branch',
    category: 'git',
    description: 'List, create, or switch git branches.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'switch', 'delete'], description: 'Branch operation' },
        name: { type: 'string', description: 'Branch name (for create/switch/delete)' },
      },
      required: ['action'],
    },
    riskLevel: 'safe',
  },
  z.object({ action: z.enum(['list', 'create', 'switch', 'delete']), name: z.string().optional() }),
  async (args, ctx) => {
    switch (args.action) {
      case 'list': {
        const { stdout } = await execAsync('git branch -a', { cwd: ctx.workspacePath });
        return { branches: stdout.trim().split('\n').map(b => b.trim()) };
      }
      case 'create': {
        if (!args.name) throw new Error('Branch name required');
        await execAsync(`git checkout -b ${args.name}`, { cwd: ctx.workspacePath });
        return { created: true, branch: args.name };
      }
      case 'switch': {
        if (!args.name) throw new Error('Branch name required');
        await execAsync(`git checkout ${args.name}`, { cwd: ctx.workspacePath });
        return { switched: true, branch: args.name };
      }
      case 'delete': {
        if (!args.name) throw new Error('Branch name required');
        await execAsync(`git branch -D ${args.name}`, { cwd: ctx.workspacePath });
        return { deleted: true, branch: args.name };
      }
    }
  }
);

export default toolRegistry;
