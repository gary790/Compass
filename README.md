# Agentic RAG Platform v1.7.0

A self-hosted, production-ready AI development platform featuring Mixture-of-Experts (MoE) LLM routing, Hybrid RAG with Reciprocal Rank Fusion, 60 tools, GenUI streaming dashboard, WebSocket real-time events, graph-based agent orchestration, Project Memory Hub, and Docker sandbox isolation per workspace.

## Architecture

```
+-----------------------------------------------------+
|               GenUI Dashboard (HTML/JS)              |
|   Chat | Explorer | Memory | Sandbox | Agent Trace   |
+-----+---------------------------+--------------------+
      | SSE Streaming             | WebSocket (ws://)
+-----v---------------------------v--------------------+
|                   Hono Server (Node.js)              |
|  /api/chat | /api/rag | /api/workspace | /api/sandbox|
+-----+----------+----------+----------+--------------+
      |          |          |          |
+-----v---+ +---v---+ +---v---+ +----v---------+
| Router  | | RAG   | | Code  | | Deploy/Test/ |
| Agent   | | Agent | | Agent | | Design/Review|
+---------+ +-------+ +-------+ +--------------+
      |          |          |
+-----v---+ +---v-----------+ +---v-----------+
| MoE LLM | | Hybrid Search | | Docker Sandbox|
| Router   | | Vec+BM25+RRF  | | Per-Workspace |
+---------+ +---+-----------+ +-------+-------+
   |  |  |      |       |            |
  OAI Ant Goo  ChromaDB PostgreSQL  Docker API
  Groq Mis Oll          Redis       (/var/run/docker.sock)
```

## Features

### Completed (v1.7.0)

- **Sandbox Isolation — Docker Containers Per Workspace** (v1.7.0) **NEW**
  - Each workspace gets its own isolated Docker container with resource limits
  - Docker Engine API integration via Unix socket (`/var/run/docker.sock`)
  - Container lifecycle: create, start, stop, restart, pause, unpause, destroy
  - Resource limits: CPU cores, memory MB, disk MB, PID count per container
  - Real-time resource monitoring: CPU %, memory %, disk %, process count
  - Port allocation (4000-4100) for per-workspace preview servers
  - Idle container auto-cleanup (configurable timeout, default 30 min)
  - All tools (shell_exec, npm_install, file ops) execute inside sandboxed containers
  - Graceful fallback: runs on host when Docker is not available
  - Network isolation with dedicated `sandbox-network` (172.30.0.0/16)
  - Security: no-new-privileges, capability dropping, command validation
  - Sandbox Dockerfile (`Dockerfile.sandbox`) with Node.js 20, git, common dev tools
  - PostgreSQL persistence: containers table, events audit log, exec history
  - Frontend: Sandbox panel with container list, status, resource gauges, actions
  - 10 new agent tools: sandbox_status, sandbox_create, sandbox_restart, sandbox_stop, sandbox_destroy, sandbox_logs, sandbox_list, sandbox_health, sandbox_exec_history

- **Project Memory Hub** (v1.6.0)
  - PostgreSQL-backed persistent context (decisions, facts, file index, embeddings)
  - ChromaDB vector embeddings for semantic memory search
  - Workspace file scanner with tech stack auto-detection
  - Auto-decision logging from tool executions (file writes, git commits, deploys)
  - Context injection into LLM system prompts (tech stack, facts, recent decisions)
  - 6 agent tools: memory_search, memory_log_decision, memory_get_context, memory_add_fact, memory_scan_workspace, memory_list_decisions
  - 11 REST API endpoints for memory CRUD
  - Frontend: Memory Hub panel with stats, facts, decisions, semantic search

- **Multi-Agent Parallel Execution** (v1.5.0)
  - LLM-powered Planner decomposes complex requests into sub-tasks
  - ParallelExecutor runs 2-4 agent lanes concurrently
  - Dependency graph, merger/synthesiser, graceful fallback

- **Human-in-the-Loop Approval UI** (v1.4.0)
  - Interactive approval cards with risk-level color coding
  - 60-second countdown, WebSocket-driven flow

- **RepairEngine** (v1.3.2)
  - Detects 7 error categories, auto-injects repair prompts
  - Max 3 retries per error, 8 total per session

- **Token-by-Token Streaming** (v1.3.1) via SSE delta events

- **Conversation Persistence** (v1.3.0) with PostgreSQL + in-memory fallback

- **Mixture-of-Experts (MoE) LLM Router** — 6 providers, 12 models
- **Graph-Based Agent Orchestrator** — 7 specialised sub-agents
- **Hybrid RAG Pipeline** — BM25 + Vector + Reciprocal Rank Fusion

- **60 Tools across 11 categories**
  - File: read, write, edit, list, delete, search, info, mkdir (8)
  - Shell: exec, npm install, npm run, process list (4)
  - System: system info, sandbox_status, sandbox_create, sandbox_restart, sandbox_stop, sandbox_destroy, sandbox_logs, sandbox_list, sandbox_health, sandbox_exec_history (10)
  - Git: init, status, commit, log, diff, push, branch (7)
  - GitHub: create repo, list repos, read/edit files, create PR, list issues (6)
  - Deploy: Cloudflare Pages, Vercel, status, preview (4)
  - Web: search (DuckDuckGo), scrape, fetch (3)
  - Code: analyze, explain, generate, test, refactor (5)
  - Database: query, execute, schema (3)
  - RAG: ingest, query, list docs, delete doc (4)
  - Memory: search, log decision, get context, add fact, scan workspace, list decisions (6)

- **GenUI Streaming Dashboard** with Tailwind CSS
- **WebSocket Real-Time Events**
- **Authentication** — JWT + bcrypt
- **Docker Compose** — PostgreSQL 16, Redis 7, ChromaDB, app + sandbox network

## URLs

- **Live Dashboard**: https://3000-ividel0kd4tewoyclfy3j-18e660f9.sandbox.novita.ai
- **Health Check**: /api/health
- **Sandbox API**: /api/sandbox
- **System Status**: /api/system/status
- **Tools List**: /api/system/tools (60 tools)
- **Models List**: /api/system/models
- **Provider Health**: /api/system/health/providers
- **WebSocket**: ws://localhost:3000/ws

## API Reference

### Sandbox (NEW in v1.7.0)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sandbox` | List all sandboxes with system overview |
| POST | `/api/sandbox` | Create sandbox for workspace |
| GET | `/api/sandbox/:wsId` | Get sandbox details |
| POST | `/api/sandbox/:wsId/start` | Start sandbox container |
| POST | `/api/sandbox/:wsId/stop` | Stop sandbox container |
| POST | `/api/sandbox/:wsId/restart` | Restart sandbox |
| POST | `/api/sandbox/:wsId/pause` | Pause (freeze) sandbox |
| POST | `/api/sandbox/:wsId/unpause` | Resume sandbox |
| DELETE | `/api/sandbox/:wsId` | Destroy sandbox |
| GET | `/api/sandbox/:wsId/health` | Health check |
| GET | `/api/sandbox/:wsId/metrics` | Resource metrics + history |
| GET | `/api/sandbox/:wsId/logs` | Container logs |
| GET | `/api/sandbox/:wsId/exec-history` | Command execution history |
| GET | `/api/sandbox/:wsId/events` | Lifecycle events |
| POST | `/api/sandbox/:wsId/exec` | Execute command in sandbox |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send message, get SSE stream response |
| GET | `/api/chat/conversations` | List active conversations |
| GET | `/api/chat/:id/history` | Get conversation message history |
| DELETE | `/api/chat/:id` | Delete a conversation |

### RAG
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rag/ingest` | Ingest document into knowledge base |
| POST | `/api/rag/search` | Hybrid search (vector+BM25+RRF) |
| GET | `/api/rag/documents` | List all indexed documents |
| DELETE | `/api/rag/documents/:id` | Delete a document |

### Memory
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/snapshot/:wsId` | Full memory snapshot |
| GET | `/api/memory/facts/:wsId` | List context facts |
| POST | `/api/memory/facts/:wsId` | Add a fact |
| DELETE | `/api/memory/facts/:wsId/:id` | Remove a fact |
| GET | `/api/memory/decisions/:wsId` | List decisions |
| POST | `/api/memory/decisions/:wsId` | Add a decision |
| POST | `/api/memory/search/:wsId` | Semantic search |
| POST | `/api/memory/scan/:wsId` | Scan workspace |
| GET | `/api/memory/files/:wsId` | List indexed files |
| GET | `/api/memory/context/:wsId` | Get context string |
| GET | `/api/memory/workspaces` | List memory-enabled workspaces |

### Workspace / Auth / System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspace` | List workspaces |
| POST | `/api/workspace` | Create workspace |
| GET | `/api/workspace/:id/tree` | Get file tree |
| GET/PUT | `/api/workspace/:id/file` | Read/write file |
| GET | `/api/health` | Health check (includes sandbox status) |
| GET | `/api/system/status` | Full platform status |
| GET | `/api/system/tools` | 60 registered tools |

## Data Architecture

- **PostgreSQL** — Users, conversations, messages, documents, chunks, deployments, agent sessions, tool executions, API usage, decisions, facts, file index, memory embeddings, sandbox containers, sandbox events, sandbox exec log
- **Redis** — LLM response caching, rate limiting, session state
- **ChromaDB** — Vector embeddings for RAG search + memory embeddings
- **Docker Engine** — Sandbox container management via Unix socket API

## Project Structure

```
webapp/
  src/
    index.ts              # Main server entry (v1.7.0)
    agent/
      orchestrator.ts     # Graph-based ReAct orchestrator
      parallel.ts         # Multi-agent parallel executor
      repair.ts           # Autonomous error detection & auto-fix
    sandbox/              # NEW — Docker container isolation
      index.ts            # Module exports
      manager.ts          # Container lifecycle (create/start/stop/destroy)
      executor.ts         # Sandboxed tool execution proxy
      resource-monitor.ts # CPU/memory/disk monitoring
    memory/
      hub.ts              # Project Memory Hub (PostgreSQL + ChromaDB)
    llm/
      router.ts           # MoE LLM router (6 providers)
    rag/
      pipeline.ts         # Hybrid RAG (chunk, embed, search, RRF)
    routes/
      sandbox.ts          # Sandbox API (15 endpoints)
      memory.ts           # Memory API (11 endpoints)
      chat.ts, rag.ts, workspace.ts, system.ts, auth.ts, websocket.ts
    tools/
      sandbox/            # 10 sandbox tools
      memory/             # 6 memory tools
      file/, shell/, git/, github/, deploy/, web/, code/, db/, rag/
    database/
      client.ts, redis.ts, conversations.ts
    config/, types/, utils/
  public/
    index.html            # GenUI dashboard (with Sandbox panel)
    static/js/app.js      # Frontend application
  migrations/
    001_initial_schema.sql
    002_project_memory.sql
    003_sandbox_containers.sql  # NEW
  docker-compose.yml      # Full stack + sandbox network
  Dockerfile              # Multi-stage production build
  Dockerfile.sandbox      # NEW — Sandbox container image
  ecosystem.config.cjs    # PM2 configuration
```

## What's Not Yet Implemented

- LLM-powered query expansion in RAG (currently keyword-based)
- Cross-encoder reranking model for RAG
- File watcher (chokidar integration for live file change events)
- Background job queue (BullMQ is installed but not wired)
- Image/vision tools
- Rate limiting middleware per user
- Edit-and-resubmit for approval cards
- Inter-lane communication (agents can't message each other mid-execution)
- Lane cancellation (can't cancel individual lanes)
- Container-to-container networking for multi-service workspaces
- GPU passthrough for ML workloads in sandboxes
- Sandbox image registry (custom images per workspace)

## Recommended Next Steps

1. Build sandbox base image and push to registry
2. Wire BullMQ for background document ingestion
3. Add LLM-powered query expansion for RAG
4. Implement file watcher for real-time workspace sync
5. Add vision/image analysis tool support
6. Rate-limit API endpoints per user
7. Add editable arguments in approval cards
8. Container-to-container networking for multi-service apps
9. GPU passthrough support in sandbox containers
10. Custom sandbox images per workspace (Python, Rust, Go)

## Quick Start

### 1. Clone & Configure
```bash
git clone <repo-url>
cd webapp
cp .env.example .env
# Add your API keys to .env (at minimum OPENAI_API_KEY)
```

### 2. Docker (Recommended)
```bash
# Build sandbox image first
docker build -t agentic-sandbox:latest -f Dockerfile.sandbox .

# Start all services
docker-compose up -d    # Starts PostgreSQL, Redis, ChromaDB, App
open http://localhost:3000
```

### 3. Local Development
```bash
npm install --legacy-peer-deps
npx tsx src/index.ts    # Runs without Docker (sandbox falls back to host mode)
```

## Deployment

- **Platform**: Self-hosted Node.js (Docker recommended)
- **Status**: Running (v1.7.0)
- **Sandbox**: Docker containers per workspace (host fallback when Docker unavailable)
- **Last Updated**: 2026-03-24
