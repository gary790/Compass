# Agentic RAG Platform

A self-hosted AI development platform with Mixture-of-Experts LLM routing, hybrid RAG search, 45+ tools, GenUI streaming dashboard, and one-click deployment to Cloudflare/Vercel.

## Quick Start

### Option A: Docker Compose (Recommended)

```bash
# 1. Clone and configure
git clone <your-repo-url>
cd agentic-rag-platform
cp .env.example .env
# Edit .env and add your API keys (at minimum OPENAI_API_KEY)

# 2. Start all services
docker-compose up -d

# 3. Run migrations and seed
docker-compose exec app npx tsx src/database/migrate.ts
docker-compose exec app npx tsx src/database/seed.ts

# 4. Open dashboard
open http://localhost:3000
```

### Option B: Local Development (without Docker)

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16, Redis 7, ChromaDB

# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Configure environment
cp .env.example .env
# Edit .env with your database URLs and API keys

# 3. Run migrations
npx tsx src/database/migrate.ts
npx tsx src/database/seed.ts

# 4. Start the server
npx tsx src/index.ts
# Or with PM2:
pm2 start ecosystem.config.cjs
```

## Architecture

```
                    Frontend (GenUI Dashboard)
                    |  Chat  |  Agent Trace  |  File Explorer  |  Terminal  |  Preview  |
                    =========================================================================
                                          SSE / REST / WebSocket
                    =========================================================================
                              Hono Server (Node.js)
                    =========================================================================
                    |   Chat API   |   RAG API   |   Workspace API   |   Auth API   |   System API   |
                    =========================================================================
                              Agent Engine
                    |   Graph Orchestrator   |   MoE LLM Router   |   Tool Registry   |   ReAct Loop   |
                    =========================================================================
                    |  OpenAI  |  Anthropic  |  Google  |  Mistral  |  Groq  |  Ollama  |
                    =========================================================================
                    |  PostgreSQL  |  Redis  |  ChromaDB  |  Filesystem  |
```

## Features

### Core Engine
- **Graph Orchestrator** — ReAct loop with planning, execution, review cycle
- **Mixture-of-Experts Router** — Routes tasks to the best LLM based on task type
- **Tool Registry** — 45 tools across 10 categories with Zod validation
- **Human-in-the-Loop** — Approval gates for dangerous operations

### Multi-LLM Support (6 Providers, 14 Models)
| Provider | Models | Best For |
|----------|--------|----------|
| OpenAI | GPT-4o, GPT-4o Mini, text-embedding-3-small | Code generation, planning, tool use |
| Anthropic | Claude 3.5 Sonnet, Claude 3.5 Haiku | Code review, safety analysis, long context |
| Google | Gemini 2.0 Flash, Gemini 2.0 Pro | Multimodal, huge context windows |
| Mistral | Mistral Large, Mistral Small | Multilingual, cost-efficient |
| Groq | Llama 3.1 70B, Llama 3.1 8B | Ultra-fast inference |
| Ollama | Any local model | Privacy, offline, no API costs |

### RAG Pipeline (Hybrid Search)
- **Chunking** — Semantic-aware splitter (heading-based + sentence-level)
- **Embeddings** — OpenAI text-embedding-3-small (or Ollama local)
- **Vector Search** — ChromaDB with cosine similarity
- **BM25 Search** — PostgreSQL full-text search with ts_rank_cd
- **Reciprocal Rank Fusion** — Merges vector + BM25 with configurable weights
- **Document Management** — Ingest, search, list, delete via API

### Tool Registry (45 Tools, 10 Categories)

| Category | Tools | Count |
|----------|-------|-------|
| **File** | read, write, edit, delete, search, info, create_dir, list_dir | 8 |
| **Shell** | exec, npm_install, npm_run, process_list | 4 |
| **System** | system_info | 1 |
| **Git** | init, status, commit, log, diff, push, branch | 7 |
| **GitHub** | create_repo, list_repos, read_file, edit_file, create_pr, list_issues | 6 |
| **Deploy** | cloudflare, vercel, status, preview | 4 |
| **Web** | search, scrape, fetch | 3 |
| **Code** | analyze, explain, generate, test, refactor | 5 |
| **Database** | query, execute, schema | 3 |
| **RAG** | ingest, query, list_docs, delete_doc | 4 |

### GenUI Dashboard
- **Streaming Chat** — Real-time SSE-based response streaming
- **Agent Trace Viewer** — Watch the AI think, call tools, and reason
- **File Explorer** — Interactive workspace file tree
- **Terminal** — Execute commands through the agent
- **Live Preview** — Preview deployed sites in-app
- **RAG Manager** — Ingest and manage knowledge base documents
- **Settings** — Configure LLM provider, approval mode, budget limits
- **Dark Mode** — Full dark theme with smooth animations

## API Endpoints

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send message (SSE streaming response) |
| GET | `/api/chat/conversations` | List conversations |
| GET | `/api/chat/:id/history` | Get conversation history |
| DELETE | `/api/chat/:id` | Delete conversation |

### RAG
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rag/ingest` | Ingest document into knowledge base |
| POST | `/api/rag/search` | Search knowledge base (hybrid/vector/bm25) |
| GET | `/api/rag/documents` | List all documents |
| DELETE | `/api/rag/documents/:id` | Delete document |

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
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login (returns JWT) |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/settings` | Update settings |
| PUT | `/api/auth/api-keys` | Save encrypted API keys |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/system/status` | Platform status |
| GET | `/api/system/models` | Available LLM models |
| GET | `/api/system/tools` | Registered tools |
| GET | `/api/system/costs` | Usage and cost tracking |
| GET | `/api/system/config` | Non-sensitive configuration |

## Data Architecture

### PostgreSQL Schema
- `users` — Accounts with encrypted API keys and settings
- `conversations` — Chat sessions with token/cost tracking
- `messages` — Individual messages with tool calls
- `documents` — RAG knowledge base documents
- `chunks` — Document chunks with full-text search (tsvector)
- `deployments` — Deployment history
- `agent_sessions` — Agent execution audit trail
- `tool_executions` — Tool call audit trail
- `api_key_usage` — Per-model cost tracking

### ChromaDB Collections
- `agentic_rag_docs` — Document embeddings (cosine similarity)

### Redis
- LLM response caching (1-hour TTL)
- Rate limiting (sliding window)
- Session storage

## Project Structure

```
agentic-rag-platform/
├── src/
│   ├── index.ts              # Hono server entry point
│   ├── agent/
│   │   └── orchestrator.ts   # ReAct loop + MoE dispatch
│   ├── llm/
│   │   └── router.ts         # Multi-provider LLM router (6 providers)
│   ├── rag/
│   │   └── pipeline.ts       # Ingest, chunk, embed, hybrid search
│   ├── genui/
│   │   └── engine.ts         # SSE stream writer + component registry
│   ├── tools/
│   │   ├── registry.ts       # Central tool registry with Zod validation
│   │   ├── file/             # 8 file operation tools
│   │   ├── shell/            # Shell, npm, process tools
│   │   ├── git/              # 7 git operation tools
│   │   ├── github/           # 6 GitHub API tools
│   │   ├── deploy/           # Cloudflare + Vercel deployment
│   │   ├── web/              # Search, scrape, fetch
│   │   ├── code/             # Analyze, generate, test, refactor
│   │   ├── db/               # PostgreSQL query tools
│   │   └── rag/              # RAG search and ingest tools
│   ├── routes/
│   │   ├── chat.ts           # SSE streaming chat
│   │   ├── rag.ts            # Knowledge base management
│   │   ├── workspace.ts      # File explorer API
│   │   ├── auth.ts           # JWT authentication
│   │   └── system.ts         # Status, models, tools, costs
│   ├── database/
│   │   ├── client.ts         # PostgreSQL connection pool
│   │   ├── redis.ts          # Redis cache + rate limiter
│   │   ├── migrate.ts        # Migration runner
│   │   ├── seed.ts           # Database seeder
│   │   └── reset.ts          # Database reset
│   ├── config/
│   │   └── index.ts          # All configuration + model registry
│   ├── types/
│   │   └── index.ts          # Full TypeScript type definitions
│   └── utils/
│       └── index.ts          # Logger, encryption, cost tracker
├── public/
│   ├── index.html            # GenUI dashboard (full SPA)
│   └── static/js/app.js      # Frontend application (607 lines)
├── migrations/
│   └── 001_initial_schema.sql
├── docker-compose.yml        # Full stack: app + PG + Redis + Chroma
├── Dockerfile                # Multi-stage production build
├── ecosystem.config.cjs      # PM2 process manager config
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Configuration

All configuration is through environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `OPENAI_API_KEY` | — | OpenAI API key (required for default config) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `GOOGLE_AI_API_KEY` | — | Google AI API key |
| `GROQ_API_KEY` | — | Groq API key |
| `MISTRAL_API_KEY` | — | Mistral API key |
| `OLLAMA_BASE_URL` | localhost:11434 | Local Ollama instance |
| `DATABASE_URL` | postgresql://... | PostgreSQL connection |
| `REDIS_URL` | redis://localhost:6379 | Redis connection |
| `CHROMA_URL` | http://localhost:8000 | ChromaDB URL |
| `GITHUB_TOKEN` | — | GitHub personal access token |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare API token |
| `VERCEL_TOKEN` | — | Vercel deployment token |
| `AGENT_MAX_ITERATIONS` | 25 | Max ReAct loop iterations |
| `ENABLE_AUTH` | false | Enable JWT authentication |

## Hardware Requirements

| Tier | CPU | RAM | GPU | Cost | Use Case |
|------|-----|-----|-----|------|----------|
| **API-Only** | 4-core | 8 GB | None | $20-40/mo VPS | Cloud LLM APIs only |
| **Hybrid** | 8-core | 32 GB | RTX 3060 12GB | $800-1200 build | API + local small models |
| **Full Local** | 16-core | 64 GB | RTX 4090 24GB | $3.5k-5k build | Run all models locally |

## Deployment Options

### Home Server (Docker + Cloudflare Tunnel)
```bash
docker-compose up -d
cloudflared tunnel --url http://localhost:3000
```

### VPS (Docker + Let's Encrypt)
```bash
docker-compose up -d
# Configure reverse proxy (nginx/caddy) with SSL
```

### Hybrid (VPS app + Home GPU)
```bash
# VPS: docker-compose up -d
# Home: ollama serve
# Connect via WireGuard/Cloudflare Tunnel
```

## License

MIT
