# Agentic RAG Platform v1.1.0

A self-hosted, production-ready AI development platform featuring Mixture-of-Experts (MoE) LLM routing, Hybrid RAG with Reciprocal Rank Fusion, 45+ tools, GenUI streaming dashboard, WebSocket real-time events, and graph-based agent orchestration.

## Architecture

```
+-----------------------------------------------------+
|               GenUI Dashboard (HTML/JS)              |
|   Chat UI | File Explorer | Agent Trace | Terminal   |
+-----+---------------------------+--------------------+
      | SSE Streaming             | WebSocket (ws://)
+-----v---------------------------v--------------------+
|                   Hono Server (Node.js)              |
|   /api/chat | /api/rag | /api/workspace | /api/auth  |
+-----+----------+----------+----------+--------------+
      |          |          |          |
+-----v---+ +---v---+ +---v---+ +----v---------+
| Router  | | RAG   | | Code  | | Deploy/Test/ |
| Agent   | | Agent | | Agent | | Design/Review|
+---------+ +-------+ +-------+ +--------------+
      |          |
+-----v---+ +---v-----------+
| MoE LLM | | Hybrid Search |
| Router   | | Vec+BM25+RRF  |
+---------+ +---+-----------+
   |  |  |      |       |
  OAI Ant Goo  ChromaDB PostgreSQL
  Groq Mis Oll          Redis
```

## Features

### Completed (v1.1.0)

- **Mixture-of-Experts (MoE) LLM Router** — 6 providers: OpenAI, Anthropic, Google, Mistral, Groq, Ollama
  - Automatic model selection based on task type (code, review, RAG, planning)
  - Retry logic with exponential backoff
  - Provider health monitoring and tracking
  - Response caching via Redis
  - Cost tracking per model/session
  - Anthropic streaming support

- **Graph-Based Agent Orchestrator** — 7 specialised sub-agents
  - Router, RAG, Code, Deploy, Design, Test, Reviewer agents
  - Intent-based routing (keyword heuristics)
  - ReAct loop (Reason + Act) with configurable max iterations
  - Concurrent tool execution with batching
  - Human-in-the-loop approval gates
  - Full cost aggregation across agent sessions

- **Hybrid RAG Pipeline** — BM25 + Vector + Reciprocal Rank Fusion
  - Semantic chunking with heading-aware splitting
  - ChromaDB vector store with cosine similarity
  - PostgreSQL full-text search (BM25)
  - RRF score fusion with configurable weights
  - Query expansion (keyword extraction)
  - Contextual compression (prune irrelevant sentences)

- **45 Tools across 10 categories**
  - File: read, write, edit, list, delete, search, info, mkdir
  - Shell: exec, npm install, npm run, process list
  - System: system info
  - Git: init, status, commit, log, diff, push, branch
  - GitHub: create repo, list repos, read/edit files, create PR, list issues
  - Deploy: Cloudflare Pages, Vercel, status, preview
  - Web: search (DuckDuckGo), scrape, fetch
  - Code: analyze, explain, generate, test, refactor
  - Database: query (read), execute (write), schema
  - RAG: ingest, query, list docs, delete doc

- **GenUI Streaming Dashboard**
  - Dark-mode Tailwind CSS interface
  - Real-time SSE streaming of agent responses
  - Agent trace panel with timestamps
  - File explorer with syntax-aware icons
  - RAG document management modal
  - Settings panel with system status
  - WebSocket connection status indicator
  - Chart, table, code block, terminal, file tree component renderers

- **WebSocket Real-Time Events**
  - Live agent event broadcasting
  - Connection management with auto-reconnect
  - Human-in-the-loop approval system
  - Heartbeat/ping-pong keep-alive

- **Authentication** — JWT-based with bcrypt password hashing
- **Docker Compose** — PostgreSQL 16, Redis 7, ChromaDB, app container
- **Database migrations** — Automatic migration runner with tracking

## URLs

- **Live Dashboard**: https://3000-ividel0kd4tewoyclfy3j-82b888ba.sandbox.novita.ai
- **Health Check**: /api/health
- **System Status**: /api/system/status
- **Tools List**: /api/system/tools
- **Models List**: /api/system/models
- **Cost Tracking**: /api/system/costs
- **Provider Health**: /api/system/health/providers
- **WebSocket**: ws://localhost:3000/ws

## API Reference

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

### Workspace
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspace` | List workspaces |
| POST | `/api/workspace` | Create workspace |
| GET | `/api/workspace/:id/tree` | Get file tree |
| GET | `/api/workspace/:id/file?path=` | Read file |
| PUT | `/api/workspace/:id/file` | Write file |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login (returns JWT) |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/settings` | Update settings |
| PUT | `/api/auth/api-keys` | Save encrypted API keys |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/system/status` | Full platform status |
| GET | `/api/system/models` | Available LLM models |
| GET | `/api/system/tools` | All registered tools |
| GET | `/api/system/costs` | Session cost tracking |
| GET | `/api/system/config` | Non-sensitive config |
| GET | `/api/system/websocket` | WebSocket clients |
| GET | `/api/system/health/providers` | Provider health |

## Data Architecture

- **PostgreSQL** — Users, conversations, messages, documents, chunks, deployments, agent sessions, tool executions, API usage
- **Redis** — LLM response caching, rate limiting, session state
- **ChromaDB** — Vector embeddings for RAG search
- **In-Memory** — Active conversations (Redis-backed in production)

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
docker-compose up -d    # Starts PostgreSQL, Redis, ChromaDB, App
open http://localhost:3000
```

### 3. Local Development
```bash
npm install --legacy-peer-deps
npx tsx src/index.ts    # Runs without Docker (DB/Redis optional)
```

### 4. Database Setup (if using PostgreSQL)
```bash
npm run db:migrate      # Apply migrations
npm run db:seed         # Create admin user + sample data
```

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Hono (lightweight, fast)
- **LLM SDKs**: openai, @anthropic-ai/sdk, @google/generative-ai
- **Vector DB**: ChromaDB (cosine similarity)
- **Database**: PostgreSQL 16 (BM25 full-text + relational)
- **Cache**: Redis 7 (ioredis)
- **Frontend**: Tailwind CSS, Chart.js, Highlight.js, Marked
- **Auth**: JWT + bcryptjs
- **Process**: PM2 (dev), Docker (prod)

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (if using OpenAI) | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude key |
| `GOOGLE_AI_API_KEY` | No | Google Gemini key |
| `DATABASE_URL` | No | PostgreSQL connection |
| `REDIS_URL` | No | Redis connection |
| `CHROMA_URL` | No | ChromaDB URL |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `CLOUDFLARE_API_TOKEN` | No | Cloudflare Pages deploy token |

## Project Structure

```
webapp/
  src/
    index.ts              # Main server entry
    agent/
      orchestrator.ts     # Graph-based ReAct orchestrator
    llm/
      router.ts           # MoE LLM router (6 providers)
    rag/
      pipeline.ts         # Hybrid RAG (chunk, embed, search, RRF)
    genui/
      engine.ts           # SSE writer + component registry
    routes/
      chat.ts             # Chat SSE endpoint
      rag.ts              # RAG ingest/search API
      workspace.ts        # File/workspace management
      system.ts           # Status, tools, models, costs
      auth.ts             # JWT auth
      websocket.ts        # WebSocket real-time events
    tools/
      registry.ts         # Tool registry singleton
      index.ts            # Tool loader
      file/               # File operations (8 tools)
      shell/              # Shell + npm (4 tools)
      git/                # Git operations (7 tools)
      github/             # GitHub API (6 tools)
      deploy/             # Cloudflare/Vercel (4 tools)
      web/                # Search/scrape/fetch (3 tools)
      code/               # Analyze/generate/test (5 tools)
      db/                 # SQL query/execute/schema (3 tools)
      rag/                # RAG tools (4 tools)
    database/
      client.ts           # PostgreSQL pool
      redis.ts            # Redis client + cache + rate limiter
      migrate.ts          # Migration runner
      seed.ts             # Seed data
    config/
      index.ts            # All configuration + model registry
    types/
      index.ts            # TypeScript type definitions
    utils/
      index.ts            # Logger, ID gen, retry, encrypt, cost tracker
  public/
    index.html            # GenUI dashboard
    static/js/app.js      # Frontend application
  migrations/
    001_initial_schema.sql # PostgreSQL schema
  docker-compose.yml      # Full stack (PG + Redis + Chroma + App)
  Dockerfile              # Multi-stage production build
  ecosystem.config.cjs    # PM2 configuration
```

## What's Not Yet Implemented

- Full conversation persistence to PostgreSQL (currently in-memory)
- LLM-powered query expansion in RAG (currently keyword-based)
- Cross-encoder reranking model for RAG
- WebSocket-driven human-in-the-loop approval UI (currently auto-approves)
- Multi-user isolation (workspaces are shared)
- File watcher (chokidar integration for live file change events)
- Background job queue (BullMQ is installed but not wired)
- Image/vision tools
- Rate limiting middleware per user
- Production deployment to Cloudflare (this is a Node.js app, not edge)

## Recommended Next Steps

1. Add conversation persistence (save/load from PostgreSQL)
2. Implement WebSocket approval UI in the dashboard
3. Wire BullMQ for background document ingestion
4. Add per-user workspace isolation
5. Add LLM-powered query expansion for RAG
6. Implement file watcher for real-time workspace sync
7. Add vision/image analysis tool support
8. Rate-limit API endpoints per user

## Deployment

- **Platform**: Self-hosted Node.js (Docker recommended)
- **Status**: Running
- **Last Updated**: 2026-03-24
