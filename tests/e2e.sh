#!/bin/bash
# ============================================================
# AGENTIC RAG PLATFORM — End-to-End Test Suite v1.9.0
# Tests all major features: API, DB, Redis, ChromaDB, RAG, Tools
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

assert_ok() {
  local name="$1"
  local url="$2"
  local expected="$3"
  TOTAL=$((TOTAL+1))
  local response
  response=$(curl -sf "$url" 2>/dev/null) || { echo -e "${RED}  FAIL${NC} $name — HTTP error"; FAIL=$((FAIL+1)); return; }
  if [ -n "$expected" ]; then
    if echo "$response" | grep -q "$expected"; then
      echo -e "${GREEN}  PASS${NC} $name"
      PASS=$((PASS+1))
    else
      echo -e "${RED}  FAIL${NC} $name — expected '$expected'"
      FAIL=$((FAIL+1))
    fi
  else
    echo -e "${GREEN}  PASS${NC} $name"
    PASS=$((PASS+1))
  fi
}

assert_post() {
  local name="$1"
  local url="$2"
  local data="$3"
  local expected="$4"
  TOTAL=$((TOTAL+1))
  local response
  response=$(curl -sf -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null) || { echo -e "${RED}  FAIL${NC} $name — HTTP error"; FAIL=$((FAIL+1)); return; }
  if [ -n "$expected" ]; then
    if echo "$response" | grep -q "$expected"; then
      echo -e "${GREEN}  PASS${NC} $name"
      PASS=$((PASS+1))
    else
      echo -e "${RED}  FAIL${NC} $name — expected '$expected'"
      FAIL=$((FAIL+1))
    fi
  else
    echo -e "${GREEN}  PASS${NC} $name"
    PASS=$((PASS+1))
  fi
}

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Agentic RAG Platform — E2E Test Suite v1.9.0${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo ""

# ── HEALTH & STATUS ──────────────────────────────────────
echo -e "${YELLOW}[1/10] Health & Status${NC}"
assert_ok "GET /api/health returns ok" "$BASE_URL/api/health" '"status":"ok"'
assert_ok "GET /api/health version 1.9.0" "$BASE_URL/api/health" '"version":"1.9.0"'
assert_ok "GET /api/system/status success" "$BASE_URL/api/system/status" '"success":true'
assert_ok "GET /api/system/status version" "$BASE_URL/api/system/status" '"version":"1.9.0"'
assert_ok "Status reports running" "$BASE_URL/api/system/status" '"status":"running"'

# ── DATABASE CONNECTION ──────────────────────────────────
echo -e "${YELLOW}[2/10] Database Connection${NC}"
assert_ok "PostgreSQL connected" "$BASE_URL/api/system/status" '"database":"connected"'
assert_ok "Redis connected" "$BASE_URL/api/system/status" '"redis":"connected"'
# ChromaDB is optional (heavy on memory) - check it's reported
TOTAL=$((TOTAL+1))
CHROMA_STATUS=$(curl -sf "$BASE_URL/api/system/status" 2>/dev/null | grep -o '"chromadb":"[^"]*"')
if echo "$CHROMA_STATUS" | grep -q '"chromadb"'; then
  echo -e "${GREEN}  PASS${NC} ChromaDB status reported ($CHROMA_STATUS)"
  PASS=$((PASS+1))
else
  echo -e "${RED}  FAIL${NC} ChromaDB status not reported"
  FAIL=$((FAIL+1))
fi

# ── TOOLS REGISTRY ───────────────────────────────────────
echo -e "${YELLOW}[3/10] Tool Registry${NC}"
assert_ok "GET /api/system/tools" "$BASE_URL/api/system/tools" '"success":true'
assert_ok "60 tools registered" "$BASE_URL/api/system/tools" '"totalCount":60'
assert_ok "Tool categories present" "$BASE_URL/api/system/tools" '"categories"'

# ── LLM MODELS ───────────────────────────────────────────
echo -e "${YELLOW}[4/10] LLM Models${NC}"
assert_ok "GET /api/system/models" "$BASE_URL/api/system/models" '"success":true'
assert_ok "Models include routing config" "$BASE_URL/api/system/models" '"routing"'
assert_ok "Provider list present" "$BASE_URL/api/system/models" '"providers"'

# ── COST TRACKING ────────────────────────────────────────
echo -e "${YELLOW}[5/10] Cost Tracking${NC}"
assert_ok "GET /api/system/costs" "$BASE_URL/api/system/costs" '"success":true'
assert_ok "Session total present" "$BASE_URL/api/system/costs" '"sessionTotal"'
assert_ok "Models breakdown present" "$BASE_URL/api/system/costs" '"models"'

# ── PERFORMANCE METRICS ──────────────────────────────────
echo -e "${YELLOW}[6/10] Performance Metrics${NC}"
assert_ok "GET /api/system/performance" "$BASE_URL/api/system/performance" '"success":true'
assert_ok "P95 latency metric" "$BASE_URL/api/system/performance" '"p95LatencyMs"'
assert_ok "Total requests metric" "$BASE_URL/api/system/performance" '"totalRequests"'

# ── WORKSPACE ────────────────────────────────────────────
echo -e "${YELLOW}[7/10] Workspace${NC}"
assert_ok "GET /api/workspace" "$BASE_URL/api/workspace" '"success"'
assert_ok "GET /api/workspace/default/tree" "$BASE_URL/api/workspace/default/tree" '"success"'

# ── TERMINAL EXECUTION ───────────────────────────────────
echo -e "${YELLOW}[8/10] Terminal Execution${NC}"
assert_post "POST /api/system/terminal/exec (echo test)" "$BASE_URL/api/system/terminal/exec" '{"command":"echo hello-e2e"}' 'hello-e2e'
assert_post "POST /api/system/terminal/exec (ls)" "$BASE_URL/api/system/terminal/exec" '{"command":"ls -la"}' 'exitCode'

# ── GIT STATUS ───────────────────────────────────────────
echo -e "${YELLOW}[9/10] Git & Deploy Status${NC}"
assert_ok "GET /api/system/git/status" "$BASE_URL/api/system/git/status" '"success":true'
assert_ok "GET /api/system/deploy/status" "$BASE_URL/api/system/deploy/status" '"success":true'

# ── RAG & MEMORY ─────────────────────────────────────────
echo -e "${YELLOW}[10/10] RAG & Memory${NC}"
assert_ok "GET /api/rag/documents" "$BASE_URL/api/rag/documents" '"success"'
assert_ok "GET /api/memory/snapshot" "$BASE_URL/api/memory/snapshot" ''
assert_ok "GET /api/memory/facts" "$BASE_URL/api/memory/facts" ''

# ── FRONTEND ─────────────────────────────────────────────
echo -e "${YELLOW}[Bonus] Frontend${NC}"
TOTAL=$((TOTAL+1))
HTML=$(curl -sf "$BASE_URL/" 2>/dev/null) || { echo -e "${RED}  FAIL${NC} Frontend HTML load"; FAIL=$((FAIL+1)); }
if echo "$HTML" | grep -q "Agentic RAG Platform"; then
  echo -e "${GREEN}  PASS${NC} Frontend HTML loads with title"
  PASS=$((PASS+1))
else
  echo -e "${RED}  FAIL${NC} Frontend HTML missing title"
  FAIL=$((FAIL+1))
fi

TOTAL=$((TOTAL+1))
JS=$(curl -sf "$BASE_URL/static/js/app.js" 2>/dev/null) || { echo -e "${RED}  FAIL${NC} Frontend JS load"; FAIL=$((FAIL+1)); }
if [ -n "$JS" ]; then
  echo -e "${GREEN}  PASS${NC} Frontend JS loads (/static/js/app.js)"
  PASS=$((PASS+1))
else
  echo -e "${RED}  FAIL${NC} Frontend JS empty or missing"
  FAIL=$((FAIL+1))
fi

# ── RESULTS ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
PCT=$((PASS * 100 / TOTAL))
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}  ALL TESTS PASSED: $PASS/$TOTAL (${PCT}%)${NC}"
else
  echo -e "${RED}  RESULTS: $PASS passed, $FAIL failed out of $TOTAL (${PCT}%)${NC}"
fi
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo ""

exit $FAIL
