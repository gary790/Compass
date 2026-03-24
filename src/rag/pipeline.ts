import { RAGDocument, RAGChunk, RAGSearchResult, RAGSearchRequest, RAGIngestRequest } from '../types/index.js';
import { createEmbedding, callLLM } from '../llm/router.js';
import { query as dbQuery } from '../database/client.js';
import { ragConfig, defaultLLMConfig, chromaConfig } from '../config/index.js';
import { createLogger, generateId, estimateTokens } from '../utils/index.js';

const logger = createLogger('RAG');

// ============================================================
// DOCUMENT CHUNKING — Semantic-aware splitter
// ============================================================
interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

export function chunkDocument(
  content: string,
  options: ChunkOptions = { chunkSize: ragConfig.defaultChunkSize, chunkOverlap: ragConfig.defaultChunkOverlap }
): { content: string; metadata: { heading?: string; chunkIndex: number } }[] {
  const chunks: { content: string; metadata: { heading?: string; chunkIndex: number } }[] = [];

  // Split by headings first (markdown or HTML)
  const sections = splitByHeadings(content);

  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = splitByTokenCount(section.content, options.chunkSize, options.chunkOverlap);
    for (const chunkContent of sectionChunks) {
      if (chunkContent.trim().length > 10) {
        chunks.push({
          content: chunkContent.trim(),
          metadata: { heading: section.heading, chunkIndex: chunkIndex++ },
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

  const remaining = content.substring(lastIndex).trim();
  if (remaining) sections.push({ heading: lastHeading, content: remaining });
  if (sections.length === 0) sections.push({ content });

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
      const overlapText = getOverlapText(currentChunk, overlap);
      currentChunk = overlapText + sentence;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentTokens += sentenceTokens;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk);
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
// QUERY EXPANSION — LLM-powered multi-query generation
// ============================================================
async function expandQueryLLM(query: string): Promise<string[]> {
  const queries = [query];

  // Always add keyword-only version
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'or', 'and', 'but', 'not', 'it', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his', 'her', 'their']);
  const keywords = query.toLowerCase().split(/\s+/).filter(w => !stopWords.has(w) && w.length > 2);
  if (keywords.length > 1 && keywords.join(' ') !== query.toLowerCase().trim()) {
    queries.push(keywords.join(' '));
  }

  // LLM-powered expansion: generate alternative phrasings
  try {
    const expansionResponse = await callLLM({
      provider: defaultLLMConfig.provider,
      model: 'gpt-4o-mini', // Use fast cheap model for expansion
      messages: [
        { role: 'system', content: 'You are a search query expansion expert. Given a user query, generate 3 alternative phrasings that would help retrieve relevant documents. Return ONLY a JSON array of strings, no explanation.' },
        { role: 'user', content: `Expand this search query into 3 alternative phrasings:\n"${query}"\nReturn JSON array only.` },
      ],
      temperature: 0.7,
      maxTokens: 200,
      responseFormat: 'json',
    });

    const parsed = JSON.parse(expansionResponse.content);
    const alternatives = Array.isArray(parsed) ? parsed : (parsed.queries || parsed.alternatives || []);
    for (const alt of alternatives) {
      if (typeof alt === 'string' && alt.trim() && alt.trim() !== query) {
        queries.push(alt.trim());
      }
    }
    logger.info(`LLM query expansion: ${query} -> ${queries.length} variants`);
  } catch (error: any) {
    logger.debug(`LLM expansion skipped: ${error.message}`);
  }

  return queries;
}

// Simple fallback (used when LLM is unavailable)
function expandQuerySimple(query: string): string[] {
  const queries = [query];
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'or', 'and', 'but', 'not', 'it', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his', 'her', 'their']);
  const keywords = query.toLowerCase().split(/\s+/).filter(w => !stopWords.has(w) && w.length > 2);
  if (keywords.length > 1 && keywords.join(' ') !== query.toLowerCase().trim()) {
    queries.push(keywords.join(' '));
  }
  return queries;
}

// ============================================================
// CONTEXTUAL COMPRESSION — Trim irrelevant parts of results
// ============================================================
function compressResult(result: RAGSearchResult, query: string): RAGSearchResult {
  const content = result.chunk.content;
  // If the chunk is already small, return as-is
  if (estimateTokens(content) <= 200) return result;

  // Split into sentences and score each one by keyword overlap
  const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const sentences = content.split(/(?<=[.!?\n])\s+/);

  const scored = sentences.map((s, i) => {
    const sWords = new Set(s.toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const term of queryTerms) {
      for (const word of sWords) {
        if (word.includes(term) || term.includes(word)) { overlap++; break; }
      }
    }
    return { sentence: s, score: overlap, index: i };
  });

  // Keep sentences with any overlap, plus 1 sentence of context around each
  const keepIndices = new Set<number>();
  for (const s of scored) {
    if (s.score > 0) {
      keepIndices.add(Math.max(0, s.index - 1));
      keepIndices.add(s.index);
      keepIndices.add(Math.min(sentences.length - 1, s.index + 1));
    }
  }

  // If nothing matched, keep everything
  if (keepIndices.size === 0) return result;

  const compressed = Array.from(keepIndices)
    .sort((a, b) => a - b)
    .map(i => sentences[i])
    .join(' ');

  return {
    ...result,
    chunk: { ...result.chunk, content: compressed },
  };
}

// ============================================================
// CROSS-ENCODER RERANKING — LLM-based relevance scoring
// ============================================================
async function crossEncoderRerank(results: RAGSearchResult[], query: string, topK: number): Promise<RAGSearchResult[]> {
  if (results.length <= topK) return results;

  // Take top candidates for reranking (max 20 to limit cost)
  const candidates = results.slice(0, Math.min(results.length, 20));

  try {
    const passages = candidates.map((r, i) => 
      `[${i}] ${r.chunk.content.substring(0, 300)}`
    ).join('\n\n');

    const response = await callLLM({
      provider: defaultLLMConfig.provider,
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a relevance judge. Given a query and numbered passages, rank the passages by relevance to the query. Return ONLY a JSON array of passage indices sorted from most to least relevant. Example: [3, 0, 7, 1]' },
        { role: 'user', content: `Query: "${query}"\n\nPassages:\n${passages}\n\nReturn JSON array of indices sorted by relevance (most relevant first):` },
      ],
      temperature: 0,
      maxTokens: 200,
      responseFormat: 'json',
    });

    const ranked = JSON.parse(response.content);
    const indices = Array.isArray(ranked) ? ranked : (ranked.indices || ranked.ranking || []);
    
    const reranked: RAGSearchResult[] = [];
    const seen = new Set<number>();
    for (const idx of indices) {
      const i = typeof idx === 'number' ? idx : parseInt(idx);
      if (!isNaN(i) && i >= 0 && i < candidates.length && !seen.has(i)) {
        seen.add(i);
        reranked.push({ ...candidates[i], score: 1 - (reranked.length / candidates.length) });
      }
      if (reranked.length >= topK) break;
    }

    // Fill remaining slots with unranked results
    if (reranked.length < topK) {
      for (let i = 0; i < candidates.length && reranked.length < topK; i++) {
        if (!seen.has(i)) {
          reranked.push(candidates[i]);
        }
      }
    }

    logger.info(`Cross-encoder reranked ${candidates.length} candidates -> top ${reranked.length}`);
    return reranked;
  } catch (error: any) {
    logger.debug(`Cross-encoder reranking skipped: ${error.message}`);
    return results.slice(0, topK);
  }
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

  // 2. Generate embeddings
  const chunkTexts = chunks.map(c => c.content);
  let embeddingResponse;
  try {
    embeddingResponse = await createEmbedding({
      provider: defaultLLMConfig.provider,
      model: defaultLLMConfig.embedModel,
      input: chunkTexts,
    });
    logger.info(`Generated ${embeddingResponse.embeddings.length} embeddings`);
  } catch (error: any) {
    logger.warn(`Embedding generation failed: ${error.message}. Storing without vectors.`);
    embeddingResponse = null;
  }

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
    logger.warn(`PostgreSQL document storage skipped: ${error.message}`);
  }

  // 4. Store chunks in PostgreSQL
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
      logger.warn(`Chunk PG storage skipped: ${error.message}`);
    }
  }

  // 5. Store embeddings in ChromaDB
  if (embeddingResponse) {
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
  }

  return {
    id: docId,
    title: req.title,
    sourceUrl: req.sourceUrl,
    sourceType: req.sourceType,
    content: req.content,
    metadata: req.metadata || {},
    chunkCount: chunks.length,
    createdAt: new Date(),
  };
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

  vectorResults.forEach((result, rank) => {
    const rrfScore = vectorWeight * (1 / (k + rank + 1));
    const existing = scoreMap.get(result.chunk.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(result.chunk.id, { result: { ...result, searchType: 'hybrid' }, rrfScore });
    }
  });

  bm25Results.forEach((result, rank) => {
    const rrfScore = bm25Weight * (1 / (k + rank + 1));
    const existing = scoreMap.get(result.chunk.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(result.chunk.id, { result: { ...result, searchType: 'hybrid' }, rrfScore });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ result, rrfScore }) => ({ ...result, score: rrfScore }));
}

export async function searchRAG(req: RAGSearchRequest): Promise<RAGSearchResult[]> {
  const topK = req.topK || ragConfig.defaultTopK;
  const searchType = req.searchType || 'hybrid';
  const retrieveK = Math.min(topK * 4, 50); // Retrieve more for reranking, cap at 50

  logger.info(`RAG search: "${req.query}" (type: ${searchType}, topK: ${topK})`);

  // Query expansion (LLM-powered with fallback)
  let expandedQueries: string[];
  try {
    expandedQueries = await expandQueryLLM(req.query);
  } catch {
    expandedQueries = expandQuerySimple(req.query);
  }
  logger.info(`Query expanded into ${expandedQueries.length} variants`);

  let results: RAGSearchResult[];

  switch (searchType) {
    case 'vector':
      results = await vectorSearch(req.query, topK, req.collection);
      break;

    case 'bm25': {
      // Search all expanded queries and merge
      const allBm25: RAGSearchResult[] = [];
      for (const q of expandedQueries) {
        const r = await bm25Search(q, retrieveK);
        allBm25.push(...r);
      }
      // Deduplicate by chunk ID, keeping highest score
      const dedupe = new Map<string, RAGSearchResult>();
      for (const r of allBm25) {
        const existing = dedupe.get(r.chunk.id);
        if (!existing || r.score > existing.score) dedupe.set(r.chunk.id, r);
      }
      results = Array.from(dedupe.values()).sort((a, b) => b.score - a.score);
      break;
    }

    case 'hybrid':
    default: {
      // Run vector + BM25 in parallel with expanded queries
      const [vectorResults, ...bm25Results] = await Promise.all([
        vectorSearch(req.query, retrieveK, req.collection),
        ...expandedQueries.map(q => bm25Search(q, retrieveK)),
      ]);

      // Merge all BM25 results, deduplicating by chunk ID
      const mergedBm25 = new Map<string, RAGSearchResult>();
      for (const results of bm25Results) {
        for (const r of results) {
          const existing = mergedBm25.get(r.chunk.id);
          if (!existing || r.score > existing.score) mergedBm25.set(r.chunk.id, r);
        }
      }

      logger.info(`Hybrid search: ${vectorResults.length} vector + ${mergedBm25.size} BM25 results`);
      results = reciprocalRankFusion(vectorResults, Array.from(mergedBm25.values()));
      break;
    }
  }

  // Cross-encoder reranking using LLM relevance scoring
  if (ragConfig.enableReranking && results.length > topK) {
    results = await crossEncoderRerank(results, req.query, topK);
  } else {
    results = results.slice(0, topK);
  }

  // Contextual compression
  results = results.map(r => compressResult(r, req.query));

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
    const chunksResult = await dbQuery('SELECT id FROM chunks WHERE document_id = $1', [docId]);
    const chunkIds = chunksResult.rows.map((r: any) => r.id);

    if (chunkIds.length > 0) {
      try {
        const collection = await getChromaCollection();
        await collection.delete({ ids: chunkIds });
      } catch (e: any) {
        logger.warn(`ChromaDB deletion failed: ${e.message}`);
      }
    }

    await dbQuery('DELETE FROM chunks WHERE document_id = $1', [docId]);
    await dbQuery('DELETE FROM documents WHERE id = $1', [docId]);

    logger.info(`Deleted document ${docId} with ${chunkIds.length} chunks`);
  } catch (error: any) {
    logger.error(`Delete document failed: ${error.message}`);
    throw error;
  }
}
