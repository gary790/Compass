import { toolRegistry, ToolContext } from '../registry.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import mime from 'mime-types';
import {
  sandboxManager,
  sandboxReadFile,
  sandboxWriteFile,
  sandboxListDir,
  sandboxDeleteFile,
  sandboxSearchFiles,
} from '../../sandbox/index.js';

// Helper: detect if workspace has an active sandbox
function shouldUseSandbox(workspacePath: string): boolean {
  if (!sandboxManager.isDockerAvailable()) return false;
  const wsId = path.basename(workspacePath);
  const sandbox = sandboxManager.getSandbox(wsId);
  return !!(sandbox && sandbox.status === 'running');
}

// ============================================================
// READ FILE — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'read_file',
    category: 'file',
    description: 'Read the contents of a file from the workspace. Uses sandbox container when available.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file within the workspace' },
        encoding: { type: 'string', description: 'File encoding (default: utf-8)', default: 'utf-8' },
      },
      required: ['path'],
    },
    riskLevel: 'safe',
  },
  z.object({ path: z.string(), encoding: z.string().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxReadFile(wsId, args.path, args.encoding);
      return {
        content: result.content,
        path: args.path,
        size: result.size,
        modified: result.modified,
        mimeType: mime.lookup(args.path) || 'text/plain',
        sandboxed: true,
      };
    }

    // Host fallback
    const fullPath = path.resolve(ctx.workspacePath, args.path);
    if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }
    const content = await fs.readFile(fullPath, { encoding: (args.encoding || 'utf-8') as BufferEncoding });
    const stats = await fs.stat(fullPath);
    return {
      content,
      path: args.path,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      mimeType: mime.lookup(fullPath) || 'text/plain',
      sandboxed: false,
    };
  }
);

// ============================================================
// WRITE FILE — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'write_file',
    category: 'file',
    description: 'Create or overwrite a file in the workspace. Creates parent directories automatically. Uses sandbox container when available.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for the file' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
    riskLevel: 'moderate',
  },
  z.object({ path: z.string(), content: z.string() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxWriteFile(wsId, args.path, args.content);
      return { path: args.path, size: result.size, created: result.created, sandboxed: true };
    }

    // Host fallback
    const fullPath = path.resolve(ctx.workspacePath, args.path);
    if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, 'utf-8');
    const stats = await fs.stat(fullPath);
    return { path: args.path, size: stats.size, created: true, sandboxed: false };
  }
);

// ============================================================
// EDIT FILE (find and replace) — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'edit_file',
    category: 'file',
    description: 'Edit a file by finding and replacing text. Uses sandbox container when available.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_text: { type: 'string', description: 'Text to find' },
              new_text: { type: 'string', description: 'Text to replace with' },
              replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
            },
            required: ['old_text', 'new_text'],
          },
          description: 'Array of find/replace operations',
        },
      },
      required: ['path', 'edits'],
    },
    riskLevel: 'moderate',
  },
  z.object({
    path: z.string(),
    edits: z.array(z.object({
      old_text: z.string(),
      new_text: z.string(),
      replace_all: z.boolean().optional(),
    })),
  }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);
    let content: string;

    // Read file (sandbox or host)
    if (shouldUseSandbox(ctx.workspacePath)) {
      const readResult = await sandboxReadFile(wsId, args.path);
      content = readResult.content;
    } else {
      const fullPath = path.resolve(ctx.workspacePath, args.path);
      if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) throw new Error('Path traversal detected');
      content = await fs.readFile(fullPath, 'utf-8');
    }

    // Apply edits
    let totalReplacements = 0;
    for (const edit of args.edits) {
      if (edit.replace_all) {
        const count = content.split(edit.old_text).length - 1;
        content = content.replaceAll(edit.old_text, edit.new_text);
        totalReplacements += count;
      } else {
        if (content.includes(edit.old_text)) {
          content = content.replace(edit.old_text, edit.new_text);
          totalReplacements += 1;
        }
      }
    }

    // Write back (sandbox or host)
    if (shouldUseSandbox(ctx.workspacePath)) {
      await sandboxWriteFile(wsId, args.path, content);
    } else {
      const fullPath = path.resolve(ctx.workspacePath, args.path);
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    return { path: args.path, replacements: totalReplacements, sandboxed: shouldUseSandbox(ctx.workspacePath) };
  }
);

// ============================================================
// LIST DIRECTORY — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'list_directory',
    category: 'file',
    description: 'List files and directories in a workspace path. Uses sandbox container when available.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (default: root)', default: '.' },
        recursive: { type: 'boolean', description: 'List recursively', default: false },
        pattern: { type: 'string', description: 'Glob pattern to filter (e.g., "**/*.ts")' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ path: z.string().optional(), recursive: z.boolean().optional(), pattern: z.string().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath) && !args.pattern) {
      const items = await sandboxListDir(wsId, args.path || '.', args.recursive || false);
      return { path: args.path || '.', items, count: items.length, sandboxed: true };
    }

    // Host fallback
    const dirPath = path.resolve(ctx.workspacePath, args.path || '.');
    if (!dirPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }

    if (args.pattern) {
      const files = await glob(args.pattern, { cwd: dirPath, nodir: false });
      return { path: args.path || '.', files, count: files.length, sandboxed: false };
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(async (entry) => {
          const entryPath = path.join(dirPath, entry.name);
          try {
            const stats = await fs.stat(entryPath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          } catch {
            return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' };
          }
        })
    );

    return { path: args.path || '.', items, count: items.length, sandboxed: false };
  }
);

// ============================================================
// DELETE FILE — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'delete_file',
    category: 'file',
    description: 'Delete a file or directory from the workspace sandbox.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to delete' },
        recursive: { type: 'boolean', description: 'Delete directories recursively', default: false },
      },
      required: ['path'],
    },
    requiresApproval: true,
    riskLevel: 'dangerous',
  },
  z.object({ path: z.string(), recursive: z.boolean().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxDeleteFile(wsId, args.path, args.recursive || false);
      return { path: args.path, deleted: result.deleted, sandboxed: true };
    }

    // Host fallback
    const fullPath = path.resolve(ctx.workspacePath, args.path);
    if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }
    await fs.rm(fullPath, { recursive: args.recursive || false });
    return { path: args.path, deleted: true, sandboxed: false };
  }
);

// ============================================================
// SEARCH FILES — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'search_files',
    category: 'file',
    description: 'Search file contents using regex pattern. Uses sandbox container when available.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory to search in (default: root)', default: '.' },
        include: { type: 'string', description: 'File pattern to include (e.g., "*.ts")' },
        maxResults: { type: 'number', description: 'Maximum results to return', default: 20 },
      },
      required: ['pattern'],
    },
    riskLevel: 'safe',
  },
  z.object({ pattern: z.string(), path: z.string().optional(), include: z.string().optional(), maxResults: z.number().optional() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath)) {
      const results = await sandboxSearchFiles(wsId, args.pattern, {
        path: args.path,
        include: args.include,
        maxResults: args.maxResults,
      });
      return { pattern: args.pattern, results, count: results.length, sandboxed: true };
    }

    // Host fallback
    const searchPath = path.resolve(ctx.workspacePath, args.path || '.');
    const globPattern = args.include || '**/*';
    const files = await glob(globPattern, { cwd: searchPath, nodir: true, ignore: ['node_modules/**', '.git/**'] });

    const regex = new RegExp(args.pattern, 'gi');
    const results: { file: string; line: number; content: string }[] = [];
    const max = args.maxResults || 20;

    for (const file of files) {
      if (results.length >= max) break;
      try {
        const content = await fs.readFile(path.join(searchPath, file), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({ file, line: i + 1, content: lines[i].trim().substring(0, 200) });
            if (results.length >= max) break;
          }
          regex.lastIndex = 0;
        }
      } catch { /* skip binary files */ }
    }

    return { pattern: args.pattern, results, count: results.length, sandboxed: false };
  }
);

// ============================================================
// FILE INFO — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'file_info',
    category: 'file',
    description: 'Get detailed information about a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
      },
      required: ['path'],
    },
    riskLevel: 'safe',
  },
  z.object({ path: z.string() }),
  async (args, ctx) => {
    const fullPath = path.resolve(ctx.workspacePath, args.path);
    if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }
    const stats = await fs.stat(fullPath);
    return {
      path: args.path,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      sizeHuman: stats.size > 1024 * 1024
        ? `${(stats.size / 1024 / 1024).toFixed(2)} MB`
        : `${(stats.size / 1024).toFixed(2)} KB`,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      permissions: stats.mode.toString(8),
      mimeType: mime.lookup(fullPath) || 'unknown',
    };
  }
);

// ============================================================
// CREATE DIRECTORY — Sandbox-aware
// ============================================================
toolRegistry.register(
  {
    name: 'create_directory',
    category: 'file',
    description: 'Create a new directory in the workspace (creates parent directories automatically).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for the new directory' },
      },
      required: ['path'],
    },
    riskLevel: 'safe',
  },
  z.object({ path: z.string() }),
  async (args, ctx) => {
    const wsId = path.basename(ctx.workspacePath);

    if (shouldUseSandbox(ctx.workspacePath)) {
      const result = await sandboxManager.exec(wsId, `mkdir -p "${args.path}"`, { timeout: 5000 });
      return { path: args.path, created: result.exitCode === 0, sandboxed: true };
    }

    const fullPath = path.resolve(ctx.workspacePath, args.path);
    if (!fullPath.startsWith(path.resolve(ctx.workspacePath))) {
      throw new Error('Path traversal detected');
    }
    await fs.mkdir(fullPath, { recursive: true });
    return { path: args.path, created: true, sandboxed: false };
  }
);

export default toolRegistry;
