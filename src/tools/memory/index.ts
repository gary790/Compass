import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import {
  getProjectMemoryLoaded,
  listProjectMemories,
} from '../../memory/hub.js';

// ============================================================
// MEMORY SEARCH — Semantic search across project memory
// ============================================================
toolRegistry.register(
  {
    name: 'memory_search',
    category: 'rag',
    description: 'Search the project memory for relevant context — decisions, facts, and files. Uses hybrid semantic + keyword search. Prefer this over rag_query when looking for project-specific knowledge (architecture decisions, coding conventions, recent changes, file locations).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (natural language)' },
        topK: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
    riskLevel: 'safe',
  },
  z.object({ query: z.string(), topK: z.number().optional() }),
  async (args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const results = await memory.semanticSearch(args.query, args.topK || 10);
    return {
      query: args.query,
      results: results.map(r => ({
        type: r.type,
        content: r.content,
        score: Math.round(r.score * 10000) / 10000,
        metadata: r.metadata,
      })),
      count: results.length,
    };
  }
);

// ============================================================
// MEMORY LOG DECISION — Record an architecture/implementation decision
// ============================================================
toolRegistry.register(
  {
    name: 'memory_log_decision',
    category: 'rag',
    description: 'Log an important project decision to persistent memory. Use this for architecture choices, tech stack changes, deployment configs, refactoring rationale, etc. Decisions are indexed for future retrieval.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['architecture', 'implementation', 'fix', 'dependency', 'config', 'refactor', 'deploy'],
          description: 'Decision category',
        },
        title: { type: 'string', description: 'Short decision title' },
        description: { type: 'string', description: 'Detailed description of the decision' },
        reasoning: { type: 'string', description: 'Why this decision was made' },
        files: { type: 'array', items: { type: 'string' }, description: 'Affected files' },
        outcome: { type: 'string', enum: ['success', 'failure', 'partial'], description: 'Result of the decision' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      },
      required: ['type', 'title', 'description'],
    },
    riskLevel: 'safe',
  },
  z.object({
    type: z.enum(['architecture', 'implementation', 'fix', 'dependency', 'config', 'refactor', 'deploy']),
    title: z.string(),
    description: z.string(),
    reasoning: z.string().optional(),
    files: z.array(z.string()).optional(),
    outcome: z.enum(['success', 'failure', 'partial']).optional(),
    tags: z.array(z.string()).optional(),
  }),
  async (args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const decision = memory.addDecision({
      type: args.type,
      title: args.title,
      description: args.description,
      reasoning: args.reasoning,
      files: args.files,
      outcome: args.outcome,
      tags: args.tags || [],
    });
    return { id: decision.id, logged: true, type: decision.type, title: decision.title };
  }
);

// ============================================================
// MEMORY GET CONTEXT — Get the full project context block
// ============================================================
toolRegistry.register(
  {
    name: 'memory_get_context',
    category: 'rag',
    description: 'Get the current project context — tech stack, recent decisions, indexed files, and key facts. Returns a structured summary that can be injected into LLM prompts for project-aware responses.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional query to tailor context retrieval' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ query: z.string().optional() }),
  async (args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const snapshot = memory.getSnapshot();
    return {
      context: memory.buildContext(args.query),
      stats: snapshot.stats,
      techStack: snapshot.techStack,
      recentDecisions: memory.getRecentDecisions(5).map(d => ({
        type: d.type, title: d.title, outcome: d.outcome,
      })),
    };
  }
);

// ============================================================
// MEMORY ADD FACT — Add a persistent context fact
// ============================================================
toolRegistry.register(
  {
    name: 'memory_add_fact',
    category: 'rag',
    description: 'Add a persistent context fact about the project. Facts are auto-injected into LLM prompts. Use for conventions, constraints, preferences, tech stack details, and architecture notes.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['tech_stack', 'architecture', 'convention', 'constraint', 'preference', 'environment'],
          description: 'Fact category',
        },
        fact: { type: 'string', description: 'The fact to store (e.g., "API responses must use camelCase JSON keys")' },
        confidence: { type: 'number', description: 'Confidence 0.0-1.0', default: 0.8 },
        source: { type: 'string', description: 'How this fact was learned' },
      },
      required: ['category', 'fact'],
    },
    riskLevel: 'safe',
  },
  z.object({
    category: z.enum(['tech_stack', 'architecture', 'convention', 'constraint', 'preference', 'environment']),
    fact: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    source: z.string().optional(),
  }),
  async (args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const fact = memory.addFact({
      category: args.category,
      fact: args.fact,
      confidence: args.confidence || 0.8,
      source: args.source || 'agent',
    });
    return { id: fact.id, added: true, category: fact.category, fact: fact.fact };
  }
);

// ============================================================
// MEMORY SCAN WORKSPACE — Scan and index project files
// ============================================================
toolRegistry.register(
  {
    name: 'memory_scan_workspace',
    category: 'rag',
    description: 'Scan the workspace directory and index all project files. Detects tech stack, extracts exports/imports for JS/TS files, and generates file summaries. Run this when starting work on a project or after significant file changes.',
    parameters: {
      type: 'object',
      properties: {},
    },
    riskLevel: 'safe',
    timeout: 60000,
  },
  z.object({}),
  async (_args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const result = await memory.scanWorkspace(ctx.workspacePath);
    const snapshot = memory.getSnapshot();
    return {
      ...result,
      techStack: snapshot.techStack,
      stats: snapshot.stats,
    };
  }
);

// ============================================================
// MEMORY LIST DECISIONS — List recent decisions
// ============================================================
toolRegistry.register(
  {
    name: 'memory_list_decisions',
    category: 'rag',
    description: 'List recent project decisions from memory. Useful for understanding what has been done and why.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max decisions to return', default: 20 },
        type: {
          type: 'string',
          enum: ['architecture', 'implementation', 'fix', 'dependency', 'config', 'refactor', 'deploy'],
          description: 'Filter by decision type',
        },
      },
    },
    riskLevel: 'safe',
  },
  z.object({
    limit: z.number().optional(),
    type: z.enum(['architecture', 'implementation', 'fix', 'dependency', 'config', 'refactor', 'deploy']).optional(),
  }),
  async (args, ctx) => {
    const memory = await getProjectMemoryLoaded(ctx.workspacePath);
    const decisions = memory.getDecisions(args.limit || 20, args.type as any);
    return {
      decisions: decisions.map(d => ({
        id: d.id,
        type: d.type,
        title: d.title,
        description: d.description,
        outcome: d.outcome,
        tags: d.tags,
        timestamp: d.timestamp,
      })),
      count: decisions.length,
    };
  }
);

export default toolRegistry;
