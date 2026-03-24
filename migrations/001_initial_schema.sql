-- ============================================================
-- AGENTIC RAG PLATFORM — PostgreSQL Schema
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  api_keys JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{
    "defaultProvider": "openai",
    "defaultModel": "gpt-4o",
    "theme": "dark",
    "approvalMode": "dangerous",
    "maxBudgetPerDay": 10
  }',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id VARCHAR(64),
  title VARCHAR(500) DEFAULT 'New Conversation',
  model VARCHAR(100),
  total_tokens BIGINT DEFAULT 0,
  total_cost_usd NUMERIC(10, 6) DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MESSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_call_id VARCHAR(64),
  tokens_used INTEGER DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  model VARCHAR(100),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DOCUMENTS TABLE (RAG Knowledge Base)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  source_url TEXT,
  source_type VARCHAR(20) NOT NULL DEFAULT 'text'
    CHECK (source_type IN ('pdf', 'markdown', 'html', 'text', 'code', 'url')),
  content TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  tsvector_content TSVECTOR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHUNKS TABLE (RAG Chunks with BM25 support)
-- ============================================================
CREATE TABLE IF NOT EXISTS chunks (
  id VARCHAR(64) PRIMARY KEY,
  document_id VARCHAR(64) REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  tsvector_content TSVECTOR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DEPLOYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployments (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64),
  user_id UUID REFERENCES users(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('cloudflare', 'vercel')),
  project_name VARCHAR(255) NOT NULL,
  url TEXT,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'building', 'deploying', 'live', 'failed')),
  build_logs TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- AGENT SESSIONS TABLE (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_sessions (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  workspace_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'running'
    CHECK (status IN ('running', 'complete', 'failed', 'aborted')),
  iterations INTEGER DEFAULT 0,
  tools_used JSONB DEFAULT '[]',
  models_used JSONB DEFAULT '[]',
  total_tokens BIGINT DEFAULT 0,
  total_cost_usd NUMERIC(10, 6) DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- TOOL EXECUTIONS TABLE (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_executions (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  arguments JSONB DEFAULT '{}',
  output JSONB,
  success BOOLEAN DEFAULT true,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- API KEY USAGE TABLE (cost tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_key_usage (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_documents_tsvector ON documents USING GIN (tsvector_content);
CREATE INDEX IF NOT EXISTS idx_chunks_tsvector ON chunks USING GIN (tsvector_content);

-- Foreign key indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation_id ON agent_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session_id ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_user_id ON api_key_usage(user_id);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created_at ON api_key_usage(created_at);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
