import { RAGDocument, RAGChunk, RAGSearchResult, RAGSearchRequest, RAGIngestRequest } from '../types/index.js';
import { createEmbedding } from '../llm/router.js';
import { query as dbQuery } from '../database/client.js';
import { ragConfig, defaultLLMConfig, chromaConfig } from '../config/index.js';
import { createLogger, generateId, estimateTokens } from '../utils/index.js';

const logger = createLogger('RAG');

// ============================================================
// DOCUMENT CHUNKING — Semantic-aware splitter
// ============================================================
interface ChunkOptions {
  chunkSize: number;    // target tokens per chunk
  chunkOverlap: number; // overlap tokens between chunks
}

export function chunkDocument(
  content: string,
  options: ChunkOptions = { chunkSize: ragConfig.defaultChunkSize, chunkOverlap: ragConfig.defaultChunkOverlap }
): { content: string; metadata: { heading?: string; chunkIndex: number } }[] {
  const chunks: { content: string; metadata: { heading?: string; chunkIndex: number } }[] = [];

  // First, split by headings (markdown or HTML)
  const sections = splitByHeadings(content);

  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = splitByTokenCount(section.content, options.chunkSize, options.chunkOverlap);
    for (const chunkContent of sectionChunks) {
      if (chunkContent.trim().length > 10) {
        chunks.push({
          content: chunkContent.trim(),
          metadata: {
            heading: section.heading,
            chunkIndex: chunkIndex++,
          },
        });
      }
    }
  }

  return chunks;
}

function splitByHeadings(content: string): { heading?: string; content: string }[] {
  const sections: { heading?: string; content: string }[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;

  let lastIndex = 0;
  let lastHeading: string | undefined;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const sectionContent = content.substring(lastIndex, match.index).trim();
      if (sectionContent) {
        sections.push({ heading: lastHeading, content: sectionContent });
      }
    }
    lastHeading = match[2];
    lastIndex = match.index + match[0].length;
  }

  // Remaining content
  const remaining = content.substring(lastIndex).trim();
  if (remaining) {
    sections.push({ heading: lastHeading, content: remaining });
  }

  // If no headings found, return the whole document
  if (sections.length === 0) {
    sections.push({ content });
  }

  return sections;
}

function splitByTokenCount(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (currentTokens + sentenceTokens > chunkSize && currentChunk) {
      chunks.push(currentChunk);
      // Keep overlap
      const overlapText = getOverlapText(currentChunk, overlap);
      currentChunk = overlapText + sentence;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentTokens += sentenceTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function getOverlapText(text: string, overlapTokens: number): string {
  const words = text.split(' ');
  const overlapWords = Math.min(overlapTokens, Math.floor(words.length / 2));
  return words.slice(-overlapWords).join(' ') + ' ';
}

// ============================================================
// CHROMADB VECTOR STORE
// ============================================================
let chromaClient: any = null;
let chromaCollection: any = null;

async function getChromaCollection(collectionName?: string) {
  if (!chromaClient) {
    const { ChromaClient } = await import('chromadb');
    chromaClient = new ChromaClient({ path: chromaConfig.url });
  }

  const name = collectionName || chromaConfig.collection;

  try {
    chromaCollection = await chromaClient.getOrCreateCollection({
      name,
      metadata: { 'hnsw:space': 'cosine' },
    });
  } catch (error: any) {
    logger.error(`ChromaDB connection failed: ${error.message}`);
    throw error;
  }

  return chromaCollection;
}

// ============================================================
// INGESTION PIPELINE
// ============================================================
export async function ingestDocument(req: RAGIngestRequest): Promise<RAGDocument> {
  logger.info(`Ingesting document: ${req.title}`, { type: req.sourceType, length: req.content.length });

  // 1. Chunk the document
  const chunks = chunkDocument(req.content, {
    chunkSize: req.chunkSize || ragConfig.defaultChunkSize,
    chunkOverlap: req.chunkOverlap || ragConfig.defaultChunkOverlap,
  });

  logger.info(`Document chunked into ${chunks.length} pieces`);

  // 2. Generate embeddings for all chunks
  const chunkTexts = chunks.map(c => c.content);
  const embeddingResponse = await createEmbedding({
    provider: defaultLLMConfig.provider,
    model: defaultLLMConfig.embedModel,
    input: chunkTexts,
  });

  logger.info(`Generated ${embeddingResponse.embeddings.length} embeddings`);

  // 3. Store document in PostgreSQL
  const docId = generateId('doc');
  try {
    await dbQuery(
      `INSERT INTO documents (id, title, source_url, source_type, content, chunk_count, metadata, tsvector_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $5))`,
      [docId, req.title, req.sourceUrl || null, req.sourceType, req.content, chunks.length,
       JSON.stringify(req.metadata || {})]
    );
  } catch (error: any) {
    logger.warn(`PostgreSQL storage skipped: ${error.message}`);
  }

  // 4. Store chunks in PostgreSQL (for BM25 search)
  const chunkIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = generateId('chunk');
    chunkIds.push(chunkId);
    try {
      await dbQuery(
        `INSERT INTO chunks (id, document_id, content, chunk_index, token_count, metadata, tsvector_content)
         VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('english', $3))`,
        [chunkId, docId, chunks[i].content, i, estimateTokens(chunks[i].content),
         JSON.stringify(chunks[i].metadata)]
      );
    } catch (error: any) {
      logger.warn(`Chunk PostgreSQL storage skipped: ${error.message}`);
    }
  }

  // 5. Store embeddings in ChromaDB
  try {
    const collection = await getChromaCollection(req.collection);
    await collection.add({
      ids: chunkIds,
      embeddings: embeddingResponse.embeddings,
      documents: chunkTexts,
      metadatas: chunks.map((c, i) => ({
        documentId: docId,
        documentTitle: req.title,
        chunkIndex: i,
        heading: c.metadata.heading || '',
        sourceType: req.sourceType,
      })),
    });
    logger.info(`Stored ${chunkIds.length} vectors in ChromaDB`);
  } catch (error: any) {
    logger.warn(`ChromaDB storage skipped: ${error.message}`);
  }

  const document: RAGDocument = {
    id: docId,
    title: req.title,
    sourceUrl: req.sourceUrl,
    sourceType: req.sourceType,
    content: req.content,
    metadata: req.metadata || {},
    chunkCount: chunks.length,
    createdAt: new Date(),
  };

  return document;
}

// ============================================================
// SEARCH — Vector, BM25, and Hybrid with RRF
// ============================================================

async function vectorSearch(query: string, topK: number, collection?: string): Promise<RAGSearchResult[]> {
  try {
    const embeddingResponse = await createEmbedding({
      provider: defaultLLMConfig.provider,
      model: defaultLLMConfig.embedModel,
      input: query,
    });

    const col = await getChromaCollection(collection);
    const results = await col.query({
      queryEmbeddings: embeddingResponse.embeddings,
      nResults: topK,
    });

    if (!results.ids?.[0]) return [];

    return results.ids[0].map((id: string, i: number) => ({
      chunk: {
        id,
        documentId: results.metadatas?.[0]?.[i]?.documentId || '',
        content: results.documents?.[0]?.[i] || '',
        chunkIndex: results.metadatas?.[0]?.[i]?.chunkIndex || 0,
        tokenCount: estimateTokens(results.documents?.[0]?.[i] || ''),
        metadata: results.metadatas?.[0]?.[i] || {},
      },
      document: {
        id: results.metadatas?.[0]?.[i]?.documentId || '',
        title: results.metadatas?.[0]?.[i]?.documentTitle || '',
        sourceType: results.metadatas?.[0]?.[i]?.sourceType || 'text',
        content: '',
        metadata: {},
        chunkCount: 0,
        createdAt: new Date(),
      },
      score: results.distances?.[0]?.[i] ? 1 - results.distances[0][i] : 0,
      searchType: 'vector' as const,
    }));
  } catch (error: any) {
    logger.warn(`Vector search failed: ${error.message}`);
    return [];
  }
}

async function bm25Search(query: string, topK: number): Promise<RAGSearchResult[]> {
  try {
    const result = await dbQuery(
      `SELECT c.id, c.document_id, c.content, c.chunk_index, c.token_count, c.metadata,
              d.title as doc_title, d.source_type, d.source_url,
              ts_rank_cd(c.tsvector_content, plainto_tsquery('english', $1)) as rank
       FROM chunks c
       JOIN documents d ON c.document_id = d.id
       WHERE c.tsvector_content @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [query, topK]
    );

    return result.rows.map((row: any) => ({
      chunk: {
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        chunkIndex: row.chunk_index,
        tokenCount: row.token_count,
        metadata: row.metadata || {},
      },
      document: {
        id: row.document_id,
        title: row.doc_title,
        sourceUrl: row.source_url,
        sourceType: row.source_type,
        content: '',
        metadata: {},
        chunkCount: 0,
        createdAt: new Date(),
      },
      score: parseFloat(row.rank) || 0,
      searchType: 'bm25' as const,
    }));
  } catch (error: any) {
    logger.warn(`BM25 search failed: ${error.message}`);
    return [];
  }
}

function reciprocalRankFusion(
  vectorResults: RAGSearchResult[],
  bm25Results: RAGSearchResult[],
  k: number = ragConfig.rrfK,
  vectorWeight: number = ragConfig.vectorWeight,
  bm25Weight: number = ragConfig.bm25Weight
): RAGSearchResult[] {
  const scoreMap = new Map<string, { result: RAGSearchResult; rrfScore: number }>();

  // Score vector results
  vectorResults.forEach((result, rank) => {
    const rrfScore = vectorWeight * (1 / (k + rank + 1));
    const existing = scoreMap.get(result.chunk.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(result.chunk.id, { result: { ...result, searchType: 'hybrid' }, rrfScore });
    }
  });

  // Score BM25 results
  bm25Results.forEach((result, rank) => {
    const rrfScore = bm25Weight * (1 / (k + rank + 1));
    const existing = scoreMap.get(result.chunk.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(result.chunk.id, { result: { ...result, searchType: 'hybrid' }, rrfScore });
    }
  });

  // Sort by RRF score
  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ result, rrfScore }) => ({ ...result, score: rrfScore }));
}

export async function searchRAG(req: RAGSearchRequest): Promise<RAGSearchResult[]> {
  const topK = req.topK || ragConfig.defaultTopK;
  const searchType = req.searchType || 'hybrid';
  const retrieveK = topK * 4; // Retrieve more for reranking

  logger.info(`RAG search: "${req.query}" (type: ${searchType}, topK: ${topK})`);

  let results: RAGSearchResult[];

  switch (searchType) {
    case 'vector':
      results = await vectorSearch(req.query, topK, req.collection);
      break;

    case 'bm25':
      results = await bm25Search(req.query, topK);
      break;

    case 'hybrid':
    default:
      const [vectorResults, bm25Results] = await Promise.all([
        vectorSearch(req.query, retrieveK, req.collection),
        bm25Search(req.query, retrieveK),
      ]);

      logger.info(`Hybrid search: ${vectorResults.length} vector + ${bm25Results.length} BM25 results`);
      results = reciprocalRankFusion(vectorResults, bm25Results);
      break;
  }

  // Trim to topK
  results = results.slice(0, topK);

  logger.info(`Returning ${results.length} results`);
  return results;
}

// ============================================================
// LIST / DELETE DOCUMENTS
// ============================================================
export async function listDocuments(): Promise<RAGDocument[]> {
  try {
    const result = await dbQuery(
      `SELECT id, title, source_url, source_type, chunk_count, metadata, created_at
       FROM documents ORDER BY created_at DESC`
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      sourceUrl: row.source_url,
      sourceType: row.source_type,
      content: '',
      metadata: row.metadata || {},
      chunkCount: row.chunk_count,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  try {
    // Get chunk IDs for ChromaDB deletion
    const chunksResult = await dbQuery('SELECT id FROM chunks WHERE document_id = $1', [docId]);
    const chunkIds = chunksResult.rows.map((r: any) => r.id);

    // Delete from ChromaDB
    if (chunkIds.length > 0) {
      try {
        const collection = await getChromaCollection();
        await collection.delete({ ids: chunkIds });
      } catch (e: any) {
        logger.warn(`ChromaDB deletion failed: ${e.message}`);
      }
    }

    // Delete from PostgreSQL
    await dbQuery('DELETE FROM chunks WHERE document_id = $1', [docId]);
    await dbQuery('DELETE FROM documents WHERE id = $1', [docId]);

    logger.info(`Deleted document ${docId} with ${chunkIds.length} chunks`);
  } catch (error: any) {
    logger.error(`Delete document failed: ${error.message}`);
    throw error;
  }
}
