import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { ingestDocument, searchRAG, listDocuments, deleteDocument } from '../../rag/pipeline.js';

// ============================================================
// RAG INGEST
// ============================================================
toolRegistry.register(
  {
    name: 'rag_ingest',
    category: 'rag',
    description: 'Ingest a document into the RAG knowledge base. Supports text, markdown, HTML, and code. The document will be chunked, embedded, and stored for retrieval.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Document content to ingest' },
        title: { type: 'string', description: 'Document title' },
        sourceUrl: { type: 'string', description: 'Source URL (if applicable)' },
        sourceType: { type: 'string', enum: ['pdf', 'markdown', 'html', 'text', 'code', 'url'], default: 'text' },
        metadata: { type: 'object', description: 'Additional metadata' },
      },
      required: ['content', 'title'],
    },
    riskLevel: 'safe',
    timeout: 60000,
  },
  z.object({
    content: z.string(), title: z.string(), sourceUrl: z.string().optional(),
    sourceType: z.enum(['pdf', 'markdown', 'html', 'text', 'code', 'url']).optional(),
    metadata: z.record(z.any()).optional(),
  }),
  async (args) => {
    const doc = await ingestDocument({
      content: args.content,
      title: args.title,
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType || 'text',
      metadata: args.metadata,
    });
    return { id: doc.id, title: doc.title, chunkCount: doc.chunkCount };
  }
);

// ============================================================
// RAG QUERY
// ============================================================
toolRegistry.register(
  {
    name: 'rag_query',
    category: 'rag',
    description: 'Search the RAG knowledge base. Uses hybrid search (vector + BM25 + Reciprocal Rank Fusion) for best results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 5 },
        searchType: { type: 'string', enum: ['vector', 'bm25', 'hybrid'], default: 'hybrid' },
      },
      required: ['query'],
    },
    riskLevel: 'safe',
  },
  z.object({ query: z.string(), topK: z.number().optional(), searchType: z.enum(['vector', 'bm25', 'hybrid']).optional() }),
  async (args) => {
    const results = await searchRAG({
      query: args.query,
      topK: args.topK,
      searchType: args.searchType,
    });
    return {
      query: args.query,
      results: results.map(r => ({
        content: r.chunk.content,
        documentTitle: r.document.title,
        score: Math.round(r.score * 10000) / 10000,
        searchType: r.searchType,
        metadata: r.chunk.metadata,
      })),
      count: results.length,
    };
  }
);

// ============================================================
// RAG LIST DOCS
// ============================================================
toolRegistry.register(
  {
    name: 'rag_list_docs',
    category: 'rag',
    description: 'List all documents in the RAG knowledge base.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
  },
  z.object({}),
  async () => {
    const docs = await listDocuments();
    return {
      documents: docs.map(d => ({
        id: d.id,
        title: d.title,
        sourceType: d.sourceType,
        chunkCount: d.chunkCount,
        createdAt: d.createdAt,
      })),
      count: docs.length,
    };
  }
);

// ============================================================
// RAG DELETE DOC
// ============================================================
toolRegistry.register(
  {
    name: 'rag_delete_doc',
    category: 'rag',
    description: 'Delete a document and all its chunks from the RAG knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Document ID to delete' },
      },
      required: ['docId'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({ docId: z.string() }),
  async (args) => {
    await deleteDocument(args.docId);
    return { deleted: true, docId: args.docId };
  }
);

export default toolRegistry;
