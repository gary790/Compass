#!/usr/bin/env python3
"""
Agentic RAG Platform v1.9.0 — Complete System Architecture Document
Generates a comprehensive multi-page PDF covering every subsystem.
"""

from fpdf import FPDF
import textwrap
import datetime

# ============================================================
# CUSTOM PDF CLASS
# ============================================================
class SystemPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)
        self.add_font("DejaVu", "", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        self.add_font("DejaVu", "B", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        self.add_font("DejaVuMono", "", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
        self.chapter_num = 0
        self.sub_num = 0

    def header(self):
        if self.page_no() > 1:
            self.set_font("DejaVu", "", 8)
            self.set_text_color(140, 140, 140)
            self.cell(0, 8, "Agentic RAG Platform v1.9.0 — System Architecture", align="L")
            self.cell(0, 8, f"Page {self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
            self.set_draw_color(200, 200, 200)
            self.line(10, 16, 200, 16)
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("DejaVu", "", 7)
        self.set_text_color(160, 160, 160)
        self.cell(0, 10, f"Generated {datetime.datetime.now().strftime('%Y-%m-%d')} | Confidential — Internal Use", align="C")

    # --- helpers ---
    def cover_page(self):
        self.add_page()
        self.ln(50)
        self.set_font("DejaVu", "B", 32)
        self.set_text_color(88, 28, 135)  # purple
        self.cell(0, 15, "Agentic RAG Platform", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(2)
        self.set_font("DejaVu", "B", 18)
        self.set_text_color(100, 100, 100)
        self.cell(0, 12, "Complete System Architecture", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(6)
        self.set_font("DejaVu", "", 14)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, "Version 1.9.0 — Maximum Performance Release", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(30)
        # Feature badges
        self.set_font("DejaVu", "", 11)
        self.set_text_color(60, 60, 60)
        badges = [
            "MoE LLM Router  |  6 Providers  |  15+ Models",
            "Hybrid RAG  |  BM25 + Vector + Cross-Encoder Reranking",
            "60 Tools  |  10 Categories  |  Graph-Based Orchestration",
            "PostgreSQL + Redis + ChromaDB  |  Real-Time WebSocket",
            "Docker Sandbox Isolation  |  Auto-Repair Engine",
            "Parallel Agent Execution  |  Project Memory Hub",
        ]
        for b in badges:
            self.cell(0, 8, b, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(25)
        self.set_font("DejaVu", "", 10)
        self.set_text_color(150, 150, 150)
        self.cell(0, 8, f"Document generated: {datetime.datetime.now().strftime('%B %d, %Y')}", align="C", new_x="LMARGIN", new_y="NEXT")

    def chapter_title(self, title):
        self.chapter_num += 1
        self.sub_num = 0
        self.add_page()
        self.set_font("DejaVu", "B", 20)
        self.set_text_color(88, 28, 135)
        self.cell(0, 14, f"{self.chapter_num}. {title}", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(88, 28, 135)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(6)
        self.set_text_color(30, 30, 30)

    def section_title(self, title):
        self.sub_num += 1
        if self.get_y() > 250:
            self.add_page()
        self.ln(4)
        self.set_font("DejaVu", "B", 13)
        self.set_text_color(55, 48, 163)
        self.cell(0, 10, f"{self.chapter_num}.{self.sub_num}  {title}", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(30, 30, 30)
        self.ln(1)

    def sub_section(self, title):
        if self.get_y() > 255:
            self.add_page()
        self.ln(2)
        self.set_font("DejaVu", "B", 11)
        self.set_text_color(80, 80, 80)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(30, 30, 30)
        self.ln(1)

    def body_text(self, text):
        self.set_font("DejaVu", "", 10)
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def bullet(self, text, indent=10):
        self.set_font("DejaVu", "", 10)
        x = self.get_x()
        self.cell(indent)
        self.set_font("DejaVu", "", 10)
        self.multi_cell(0, 5.5, f"\u2022  {text}")

    def bold_bullet(self, bold_part, rest):
        if self.get_y() > 270:
            self.add_page()
        self.set_font("DejaVu", "", 10)
        indent = 10
        combined = f"\u2022  {bold_part}{rest}"
        # Save x, add indent, use width minus indent minus margin
        x = self.get_x()
        self.set_x(x + indent)
        self.multi_cell(self.w - self.r_margin - x - indent, 5.5, combined)
        self.set_x(x)

    def code_block(self, text, max_lines=30):
        if self.get_y() > 240:
            self.add_page()
        self.set_font("DejaVuMono", "", 8)
        self.set_fill_color(245, 245, 245)
        lines = text.strip().split("\n")[:max_lines]
        for line in lines:
            tr = line[:110]
            self.cell(0, 4.5, f"  {tr}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.set_font("DejaVu", "", 10)
        self.ln(2)

    def table_header(self, cols, widths):
        self.set_font("DejaVu", "B", 9)
        self.set_fill_color(88, 28, 135)
        self.set_text_color(255, 255, 255)
        for i, col in enumerate(cols):
            self.cell(widths[i], 7, col, border=1, fill=True, align="C")
        self.ln()
        self.set_text_color(30, 30, 30)

    def table_row(self, cols, widths, fill=False):
        if self.get_y() > 268:
            self.add_page()
        self.set_font("DejaVu", "", 8)
        if fill:
            self.set_fill_color(248, 248, 252)
        for i, col in enumerate(cols):
            self.cell(widths[i], 6, str(col)[:50], border=1, fill=fill, align="L" if i == 0 else "C")
        self.ln()


# ============================================================
# BUILD THE PDF
# ============================================================
pdf = SystemPDF()

# --- COVER ---
pdf.cover_page()

# === TABLE OF CONTENTS ===
pdf.add_page()
pdf.set_font("DejaVu", "B", 18)
pdf.set_text_color(88, 28, 135)
pdf.cell(0, 14, "Table of Contents", new_x="LMARGIN", new_y="NEXT")
pdf.ln(4)
toc = [
    "1. Executive Summary",
    "2. System Architecture Overview",
    "3. LLM Router — Mixture of Experts Engine",
    "4. Agent Orchestration — Graph-Based Execution",
    "5. RAG Pipeline — Hybrid Retrieval System",
    "6. Project Memory Hub — Persistent Context",
    "7. Tool Registry — 60 Tools, 10 Categories",
    "8. Infrastructure — PostgreSQL, Redis, ChromaDB",
    "9. Real-Time Communication — WebSocket & SSE",
    "10. Sandbox Isolation — Docker Container Management",
    "11. Auto-Repair Engine — Autonomous Error Recovery",
    "12. Frontend Dashboard — GenUI Streaming Interface",
    "13. API Reference — Complete Endpoint Map",
    "14. Security, Auth & Rate Limiting",
    "15. Configuration & Environment",
    "16. Data Models & Database Schema",
    "17. Deployment Architecture",
]
pdf.set_font("DejaVu", "", 11)
pdf.set_text_color(40, 40, 40)
for item in toc:
    pdf.cell(0, 7.5, item, new_x="LMARGIN", new_y="NEXT")

# ========================================================================
# CHAPTER 1: EXECUTIVE SUMMARY
# ========================================================================
pdf.chapter_title("Executive Summary")
pdf.body_text(
    "The Agentic RAG Platform is a self-hosted, full-stack AI development environment that combines "
    "Mixture-of-Experts (MoE) LLM routing, Hybrid Retrieval-Augmented Generation, graph-based agent "
    "orchestration, and 60 integrated tools into a single cohesive system. It is designed to serve as "
    "an intelligent coding assistant that can plan, write, test, review, and deploy software "
    "autonomously, while keeping a human in the loop for high-risk operations."
)
pdf.body_text(
    "The platform is built on the Hono web framework for its backend, uses a real-time GenUI streaming "
    "dashboard for its frontend, and integrates with PostgreSQL (relational persistence), Redis "
    "(caching and rate limiting), and ChromaDB (vector embeddings) for its data layer. It supports "
    "6 LLM providers (OpenAI, Anthropic, Google Gemini, Mistral, Groq, Ollama) with 15+ models, "
    "automatic failover, response caching, and per-token cost tracking."
)

pdf.section_title("Key Capabilities at a Glance")
caps = [
    ("MoE LLM Router", "Automatic provider selection, failover, streaming, cost tracking, Redis caching"),
    ("Graph Orchestration", "7 specialized agents (Router, RAG, Code, Deploy, Design, Test, Reviewer)"),
    ("Parallel Execution", "LLM-planned task decomposition into 2-4 concurrent agent lanes with dependency resolution"),
    ("Hybrid RAG", "BM25 full-text + ChromaDB vector search, Reciprocal Rank Fusion, cross-encoder reranking"),
    ("LLM Query Expansion", "Automatic generation of 3+ alternative phrasings for richer retrieval"),
    ("Project Memory Hub", "Persistent file index, decision log, context facts, tech stack auto-detection"),
    ("60 Tools / 10 Categories", "File, Shell, System, Git, GitHub, Deploy, Web, Code, Database, RAG"),
    ("Auto-Repair Engine", "Detects build/test/lint/type errors, injects repair prompts, retries automatically"),
    ("Docker Sandbox", "Per-workspace container isolation with resource limits, port allocation, exec history"),
    ("Real-Time Streaming", "Server-Sent Events for LLM token streaming, WebSocket for bidirectional control"),
    ("Human-in-the-Loop", "WebSocket-based approval gates for high-risk tool executions"),
    ("Full Observability", "Cost tracking, latency percentiles (P50/P95/P99), tool stats, provider health"),
]
for bold, rest in caps:
    pdf.bold_bullet(f"{bold}: ", rest)

# ========================================================================
# CHAPTER 2: SYSTEM ARCHITECTURE
# ========================================================================
pdf.chapter_title("System Architecture Overview")

pdf.section_title("High-Level Architecture Diagram (Text)")
pdf.code_block("""
+---------------------------------------------------------------------+
|                         BROWSER CLIENT                              |
|   GenUI Dashboard  |  Chat  |  Workspace  |  Metrics  |  Terminal   |
+---------+---------+--------+-----+-------+-----------+-------------+
          |  HTTPS / SSE           |  WebSocket (ws://host/ws)
          v                        v
+---------------------------------------------------------------------+
|                         HONO SERVER (port 3000)                     |
|  Middleware: CORS | Logger | Error Handler | Static Files           |
+---------+---------+--------+-----+-------+-----------+-------------+
|         |         |        |     |       |           |             |
| /api/   | /api/   | /api/  |/api/|  /api/| /api/     | /api/       |
| chat    | rag     | system |ws   |memory | workspace | sandbox     |
+---------+---------+--------+-----+-------+-----------+-------------+
          |                        |
+---------v------------------------v---------------------------------+
|                   ORCHESTRATION ENGINE                              |
|  Planner -> detectPrimaryAgent -> ReAct Loop -> Parallel Executor  |
|  RepairEngine scans tool results -> auto-fix -> re-verify          |
+----+-----------+-----------+-----------+-----------+---------------+
     |           |           |           |           |
+----v---+ +-----v----+ +---v-----+ +---v-----+ +---v-----+
| Router | |  Code    | |  RAG    | | Deploy  | | Review  |
| Agent  | |  Agent   | |  Agent  | | Agent   | | Agent   |
| (all   | | (file,   | | (rag,   | | (deploy,| | (read,  |
|  60    | |  shell,  | |  web,   | |  shell) | |  code)  |
|  tools)| |  code)   | |  memory)| |         | |         |
+----+---+ +----+-----+ +---+-----+ +---+-----+ +---+-----+
     |          |            |           |           |
+----v----------v------------v-----------v-----------v-----------+
|                      TOOL REGISTRY (60 tools)                  |
|  file(8) shell(4) system(10) git(7) github(6) deploy(4)       |
|  web(3)  code(5)  database(3)  rag(10)                         |
+-------+----------+-----------+----------+----------------------+
        |          |           |          |
+-------v---+ +---v-------+ +-v--------+ +v-----------+
| PostgreSQL | | Redis     | | ChromaDB | | LLM APIs   |
| 17 tables  | | Cache +   | | Vector   | | OpenAI     |
| FTS indexes| | Rate Limit| | Store    | | Anthropic  |
| Decisions  | | Sessions  | | Cosine   | | Google     |
| Memory     | | LLM Cache | | HNSW     | | Mistral    |
+------------+ +-----------+ +----------+ | Groq       |
                                           | Ollama     |
                                           +------------+
""")

pdf.section_title("Technology Stack")
tech = [
    ("Runtime", "Node.js (ES2022), TypeScript 5+"),
    ("Web Framework", "Hono v4 — lightweight, fast, middleware-based"),
    ("HTTP Server", "@hono/node-server — Node.js adapter for Hono"),
    ("WebSocket", "@hono/node-ws — bidirectional real-time communication"),
    ("Database", "PostgreSQL — 17 tables, full-text search with tsvector/GIN indexes"),
    ("Cache/Queue", "Redis via ioredis — LLM response cache, rate limiting, sessions"),
    ("Vector Store", "ChromaDB — HNSW-indexed cosine similarity embeddings"),
    ("LLM SDKs", "openai, @anthropic-ai/sdk, @google/generative-ai"),
    ("Process Mgmt", "PM2 — daemon process management with log rotation"),
    ("Build Tool", "TypeScript compiler (tsc) — compiles to dist/"),
    ("Frontend", "Vanilla HTML/CSS/JS + Tailwind CSS (CDN), Chart.js, marked.js, highlight.js"),
    ("Validation", "Zod — runtime schema validation for tool inputs"),
    ("Container", "Docker — optional per-workspace sandbox isolation"),
]
for bold, rest in tech:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("Directory Structure")
pdf.code_block("""
webapp/
  src/
    index.ts              # Main server — Hono app, middleware, routes, startup
    config/index.ts       # All configuration + MODEL_REGISTRY + MOE_ROUTING
    types/index.ts        # TypeScript interfaces for entire system
    utils/index.ts        # Logger, ID gen, CostTracker, PerformanceTracker, crypto
    llm/router.ts         # MoE LLM router — 6 providers, streaming, caching
    rag/pipeline.ts       # Hybrid RAG — chunking, BM25, vector, RRF, reranking
    memory/hub.ts         # Project Memory — file index, decisions, facts, context
    agent/
      orchestrator.ts     # Main Orchestrator class — plan + ReAct loop
      parallel.ts         # Parallel Executor — multi-lane agent concurrency
      repair.ts           # Auto-Repair Engine — error detection + fix injection
    genui/engine.ts       # SSE writer for token-by-token streaming
    database/
      client.ts           # PostgreSQL pool wrapper
      redis.ts            # Redis client + cache/rate-limit helpers
      conversations.ts    # Conversation persistence (PG + in-memory fallback)
      migrate.ts / seed.ts / reset.ts   # DB lifecycle utilities
    sandbox/
      manager.ts          # Docker container lifecycle (create/start/stop/destroy)
      executor.ts         # Command execution inside containers
      resource-monitor.ts # Periodic CPU/memory/disk metrics collection
      index.ts            # Exports sandboxManager + resourceMonitor singletons
    routes/
      chat.ts             # POST /api/chat (SSE), conversation CRUD
      rag.ts              # POST /api/rag/ingest, /api/rag/search, document mgmt
      system.ts           # /api/system/status, /models, /tools, /costs, /terminal
      workspace.ts        # File tree, read/write/delete, workspace management
      memory.ts           # Memory snapshot, search, facts, decisions, scan
      sandbox.ts          # Sandbox CRUD + action endpoints
      auth.ts             # JWT login (disabled by default)
      websocket.ts        # WebSocket setup, client manager, approval system
    tools/
      registry.ts         # Central ToolRegistry class — register, validate, execute
      index.ts            # initializeTools() — loads all 60 tools
      file/index.ts       # read_file, write_file, edit_file, list_dir, search, etc.
      shell/index.ts      # shell_exec, npm_install, npm_run, process_list
      system/index.ts     # system_info, env, disk_usage, etc. (10 tools)
      git/index.ts        # git_init, status, commit, push, branch, diff, log
      github/index.ts     # create_repo, read_file, edit_file, create_pr, issues, repos
      deploy/index.ts     # deploy_cloudflare, deploy_vercel, deploy_status, preview
      web/index.ts        # web_search, web_scrape, web_fetch
      code/index.ts       # code_generate, code_analyze, code_test, code_refactor, explain
      db/index.ts         # db_query, db_execute, db_schema
      rag/index.ts        # rag_ingest, rag_query, rag_list, rag_delete, memory tools
  migrations/
    001_initial_schema.sql   # Core tables: users, conversations, messages, documents, etc.
    002_project_memory.sql    # Memory tables: decisions, context_facts, file_index
    003_sandbox_containers.sql # Sandbox tables: containers, events, exec_log
  public/
    index.html               # Full dashboard HTML (sidebar, chat, workspace panels)
    static/js/app.js         # ~2000-line frontend JavaScript
    static/css/ ...           # Custom styles
  tests/
    e2e.sh                   # 31-test end-to-end suite (curl-based)
  ecosystem.config.cjs       # PM2 configuration
  package.json / tsconfig.json / .env
""")

# ========================================================================
# CHAPTER 3: LLM ROUTER
# ========================================================================
pdf.chapter_title("LLM Router — Mixture of Experts Engine")

pdf.body_text(
    "The LLM Router is the central intelligence dispatch layer. It supports 6 providers with "
    "15+ models, handles both synchronous completion and token-by-token streaming, caches "
    "responses in Redis, tracks per-model costs, and provides automatic failover via health "
    "monitoring."
)

pdf.section_title("Provider Adapters")
pdf.body_text(
    "Each LLM provider has a dedicated adapter function that translates the platform's unified "
    "LLMCompletionRequest into the provider-specific SDK call. The adapters handle message format "
    "differences (e.g., Anthropic requires separate system messages and tool_use/tool_result blocks), "
    "extract usage metrics, and compute cost."
)
providers = [
    ["OpenAI", "gpt-4o, gpt-4o-mini, gpt-4-turbo, o1", "Native SDK", "Yes"],
    ["Anthropic", "claude-3-5-sonnet, claude-3-haiku, claude-3-opus", "Native SDK", "Yes"],
    ["Google", "gemini-1.5-pro, gemini-1.5-flash, gemini-pro", "Native SDK", "No*"],
    ["Mistral", "mistral-large, mistral-medium, open-mixtral", "OpenAI-compat", "Yes"],
    ["Groq", "llama-3.1-70b, llama-3.1-8b, mixtral-8x7b", "OpenAI-compat", "Yes"],
    ["Ollama", "Any local model (llama3, codestral, etc.)", "REST API", "Simulated"],
]
widths = [28, 62, 30, 22]
pdf.table_header(["Provider", "Models", "Adapter", "Streaming"], widths)
for i, row in enumerate(providers):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Request Flow")
pdf.body_text("1. Validate API key for the requested provider.\n"
              "2. Check Redis cache (MD5 hash of the full request) — return cached response if hit.\n"
              "3. Log the request (provider, model, message count, tool count).\n"
              "4. Dispatch to the appropriate provider adapter via PROVIDER_MAP lookup.\n"
              "5. Execute with retry logic (max 2 retries, exponential backoff: 1s, 2s).\n"
              "6. Record success in providerHealth (latency, success count).\n"
              "7. Cache the response in Redis with 1-hour TTL (non-tool responses only).\n"
              "8. Log completion metrics (tokens, cost, latency, tool calls).\n"
              "9. Return the unified LLMCompletionResponse to the caller.")

pdf.section_title("Streaming Architecture")
pdf.body_text(
    "The streamLLM() generator yields LLMStreamChunk objects of types: text_delta (partial text tokens), "
    "tool_call_delta (incremental tool call assembly), usage (final token counts + cost), done, and error. "
    "OpenAI, Groq, and Mistral share a common streamOpenAICompatible() adapter. Anthropic has a "
    "dedicated streamAnthropic() adapter that maps content_block_delta events. Google and Ollama use "
    "simulated streaming (full completion, then word-by-word yield)."
)

pdf.section_title("Cost Tracking")
pdf.body_text(
    "Every LLM call (both sync and streaming) reports cost to the global CostTracker singleton. "
    "Cost is computed from the MODEL_REGISTRY which stores per-model costPer1kInput and costPer1kOutput "
    "rates. The CostTracker records per-model totals: cost, input tokens, output tokens, request count, "
    "and cumulative latency. The /api/system/costs endpoint exposes the full breakdown."
)

pdf.section_title("Provider Health Monitoring")
pdf.body_text(
    "Each provider maintains a ProviderHealth record tracking: available (bool), lastError, "
    "lastErrorAt, successCount, errorCount, and avgLatencyMs. A provider is marked unavailable "
    "after 3 consecutive errors within 60 seconds. The /api/system/health/providers endpoint "
    "returns the full health map."
)

pdf.section_title("Embedding Support")
pdf.body_text(
    "The createEmbedding() function supports OpenAI (text-embedding-3-small, 1536 dimensions) "
    "and Ollama. Embeddings are used by both the RAG pipeline (document chunk vectors) and the "
    "Project Memory Hub (decision/fact embeddings for semantic search)."
)

# ========================================================================
# CHAPTER 4: AGENT ORCHESTRATION
# ========================================================================
pdf.chapter_title("Agent Orchestration — Graph-Based Execution")

pdf.body_text(
    "The Orchestrator is the brain of the platform. It receives a user message, decides which "
    "agent(s) should handle it, executes a ReAct (Reason + Act) loop with tool calling, and "
    "streams results back in real time. It supports both single-agent and parallel multi-agent "
    "execution."
)

pdf.section_title("Seven Specialized Agents")
agents = [
    ["Router", "gpt-4o", "All 60", "25", "Central coordinator; handles general requests; gets all tools"],
    ["RAG", "gpt-4o-mini", "11", "5", "Knowledge base search; falls back to web search"],
    ["Code", "gpt-4o", "16", "15", "File ops, shell exec, code generation, analysis, testing"],
    ["Deploy", "gpt-4o-mini", "8", "10", "Build verification, Cloudflare/Vercel deployment"],
    ["Design", "gpt-4o", "4", "10", "UI/frontend generation with Tailwind CSS"],
    ["Test", "gpt-4o-mini", "6", "10", "Test generation, execution, coverage reporting"],
    ["Reviewer", "claude-3-5-sonnet", "3", "5", "Security audit, best practices, bug detection"],
]
widths = [22, 25, 14, 12, 117]
pdf.table_header(["Agent", "Default Model", "Tools", "Max Iter", "Purpose"], widths)
for i, row in enumerate(agents):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Intent-Based Routing")
pdf.body_text(
    "The detectPrimaryAgent() function matches the user message against regex patterns to "
    "determine which agent is best suited. For example, messages containing 'deploy', 'publish', "
    "or 'cloudflare' route to the Deploy Agent. Messages about 'code', 'write function', or "
    "'refactor' route to Code. The Router Agent is the default catch-all."
)

pdf.section_title("ReAct Loop (Single Agent)")
pdf.body_text(
    "1. Inject the agent's system prompt + project memory context + last 20 conversation messages.\n"
    "2. Call streamAndCollect() — streams text tokens live via SSE, collects tool_call deltas.\n"
    "3. If finish_reason is 'stop' — emit the text response and exit.\n"
    "4. If finish_reason is 'tool_calls' — execute each tool call (batched by concurrency limit).\n"
    "5. Append tool results to the message history.\n"
    "6. Auto-log decisions to Project Memory from tool results.\n"
    "7. Run the RepairEngine scanner on tool results — if errors detected, inject a repair prompt.\n"
    "8. Loop back to step 2 (max 25 iterations for Router, fewer for specialized agents).\n"
    "9. On completion, emit a 'done' event with aggregated usage (tokens, cost, duration, tools used)."
)

pdf.section_title("Parallel Execution (Multi-Agent)")
pdf.body_text(
    "For complex requests, the Planner LLM decomposes the task into sub-tasks and assigns each "
    "to a specialized agent. The ParallelExecutor resolves dependencies topologically and runs "
    "independent tasks concurrently. Maximum 4 parallel lanes."
)
pdf.body_text(
    "Flow: User message -> Planner LLM (classification model) -> ExecutionPlan JSON -> "
    "topological dependency resolution -> concurrent runLane() calls -> each lane runs its own "
    "ReAct loop with streaming -> results collected -> Merger LLM synthesizes all lane outputs "
    "into a single coherent response."
)
pdf.body_text(
    "Example: 'Build a REST API with tests' decomposes into: code agent (build the API) -> "
    "test agent (depends on code, generates and runs tests). The code agent runs first; when "
    "it completes, its output is injected as context into the test agent's system prompt."
)

pdf.section_title("Human-in-the-Loop Approval")
pdf.body_text(
    "High-risk tools (e.g., deploy, destructive file operations) have requiresApproval=true. "
    "Before execution, the Orchestrator emits an 'approval' event via WebSocket with the tool "
    "name, arguments, risk level, and two actions (approve/reject). The requestApproval() "
    "function returns a Promise that resolves when the user responds. Auto-approves after 60s "
    "timeout."
)

# ========================================================================
# CHAPTER 5: RAG PIPELINE
# ========================================================================
pdf.chapter_title("RAG Pipeline — Hybrid Retrieval System")

pdf.body_text(
    "The RAG pipeline implements a state-of-the-art hybrid retrieval system combining BM25 "
    "full-text search (PostgreSQL tsvector) with vector similarity search (ChromaDB) and "
    "Reciprocal Rank Fusion, enhanced with LLM-powered query expansion and cross-encoder "
    "reranking."
)

pdf.section_title("Document Ingestion Pipeline")
pdf.body_text(
    "1. Semantic Chunking: Split document by markdown headings first, then by token count "
    "(default 500 tokens per chunk, 50-token overlap) using sentence-boundary-aware splitting.\n"
    "2. Embedding Generation: Each chunk is embedded via the configured model (default: "
    "text-embedding-3-small, 1536 dimensions).\n"
    "3. PostgreSQL Storage: Document metadata stored in 'documents' table; each chunk stored in "
    "'chunks' table with tsvector_content for full-text search.\n"
    "4. ChromaDB Storage: Chunk embeddings stored in a cosine-similarity HNSW-indexed collection "
    "with metadata (documentId, title, heading, sourceType)."
)

pdf.section_title("Search Pipeline")
pdf.code_block("""
searchRAG(query)
  |
  +-> expandQueryLLM(query)          # LLM generates 3+ alternative phrasings
  |     |-> "original query"
  |     |-> "keyword-only version"
  |     |-> "LLM alternative 1"
  |     |-> "LLM alternative 2"
  |     +-> "LLM alternative 3"
  |
  +-> vectorSearch(query, 4x topK)   # ChromaDB cosine similarity
  |
  +-> bm25Search(expanded[0..N], 4x topK)  # PostgreSQL ts_rank_cd, per query variant
  |
  +-> reciprocalRankFusion(vector, bm25)    # Weighted merge: vector=0.6, bm25=0.4, k=60
  |
  +-> crossEncoderRerank(fused, query, topK) # LLM judges relevance, reorders top-20
  |
  +-> compressResult(each result, query)     # Trim irrelevant sentences by keyword overlap
  |
  +-> return top-K results
""")

pdf.section_title("LLM-Powered Query Expansion")
pdf.body_text(
    "The expandQueryLLM() function calls gpt-4o-mini with a specialized prompt to generate 3 "
    "alternative phrasings of the user query. This broadens retrieval coverage across vocabulary "
    "mismatches. Falls back to simple keyword extraction if LLM is unavailable."
)

pdf.section_title("Cross-Encoder Reranking")
pdf.body_text(
    "After fusion, the top 20 candidates are sent to gpt-4o-mini as a relevance judge. The LLM "
    "receives numbered passages and returns a JSON array of indices sorted by relevance. "
    "Candidates are reranked by the LLM's ordering, with scores assigned as 1 - (rank / total). "
    "Falls back to position-based ranking if the LLM call fails."
)

pdf.section_title("Contextual Compression")
pdf.body_text(
    "Each result chunk is compressed by scoring individual sentences for keyword overlap with "
    "the original query. Sentences with overlap are kept, plus one sentence of context above "
    "and below. Chunks under 200 tokens are returned as-is."
)

pdf.section_title("RAG Configuration")
cfg = [
    ("Chunk Size", "500 tokens"),
    ("Chunk Overlap", "50 tokens"),
    ("Top-K", "5 results"),
    ("RRF K", "60"),
    ("Vector Weight", "0.6"),
    ("BM25 Weight", "0.4"),
    ("Reranking", "Enabled (LLM cross-encoder)"),
    ("Embedding Model", "text-embedding-3-small (1536 dim)"),
]
for bold, rest in cfg:
    pdf.bold_bullet(f"{bold}: ", rest)

# ========================================================================
# CHAPTER 6: PROJECT MEMORY HUB
# ========================================================================
pdf.chapter_title("Project Memory Hub — Persistent Context")

pdf.body_text(
    "The Project Memory Hub provides long-term context that persists across conversations. "
    "It maintains a file index, decision log, context facts, and auto-detected tech stack for each workspace. "
    "All data is backed by PostgreSQL and optionally ChromaDB for semantic search."
)

pdf.section_title("Four Memory Components")

pdf.sub_section("1. File Index")
pdf.body_text(
    "A complete index of all source files in the workspace, updated via scanWorkspace(). "
    "Each file records: path, language, sizeBytes, lastModified, summary, exports, imports. "
    "Languages are auto-detected from 30+ file extensions. Files >500KB and dirs like "
    "node_modules, .git, dist are excluded."
)

pdf.sub_section("2. Decision Log")
pdf.body_text(
    "Every meaningful tool execution is automatically logged as a Decision. Decisions have: "
    "type (architecture/implementation/fix/dependency/config/refactor/deploy), title, description, "
    "reasoning, related files, agent type, outcome (success/failure/partial), and tags. "
    "Decisions are persisted to PostgreSQL and embedded in ChromaDB for semantic search. "
    "Cap: 500 decisions per workspace (FIFO)."
)

pdf.sub_section("3. Context Facts")
pdf.body_text(
    "Persistent knowledge statements about the project. Categories: tech_stack, architecture, "
    "convention, constraint, preference, environment. Each fact has a confidence score (0-1) "
    "and source attribution. Duplicate facts are merged (confidence = max). Cap: 200 facts "
    "per workspace."
)

pdf.sub_section("4. Tech Stack Auto-Detection")
pdf.body_text(
    "Parses package.json to detect: frameworks (Hono, Express, React, Vue, etc.), databases "
    "(PostgreSQL, Redis, MongoDB, etc.), build tools (Vite, Webpack, TypeScript), test frameworks "
    "(Jest, Vitest, Playwright), package manager, and deploy target (from config file presence). "
    "Detected components are auto-added as context facts."
)

pdf.section_title("Context Injection into LLM Prompts")
pdf.body_text(
    "Before each orchestrator run, buildContext() generates a structured context block containing "
    "the tech stack summary, high-confidence facts, file index statistics, key file summaries, "
    "and recent decisions. This is appended to the agent's system prompt, giving the LLM "
    "persistent awareness of the project's structure and history."
)

pdf.section_title("Semantic Search Across Memory")
pdf.body_text(
    "The semanticSearch() function performs hybrid search across all memory types:\n"
    "1. Vector search via ChromaDB embeddings (decisions and facts)\n"
    "2. BM25 keyword search on decisions via PostgreSQL tsvector\n"
    "3. In-memory keyword matching on facts\n"
    "4. File path and summary matching\n"
    "Results are deduplicated, scored, and returned sorted by relevance."
)

# ========================================================================
# CHAPTER 7: TOOL REGISTRY
# ========================================================================
pdf.chapter_title("Tool Registry — 60 Tools, 10 Categories")

pdf.body_text(
    "The Tool Registry is a centralized system for registering, validating, and executing tools. "
    "Each tool has a ToolDefinition (name, description, category, risk level, parameters schema, "
    "approval requirement), a Zod validation schema, and an executor function. Tools are exposed "
    "to LLMs as function-calling tool definitions."
)

pdf.section_title("Tool Categories")
categories = [
    ["file", "8", "read_file, write_file, edit_file, list_directory, search_files, create_dir, delete_file, file_info"],
    ["shell", "4", "shell_exec, npm_install, npm_run, process_list"],
    ["system", "10", "system_info, env_get, env_set, disk_usage, memory_usage, cpu_usage, network, uptime, whoami, os_info"],
    ["git", "7", "git_init, git_status, git_commit, git_push, git_branch, git_diff, git_log"],
    ["github", "6", "github_create_repo, github_read_file, github_edit_file, github_create_pr, github_list_issues, github_list_repos"],
    ["deploy", "4", "deploy_cloudflare, deploy_vercel, deploy_status, deploy_preview"],
    ["web", "3", "web_search, web_scrape, web_fetch"],
    ["code", "5", "code_generate, code_analyze, code_test, code_refactor, code_explain"],
    ["database", "3", "db_query (read-only), db_execute (write), db_schema"],
    ["rag", "10", "rag_ingest, rag_query, rag_list_docs, rag_delete_doc, memory_scan, memory_search, memory_get_context, memory_add_fact, memory_log_decision, memory_list_decisions"],
]
widths = [22, 14, 154]
pdf.table_header(["Category", "Count", "Tools"], widths)
for i, row in enumerate(categories):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Execution Pipeline")
pdf.body_text(
    "1. Tool Registry looks up the RegisteredTool by name.\n"
    "2. Zod schema validates the input arguments — returns validation error if invalid.\n"
    "3. The executor function runs with a ToolContext containing workspacePath, userId, messageId.\n"
    "4. Execution is timed. On success: returns {success: true, output, durationMs}.\n"
    "5. On failure: catches exception, returns {success: false, error, durationMs}.\n"
    "6. The Orchestrator receives the result and appends it to the LLM conversation."
)

pdf.section_title("Risk Levels & Approval")
pdf.body_text(
    "Tools are classified by risk: low (read operations), medium (file writes, git), high "
    "(deploy, destructive shell commands). High-risk tools with requiresApproval=true trigger "
    "the WebSocket approval gate before execution. The shell_exec tool additionally blocks "
    "dangerous command patterns (rm -rf /, format, shutdown, etc.)."
)

# ========================================================================
# CHAPTER 8: INFRASTRUCTURE
# ========================================================================
pdf.chapter_title("Infrastructure — PostgreSQL, Redis, ChromaDB")

pdf.section_title("PostgreSQL (17 Tables)")
pdf.body_text(
    "PostgreSQL serves as the primary relational data store. It uses the uuid-ossp extension "
    "for UUID generation, tsvector/GIN indexes for full-text search, and auto-updating "
    "updated_at triggers."
)
tables = [
    ["users", "User accounts (email, name, password hash, role, API key)"],
    ["conversations", "Chat sessions (title, workspace, model, token/cost totals)"],
    ["messages", "Chat messages (role, content, model, tokens, cost, tool data)"],
    ["documents", "RAG documents (title, source, content, chunk count, tsvector)"],
    ["chunks", "Document chunks (content, index, token count, embedding ref, tsvector)"],
    ["deployments", "Deployment records (platform, URL, status, build log)"],
    ["agent_sessions", "Agent execution sessions (type, status, tokens, cost, tools used)"],
    ["tool_executions", "Tool execution log (name, args, result, duration, exit code)"],
    ["api_key_usage", "API key usage tracking (key, endpoint, tokens, cost)"],
    ["decisions", "Project Memory decisions (type, title, description, tags, tsvector)"],
    ["context_facts", "Project Memory facts (category, fact, confidence, tsvector)"],
    ["file_index", "Project Memory file index (path, language, size, exports, imports)"],
    ["memory_embeddings", "ChromaDB embedding references (source type/id, chroma_id)"],
    ["sandbox_containers", "Docker containers (image, status, resources, ports, metrics)"],
    ["sandbox_events", "Container lifecycle events (created, started, stopped, etc.)"],
    ["sandbox_exec_log", "Command execution log inside containers (cmd, output, duration)"],
    ["_migrations", "Migration tracking (which .sql files have been applied)"],
]
widths = [40, 150]
pdf.table_header(["Table", "Purpose"], widths)
for i, row in enumerate(tables):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Redis")
pdf.body_text(
    "Redis provides three services:\n"
    "1. LLM Response Cache: MD5-keyed cached responses with 1-hour TTL, avoiding duplicate "
    "LLM calls for identical requests.\n"
    "2. Rate Limiting: Sliding-window rate limiter using sorted sets. Configurable per-endpoint "
    "(chat: 30 req/min, RAG: 60/min, deploy: 5/5min, general: 120/min).\n"
    "3. General KV Cache: Simple get/set/delete helpers for arbitrary data.\n\n"
    "Redis is non-blocking — the platform functions without it (caching disabled, no rate limits). "
    "Connection uses lazy initialization with max 3 retry attempts before disabling."
)

pdf.section_title("ChromaDB")
pdf.body_text(
    "ChromaDB stores vector embeddings for:\n"
    "1. RAG document chunks — cosine similarity HNSW index, collection: 'rag_documents'\n"
    "2. Project Memory decisions/facts — collection: 'conversation_memory'\n\n"
    "ChromaDB is optional — when unavailable, vector search is disabled but BM25 search "
    "continues to work. The platform logs a warning and falls back gracefully."
)

# ========================================================================
# CHAPTER 9: REAL-TIME COMMUNICATION
# ========================================================================
pdf.chapter_title("Real-Time Communication — WebSocket & SSE")

pdf.section_title("Server-Sent Events (SSE)")
pdf.body_text(
    "The primary streaming mechanism for LLM responses. When POST /api/chat is called, it "
    "returns a text/event-stream response. The SSEWriter (genui/engine.ts) emits GenUIEvent "
    "objects as SSE data frames. Event types include:"
)
events = [
    ("text", "LLM text output — {content, delta: true/false}. delta=true for streaming tokens"),
    ("thinking", "Agent reasoning — {content, agentType}. Shows which agent is active"),
    ("tool_call", "Tool invocation — {toolName, toolArgs, agentType}"),
    ("tool_result", "Tool output — {toolName, success, output, durationMs}"),
    ("approval", "Human approval request — {id, toolName, toolArgs, riskLevel, actions}"),
    ("component", "UI component — {name, props}. e.g., status_badge, code_block, file_tree"),
    ("error", "Error event — {message, code, recoverable}"),
    ("done", "Orchestration complete — {summary, usage: {tokens, cost, duration, tools}}"),
]
for bold, rest in events:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("WebSocket (ws://host/ws)")
pdf.body_text(
    "Bidirectional communication channel for:\n"
    "1. System events broadcast (agent:step events forwarded to all clients)\n"
    "2. Approval responses (user approves/rejects tool execution)\n"
    "3. Ping/pong keepalive\n"
    "4. Conversation binding (client subscribes to a conversation ID)\n"
    "5. Workspace sync requests\n\n"
    "Client connections are tracked in a Map with metadata (id, userId, conversationId, "
    "connectedAt). The platform reports connected client count in /api/health."
)

# ========================================================================
# CHAPTER 10: SANDBOX ISOLATION
# ========================================================================
pdf.chapter_title("Sandbox Isolation — Docker Container Management")

pdf.body_text(
    "The Sandbox Manager provides per-workspace Docker container isolation. Each workspace can "
    "run inside its own container with configurable resource limits. When Docker is unavailable, "
    "the platform falls back to host-mode execution."
)

pdf.section_title("Container Lifecycle")
pdf.body_text(
    "States: pending -> creating -> running -> stopped/paused/failed -> destroyed\n\n"
    "Operations: create (spin up container from base image), start, stop, restart, destroy. "
    "Each state transition is logged as a sandbox_event in PostgreSQL."
)

pdf.section_title("Resource Limits (Defaults)")
limits = [
    ("CPU", "1.0 core"),
    ("Memory", "512 MB"),
    ("Disk", "1024 MB"),
    ("Max Containers", "20"),
    ("Idle Timeout", "30 minutes"),
    ("Port Range", "4000-4100"),
    ("Max PIDs", "Configurable"),
    ("Base Image", "agentic-sandbox:latest"),
]
for bold, rest in limits:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("Resource Monitor")
pdf.body_text(
    "A periodic collector (default 60s interval) queries Docker for CPU%, memory usage, disk "
    "usage, and network I/O for each running container. Metrics are stored in the "
    "sandbox_containers table and exposed via /api/sandbox."
)

# ========================================================================
# CHAPTER 11: AUTO-REPAIR ENGINE
# ========================================================================
pdf.chapter_title("Auto-Repair Engine — Autonomous Error Recovery")

pdf.body_text(
    "The RepairEngine is an autonomous error detection and recovery system that runs inside "
    "the Orchestrator's ReAct loop. It scans tool outputs for known error patterns, classifies "
    "them, and injects structured repair prompts so the LLM can fix issues automatically."
)

pdf.section_title("Error Categories")
errs = [
    ["type_error", "TypeScript type mismatches (TS2322, TS2339, etc.)", "Fix types, add type guards"],
    ["build_error", "Build failures (tsc, vite, webpack, esbuild)", "Check imports, syntax, config"],
    ["test_failure", "Test assertion failures (jest, mocha, vitest)", "Fix test or code under test"],
    ["lint_error", "ESLint/Prettier violations", "Follow style guide rules"],
    ["dependency_error", "Missing modules, version conflicts", "npm install missing package"],
    ["runtime_error", "EADDRINUSE, ReferenceError, TypeError", "Check stack trace, fix source"],
    ["syntax_error", "JSON parse errors, unexpected tokens", "Fix brackets, commas, quotes"],
]
widths = [30, 70, 90]
pdf.table_header(["Category", "Detection Patterns", "Auto-Suggestion"], widths)
for i, row in enumerate(errs):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Repair Flow")
pdf.body_text(
    "1. After each tool execution batch, scanToolResults() checks outputs from repairable tools "
    "(shell_exec, npm_run, npm_install, code_test, deploy_*).\n"
    "2. Regex-based detection extracts error category, file path, line number, and error message.\n"
    "3. If errors are found and repair budget allows (max 3 attempts per error, 8 total per session), "
    "a structured repair prompt is generated.\n"
    "4. The prompt is injected as a user message: 'AUTOMATED REPAIR — The following error(s) were "
    "detected...' with file locations, error descriptions, and fix suggestions.\n"
    "5. The next ReAct iteration picks up the repair prompt and the LLM attempts to fix the issue.\n"
    "6. If the same error persists after 3 attempts, the engine stops retrying that specific error."
)

# ========================================================================
# CHAPTER 12: FRONTEND DASHBOARD
# ========================================================================
pdf.chapter_title("Frontend Dashboard — GenUI Streaming Interface")

pdf.body_text(
    "The frontend is a single-page application built with vanilla HTML/CSS/JS, Tailwind CSS (CDN), "
    "Chart.js for metrics visualization, marked.js for markdown rendering, and highlight.js for "
    "code syntax highlighting. It communicates with the backend via REST APIs, SSE streaming, "
    "and WebSocket."
)

pdf.section_title("Layout Structure")
pdf.body_text(
    "The UI is divided into three columns:\n"
    "1. Narrow Sidebar (56px): 8 navigation buttons for Chats, Agents, Files, RAG, Tools, "
    "Memory, Sandbox, Workflows. Plus Settings and user avatar.\n"
    "2. Expandable Side Panel (256px): Slides out from the sidebar showing content for the "
    "selected section. Toggled by clicking sidebar buttons.\n"
    "3. Main Content Area (flex): Split horizontally into Chat Pane (45% width) and Workspace "
    "Pane (55% width)."
)

pdf.section_title("Chat Pane")
pdf.body_text(
    "Features a header with version badge and 'Live' WebSocket indicator. Contains a welcome "
    "screen with quick-action buttons (System Status, Create Web App, Web Search, GitHub Repos). "
    "The chat input area includes an AI Developer tab, RAG Search tab, a textarea with "
    "attachment support, model indicator (GPT-4o), and send button. Messages render as "
    "markdown with syntax-highlighted code blocks."
)

pdf.section_title("Workspace Pane")
pdf.body_text(
    "Tabbed interface with: Preview (iframe for live app previews with address bar), Files "
    "(file explorer with tree view), Trace (agent execution trace), Terminal (interactive "
    "command line), Deploy (quick actions for Cloudflare/Vercel), GitHub (status, commits, "
    "push/PR), Metrics (latency charts, cost breakdown, tool stats, provider health)."
)

pdf.section_title("Sidebar Panels")
panels = [
    ("Chats", "Conversation history — list, load, create, delete past sessions"),
    ("Agents", "7 agent cards with icons and descriptions"),
    ("Files", "Workspace file tree with file operations"),
    ("RAG (Knowledge Base)", "Document list, add new documents for ingestion"),
    ("Tools", "All 60 tools grouped by category with risk badges"),
    ("Memory", "Stats, scan button, tech stack, facts, decisions"),
    ("Sandbox", "Docker status, container list, resource metrics, create/destroy"),
    ("Workflows", "4 pre-built templates: Full Stack App, Research, PR Review, RAG Pipeline"),
]
for bold, rest in panels:
    pdf.bold_bullet(f"{bold}: ", rest)

# ========================================================================
# CHAPTER 13: API REFERENCE
# ========================================================================
pdf.chapter_title("API Reference — Complete Endpoint Map")

pdf.section_title("Chat API")
apis = [
    ["POST", "/api/chat", "Send message, get SSE stream response"],
    ["GET", "/api/chat/conversations", "List all conversations (limit 50)"],
    ["GET", "/api/chat/:id/history", "Get conversation with message history"],
    ["PATCH", "/api/chat/:id", "Update conversation (e.g., title)"],
    ["DELETE", "/api/chat/:id", "Delete conversation"],
]
widths = [16, 52, 122]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("RAG API")
apis = [
    ["POST", "/api/rag/ingest", "Ingest document (title, content, sourceType, chunkSize)"],
    ["POST", "/api/rag/search", "Search knowledge base (query, topK, searchType)"],
    ["GET", "/api/rag/documents", "List all ingested documents"],
    ["DELETE", "/api/rag/documents/:id", "Delete document + chunks + vectors"],
]
widths = [16, 52, 122]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("System API")
apis = [
    ["GET", "/api/system/status", "Full system health: DB, Redis, tools, memory, WS clients"],
    ["GET", "/api/system/models", "All models by provider with metadata"],
    ["GET", "/api/system/tools", "All tools grouped by category"],
    ["GET", "/api/system/costs", "Detailed cost tracking per model"],
    ["GET", "/api/system/performance", "Latency percentiles (P50/P95/P99), tool stats"],
    ["GET", "/api/system/health/providers", "Provider health: available, errors, avg latency"],
    ["GET", "/api/system/config", "Non-sensitive config: providers, tool counts"],
    ["GET", "/api/system/deploy/status", "Deployment list and supported platforms"],
    ["GET", "/api/system/git/status", "Git repo status: branch, commits, changes"],
    ["GET", "/api/system/websocket", "Connected WS clients and pending approvals"],
    ["POST", "/api/system/terminal/exec", "Execute terminal command (with blocklist)"],
]
widths = [16, 56, 118]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Memory API")
apis = [
    ["GET", "/api/memory/snapshot", "Full memory snapshot (files, decisions, facts, stats)"],
    ["POST", "/api/memory/search", "Semantic search across all memory types"],
    ["GET", "/api/memory/facts", "List all context facts"],
    ["POST", "/api/memory/facts", "Add new context fact"],
    ["DELETE", "/api/memory/facts/:id", "Delete fact"],
    ["GET", "/api/memory/decisions", "List decisions (optional type filter)"],
    ["POST", "/api/memory/decisions", "Log new decision"],
    ["POST", "/api/memory/scan", "Scan workspace and index all files"],
]
widths = [16, 52, 122]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Workspace & Sandbox APIs")
apis = [
    ["GET", "/api/workspace", "List workspaces"],
    ["GET", "/api/workspace/:id/tree", "File tree for workspace"],
    ["GET", "/api/workspace/:id/file", "Read file contents"],
    ["POST", "/api/workspace/:id/file", "Write file"],
    ["DELETE", "/api/workspace/:id/file", "Delete file"],
    ["GET", "/api/sandbox", "List sandboxes with overview"],
    ["POST", "/api/sandbox", "Create new sandbox container"],
    ["DELETE", "/api/sandbox/:id", "Destroy sandbox"],
    ["POST", "/api/sandbox/:id/:action", "Start/stop/restart container"],
]
widths = [16, 52, 122]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

pdf.section_title("Health & Auth")
apis = [
    ["GET", "/api/health", "Quick health check (status, version, uptime, memory, WS)"],
    ["POST", "/api/auth/login", "JWT login (disabled by default)"],
    ["WS", "/ws", "WebSocket endpoint for real-time events"],
]
widths = [16, 52, 122]
pdf.table_header(["Method", "Endpoint", "Description"], widths)
for i, row in enumerate(apis):
    pdf.table_row(row, widths, fill=i % 2 == 0)

# ========================================================================
# CHAPTER 14: SECURITY
# ========================================================================
pdf.chapter_title("Security, Auth & Rate Limiting")

pdf.section_title("Authentication (Optional)")
pdf.body_text(
    "JWT-based authentication is available but disabled by default (ENABLE_AUTH=false). "
    "When enabled: POST /api/auth/login accepts email+password, returns a JWT token (24h expiry, "
    "bcrypt 10 rounds). All API routes then require an Authorization: Bearer <token> header."
)

pdf.section_title("Rate Limiting")
pdf.body_text(
    "Redis-backed sliding-window rate limiter using sorted sets. Configurable per-endpoint:"
)
limits = [
    ("Chat", "30 requests / minute"),
    ("RAG", "60 requests / minute"),
    ("Deploy", "5 requests / 5 minutes"),
    ("General", "120 requests / minute"),
]
for bold, rest in limits:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("Command Execution Safety")
pdf.body_text(
    "The terminal/exec endpoint and shell_exec tool block dangerous command patterns: "
    "rm -rf /, format, shutdown, reboot, dd, mkfs, and other destructive commands. "
    "Output is truncated to 50K characters."
)

pdf.section_title("Encryption")
pdf.body_text(
    "AES-256-GCM encryption utilities are available for sensitive data, using a salted key "
    "derived from the server's secret key + timestamp-based salt."
)

# ========================================================================
# CHAPTER 15: CONFIGURATION
# ========================================================================
pdf.chapter_title("Configuration & Environment")

pdf.body_text(
    "All configuration is centralized in src/config/index.ts with environment variable overrides "
    "via .env file. Helper functions env(), envInt(), envBool() read env vars with defaults."
)

pdf.section_title("Key Configuration Groups")
configs = [
    ("Server", "PORT=3000, HOST=0.0.0.0, CORS_ORIGINS=*, SECRET_KEY"),
    ("Database", "DATABASE_URL=postgresql://agentic:agentic_password@localhost:5432/agentic_rag"),
    ("Redis", "REDIS_URL=redis://localhost:6379, max retries=3"),
    ("ChromaDB", "CHROMA_URL=http://localhost:8000, collections for docs/code/memory"),
    ("LLM Keys", "OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY"),
    ("Default LLM", "DEFAULT_LLM_PROVIDER=openai, DEFAULT_MODEL=gpt-4o, EMBED_MODEL=text-embedding-3-small"),
    ("Agent", "Max iterations=25, timeout=120s, max concurrent tools=5, budget=$1.0/request"),
    ("RAG", "Chunk size=500, overlap=50, topK=5, rrfK=60, vector weight=0.6, bm25 weight=0.4"),
    ("Workspace", "Root=./workspaces, max=50, max size=500MB"),
    ("Sandbox", "Base image=agentic-sandbox:latest, CPU=1.0, memory=512MB, max containers=20"),
    ("Auth", "ENABLE_AUTH=false, JWT_EXPIRES_IN=24h, BCRYPT_ROUNDS=10"),
]
for bold, rest in configs:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("MODEL_REGISTRY")
pdf.body_text(
    "A comprehensive registry of 15+ models with metadata: provider, maxTokens, contextWindow, "
    "costPer1kInput, costPer1kOutput, supportsTools, supportsStreaming, supportsVision, speed "
    "rating, and best-use-case description. Used by getBestModelForTask() to select the "
    "optimal model for each agent type."
)

pdf.section_title("MOE_ROUTING Table")
pdf.body_text(
    "Maps task types to primary and fallback model IDs:\n"
    "- code_generation: gpt-4o (primary), claude-3-5-sonnet (fallback)\n"
    "- rag_query: gpt-4o-mini (primary), gemini-1.5-flash (fallback)\n"
    "- classification: gpt-4o-mini (primary), llama-3.1-8b (fallback)\n"
    "- general_reasoning: gpt-4o (primary), claude-3-5-sonnet (fallback)\n"
    "- code_review: claude-3-5-sonnet (primary), gpt-4o (fallback)"
)

# ========================================================================
# CHAPTER 16: DATA MODELS
# ========================================================================
pdf.chapter_title("Data Models & Database Schema")

pdf.section_title("Core TypeScript Interfaces")
pdf.body_text(
    "The types/index.ts file defines the complete type system. Key interfaces:"
)
types = [
    ("LLMMessage", "role (system/user/assistant/tool), content, tool_calls?, tool_call_id?"),
    ("LLMCompletionRequest", "provider, model, messages, tools?, temperature, maxTokens, responseFormat?"),
    ("LLMCompletionResponse", "id, provider, model, content, toolCalls, usage, finishReason, latencyMs"),
    ("LLMStreamChunk", "type (text_delta/tool_call_delta/usage/done/error), content?, usage?"),
    ("GenUIEvent", "id, timestamp, type (text/thinking/tool_call/tool_result/approval/component/error/done)"),
    ("ToolDefinition", "name, description, category, riskLevel, parameters (JSON Schema), requiresApproval"),
    ("ToolExecutionResult", "success, output, error?, durationMs"),
    ("RAGDocument", "id, title, sourceUrl, sourceType, content, metadata, chunkCount, createdAt"),
    ("RAGChunk", "id, documentId, content, chunkIndex, tokenCount, metadata"),
    ("RAGSearchResult", "chunk, document, score, searchType (vector/bm25/hybrid)"),
    ("OrchestrationState", "id, conversationId, userId, currentNode, status, messages, iteration"),
    ("SubTask", "id, agentType, title, instruction, dependsOn[], priority"),
    ("ExecutionPlan", "parallel, reasoning, tasks: SubTask[]"),
    ("Decision", "id, timestamp, type, title, description, reasoning?, files?, outcome?, tags[]"),
    ("ContextFact", "id, category, fact, confidence, source, createdAt, updatedAt"),
]
for bold, rest in types:
    pdf.bold_bullet(f"{bold}: ", rest)

pdf.section_title("Migration Files")
pdf.body_text(
    "Three migration files define the PostgreSQL schema:\n"
    "- 001_initial_schema.sql: uuid-ossp extension, users, conversations, messages, documents, "
    "chunks, deployments, agent_sessions, tool_executions, api_key_usage. Includes FTS indexes.\n"
    "- 002_project_memory.sql: decisions, context_facts, file_index, memory_embeddings. "
    "tsvector triggers for decisions and facts.\n"
    "- 003_sandbox_containers.sql: sandbox_containers, sandbox_events, sandbox_exec_log. "
    "Indexes on status, workspace, port, timestamps."
)

# ========================================================================
# CHAPTER 17: DEPLOYMENT
# ========================================================================
pdf.chapter_title("Deployment Architecture")

pdf.section_title("Local Development (Current)")
pdf.body_text(
    "The platform runs on a single server with PM2 process management:\n"
    "- Hono server on port 3000 (HTTP + WebSocket)\n"
    "- PostgreSQL on port 5432 (local or Docker)\n"
    "- Redis on port 6379 (local or Docker)\n"
    "- ChromaDB on port 8000 (optional, Python-based)\n"
    "- PM2 ecosystem.config.cjs manages the Node.js process\n"
    "- Static files served from public/ directory"
)

pdf.section_title("Startup Sequence")
pdf.body_text(
    "1. Log version banner (v1.9.0)\n"
    "2. initializeTools() — register all 60 tools in the Tool Registry\n"
    "3. sandboxManager.initialize() — detect Docker, set up container management\n"
    "4. testConnection() — verify PostgreSQL connectivity (non-blocking)\n"
    "5. connectRedis() — verify Redis connectivity (non-blocking)\n"
    "6. ChromaDB heartbeat check (non-blocking)\n"
    "7. Ensure workspace directory exists\n"
    "8. Start HTTP server with WebSocket injection\n"
    "9. Log all endpoint URLs"
)

pdf.section_title("Graceful Degradation")
pdf.body_text(
    "The platform is designed to function with reduced capabilities when services are unavailable:\n"
    "- Without PostgreSQL: in-memory fallback for conversations, no persistent memory\n"
    "- Without Redis: no caching, no rate limiting\n"
    "- Without ChromaDB: BM25-only search, no vector similarity\n"
    "- Without Docker: host-mode execution, no container isolation\n"
    "- Without LLM API keys: provider marked unavailable, fallback to next available"
)

pdf.section_title("End-to-End Test Suite")
pdf.body_text(
    "31 curl-based tests covering: health endpoints, database/Redis connectivity, ChromaDB "
    "status, tool registration, model listing, cost tracking, performance metrics, workspace "
    "API, terminal execution, Git/deploy status, RAG endpoints, memory endpoints, and frontend "
    "asset loading. All 31/31 tests pass."
)

# ============================================================
# SAVE
# ============================================================
output_path = "/home/user/webapp/Agentic_RAG_Platform_System_Architecture.pdf"
pdf.output(output_path)
print(f"PDF generated: {output_path}")
print(f"Pages: {pdf.page_no()}")
