import { Hono } from 'hono';
import { ingestDocument, searchRAG, listDocuments, deleteDocument } from '../rag/pipeline.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('RAGRoute');
const ragRoutes = new Hono();

// POST /api/rag/ingest — Ingest document
ragRoutes.post('/ingest', async (c) => {
  try {
    const body = await c.req.json();
    const { content, title, sourceUrl, sourceType, metadata } = body;

    if (!content || !title) {
      return c.json({ success: false, error: { code: 'VALIDATION', message: 'content and title are required' } }, 400);
    }

    const doc = await ingestDocument({ content, title, sourceUrl, sourceType: sourceType || 'text', metadata });
    return c.json({ success: true, data: doc });
  } catch (error: any) {
    logger.error(`Ingest error: ${error.message}`);
    return c.json({ success: false, error: { code: 'INGEST_ERROR', message: error.message } }, 500);
  }
});

// POST /api/rag/search — Search knowledge base
ragRoutes.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { query, topK, searchType } = body;

    if (!query) {
      return c.json({ success: false, error: { code: 'VALIDATION', message: 'query is required' } }, 400);
    }

    const results = await searchRAG({ query, topK, searchType });
    return c.json({ success: true, data: { results, count: results.length } });
  } catch (error: any) {
    logger.error(`Search error: ${error.message}`);
    return c.json({ success: false, error: { code: 'SEARCH_ERROR', message: error.message } }, 500);
  }
});

// GET /api/rag/documents — List documents
ragRoutes.get('/documents', async (c) => {
  try {
    const docs = await listDocuments();
    return c.json({ success: true, data: { documents: docs, count: docs.length } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'LIST_ERROR', message: error.message } }, 500);
  }
});

// DELETE /api/rag/documents/:id — Delete document
ragRoutes.delete('/documents/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteDocument(id);
    return c.json({ success: true, data: { deleted: true, id } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'DELETE_ERROR', message: error.message } }, 500);
  }
});

export default ragRoutes;
