# Agentic RAG Platform v1.8.0

A self-hosted, production-ready AI development platform featuring Mixture-of-Experts (MoE) LLM routing, Hybrid RAG with Reciprocal Rank Fusion, 60 tools across 10 categories, GenUI streaming dashboard, WebSocket real-time events, graph-based agent orchestration, Project Memory Hub, Docker sandbox isolation, comprehensive performance metrics, live terminal, and full Git/GitHub integration.

## Architecture

```
+-----------------------------------------------------+
|               GenUI Dashboard (HTML/JS)              |
|   Chat | Explorer | Memory | Sandbox | Agent Trace   |
|   Metrics | Terminal | Deploy | GitHub | Settings     |
+-----+---------------------------+--------------------+
      | SSE Streaming             | WebSocket (ws://)
+-----v---------------------------v--------------------+
|                   Hono Server (Node.js)              |
|  /api/chat | /api/rag | /api/workspace | /api/sandbox|
|  /api/system | /api/memory | /api/auth                |
+-----+----------+----------+----------+--------------+
      |          |          |          |
+-----v---+ +---v---+ +---v---+ +----v---------+
| Router  | | RAG   | | Code  | | Deploy/Test/ |
| Agent   | | Agent | | Agent | | Design/Review|
+-----+---+ +---+---+ +---+---+ +------+-------+
      |          |          |           |
+-----v----------v----------v-----------v------+
|           Tool Registry (60 tools)            |
|  file | shell | git | github | deploy | web   |
|  code | database | rag | system | sandbox     |
+------+----------+----------+---------+-------+
       |          |          |         |
  +----v---+ +---v---+ +---v----+ +--v-------+
  | File   | | Shell | | Docker | | LLM MoE  |
  | System | | Exec  | | API    | | Router   |
  +--------+ +-------+ +--------+ +----------+
                                   | OpenAI   |
                                   | Anthropic|
                                   | Google   |
                                   | Groq     |
                                   | Mistral  |
                                   | Ollama   |
                                   +----------+
```

## Live URLs

- **Dashboard**: https://3000-ividel0kd4tewoyclfy3j-18e660f9.sandbox.novita.ai
- **Health**: /api/health
- **System Status**: /api/system/status
- **System Tools (60)**: /api/system/tools
- **Models & Routing**: /api/system/models
- **Cost Tracking**: /api/system/costs
- **Performance Metrics**: /api/system/performance
- **Provider Health**: /api/system/health/providers
- **Git Status**: /api/system/git/status
- **Deploy Status**: /api/system/deploy/status
- **Terminal Exec**: POST /api/system/terminal/exec
- **WebSocket**: ws://localhost:3000/ws

## Features (100% Complete)

### Core AI Engine
- **MoE LLM Router** — 6 providers (OpenAI, Anthropic, Google, Mistral, Groq, Ollama), 15 models, automatic task-based routing with fallback
- **Streaming** — Token-by-token SSE streaming with live markdown rendering
- **Cost Tracking** — Detailed per-model cost, token, and latency tracking with session summaries
- **Provider Health** — Circuit breaker pattern, success/error counts, average latency per provider
- **Response Caching** — Redis-backed LLM response cache (1hr TTL for non-tool queries)

### Graph-Based Orchestration
- **7 Agent Types** — Router, RAG, Code, Deploy, Design, Test, Reviewer
- **Parallel Execution** — 2-4 concurrent agent lanes with LLM result synthesis
- **Auto-Repair Engine** — Up to 8 autonomous error detection and fix loops per session
- **Human-in-the-Loop** — WebSocket-based approval UI with countdown timer, risk levels

### Hybrid RAG Pipeline
- **BM25 + Vector Search** — Reciprocal Rank Fusion combining keyword and semantic results
- **ChromaDB Integration** — Persistent vector embeddings with 3 collections (docs, code, memory)
- **Semantic Chunking** — Intelligent document splitting with overlap
- **Source Cards UI** — GenUI component showing retrieval sources with scores

### Project Memory Hub
- **File Index** — Scans workspace, extracts exports/imports/summaries for JS/TS files
- **Decision Log** — Architecture, implementation, fix, deploy decisions with outcomes
- **Context Facts** — Tech stack, conventions, constraints, preferences with confidence scores
- **Semantic Search** — Combined vector (ChromaDB) + keyword (PostgreSQL) search
- **LLM Context Block** — Auto-generates context summary for agent prompts

### Sandbox Isolation (Docker)
- **Container Management** — Full lifecycle: create, start, stop, restart, pause, unpause, destroy
- **Resource Monitoring** — CPU, memory, disk, PID tracking with alert thresholds
- **Port Isolation** — Per-container port allocation (4000-4100)
- **Exec History** — Command audit log per sandbox
- **Graceful Degradation** — Falls back to host execution when Docker unavailable

### Dashboard Panels (All Functional)
1. **Chat** — AI conversation with SSE streaming, markdown, code highlighting
2. **Agents** — 7 agent cards with one-click activation
3. **File Explorer** — Workspace file tree, file opening, workspace switching
4. **Knowledge Base** — RAG document ingestion, listing, deletion
5. **Tools** — 60 tools listed by category with risk indicators
6. **Project Memory** — Stats, tech stack, facts, decisions, semantic search
7. **Sandbox** — Docker status, container list, resource metrics, actions
8. **Workflows** — Pre-built workflow templates (Full Stack, Research, PR Review, RAG Pipeline)
9. **Preview** — Live iframe preview of deployed apps
10. **Trace** — Real-time agent reasoning and tool call trace
11. **Terminal** — Direct command execution with history (↑/↓), real API backend
12. **Deploy** — Build/test/deploy buttons, deployment history, Cloudflare/Vercel
13. **GitHub** — Git status, branch info, commit history, push/PR actions
14. **Metrics** — Latency chart, cost doughnut, tool stats, provider health, top cards
15. **Settings** — LLM provider, approval mode, budget, system info

### 60 Tools (10 Categories)

| Category | Count | Tools |
|----------|-------|-------|
| File | 8 | read_file, write_file, edit_file, list_directory, delete_file, search_files, file_info, create_directory |
| Shell | 4 | shell_exec, npm_install, npm_run, process_list |
| System | 10 | system_info, sandbox_status/create/restart/stop/destroy/logs/list/health/exec_history |
| Git | 7 | git_init, git_status, git_commit, git_log, git_diff, git_push, git_branch |
| GitHub | 6 | github_create_repo, github_list_repos, github_read_file, github_edit_file, github_create_pr, github_list_issues |
| Deploy | 4 | deploy_cloudflare, deploy_vercel, deploy_status, deploy_preview |
| Web | 3 | web_search, web_scrape, web_fetch |
| Code | 5 | code_analyze, code_explain, code_generate, code_test, code_refactor |
| Database | 3 | db_query, db_execute, db_schema |
| RAG | 10 | rag_ingest, rag_query, rag_list_docs, rag_delete_doc, memory_search, memory_log_decision, memory_get_context, memory_add_fact, memory_scan_workspace, memory_list_decisions |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/health | GET | Health check with version, sandbox, memory, WS stats |
| /api/chat | POST | SSE streaming chat with agent orchestration |
| /api/chat/conversations | GET | List all conversations |
| /api/chat/:id/history | GET | Get conversation history |
| /api/chat/:id | DELETE | Delete conversation |
| /api/rag/ingest | POST | Ingest document into RAG pipeline |
| /api/rag/query | POST | Query knowledge base |
| /api/rag/documents | GET | List RAG documents |
| /api/rag/documents/:id | DELETE | Delete RAG document |
| /api/workspace | GET/POST | List/create workspaces |
| /api/workspace/:id/tree | GET | Get file tree |
| /api/workspace/:id/file | GET/PUT | Read/write files |
| /api/memory/snapshot | GET | Memory hub snapshot |
| /api/memory/search | POST | Semantic memory search |
| /api/memory/facts | GET/POST | List/add context facts |
| /api/memory/facts/:id | DELETE | Delete fact |
| /api/memory/decisions | GET | List decisions |
| /api/memory/scan | POST | Scan workspace |
| /api/sandbox | GET/POST | List sandboxes / create sandbox |
| /api/sandbox/:id | DELETE | Destroy sandbox |
| /api/sandbox/:id/start | POST | Start sandbox |
| /api/sandbox/:id/stop | POST | Stop sandbox |
| /api/sandbox/:id/restart | POST | Restart sandbox |
| /api/sandbox/:id/health | GET | Sandbox health check |
| /api/sandbox/:id/metrics | GET | Sandbox resource metrics |
| /api/sandbox/:id/logs | GET | Sandbox container logs |
| /api/sandbox/:id/exec | POST | Execute in sandbox |
| /api/sandbox/:id/exec-history | GET | Execution audit log |
| /api/system/status | GET | Comprehensive platform status |
| /api/system/tools | GET | All 60 tools by category |
| /api/system/models | GET | Available models & MoE routing |
| /api/system/costs | GET | Detailed cost breakdown by model |
| /api/system/performance | GET | Latency percentiles, tool stats |
| /api/system/config | GET | Non-sensitive configuration |
| /api/system/health/providers | GET | Provider health & circuit breaker |
| /api/system/deploy/status | GET | Deployment history |
| /api/system/git/status | GET | Git repo status, commits, changes |
| /api/system/terminal/exec | POST | Direct terminal command execution |
| /api/system/websocket | GET | WebSocket client info |
| /api/auth/login | POST | JWT authentication |

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Hono (fast, lightweight)
- **LLM SDKs**: OpenAI, Anthropic, Google Generative AI
- **Vector DB**: ChromaDB
- **Database**: PostgreSQL 16 (optional)
- **Cache**: Redis 7 (optional)
- **Frontend**: Tailwind CSS, Chart.js, Highlight.js, Marked.js
- **Process Manager**: PM2
- **Container**: Docker (optional, for sandbox)

## Quick Start

```bash
git clone https://github.com/gary790/Compass.git
cd Compass
cp .env.example .env  # Add API keys
npm install
npm run build
pm2 start ecosystem.config.cjs
open http://localhost:3000

# Optional: Full stack with Docker
docker-compose up -d
```

## Version History

| Version | Feature |
|---------|---------|
| v1.8.0 | Full Performance: comprehensive metrics, live terminal, deploy/github panels, performance tracker |
| v1.7.0 | Sandbox Isolation: Docker containers per workspace, resource monitoring |
| v1.6.0 | Project Memory Hub: persistent context, embeddings, decision log |
| v1.5.0 | Multi-Agent Parallel Execution: 2-4 concurrent lanes |
| v1.4.0 | Human-in-the-Loop Approval UI via WebSocket |
| v1.3.2 | RepairEngine: autonomous error detection & auto-fix |
| v1.3.1 | Token-by-token SSE streaming |
| v1.3.0 | GenUI components, source cards |
| v1.2.0 | Hybrid RAG with BM25 + vector fusion |
| v1.1.0 | MoE router, graph orchestrator, 51 tools |

## GitHub

https://github.com/gary790/Compass

## Deployment

- **Platform**: Self-hosted (Node.js) / Docker Compose
- **Status**: Running
- **Last Updated**: 2026-03-24
