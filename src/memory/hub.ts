// ============================================================
// PROJECT MEMORY HUB v2 — Persistent context across conversations
// Stores: file index, decision log, context facts, tech stack
// Backed by PostgreSQL + ChromaDB embeddings
// ============================================================
import { createLogger, generateId, estimateTokens } from '../utils/index.js';
import { query as dbQuery } from '../database/client.js';
import { createEmbedding } from '../llm/router.js';
import { defaultLLMConfig, chromaConfig } from '../config/index.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('ProjectMemory');

// ChromaDB collection for memory embeddings
const MEMORY_COLLECTION = chromaConfig.memoryCollection || 'conversation_memory';

// ============================================================
// TYPES
// ============================================================

/** A single indexed file in the project */
export interface IndexedFile {
  path: string;
  language: string;
  sizeBytes: number;
  lastModified: number;
  summary?: string;
  exports?: string[];
  imports?: string[];
  chunkIds?: string[];
  indexedAt: number;
}

/** An architectural or implementation decision */
export interface Decision {
  id: string;
  timestamp: number;
  type: 'architecture' | 'implementation' | 'fix' | 'dependency' | 'config' | 'refactor' | 'deploy';
  title: string;
  description: string;
  reasoning?: string;
  files?: string[];
  agentType?: string;
  outcome?: 'success' | 'failure' | 'partial';
  tags: string[];
}

/** A persistent context fact */
export interface ContextFact {
  id: string;
  category: 'tech_stack' | 'architecture' | 'convention' | 'constraint' | 'preference' | 'environment';
  fact: string;
  confidence: number;
  source: string;
  createdAt: number;
  updatedAt: number;
}

/** Summary of the project's tech stack */
export interface TechStack {
  frameworks: string[];
  languages: string[];
  databases: string[];
  buildTools: string[];
  testFrameworks: string[];
  deployTarget?: string;
  packageManager: string;
  nodeVersion?: string;
}

/** Full memory snapshot */
export interface MemorySnapshot {
  workspaceId: string;
  fileIndex: Map<string, IndexedFile>;
  decisions: Decision[];
  facts: ContextFact[];
  techStack: TechStack | null;
  lastIndexedAt: number | null;
  stats: {
    totalFiles: number;
    indexedFiles: number;
    totalDecisions: number;
    totalFacts: number;
  };
}

/** Semantic search result across memory */
export interface MemorySearchResult {
  type: 'decision' | 'fact' | 'file';
  id: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

// Language detection from extensions
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.rb': 'ruby',
  '.php': 'php', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.css': 'css', '.scss': 'scss', '.html': 'html', '.vue': 'vue', '.svelte': 'svelte',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.md': 'markdown', '.sql': 'sql', '.sh': 'shell', '.bash': 'shell',
  '.dockerfile': 'docker', '.tf': 'terraform', '.graphql': 'graphql',
};

// Dirs/files to skip during scanning
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.wrangler', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'vendor', 'target', '.cache', '.turbo',
  'coverage', '.nyc_output', '.parcel-cache',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'Thumbs.db',
]);

// ============================================================
// ChromaDB helpers
// ============================================================
let chromaClient: any = null;

async function getMemoryChromaCollection() {
  if (!chromaClient) {
    try {
      const { ChromaClient } = await import('chromadb');
      chromaClient = new ChromaClient({ path: chromaConfig.url });
    } catch {
      return null; // ChromaDB not available
    }
  }
  try {
    return await chromaClient.getOrCreateCollection({
      name: MEMORY_COLLECTION,
      metadata: { 'hnsw:space': 'cosine' },
    });
  } catch {
    return null;
  }
}

async function embedText(text: string): Promise<number[] | null> {
  try {
    const resp = await createEmbedding({
      provider: defaultLLMConfig.provider,
      model: defaultLLMConfig.embedModel,
      input: text,
    });
    return resp.embeddings[0] || null;
  } catch {
    return null;
  }
}

async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  try {
    const resp = await createEmbedding({
      provider: defaultLLMConfig.provider,
      model: defaultLLMConfig.embedModel,
      input: texts,
    });
    return texts.map((_, i) => resp.embeddings[i] || null);
  } catch {
    return texts.map(() => null);
  }
}

// ============================================================
// PROJECT MEMORY CLASS — One instance per workspace
// ============================================================
export class ProjectMemory {
  private workspaceId: string;
  private files: Map<string, IndexedFile> = new Map();
  private decisions: Decision[] = [];
  private facts: Map<string, ContextFact> = new Map();
  private techStack: TechStack | null = null;
  private lastIndexedAt: number | null = null;
  private loaded: boolean = false;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    logger.info(`ProjectMemory initialized for workspace: ${workspaceId}`);
  }

  // ============================================================
  // LAZY LOAD FROM DB
  // ============================================================
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await Promise.all([
      this.loadDecisionsFromDB(),
      this.loadFactsFromDB(),
      this.loadFileIndexFromDB(),
    ]);
    this.loaded = true;
  }

  // ============================================================
  // FILE INDEX
  // ============================================================
  setFileIndex(files: IndexedFile[]): void {
    this.files.clear();
    for (const file of files) {
      this.files.set(file.path, file);
    }
    this.lastIndexedAt = Date.now();
    logger.info(`File index updated: ${files.length} files`);
  }

  updateFile(file: IndexedFile): void {
    this.files.set(file.path, file);
    this.persistFileAsync(file);
  }

  removeFile(filePath: string): void {
    this.files.delete(filePath);
    this.deleteFileFromDB(filePath);
  }

  getFile(filePath: string): IndexedFile | undefined {
    return this.files.get(filePath);
  }

  getAllFiles(): IndexedFile[] {
    return Array.from(this.files.values());
  }

  getFilesByLanguage(language: string): IndexedFile[] {
    return this.getAllFiles().filter(f => f.language === language);
  }

  getFilesByPattern(pattern: RegExp): IndexedFile[] {
    return this.getAllFiles().filter(f => pattern.test(f.path));
  }

  // ============================================================
  // FILE SCANNER — Walk workspace and index files
  // ============================================================
  async scanWorkspace(workspacePath: string): Promise<{ scanned: number; indexed: number }> {
    logger.info(`Scanning workspace: ${workspacePath}`);
    const scannedFiles: IndexedFile[] = [];

    const walk = async (dir: string, prefix: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), prefix + entry.name + '/');
        } else if (entry.isFile()) {
          if (IGNORE_FILES.has(entry.name)) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const lang = LANG_MAP[ext];
          if (!lang) continue; // skip unknown file types
          const fullPath = path.join(dir, entry.name);
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > 500_000) continue; // skip files > 500KB
            const relativePath = prefix + entry.name;

            // Read file for export/import extraction
            let exports: string[] = [];
            let imports: string[] = [];
            let summary: string | undefined;
            if (['typescript', 'javascript'].includes(lang) && stat.size < 100_000) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                exports = extractExports(content);
                imports = extractImports(content);
                summary = extractSummary(content, entry.name);
              } catch { /* skip read errors */ }
            }

            scannedFiles.push({
              path: relativePath,
              language: lang,
              sizeBytes: stat.size,
              lastModified: stat.mtimeMs,
              summary,
              exports,
              imports,
              indexedAt: Date.now(),
            });
          } catch { /* skip stat errors */ }
        }
      }
    };

    await walk(workspacePath, '');

    // Update in-memory index
    this.setFileIndex(scannedFiles);

    // Persist to DB (batch)
    await this.persistFileIndexBatch(scannedFiles);

    // Auto-detect tech stack
    await this.detectTechStack(workspacePath);

    logger.info(`Scan complete: ${scannedFiles.length} files indexed`);
    return { scanned: scannedFiles.length, indexed: scannedFiles.length };
  }

  // ============================================================
  // TECH STACK AUTO-DETECTION
  // ============================================================
  async detectTechStack(workspacePath: string): Promise<TechStack> {
    const stack: TechStack = {
      frameworks: [],
      languages: [],
      databases: [],
      buildTools: [],
      testFrameworks: [],
      packageManager: 'npm',
    };

    // Detect from file extensions
    const langCounts = new Map<string, number>();
    for (const f of this.files.values()) {
      langCounts.set(f.language, (langCounts.get(f.language) || 0) + 1);
    }
    stack.languages = Array.from(langCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang);

    // Parse package.json
    try {
      const pkgRaw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Frameworks
      if (allDeps['hono']) stack.frameworks.push('Hono');
      if (allDeps['express']) stack.frameworks.push('Express');
      if (allDeps['next']) stack.frameworks.push('Next.js');
      if (allDeps['nuxt']) stack.frameworks.push('Nuxt');
      if (allDeps['react']) stack.frameworks.push('React');
      if (allDeps['vue']) stack.frameworks.push('Vue');
      if (allDeps['svelte']) stack.frameworks.push('Svelte');
      if (allDeps['fastify']) stack.frameworks.push('Fastify');
      if (allDeps['nestjs'] || allDeps['@nestjs/core']) stack.frameworks.push('NestJS');

      // Databases
      if (allDeps['pg'] || allDeps['postgres']) stack.databases.push('PostgreSQL');
      if (allDeps['mysql2'] || allDeps['mysql']) stack.databases.push('MySQL');
      if (allDeps['mongodb'] || allDeps['mongoose']) stack.databases.push('MongoDB');
      if (allDeps['redis'] || allDeps['ioredis']) stack.databases.push('Redis');
      if (allDeps['chromadb']) stack.databases.push('ChromaDB');
      if (allDeps['better-sqlite3'] || allDeps['sqlite3']) stack.databases.push('SQLite');

      // Build tools
      if (allDeps['vite']) stack.buildTools.push('Vite');
      if (allDeps['webpack']) stack.buildTools.push('Webpack');
      if (allDeps['esbuild']) stack.buildTools.push('esbuild');
      if (allDeps['rollup']) stack.buildTools.push('Rollup');
      if (allDeps['tsup']) stack.buildTools.push('tsup');
      if (allDeps['typescript']) stack.buildTools.push('TypeScript');
      if (allDeps['wrangler']) stack.buildTools.push('Wrangler');

      // Test frameworks
      if (allDeps['jest']) stack.testFrameworks.push('Jest');
      if (allDeps['vitest']) stack.testFrameworks.push('Vitest');
      if (allDeps['mocha']) stack.testFrameworks.push('Mocha');
      if (allDeps['playwright']) stack.testFrameworks.push('Playwright');
      if (allDeps['cypress']) stack.testFrameworks.push('Cypress');

      // Package manager
      if (pkg.packageManager?.startsWith('pnpm')) stack.packageManager = 'pnpm';
      else if (pkg.packageManager?.startsWith('yarn')) stack.packageManager = 'yarn';
      else stack.packageManager = 'npm';

      // Node version
      if (pkg.engines?.node) stack.nodeVersion = pkg.engines.node;
    } catch { /* no package.json */ }

    // Detect deploy target from config files
    const configFiles = Array.from(this.files.keys());
    if (configFiles.some(f => f.includes('wrangler'))) stack.deployTarget = 'Cloudflare Workers';
    else if (configFiles.some(f => f.includes('vercel.json'))) stack.deployTarget = 'Vercel';
    else if (configFiles.some(f => f.includes('Dockerfile'))) stack.deployTarget = 'Docker';
    else if (configFiles.some(f => f.includes('fly.toml'))) stack.deployTarget = 'Fly.io';

    this.setTechStack(stack);
    return stack;
  }

  // ============================================================
  // DECISION LOG
  // ============================================================
  addDecision(decision: Omit<Decision, 'id' | 'timestamp'>): Decision {
    const full: Decision = {
      ...decision,
      id: generateId('dec'),
      timestamp: Date.now(),
    };
    this.decisions.push(full);

    // Cap at 500 decisions (FIFO)
    if (this.decisions.length > 500) {
      this.decisions = this.decisions.slice(-500);
    }

    logger.info(`Decision logged: [${full.type}] ${full.title}`);
    this.persistDecisionAsync(full);
    this.embedDecisionAsync(full);
    return full;
  }

  getDecisions(limit: number = 50, type?: Decision['type']): Decision[] {
    let filtered = this.decisions;
    if (type) filtered = filtered.filter(d => d.type === type);
    return filtered.slice(-limit).reverse();
  }

  getRecentDecisions(n: number = 10): Decision[] {
    return this.decisions.slice(-n).reverse();
  }

  searchDecisions(query: string): Decision[] {
    const terms = query.toLowerCase().split(/\s+/);
    return this.decisions.filter(d => {
      const text = `${d.title} ${d.description} ${d.tags.join(' ')}`.toLowerCase();
      return terms.some(t => text.includes(t));
    }).slice(-20).reverse();
  }

  // ============================================================
  // CONTEXT FACTS
  // ============================================================
  addFact(fact: Omit<ContextFact, 'id' | 'createdAt' | 'updatedAt'>): ContextFact {
    // Check for duplicate/similar facts — update if found
    for (const [, existing] of this.facts) {
      if (existing.category === fact.category &&
          existing.fact.toLowerCase() === fact.fact.toLowerCase()) {
        existing.confidence = Math.max(existing.confidence, fact.confidence);
        existing.updatedAt = Date.now();
        this.persistFactAsync(existing);
        return existing;
      }
    }

    const full: ContextFact = {
      ...fact,
      id: generateId('fact'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.facts.set(full.id, full);

    // Cap at 200 facts
    if (this.facts.size > 200) {
      const oldest = Array.from(this.facts.values())
        .sort((a, b) => a.updatedAt - b.updatedAt);
      for (let i = 0; i < 50; i++) {
        this.facts.delete(oldest[i].id);
      }
    }

    logger.info(`Fact added: [${full.category}] ${full.fact}`);
    this.persistFactAsync(full);
    return full;
  }

  getFacts(category?: ContextFact['category']): ContextFact[] {
    const all = Array.from(this.facts.values());
    if (category) return all.filter(f => f.category === category);
    return all;
  }

  removeFact(id: string): void {
    this.facts.delete(id);
    this.deleteFactFromDB(id);
  }

  // ============================================================
  // TECH STACK
  // ============================================================
  setTechStack(stack: TechStack): void {
    this.techStack = stack;
    logger.info(`Tech stack set: ${stack.frameworks.join(', ')} / ${stack.languages.join(', ')}`);

    // Auto-create context facts from tech stack
    for (const fw of stack.frameworks) {
      this.addFact({ category: 'tech_stack', fact: `Uses framework: ${fw}`, confidence: 1.0, source: 'package.json scan' });
    }
    for (const lang of stack.languages) {
      this.addFact({ category: 'tech_stack', fact: `Language: ${lang}`, confidence: 1.0, source: 'file extension scan' });
    }
    if (stack.deployTarget) {
      this.addFact({ category: 'environment', fact: `Deploy target: ${stack.deployTarget}`, confidence: 0.9, source: 'config scan' });
    }
    for (const db of stack.databases) {
      this.addFact({ category: 'tech_stack', fact: `Database: ${db}`, confidence: 0.9, source: 'dependency scan' });
    }
  }

  getTechStack(): TechStack | null {
    return this.techStack;
  }

  // ============================================================
  // SEMANTIC SEARCH — Hybrid: embedding + keyword across memory
  // ============================================================
  async semanticSearch(query: string, topK: number = 10): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];

    // 1. Vector search via ChromaDB
    const vectorResults = await this.vectorSearchMemory(query, topK);
    results.push(...vectorResults);

    // 2. Keyword search (BM25) on decisions via PostgreSQL
    const keywordDecisions = await this.keywordSearchDecisions(query, topK);
    for (const d of keywordDecisions) {
      // Avoid duplicates by checking ID
      if (!results.find(r => r.id === d.id)) {
        results.push(d);
      }
    }

    // 3. In-memory keyword search on facts
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    for (const fact of this.facts.values()) {
      const text = `${fact.category} ${fact.fact}`.toLowerCase();
      if (terms.some(t => text.includes(t))) {
        if (!results.find(r => r.id === fact.id)) {
          results.push({
            type: 'fact',
            id: fact.id,
            content: `[${fact.category}] ${fact.fact}`,
            score: 0.5,
            metadata: { category: fact.category, confidence: fact.confidence, source: fact.source },
          });
        }
      }
    }

    // 4. File path matching
    const fileMatches = this.getAllFiles().filter(f => {
      const filePath = f.path.toLowerCase();
      return terms.some(t => filePath.includes(t)) ||
        (f.summary && terms.some(t => f.summary!.toLowerCase().includes(t)));
    }).slice(0, 5);

    for (const f of fileMatches) {
      results.push({
        type: 'file',
        id: f.path,
        content: `${f.path} — ${f.summary || f.language}`,
        score: 0.4,
        metadata: { language: f.language, sizeBytes: f.sizeBytes, exports: f.exports },
      });
    }

    // Sort by score descending and return top K
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private async vectorSearchMemory(query: string, topK: number): Promise<MemorySearchResult[]> {
    try {
      const collection = await getMemoryChromaCollection();
      if (!collection) return [];

      const queryEmbedding = await embedText(query);
      if (!queryEmbedding) return [];

      const chromaResults = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
      });

      if (!chromaResults.ids?.[0]) return [];

      return chromaResults.ids[0].map((id: string, i: number) => ({
        type: (chromaResults.metadatas?.[0]?.[i]?.sourceType || 'decision') as MemorySearchResult['type'],
        id: chromaResults.metadatas?.[0]?.[i]?.sourceId || id,
        content: chromaResults.documents?.[0]?.[i] || '',
        score: chromaResults.distances?.[0]?.[i] ? 1 - chromaResults.distances[0][i] : 0,
        metadata: chromaResults.metadatas?.[0]?.[i] || {},
      }));
    } catch (err: any) {
      logger.warn(`Memory vector search failed: ${err.message}`);
      return [];
    }
  }

  private async keywordSearchDecisions(query: string, topK: number): Promise<MemorySearchResult[]> {
    try {
      const result = await dbQuery(
        `SELECT id, type, title, description, reasoning, tags,
                ts_rank_cd(tsvector_content, plainto_tsquery('english', $1)) as rank
         FROM decisions
         WHERE workspace_id = $2 AND tsvector_content @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC LIMIT $3`,
        [query, this.workspaceId, topK]
      );
      return result.rows.map((row: any) => ({
        type: 'decision' as const,
        id: row.id,
        content: `[${row.type}] ${row.title}: ${row.description}`,
        score: parseFloat(row.rank) || 0,
        metadata: { type: row.type, reasoning: row.reasoning, tags: JSON.parse(row.tags || '[]') },
      }));
    } catch {
      return [];
    }
  }

  // ============================================================
  // AUTO-DECISION EXTRACTION — Infer decisions from tool results
  // ============================================================
  extractDecisionFromToolResult(
    toolName: string,
    toolArgs: Record<string, any>,
    success: boolean,
    agentType?: string
  ): Decision | null {
    // Only log meaningful tool executions
    const decisionMap: Record<string, () => Omit<Decision, 'id' | 'timestamp'> | null> = {
      'write_file': () => ({
        type: 'implementation',
        title: `Created/Updated file: ${toolArgs.path || toolArgs.filePath || 'unknown'}`,
        description: `Wrote ${toolArgs.content?.length || 0} characters to ${toolArgs.path || toolArgs.filePath}`,
        files: [toolArgs.path || toolArgs.filePath].filter(Boolean),
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['file-write'],
      }),
      'edit_file': () => ({
        type: 'implementation',
        title: `Edited file: ${toolArgs.path || toolArgs.filePath || 'unknown'}`,
        description: `Applied edit to ${toolArgs.path || toolArgs.filePath}${toolArgs.search ? ': replaced content' : ''}`,
        files: [toolArgs.path || toolArgs.filePath].filter(Boolean),
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['file-edit'],
      }),
      'npm_install': () => ({
        type: 'dependency',
        title: `Installed package: ${toolArgs.package || toolArgs.packages || 'dependencies'}`,
        description: `npm install ${toolArgs.package || toolArgs.packages || ''}`,
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['npm', 'dependency'],
      }),
      'git_commit': () => ({
        type: 'implementation',
        title: `Git commit: ${toolArgs.message?.substring(0, 80) || 'commit'}`,
        description: `Committed changes: ${toolArgs.message || ''}`,
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['git', 'commit'],
      }),
      'deploy_cloudflare': () => ({
        type: 'deploy',
        title: `Deployed to Cloudflare`,
        description: `Deployed project to Cloudflare Pages/Workers`,
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['deploy', 'cloudflare'],
      }),
      'deploy_vercel': () => ({
        type: 'deploy',
        title: `Deployed to Vercel`,
        description: `Deployed project to Vercel`,
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['deploy', 'vercel'],
      }),
      'code_refactor': () => ({
        type: 'refactor',
        title: `Refactored: ${toolArgs.description?.substring(0, 80) || 'code refactor'}`,
        description: toolArgs.description || 'Code refactoring',
        files: toolArgs.files || [],
        agentType,
        outcome: success ? 'success' : 'failure',
        tags: ['refactor'],
      }),
      'shell_exec': () => {
        const cmd = toolArgs.command || '';
        // Only log meaningful commands
        if (cmd.match(/^(npm run build|npm test|npx|docker|make)/)) {
          return {
            type: 'config' as const,
            title: `Executed: ${cmd.substring(0, 80)}`,
            description: `Shell command: ${cmd}`,
            agentType,
            outcome: success ? 'success' : 'failure',
            tags: ['shell'],
          };
        }
        return null;
      },
    };

    const extractor = decisionMap[toolName];
    if (!extractor) return null;

    const partialDecision = extractor();
    if (!partialDecision) return null;

    return this.addDecision(partialDecision);
  }

  // ============================================================
  // CONTEXT BUILDER — Generates context string for LLM injection
  // ============================================================
  buildContext(query?: string): string {
    const sections: string[] = [];

    // Tech stack summary
    if (this.techStack) {
      const ts = this.techStack;
      sections.push(
        `PROJECT TECH STACK:
- Frameworks: ${ts.frameworks.join(', ') || 'none detected'}
- Languages: ${ts.languages.join(', ') || 'unknown'}
- Databases: ${ts.databases.join(', ') || 'none'}
- Build: ${ts.buildTools.join(', ') || 'none'}
- Tests: ${ts.testFrameworks.join(', ') || 'none'}
- Deploy: ${ts.deployTarget || 'not configured'}
- Package manager: ${ts.packageManager}`
      );
    }

    // Key context facts
    const facts = this.getFacts();
    if (facts.length > 0) {
      const factLines = facts
        .filter(f => f.confidence >= 0.5)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 20)
        .map(f => `- [${f.category}] ${f.fact}`);
      if (factLines.length > 0) {
        sections.push(`PROJECT CONTEXT:\n${factLines.join('\n')}`);
      }
    }

    // File index summary
    if (this.files.size > 0) {
      const filesByLang = new Map<string, number>();
      for (const f of this.files.values()) {
        filesByLang.set(f.language, (filesByLang.get(f.language) || 0) + 1);
      }
      const langSummary = Array.from(filesByLang.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang}(${count})`)
        .join(', ');

      sections.push(`PROJECT FILES (${this.files.size} indexed): ${langSummary}`);

      // Include key files (entry points, configs)
      const keyFiles = this.getAllFiles()
        .filter(f => /index\.|main\.|app\.|server\.|config\.|package\.json|tsconfig/.test(f.path))
        .slice(0, 10);
      if (keyFiles.length > 0) {
        const keyList = keyFiles.map(f =>
          `  ${f.path}${f.summary ? ` — ${f.summary}` : ''}`
        ).join('\n');
        sections.push(`KEY FILES:\n${keyList}`);
      }
    }

    // Recent decisions (last 5)
    const recentDec = this.getRecentDecisions(5);
    if (recentDec.length > 0) {
      const decLines = recentDec.map(d =>
        `- [${d.type}] ${d.title}${d.outcome ? ` (${d.outcome})` : ''}`
      );
      sections.push(`RECENT DECISIONS:\n${decLines.join('\n')}`);
    }

    return sections.length > 0
      ? `=== PROJECT MEMORY ===\n${sections.join('\n\n')}\n=== END PROJECT MEMORY ===`
      : '';
  }

  // ============================================================
  // SNAPSHOT — Full state for API / persistence
  // ============================================================
  getSnapshot(): MemorySnapshot {
    return {
      workspaceId: this.workspaceId,
      fileIndex: new Map(this.files),
      decisions: [...this.decisions],
      facts: Array.from(this.facts.values()),
      techStack: this.techStack,
      lastIndexedAt: this.lastIndexedAt,
      stats: {
        totalFiles: this.files.size,
        indexedFiles: Array.from(this.files.values()).filter(f => f.chunkIds && f.chunkIds.length > 0).length,
        totalDecisions: this.decisions.length,
        totalFacts: this.facts.size,
      },
    };
  }

  // ============================================================
  // PERSISTENCE — PostgreSQL (fire-and-forget)
  // ============================================================

  // --- Decisions ---
  private async persistDecisionAsync(decision: Decision): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO decisions (id, workspace_id, type, title, description, reasoning, files, agent_type, outcome, tags, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0))
         ON CONFLICT (id) DO NOTHING`,
        [
          decision.id, this.workspaceId, decision.type, decision.title,
          decision.description, decision.reasoning || null,
          JSON.stringify(decision.files || []), decision.agentType || null,
          decision.outcome || null, JSON.stringify(decision.tags),
          decision.timestamp,
        ]
      );
    } catch { /* DB not available */ }
  }

  private async embedDecisionAsync(decision: Decision): Promise<void> {
    try {
      const collection = await getMemoryChromaCollection();
      if (!collection) return;

      const text = `[${decision.type}] ${decision.title}: ${decision.description}${decision.reasoning ? '\nReasoning: ' + decision.reasoning : ''}`;
      const embedding = await embedText(text);
      if (!embedding) return;

      const chromaId = `dec_${decision.id}`;
      await collection.add({
        ids: [chromaId],
        embeddings: [embedding],
        documents: [text],
        metadatas: [{
          sourceType: 'decision',
          sourceId: decision.id,
          decisionType: decision.type,
          workspaceId: this.workspaceId,
        }],
      });

      // Store reference in PG
      await dbQuery(
        `INSERT INTO memory_embeddings (id, workspace_id, source_type, source_id, content_preview, chroma_id)
         VALUES ($1, $2, 'decision', $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [generateId('emb'), this.workspaceId, decision.id, text.substring(0, 200), chromaId]
      );
    } catch { /* embedding not critical */ }
  }

  async loadDecisionsFromDB(): Promise<void> {
    try {
      const result = await dbQuery(
        `SELECT id, type, title, description, reasoning, files, agent_type, outcome, tags,
                extract(epoch from created_at) * 1000 as timestamp
         FROM decisions WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 500`,
        [this.workspaceId]
      );
      for (const row of result.rows) {
        // Avoid duplicates
        if (this.decisions.find(d => d.id === row.id)) continue;
        this.decisions.push({
          id: row.id,
          timestamp: parseInt(row.timestamp),
          type: row.type,
          title: row.title,
          description: row.description,
          reasoning: row.reasoning,
          files: JSON.parse(row.files || '[]'),
          agentType: row.agent_type,
          outcome: row.outcome,
          tags: JSON.parse(row.tags || '[]'),
        });
      }
      if (result.rows.length > 0) logger.info(`Loaded ${result.rows.length} decisions from DB`);
    } catch { /* DB not available */ }
  }

  // --- Facts ---
  private async persistFactAsync(fact: ContextFact): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO context_facts (id, workspace_id, category, fact, confidence, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET
           confidence = GREATEST(context_facts.confidence, EXCLUDED.confidence),
           updated_at = EXCLUDED.updated_at`,
        [
          fact.id, this.workspaceId, fact.category, fact.fact,
          fact.confidence, fact.source, fact.createdAt, fact.updatedAt,
        ]
      );
    } catch { /* DB not available */ }
  }

  private async deleteFactFromDB(id: string): Promise<void> {
    try {
      await dbQuery('DELETE FROM context_facts WHERE id = $1', [id]);
    } catch { /* DB not available */ }
  }

  async loadFactsFromDB(): Promise<void> {
    try {
      const result = await dbQuery(
        `SELECT id, category, fact, confidence, source,
                extract(epoch from created_at) * 1000 as created_at,
                extract(epoch from updated_at) * 1000 as updated_at
         FROM context_facts WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 200`,
        [this.workspaceId]
      );
      for (const row of result.rows) {
        if (this.facts.has(row.id)) continue;
        this.facts.set(row.id, {
          id: row.id,
          category: row.category,
          fact: row.fact,
          confidence: parseFloat(row.confidence),
          source: row.source || '',
          createdAt: parseInt(row.created_at),
          updatedAt: parseInt(row.updated_at),
        });
      }
      if (result.rows.length > 0) logger.info(`Loaded ${result.rows.length} facts from DB`);
    } catch { /* DB not available */ }
  }

  // --- File Index ---
  private async persistFileAsync(file: IndexedFile): Promise<void> {
    try {
      await dbQuery(
        `INSERT INTO file_index (path, workspace_id, language, size_bytes, last_modified, summary, exports, imports, chunk_ids, indexed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (workspace_id, path) DO UPDATE SET
           language = EXCLUDED.language, size_bytes = EXCLUDED.size_bytes,
           last_modified = EXCLUDED.last_modified, summary = EXCLUDED.summary,
           exports = EXCLUDED.exports, imports = EXCLUDED.imports,
           chunk_ids = EXCLUDED.chunk_ids, indexed_at = NOW()`,
        [
          file.path, this.workspaceId, file.language, file.sizeBytes,
          file.lastModified, file.summary || null,
          JSON.stringify(file.exports || []), JSON.stringify(file.imports || []),
          JSON.stringify(file.chunkIds || []),
        ]
      );
    } catch { /* DB not available */ }
  }

  private async persistFileIndexBatch(files: IndexedFile[]): Promise<void> {
    // Batch persist in chunks of 50
    for (let i = 0; i < files.length; i += 50) {
      const batch = files.slice(i, i + 50);
      await Promise.allSettled(batch.map(f => this.persistFileAsync(f)));
    }
  }

  private async deleteFileFromDB(filePath: string): Promise<void> {
    try {
      await dbQuery('DELETE FROM file_index WHERE workspace_id = $1 AND path = $2', [this.workspaceId, filePath]);
    } catch { /* DB not available */ }
  }

  async loadFileIndexFromDB(): Promise<void> {
    try {
      const result = await dbQuery(
        `SELECT path, language, size_bytes, last_modified, summary, exports, imports, chunk_ids,
                extract(epoch from indexed_at) * 1000 as indexed_at
         FROM file_index WHERE workspace_id = $1`,
        [this.workspaceId]
      );
      for (const row of result.rows) {
        if (this.files.has(row.path)) continue;
        this.files.set(row.path, {
          path: row.path,
          language: row.language,
          sizeBytes: row.size_bytes,
          lastModified: parseInt(row.last_modified),
          summary: row.summary,
          exports: JSON.parse(row.exports || '[]'),
          imports: JSON.parse(row.imports || '[]'),
          chunkIds: JSON.parse(row.chunk_ids || '[]'),
          indexedAt: parseInt(row.indexed_at),
        });
      }
      if (result.rows.length > 0) {
        this.lastIndexedAt = Date.now();
        logger.info(`Loaded ${result.rows.length} file index entries from DB`);
      }
    } catch { /* DB not available */ }
  }
}

// ============================================================
// CODE ANALYSIS HELPERS
// ============================================================
function extractExports(content: string): string[] {
  const exports: string[] = [];
  // export function/class/const/let/var/interface/type/enum
  const regex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports.slice(0, 30); // cap
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const regex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports.slice(0, 30); // cap
}

function extractSummary(content: string, filename: string): string | undefined {
  // Try to extract from first JSDoc comment or first line comment
  const jsdocMatch = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jsdocMatch) return jsdocMatch[1].replace(/\*\//, '').trim().substring(0, 100);

  const lineCommentMatch = content.match(/^\/\/\s*(.+)/m);
  if (lineCommentMatch) return lineCommentMatch[1].trim().substring(0, 100);

  // Generate from filename
  const name = filename.replace(/\.[^.]+$/, '');
  return `${name} module`;
}

// ============================================================
// GLOBAL MEMORY REGISTRY — One ProjectMemory per workspace
// ============================================================
const memoryRegistry = new Map<string, ProjectMemory>();

export function getProjectMemory(workspaceId: string): ProjectMemory {
  let memory = memoryRegistry.get(workspaceId);
  if (!memory) {
    memory = new ProjectMemory(workspaceId);
    memoryRegistry.set(workspaceId, memory);
  }
  return memory;
}

export async function getProjectMemoryLoaded(workspaceId: string): Promise<ProjectMemory> {
  const memory = getProjectMemory(workspaceId);
  await memory.ensureLoaded();
  return memory;
}

export function listProjectMemories(): { workspaceId: string; stats: MemorySnapshot['stats'] }[] {
  return Array.from(memoryRegistry.entries()).map(([id, mem]) => ({
    workspaceId: id,
    stats: mem.getSnapshot().stats,
  }));
}
