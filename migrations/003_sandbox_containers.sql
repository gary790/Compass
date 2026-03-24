-- ============================================================
-- SANDBOX CONTAINERS — Docker container per workspace isolation
-- Migration 003
-- ============================================================

-- ============================================================
-- SANDBOX_CONTAINERS TABLE — One container per workspace
-- ============================================================
CREATE TABLE IF NOT EXISTS sandbox_containers (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(255) NOT NULL UNIQUE,
  container_id VARCHAR(128),                -- Docker container ID (64-char hex)
  container_name VARCHAR(128) NOT NULL,     -- Human-readable: sandbox-{workspace_id}
  image VARCHAR(255) NOT NULL DEFAULT 'agentic-sandbox:latest',
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','creating','running','paused','stopping','stopped','failed','destroyed'
  )),
  -- Network isolation
  network_id VARCHAR(128),                  -- Docker network ID
  ip_address VARCHAR(45),                   -- Container internal IP
  allocated_port INTEGER,                   -- Host-mapped port for preview
  -- Resource limits
  cpu_limit NUMERIC(4,2) DEFAULT 1.0,       -- CPU cores (e.g. 0.5, 1.0, 2.0)
  memory_limit_mb INTEGER DEFAULT 512,      -- Memory in MB
  disk_limit_mb INTEGER DEFAULT 1024,       -- Disk quota in MB
  pids_limit INTEGER DEFAULT 256,           -- Max process count
  -- Runtime metrics (last snapshot)
  cpu_usage_percent NUMERIC(5,2) DEFAULT 0,
  memory_usage_mb INTEGER DEFAULT 0,
  disk_usage_mb INTEGER DEFAULT 0,
  process_count INTEGER DEFAULT 0,
  -- Lifecycle timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  -- Configuration
  environment JSONB DEFAULT '{}',           -- Env vars passed to container
  labels JSONB DEFAULT '{}',                -- Docker labels
  volumes JSONB DEFAULT '[]',               -- Volume mount specs
  -- Error tracking
  last_error TEXT,
  restart_count INTEGER DEFAULT 0,
  max_restarts INTEGER DEFAULT 5
);

-- ============================================================
-- SANDBOX_EVENTS TABLE — Audit log for container lifecycle events
-- ============================================================
CREATE TABLE IF NOT EXISTS sandbox_events (
  id VARCHAR(64) PRIMARY KEY,
  sandbox_id VARCHAR(64) NOT NULL REFERENCES sandbox_containers(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
    'created','started','stopped','paused','resumed','restarted',
    'health_check','resource_alert','error','destroyed',
    'exec_start','exec_complete','exec_error'
  )),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SANDBOX_EXEC_LOG TABLE — Command execution history per container
-- ============================================================
CREATE TABLE IF NOT EXISTS sandbox_exec_log (
  id VARCHAR(64) PRIMARY KEY,
  sandbox_id VARCHAR(64) NOT NULL REFERENCES sandbox_containers(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  user_id VARCHAR(64),
  tool_name VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sandbox_workspace ON sandbox_containers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_status ON sandbox_containers(status);
CREATE INDEX IF NOT EXISTS idx_sandbox_last_active ON sandbox_containers(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_port ON sandbox_containers(allocated_port) WHERE allocated_port IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sandbox_events_sandbox ON sandbox_events(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_events_type ON sandbox_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sandbox_events_created ON sandbox_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sandbox_exec_sandbox ON sandbox_exec_log(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_exec_created ON sandbox_exec_log(created_at DESC);
