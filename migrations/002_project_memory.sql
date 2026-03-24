-- ============================================================
-- PROJECT MEMORY HUB — Persistent embeddings & context
-- Migration 002
-- ============================================================

-- ============================================================
-- DECISIONS TABLE — Architecture / implementation decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS decisions (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(255) NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'architecture','implementation','fix','dependency','config','refactor','deploy'
  )),
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  reasoning TEXT,
  files JSONB DEFAULT '[]',
  agent_type VARCHAR(30),
  outcome VARCHAR(20) CHECK (outcome IN ('success','failure','partial')),
  tags JSONB DEFAULT '[]',
  embedding_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTEXT_FACTS TABLE — Persistent knowledge about the project
-- ============================================================
CREATE TABLE IF NOT EXISTS context_facts (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(255) NOT NULL,
  category VARCHAR(30) NOT NULL CHECK (category IN (
    'tech_stack','architecture','convention','constraint','preference','environment'
  )),
  fact TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.5,
  source VARCHAR(255),
  embedding_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FILE_INDEX TABLE — Indexed project files with summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS file_index (
  path VARCHAR(1024) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  language VARCHAR(30),
  size_bytes INTEGER DEFAULT 0,
  last_modified BIGINT,
  summary TEXT,
  exports JSONB DEFAULT '[]',
  imports JSONB DEFAULT '[]',
  chunk_ids JSONB DEFAULT '[]',
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (workspace_id, path)
);

-- ============================================================
-- MEMORY_EMBEDDINGS TABLE — Vector references for ChromaDB
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(30) NOT NULL CHECK (source_type IN (
    'file','decision','fact','conversation_summary'
  )),
  source_id VARCHAR(64) NOT NULL,
  content_preview TEXT,
  chroma_id VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON decisions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(type);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_tags ON decisions USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_context_facts_workspace ON context_facts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_context_facts_category ON context_facts(category);

CREATE INDEX IF NOT EXISTS idx_file_index_workspace ON file_index(workspace_id);
CREATE INDEX IF NOT EXISTS idx_file_index_language ON file_index(language);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_workspace ON memory_embeddings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_source ON memory_embeddings(source_type, source_id);

-- Full text search on decisions
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS tsvector_content TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_decisions_fts ON decisions USING GIN (tsvector_content);

-- Full text search on facts
ALTER TABLE context_facts ADD COLUMN IF NOT EXISTS tsvector_content TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_facts_fts ON context_facts USING GIN (tsvector_content);

-- Trigger for decisions FTS
CREATE OR REPLACE FUNCTION update_decision_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tsvector_content = to_tsvector('english', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'') || ' ' || COALESCE(NEW.reasoning,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decisions_tsvector ON decisions;
CREATE TRIGGER trg_decisions_tsvector
  BEFORE INSERT OR UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION update_decision_tsvector();

-- Trigger for facts FTS
CREATE OR REPLACE FUNCTION update_fact_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tsvector_content = to_tsvector('english', COALESCE(NEW.fact,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facts_tsvector ON context_facts;
CREATE TRIGGER trg_facts_tsvector
  BEFORE INSERT OR UPDATE ON context_facts
  FOR EACH ROW EXECUTE FUNCTION update_fact_tsvector();
