import { Hono } from 'hono';
import { createLogger } from '../utils/index.js';
import {
  getProjectMemoryLoaded,
  listProjectMemories,
  type Decision,
  type ContextFact,
} from '../memory/hub.js';

const logger = createLogger('MemoryRoute');

const memoryRoutes = new Hono();

// ============================================================
// GET /api/memory/snapshot — Full memory snapshot for a workspace
// ============================================================
memoryRoutes.get('/snapshot', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const snapshot = memory.getSnapshot();
    return c.json({
      success: true,
      data: {
        workspaceId: snapshot.workspaceId,
        stats: snapshot.stats,
        techStack: snapshot.techStack,
        lastIndexedAt: snapshot.lastIndexedAt,
        factsCount: snapshot.facts.length,
        decisionsCount: snapshot.decisions.length,
        filesCount: snapshot.fileIndex.size,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// GET /api/memory/facts — List all context facts
// ============================================================
memoryRoutes.get('/facts', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const category = c.req.query('category') as ContextFact['category'] | undefined;
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const facts = memory.getFacts(category);
    return c.json({
      success: true,
      data: facts.map(f => ({
        id: f.id,
        category: f.category,
        fact: f.fact,
        confidence: f.confidence,
        source: f.source,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// POST /api/memory/facts — Add a context fact
// ============================================================
memoryRoutes.post('/facts', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const body = await c.req.json();
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const fact = memory.addFact({
      category: body.category,
      fact: body.fact,
      confidence: body.confidence || 0.8,
      source: body.source || 'manual',
    });
    return c.json({ success: true, data: fact });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// DELETE /api/memory/facts/:id — Remove a fact
// ============================================================
memoryRoutes.delete('/facts/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const id = c.req.param('id');
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    memory.removeFact(id);
    return c.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// GET /api/memory/decisions — List decisions
// ============================================================
memoryRoutes.get('/decisions', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const limit = parseInt(c.req.query('limit') || '50');
  const type = c.req.query('type') as Decision['type'] | undefined;
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const decisions = memory.getDecisions(limit, type);
    return c.json({
      success: true,
      data: decisions.map(d => ({
        id: d.id,
        type: d.type,
        title: d.title,
        description: d.description,
        reasoning: d.reasoning,
        files: d.files,
        agentType: d.agentType,
        outcome: d.outcome,
        tags: d.tags,
        timestamp: d.timestamp,
      })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// POST /api/memory/decisions — Log a decision manually
// ============================================================
memoryRoutes.post('/decisions', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const body = await c.req.json();
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const decision = memory.addDecision({
      type: body.type,
      title: body.title,
      description: body.description,
      reasoning: body.reasoning,
      files: body.files,
      outcome: body.outcome,
      tags: body.tags || [],
    });
    return c.json({ success: true, data: decision });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// POST /api/memory/search — Semantic search across memory
// ============================================================
memoryRoutes.post('/search', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const body = await c.req.json();
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const results = await memory.semanticSearch(body.query, body.topK || 10);
    return c.json({
      success: true,
      data: results,
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// POST /api/memory/scan — Scan workspace and index files
// ============================================================
memoryRoutes.post('/scan', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    const result = await memory.scanWorkspace(workspaceId);
    const snapshot = memory.getSnapshot();
    return c.json({
      success: true,
      data: {
        ...result,
        stats: snapshot.stats,
        techStack: snapshot.techStack,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// GET /api/memory/files — List indexed files
// ============================================================
memoryRoutes.get('/files', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const language = c.req.query('language');
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    let files = memory.getAllFiles();
    if (language) files = files.filter(f => f.language === language);
    return c.json({
      success: true,
      data: files.map(f => ({
        path: f.path,
        language: f.language,
        sizeBytes: f.sizeBytes,
        summary: f.summary,
        exports: f.exports,
        imports: f.imports,
        indexedAt: f.indexedAt,
      })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// GET /api/memory/context — Get project context string
// ============================================================
memoryRoutes.get('/context', async (c) => {
  const workspaceId = c.req.query('workspaceId') || './workspaces/default';
  const query = c.req.query('query');
  try {
    const memory = await getProjectMemoryLoaded(workspaceId);
    return c.json({
      success: true,
      data: {
        context: memory.buildContext(query),
        stats: memory.getSnapshot().stats,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'MEMORY_ERROR', message: err.message } }, 500);
  }
});

// ============================================================
// GET /api/memory/workspaces — List all workspace memories
// ============================================================
memoryRoutes.get('/workspaces', async (c) => {
  return c.json({
    success: true,
    data: listProjectMemories(),
  });
});

export default memoryRoutes;
