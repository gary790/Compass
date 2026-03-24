import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import { workspaceConfig } from '../config/index.js';
import { createLogger, generateId } from '../utils/index.js';
import { FileNode } from '../types/index.js';

const logger = createLogger('WorkspaceRoute');
const workspaceRoutes = new Hono();

// Ensure workspace root exists
async function ensureWorkspaceRoot() {
  await fs.mkdir(path.resolve(workspaceConfig.root), { recursive: true });
}

// Build file tree recursively
async function buildFileTree(dirPath: string, maxDepth: number = 5, depth: number = 0): Promise<FileNode[]> {
  if (depth >= maxDepth) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    // Skip hidden files and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = fullPath;

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, maxDepth, depth + 1);
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else {
      try {
        const stats = await fs.stat(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        const langMap: Record<string, string> = {
          '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
          '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
          '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown',
          '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.sql': 'sql',
          '.sh': 'bash', '.dockerfile': 'dockerfile',
        };
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
          modified: stats.mtime.toISOString(),
          language: langMap[ext],
        });
      } catch {
        nodes.push({ name: entry.name, path: relativePath, type: 'file' });
      }
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// GET /api/workspace — List workspaces
workspaceRoutes.get('/', async (c) => {
  await ensureWorkspaceRoot();
  try {
    const rootPath = path.resolve(workspaceConfig.root);
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const workspaces = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const wsPath = path.join(rootPath, entry.name);
        try {
          const stats = await fs.stat(wsPath);
          workspaces.push({
            id: entry.name,
            name: entry.name,
            path: wsPath,
            modified: stats.mtime.toISOString(),
          });
        } catch {}
      }
    }

    return c.json({ success: true, data: { workspaces, count: workspaces.length } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'LIST_ERROR', message: error.message } }, 500);
  }
});

// POST /api/workspace — Create workspace
workspaceRoutes.post('/', async (c) => {
  await ensureWorkspaceRoot();
  const body = await c.req.json();
  const { name } = body;

  if (!name) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'name is required' } }, 400);
  }

  const wsId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const wsPath = path.resolve(workspaceConfig.root, wsId);

  try {
    await fs.mkdir(wsPath, { recursive: true });
    return c.json({ success: true, data: { id: wsId, name, path: wsPath } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'CREATE_ERROR', message: error.message } }, 500);
  }
});

// GET /api/workspace/:id/tree — Get file tree
workspaceRoutes.get('/:id/tree', async (c) => {
  const id = c.req.param('id');
  const wsPath = path.resolve(workspaceConfig.root, id);

  try {
    await fs.access(wsPath);
    const tree = await buildFileTree(wsPath);
    return c.json({ success: true, data: { id, tree } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: `Workspace ${id} not found` } }, 404);
  }
});

// GET /api/workspace/:id/file — Read file
workspaceRoutes.get('/:id/file', async (c) => {
  const id = c.req.param('id');
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'path query param required' } }, 400);
  }

  const fullPath = path.resolve(workspaceConfig.root, id, filePath);
  const wsRoot = path.resolve(workspaceConfig.root, id);

  if (!fullPath.startsWith(wsRoot)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Path traversal detected' } }, 403);
  }

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const stats = await fs.stat(fullPath);
    return c.json({ success: true, data: { path: filePath, content, size: stats.size } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'READ_ERROR', message: error.message } }, 500);
  }
});

// PUT /api/workspace/:id/file — Write file
workspaceRoutes.put('/:id/file', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { path: filePath, content } = body;

  if (!filePath || content === undefined) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'path and content required' } }, 400);
  }

  const fullPath = path.resolve(workspaceConfig.root, id, filePath);
  const wsRoot = path.resolve(workspaceConfig.root, id);

  if (!fullPath.startsWith(wsRoot)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Path traversal detected' } }, 403);
  }

  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return c.json({ success: true, data: { path: filePath, written: true } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'WRITE_ERROR', message: error.message } }, 500);
  }
});

export default workspaceRoutes;
