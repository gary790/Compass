// ============================================================
// AGENTIC RAG PLATFORM — Frontend v1.9 (Maximum Performance)
// Layout: Narrow sidebar | Chat pane | Workspace pane
// ============================================================

let currentConversationId = null;
let currentWorkspace = 'default';
let isStreaming = false;
let totalTokens = 0;
let totalCost = 0;
let ws = null;
let wsReconnectTimer = null;
let wsReconnectAttempt = 0;
let activeSidebar = null;
let activeWorkspaceTab = 'preview';
let conversationList = [];
let streamedText = '';  // Accumulates streamed text tokens for markdown rendering

document.addEventListener('DOMContentLoaded', () => {
  loadWorkspaces();
  loadWorkspace('default');
  loadRAGDocs();
  loadSystemInfo();
  connectWebSocket();
  setupResizeHandle();
  loadConversationList();
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });
});

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================
function switchSidebar(name) {
  const panel = document.getElementById('sidePanel');
  const title = document.getElementById('sidePanelTitle');
  const content = document.getElementById('sidePanelContent');

  // Toggle off if clicking the same sidebar button again
  if (activeSidebar === name) {
    closeSidePanel();
    return;
  }

  // Highlight active button
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sidebar-btn[data-sidebar="${name}"]`);
  if (btn) btn.classList.add('active');

  activeSidebar = name;

  // Remove panel-hidden class and show panel (class has !important so inline style alone won't work)
  panel.classList.remove('panel-hidden');
  panel.style.display = 'flex';

  // "chat" = show conversation history panel
  if (name === 'chat') {
    title.textContent = 'Conversations';
    content.innerHTML = buildConversationListPanel();
    loadConversationList();
    return;
  }

  switch (name) {
    case 'agents':
      title.textContent = 'Agents';
      content.innerHTML = buildAgentsPanel();
      break;
    case 'explorer':
      title.textContent = 'File Explorer';
      content.innerHTML = buildExplorerSideContent();
      refreshSideFileTree();
      break;
    case 'rag':
      title.textContent = 'Knowledge Base';
      content.innerHTML = buildRAGSideContent();
      loadRAGDocs();
      break;
    case 'tools':
      title.textContent = 'Tools';
      content.innerHTML = '<div class="text-xs text-gray-400 py-4">Loading tools...</div>';
      loadToolsList();
      break;
    case 'memory':
      title.textContent = 'Project Memory';
      content.innerHTML = buildMemoryPanel();
      loadMemoryData();
      break;
    case 'sandbox':
      title.textContent = 'Sandbox Isolation';
      content.innerHTML = buildSandboxPanel();
      loadSandboxData();
      break;
    case 'workflows':
      title.textContent = 'Workflows';
      content.innerHTML = buildWorkflowsPanel();
      break;
  }
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.add('panel-hidden');
  panel.style.display = '';
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  activeSidebar = null;
}

// ============================================================
// MEMORY HUB PANEL
// ============================================================
function buildMemoryPanel() {
  return `
    <div class="space-y-3">
      <!-- Stats Summary -->
      <div id="memoryStats" class="grid grid-cols-2 gap-2">
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-indigo-600" id="memStatFiles">—</div>
          <div class="text-[10px] text-gray-400">Files</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-violet-600" id="memStatDecisions">—</div>
          <div class="text-[10px] text-gray-400">Decisions</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-emerald-600" id="memStatFacts">—</div>
          <div class="text-[10px] text-gray-400">Facts</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-amber-600" id="memStatEmbedded">—</div>
          <div class="text-[10px] text-gray-400">Embedded</div>
        </div>
      </div>

      <!-- Scan Button -->
      <button onclick="scanWorkspaceMemory()" class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium transition">
        <i class="fas fa-sync-alt" id="memoryScanIcon"></i>
        <span id="memoryScanLabel">Scan Workspace</span>
      </button>

      <!-- Semantic Search -->
      <div class="relative">
        <input id="memorySearchInput" type="text" placeholder="Search memory..." 
          class="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-300"
          onkeydown="if(event.key==='Enter')searchMemory()">
        <i class="fas fa-search absolute left-2.5 top-2.5 text-gray-300 text-xs"></i>
      </div>
      <div id="memorySearchResults" class="space-y-1 hidden"></div>

      <!-- Tech Stack -->
      <div class="border-t border-gray-100 pt-2">
        <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Tech Stack</div>
        <div id="memoryTechStack" class="text-xs text-gray-500">Not scanned yet</div>
      </div>

      <!-- Facts List -->
      <div class="border-t border-gray-100 pt-2">
        <div class="flex items-center justify-between mb-1">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Context Facts</div>
          <button onclick="toggleAddFact()" class="text-[10px] text-indigo-500 hover:text-indigo-700"><i class="fas fa-plus"></i></button>
        </div>
        <div id="addFactForm" class="hidden mb-2 space-y-1">
          <select id="factCategory" class="w-full text-xs border border-gray-200 rounded px-2 py-1">
            <option value="convention">Convention</option>
            <option value="architecture">Architecture</option>
            <option value="constraint">Constraint</option>
            <option value="preference">Preference</option>
            <option value="tech_stack">Tech Stack</option>
            <option value="environment">Environment</option>
          </select>
          <input id="factText" type="text" placeholder="e.g. API uses camelCase JSON" class="w-full text-xs border border-gray-200 rounded px-2 py-1">
          <button onclick="addMemoryFact()" class="w-full text-xs bg-indigo-500 text-white rounded px-2 py-1 hover:bg-indigo-600">Add Fact</button>
        </div>
        <div id="memoryFactsList" class="space-y-1 max-h-40 overflow-y-auto"></div>
      </div>

      <!-- Decision Timeline -->
      <div class="border-t border-gray-100 pt-2">
        <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Recent Decisions</div>
        <div id="memoryDecisionsList" class="space-y-1 max-h-48 overflow-y-auto"></div>
      </div>
    </div>
  `;
}

function loadMemoryData() {
  // Load snapshot
  fetch('/api/memory/snapshot?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'))
    .then(r => r.json()).then(res => {
      if (!res.success) return;
      const d = res.data;
      const el = id => document.getElementById(id);
      if (el('memStatFiles')) el('memStatFiles').textContent = d.stats.totalFiles;
      if (el('memStatDecisions')) el('memStatDecisions').textContent = d.stats.totalDecisions;
      if (el('memStatFacts')) el('memStatFacts').textContent = d.stats.totalFacts;
      if (el('memStatEmbedded')) el('memStatEmbedded').textContent = d.stats.indexedFiles;
      // Tech stack
      if (d.techStack && el('memoryTechStack')) {
        const ts = d.techStack;
        const parts = [];
        if (ts.frameworks.length) parts.push('<span class="text-indigo-600">' + ts.frameworks.join(', ') + '</span>');
        if (ts.languages.length) parts.push(ts.languages.join(', '));
        if (ts.databases.length) parts.push('<span class="text-emerald-600">' + ts.databases.join(', ') + '</span>');
        if (ts.deployTarget) parts.push('<span class="text-amber-600">' + ts.deployTarget + '</span>');
        el('memoryTechStack').innerHTML = parts.join(' · ') || 'Not detected';
      }
    }).catch(() => {});

  // Load facts
  fetch('/api/memory/facts?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'))
    .then(r => r.json()).then(res => {
      if (!res.success || !res.data) return;
      const list = document.getElementById('memoryFactsList');
      if (!list) return;
      if (res.data.length === 0) {
        list.innerHTML = '<div class="text-xs text-gray-400 italic">No facts yet</div>';
        return;
      }
      const catColors = { tech_stack:'bg-blue-50 text-blue-700', architecture:'bg-purple-50 text-purple-700', convention:'bg-green-50 text-green-700', constraint:'bg-red-50 text-red-700', preference:'bg-yellow-50 text-yellow-700', environment:'bg-gray-100 text-gray-700' };
      list.innerHTML = res.data.slice(0, 30).map(f => `
        <div class="flex items-start gap-1.5 group">
          <span class="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${catColors[f.category] || 'bg-gray-100 text-gray-600'}">${f.category.replace('_',' ')}</span>
          <span class="text-xs text-gray-600 flex-1 leading-tight">${escapeHtml(f.fact)}</span>
          <button onclick="deleteFact('${f.id}')" class="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 text-[10px] shrink-0"><i class="fas fa-times"></i></button>
        </div>
      `).join('');
    }).catch(() => {});

  // Load decisions
  fetch('/api/memory/decisions?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default') + '&limit=20')
    .then(r => r.json()).then(res => {
      if (!res.success || !res.data) return;
      const list = document.getElementById('memoryDecisionsList');
      if (!list) return;
      if (res.data.length === 0) {
        list.innerHTML = '<div class="text-xs text-gray-400 italic">No decisions yet</div>';
        return;
      }
      const typeIcons = { architecture:'fa-sitemap', implementation:'fa-code', fix:'fa-wrench', dependency:'fa-box', config:'fa-cog', refactor:'fa-recycle', deploy:'fa-rocket' };
      const outcomeColors = { success:'text-green-500', failure:'text-red-500', partial:'text-amber-500' };
      list.innerHTML = res.data.map(d => {
        const icon = typeIcons[d.type] || 'fa-circle';
        const time = new Date(d.timestamp).toLocaleDateString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
        const outcomeIcon = d.outcome ? `<i class="fas ${d.outcome === 'success' ? 'fa-check-circle' : d.outcome === 'failure' ? 'fa-times-circle' : 'fa-exclamation-circle'} ${outcomeColors[d.outcome] || ''} text-[10px]"></i>` : '';
        return `
          <div class="flex items-start gap-1.5 py-1 border-b border-gray-50 last:border-0">
            <i class="fas ${icon} text-[10px] text-gray-400 mt-0.5 shrink-0"></i>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <span class="text-xs font-medium text-gray-700 truncate">${escapeHtml(d.title)}</span>
                ${outcomeIcon}
              </div>
              <div class="text-[10px] text-gray-400">${time}</div>
            </div>
          </div>
        `;
      }).join('');
    }).catch(() => {});
}

function scanWorkspaceMemory() {
  const icon = document.getElementById('memoryScanIcon');
  const label = document.getElementById('memoryScanLabel');
  if (icon) icon.className = 'fas fa-sync-alt fa-spin';
  if (label) label.textContent = 'Scanning...';

  fetch('/api/memory/scan?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'), { method: 'POST' })
    .then(r => r.json()).then(res => {
      if (icon) icon.className = 'fas fa-sync-alt';
      if (label) label.textContent = 'Scan Workspace';
      if (res.success) {
        loadMemoryData(); // refresh
      }
    }).catch(() => {
      if (icon) icon.className = 'fas fa-sync-alt';
      if (label) label.textContent = 'Scan Workspace';
    });
}

function searchMemory() {
  const input = document.getElementById('memorySearchInput');
  const resultsDiv = document.getElementById('memorySearchResults');
  if (!input || !resultsDiv) return;
  const query = input.value.trim();
  if (!query) { resultsDiv.classList.add('hidden'); return; }

  fetch('/api/memory/search?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK: 8 }),
  })
    .then(r => r.json()).then(res => {
      if (!res.success || !res.data || res.data.length === 0) {
        resultsDiv.innerHTML = '<div class="text-xs text-gray-400 italic py-1">No results</div>';
        resultsDiv.classList.remove('hidden');
        return;
      }
      const typeColors = { decision:'text-violet-600', fact:'text-emerald-600', file:'text-blue-600' };
      const typeIcons = { decision:'fa-gavel', fact:'fa-lightbulb', file:'fa-file-code' };
      resultsDiv.innerHTML = res.data.map(r => `
        <div class="flex items-start gap-1.5 py-1 border-b border-gray-50">
          <i class="fas ${typeIcons[r.type] || 'fa-circle'} ${typeColors[r.type] || 'text-gray-400'} text-[10px] mt-1 shrink-0"></i>
          <div class="flex-1 min-w-0">
            <div class="text-xs text-gray-700 leading-tight">${escapeHtml(r.content.substring(0, 120))}</div>
            <div class="text-[10px] text-gray-400">${r.type} · score: ${(r.score).toFixed(3)}</div>
          </div>
        </div>
      `).join('');
      resultsDiv.classList.remove('hidden');
    }).catch(() => {});
}

function toggleAddFact() {
  const form = document.getElementById('addFactForm');
  if (form) form.classList.toggle('hidden');
}

function addMemoryFact() {
  const category = document.getElementById('factCategory')?.value;
  const fact = document.getElementById('factText')?.value?.trim();
  if (!fact) return;

  fetch('/api/memory/facts?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, fact, confidence: 0.9, source: 'manual' }),
  })
    .then(r => r.json()).then(res => {
      if (res.success) {
        document.getElementById('factText').value = '';
        document.getElementById('addFactForm')?.classList.add('hidden');
        loadMemoryData();
      }
    }).catch(() => {});
}

function deleteFact(id) {
  fetch('/api/memory/facts/' + id + '?workspaceId=' + encodeURIComponent(currentWorkspace || './workspaces/default'), { method: 'DELETE' })
    .then(r => r.json()).then(res => {
      if (res.success) loadMemoryData();
    }).catch(() => {});
}

// ============================================================
// SANDBOX PANEL — Docker container isolation UI
// ============================================================
function buildSandboxPanel() {
  return `
    <div class="space-y-3">
      <!-- Docker Status -->
      <div id="sandboxDockerStatus" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
        <i class="fas fa-docker text-blue-500"></i>
        <span class="text-xs text-gray-500">Checking Docker...</span>
      </div>

      <!-- System Overview -->
      <div id="sandboxOverview" class="grid grid-cols-2 gap-2">
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-blue-600" id="sbxRunning">—</div>
          <div class="text-[10px] text-gray-400">Running</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-gray-600" id="sbxTotal">—</div>
          <div class="text-[10px] text-gray-400">Total</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-green-600" id="sbxCPU">—</div>
          <div class="text-[10px] text-gray-400">CPU %</div>
        </div>
        <div class="bg-white rounded-lg p-2 border border-gray-100 text-center">
          <div class="text-lg font-bold text-purple-600" id="sbxMemory">—</div>
          <div class="text-[10px] text-gray-400">Memory</div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-1">
        <button onclick="createSandbox()" class="flex-1 px-2 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition">
          <i class="fas fa-plus mr-1"></i>New Sandbox
        </button>
        <button onclick="loadSandboxData()" class="px-2 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>

      <!-- Container List -->
      <div class="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Containers</div>
      <div id="sandboxList" class="space-y-2">
        <div class="text-xs text-gray-400 py-4 text-center">Loading...</div>
      </div>

      <!-- Port Range Info -->
      <div id="sandboxPortInfo" class="text-[10px] text-gray-400 text-center pt-2 border-t border-gray-100">
        Preview ports: 4000-4100
      </div>
    </div>`;
}

async function loadSandboxData() {
  try {
    const resp = await fetch('/api/sandbox');
    const data = await resp.json();
    if (!data.success) return;

    const { overview, dockerAvailable, sandboxes } = data.data;

    // Docker status
    const statusEl = document.getElementById('sandboxDockerStatus');
    if (statusEl) {
      if (dockerAvailable) {
        statusEl.innerHTML = '<i class="fas fa-check-circle text-green-500"></i><span class="text-xs text-green-700 font-medium">Docker Connected</span><span class="text-[10px] text-gray-400 ml-auto">Isolation Active</span>';
        statusEl.className = 'flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-100';
      } else {
        statusEl.innerHTML = '<i class="fas fa-exclamation-triangle text-yellow-500"></i><span class="text-xs text-yellow-700 font-medium">Host Mode</span><span class="text-[10px] text-gray-400 ml-auto">No Docker</span>';
        statusEl.className = 'flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-100';
      }
    }

    // Overview stats
    if (overview) {
      const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setT('sbxRunning', overview.runningContainers);
      setT('sbxTotal', overview.totalContainers);
      setT('sbxCPU', overview.averageCPU.toFixed(1) + '%');
      setT('sbxMemory', overview.totalMemoryMB + 'MB');
    }

    // Container list
    const listEl = document.getElementById('sandboxList');
    if (!listEl) return;

    if (!sandboxes || sandboxes.length === 0) {
      listEl.innerHTML = '<div class="text-xs text-gray-400 py-4 text-center"><i class="fas fa-cube text-gray-300 text-2xl mb-2 block"></i>No sandbox containers.<br>Create one to enable isolation.</div>';
      return;
    }

    listEl.innerHTML = sandboxes.map(function(s) {
      var statusColors = {
        running: 'bg-green-500', stopped: 'bg-gray-400', paused: 'bg-yellow-500',
        failed: 'bg-red-500', creating: 'bg-blue-400', destroyed: 'bg-gray-300',
      };
      var dotColor = statusColors[s.status] || 'bg-gray-400';
      var isRunning = s.status === 'running';
      var cpu = s.metrics && s.metrics.cpuUsagePercent ? s.metrics.cpuUsagePercent.toFixed(1) : '0';
      var mem = s.metrics ? (s.metrics.memoryUsageMB || 0) : 0;
      var label = s.containerName || s.workspaceId;
      var badgeClass = isRunning ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500';

      var actions = '';
      if (isRunning) {
        actions = '<button onclick="sandboxAction(\'' + s.workspaceId + '\',\'stop\')" class="flex-1 text-[10px] px-1.5 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition"><i class="fas fa-stop mr-0.5"></i>Stop</button>' +
          '<button onclick="sandboxAction(\'' + s.workspaceId + '\',\'restart\')" class="flex-1 text-[10px] px-1.5 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition"><i class="fas fa-redo mr-0.5"></i>Restart</button>';
      } else {
        actions = '<button onclick="sandboxAction(\'' + s.workspaceId + '\',\'start\')" class="flex-1 text-[10px] px-1.5 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 transition"><i class="fas fa-play mr-0.5"></i>Start</button>';
      }
      actions += '<button onclick="sandboxAction(\'' + s.workspaceId + '\',\'destroy\')" class="text-[10px] px-1.5 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 transition" title="Destroy"><i class="fas fa-trash"></i></button>';

      return '<div class="bg-white rounded-lg border border-gray-100 p-2.5 hover:border-gray-200 transition">' +
        '<div class="flex items-center gap-2 mb-1.5">' +
          '<div class="w-2 h-2 rounded-full ' + dotColor + '"></div>' +
          '<span class="text-xs font-medium text-gray-700 flex-1 truncate">' + label + '</span>' +
          '<span class="text-[10px] px-1.5 py-0.5 rounded-full ' + badgeClass + '">' + s.status + '</span>' +
        '</div>' +
        '<div class="grid grid-cols-3 gap-1 mb-1.5 text-[10px] text-gray-500">' +
          '<div><i class="fas fa-microchip text-blue-400 mr-0.5"></i>' + cpu + '%</div>' +
          '<div><i class="fas fa-memory text-purple-400 mr-0.5"></i>' + mem + 'MB</div>' +
          '<div><i class="fas fa-network-wired text-gray-400 mr-0.5"></i>:' + (s.port || '—') + '</div>' +
        '</div>' +
        '<div class="flex gap-1">' + actions + '</div>' +
      '</div>';
    }).join('');

    // Port info
    if (overview && overview.portRange) {
      var portEl = document.getElementById('sandboxPortInfo');
      if (portEl) portEl.textContent = 'Ports: ' + overview.portRange.start + '-' + overview.portRange.end + ' (' + overview.portRange.used + ' used)';
    }
  } catch (err) {
    var listEl2 = document.getElementById('sandboxList');
    if (listEl2) listEl2.innerHTML = '<div class="text-xs text-red-400 py-2">Failed to load sandbox data</div>';
  }
}

async function createSandbox() {
  var wsId = currentWorkspace || 'default';
  try {
    var resp = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId }),
    });
    var data = await resp.json();
    if (data.success) {
      loadSandboxData();
    } else {
      alert(data.error?.message || 'Failed to create sandbox');
    }
  } catch (err) {
    alert('Error creating sandbox: ' + err.message);
  }
}

async function sandboxAction(workspaceId, action) {
  if (action === 'destroy' && !confirm('Destroy sandbox for ' + workspaceId + '? Container will be removed (files preserved).')) return;

  try {
    var method = action === 'destroy' ? 'DELETE' : 'POST';
    var url = action === 'destroy'
      ? '/api/sandbox/' + workspaceId
      : '/api/sandbox/' + workspaceId + '/' + action;
    var resp = await fetch(url, { method: method });
    var data = await resp.json();
    if (data.success) {
      loadSandboxData();
    } else {
      alert(data.error?.message || 'Failed to ' + action + ' sandbox');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function buildAgentsPanel() {
  const agents = [
    { icon: 'fa-lightbulb', name: 'Planner', desc: 'Task decomposition & planning', color: 'text-yellow-500' },
    { icon: 'fa-code', name: 'Coder', desc: 'Write & edit code', color: 'text-blue-500' },
    { icon: 'fa-terminal', name: 'Executor', desc: 'Run commands & builds', color: 'text-green-500' },
    { icon: 'fa-search', name: 'Researcher', desc: 'Search web & knowledge', color: 'text-purple-500' },
    { icon: 'fa-file-alt', name: 'Writer', desc: 'Documentation & content', color: 'text-pink-500' },
    { icon: 'fa-bug', name: 'Debugger', desc: 'Find & fix errors', color: 'text-red-500' },
    { icon: 'fa-cloud', name: 'DevOps', desc: 'Deploy & infrastructure', color: 'text-orange-500' },
  ];
  return `<div class="space-y-1">${agents.map(a => `
    <div class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition text-xs"
         onclick="sendQuickAction('Use the ${a.name} agent to help me')">
      <div class="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
        <i class="fas ${a.icon} ${a.color}" style="font-size:11px"></i>
      </div>
      <div>
        <div class="text-gray-700 font-medium">${a.name}</div>
        <div class="text-gray-400" style="font-size:10px">${a.desc}</div>
      </div>
    </div>`).join('')}</div>`;
}

function buildExplorerSideContent() {
  return `
    <div class="flex items-center justify-between mb-2">
      <select id="workspaceSelectSide" onchange="loadWorkspace(this.value)"
        class="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300 flex-1 mr-2">
        <option value="default">default</option>
      </select>
      <button onclick="refreshSideFileTree()" class="text-gray-400 hover:text-gray-600 text-xs px-1"><i class="fas fa-sync-alt"></i></button>
    </div>
    <div id="fileTreeSide" class="text-sm">
      <div class="text-gray-400 text-xs py-4">Loading files...</div>
    </div>`;
}

function buildRAGSideContent() {
  return `
    <div id="ragDocCountSide" class="text-xs text-gray-400 mb-3">0 documents indexed</div>
    <button onclick="showRAGPanel()" class="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition">
      <i class="fas fa-plus mr-1"></i>Add Document
    </button>
    <div id="ragDocListSide" class="mt-3 space-y-1.5"></div>`;
}

// ============================================================
// CONVERSATION HISTORY
// ============================================================
function buildConversationListPanel() {
  return `
    <button onclick="startNewConversation()" class="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition mb-3">
      <i class="fas fa-plus mr-1"></i>New Chat
    </button>
    <div id="convListSide" class="space-y-1">
      <div class="text-xs text-gray-400 py-4 text-center">Loading conversations...</div>
    </div>`;
}

function startNewConversation() {
  currentConversationId = null;
  switchToHomePage();
  document.getElementById('chatInput').focus();
  closeSidePanel();
  // Highlight "chat" button
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.toggle('active', b.dataset.sidebar === 'chat'));
}

async function loadConversationList() {
  try {
    const res = await fetch('/api/chat/conversations');
    const data = await res.json();
    if (data.success) {
      conversationList = data.data;
      renderConversationList();
    }
  } catch {
    const el = document.getElementById('convListSide');
    if (el) el.innerHTML = '<div class="text-xs text-gray-400 py-4 text-center">Could not load conversations</div>';
  }
}

function renderConversationList() {
  const el = document.getElementById('convListSide');
  if (!el) return;
  if (!conversationList.length) {
    el.innerHTML = '<div class="text-xs text-gray-400 py-4 text-center">No conversations yet</div>';
    return;
  }
  el.innerHTML = conversationList.map(c => {
    const isActive = c.id === currentConversationId;
    const date = new Date(c.updatedAt);
    const timeStr = formatRelativeTime(date);
    return `
      <div class="group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition text-xs
        ${isActive ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-100 border border-transparent'}"
        onclick="loadConversation('${c.id}')">
        <div class="flex-1 min-w-0">
          <div class="text-gray-700 font-medium truncate ${isActive ? 'text-indigo-700' : ''}">${escapeHtml(c.title || 'Untitled')}</div>
          <div class="text-gray-400 truncate" style="font-size:10px">
            ${c.messageCount || 0} msgs &middot; ${timeStr}
          </div>
        </div>
        <button onclick="event.stopPropagation(); deleteConv('${c.id}')" 
          class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition p-1" title="Delete">
          <i class="fas fa-trash" style="font-size:10px"></i>
        </button>
      </div>`;
  }).join('');
}

async function loadConversation(id) {
  try {
    const res = await fetch(`/api/chat/${id}/history`);
    const data = await res.json();
    if (!data.success) return;

    currentConversationId = id;
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.innerHTML = '';

    // Render each message
    const msgs = data.data.messages || [];
    for (const msg of msgs) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        addChatMessage(msg.role, msg.content);
      }
    }

    // Update token counter from conversation stats
    if (data.data.totalTokens) totalTokens = data.data.totalTokens;
    if (data.data.totalCostUSD) totalCost = data.data.totalCostUSD;
    updateTokenCounter();

    // Re-render list to highlight active
    renderConversationList();

    // Close side panel and focus input
    closeSidePanel();
    document.getElementById('chatInput').focus();
  } catch (err) {
    console.error('Failed to load conversation:', err);
  }
}

async function deleteConv(id) {
  if (!confirm('Delete this conversation?')) return;
  try {
    await fetch(`/api/chat/${id}`, { method: 'DELETE' });
    if (currentConversationId === id) {
      startNewConversation();
    }
    loadConversationList();
  } catch {}
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd ago';
  return date.toLocaleDateString();
}

function buildWorkflowsPanel() {
  const flows = [
    { icon: 'fa-rocket', name: 'Full Stack App', desc: 'Plan → Code → Test → Deploy' },
    { icon: 'fa-book', name: 'Research & Write', desc: 'Search → Analyze → Document' },
    { icon: 'fa-code-branch', name: 'PR Review', desc: 'Fetch → Review → Comment' },
    { icon: 'fa-database', name: 'RAG Pipeline', desc: 'Ingest → Chunk → Embed → Index' },
  ];
  return `<div class="space-y-1">${flows.map(f => `
    <div class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition text-xs"
         onclick="sendQuickAction('Run the ${f.name} workflow')">
      <div class="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
        <i class="fas ${f.icon} text-indigo-500" style="font-size:11px"></i>
      </div>
      <div>
        <div class="text-gray-700 font-medium">${f.name}</div>
        <div class="text-gray-400" style="font-size:10px">${f.desc}</div>
      </div>
    </div>`).join('')}</div>`;
}

async function loadToolsList() {
  const content = document.getElementById('sidePanelContent');
  try {
    const res = await fetch('/api/system/tools');
    const data = await res.json();
    if (data.success) {
      let html = '';
      for (const [cat, tools] of Object.entries(data.data.tools)) {
        html += `<div class="mb-3">
          <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">${cat}</div>
          <div class="space-y-0.5">
            ${tools.map(t => `<div class="text-xs py-1 px-2 rounded hover:bg-gray-100 cursor-pointer transition flex items-center gap-1.5" title="${t.description}">
              <i class="fas fa-wrench text-gray-300" style="font-size:9px"></i>
              <span class="text-gray-600">${t.name}</span>
              ${t.riskLevel === 'high' ? '<span class="text-red-400 ml-auto" style="font-size:9px"><i class="fas fa-exclamation-triangle"></i></span>' : ''}
            </div>`).join('')}
          </div>
        </div>`;
      }
      content.innerHTML = html || '<div class="text-xs text-gray-400 py-4">No tools loaded</div>';
    }
  } catch {
    content.innerHTML = '<div class="text-xs text-gray-400 py-4">Could not load tools</div>';
  }
}

// ============================================================
// WORKSPACE TABS
// ============================================================
const WS_PANELS = ['preview', 'explorer', 'trace', 'terminal', 'deploy', 'github', 'metrics'];

function switchWorkspaceTab(tab) {
  activeWorkspaceTab = tab;

  // Update button styles
  document.querySelectorAll('.ws-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.wstab === tab);
  });

  // Show/hide panels using style.display
  WS_PANELS.forEach(p => {
    const el = document.getElementById('wspanel-' + p);
    if (!el) return;
    if (p === tab) {
      el.style.display = (p === 'terminal') ? 'flex' : '';
      if (p !== 'terminal') el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // Load data on switch
  if (tab === 'explorer') refreshFileTree();
  if (tab === 'metrics') loadMetrics();
  if (tab === 'deploy') loadDeployStatus();
  if (tab === 'github') loadGitStatus();
  if (tab === 'terminal') {
    var ti = document.getElementById('terminalInput');
    if (ti) ti.focus();
    var tw = document.getElementById('terminalWorkspace');
    if (tw) tw.textContent = currentWorkspace || 'default';
  }
}

let _latencyChart = null;
let _costChart = null;

async function loadMetrics() {
  try {
    var [statusRes, costsRes, perfRes, healthRes] = await Promise.all([
      fetch('/api/system/status'),
      fetch('/api/system/costs'),
      fetch('/api/system/performance'),
      fetch('/api/system/health/providers'),
    ]);
    var statusData = await statusRes.json();
    var costsData = await costsRes.json();
    var perfData = await perfRes.json();
    var healthData = await healthRes.json();

    var d = statusData.data;
    var costs = costsData.data;
    var perf = perfData.data;
    var health = healthData.data;

    // Update refresh time
    var refreshEl = document.getElementById('metricsRefreshTime');
    if (refreshEl) refreshEl.textContent = 'Updated: ' + new Date().toLocaleTimeString();

    // Top cards: 4 key metrics
    var topCards = document.getElementById('metricsTopCards');
    if (topCards) {
      topCards.innerHTML = [
        { label: 'Total Tokens', value: (costs.totalTokens || totalTokens).toLocaleString(), icon: 'fa-coins', color: 'text-purple-600', bg: 'bg-purple-50' },
        { label: 'Session Cost', value: '$' + (costs.sessionTotal || totalCost).toFixed(4), icon: 'fa-dollar-sign', color: 'text-green-600', bg: 'bg-green-50' },
        { label: 'LLM Requests', value: costs.totalRequests || 0, icon: 'fa-bolt', color: 'text-blue-600', bg: 'bg-blue-50' },
        { label: 'Avg Latency', value: (perf.avgLatencyMs || 0) + 'ms', icon: 'fa-clock', color: 'text-orange-600', bg: 'bg-orange-50' },
      ].map(function(m) {
        return '<div class="' + m.bg + ' rounded-xl p-3 border border-gray-200">' +
          '<div class="flex items-center gap-2 mb-1"><i class="fas ' + m.icon + ' ' + m.color + '" style="font-size:10px"></i><span class="text-[10px] text-gray-400 uppercase">' + m.label + '</span></div>' +
          '<div class="text-xl font-bold ' + m.color + '">' + m.value + '</div></div>';
      }).join('');
    }

    // Secondary grid
    var grid = document.getElementById('metricsGrid');
    if (grid) {
      grid.innerHTML = [
        { label: 'Status', value: d.status, color: 'text-green-600' },
        { label: 'Version', value: d.version, color: 'text-indigo-600' },
        { label: 'Tools', value: d.toolCount, color: 'text-blue-600' },
        { label: 'Memory', value: d.memory.used + ' (' + d.memory.heapUsedPercent + '%)', color: 'text-yellow-600' },
        { label: 'Uptime', value: Math.floor(d.uptime / 60) + ' min', color: 'text-gray-700' },
        { label: 'Database', value: d.database, color: d.database === 'connected' ? 'text-green-600' : 'text-red-500' },
        { label: 'Redis', value: d.redis || 'unknown', color: (d.redis === 'connected') ? 'text-green-600' : 'text-red-500' },
        { label: 'ChromaDB', value: d.chromadb || 'unknown', color: (d.chromadb === 'connected') ? 'text-green-600' : 'text-red-500' },
        { label: 'WS Clients', value: d.websocket.connectedClients, color: 'text-indigo-600' },
        { label: 'P95 Latency', value: (perf.p95LatencyMs || 0) + 'ms', color: 'text-orange-600' },
      ].map(function(m) {
        return '<div class="bg-gray-50 rounded-xl p-3 border border-gray-200">' +
          '<div class="text-[10px] text-gray-400 mb-0.5">' + m.label + '</div>' +
          '<div class="text-sm font-bold ' + m.color + '">' + m.value + '</div></div>';
      }).join('');
    }

    // Latency chart
    var latencyCtx = document.getElementById('latencyChart');
    if (latencyCtx && perf.recentLatencies && perf.recentLatencies.length > 0) {
      if (_latencyChart) _latencyChart.destroy();
      _latencyChart = new Chart(latencyCtx, {
        type: 'line',
        data: {
          labels: perf.recentLatencies.map(function(_, i) { return i + 1; }),
          datasets: [{ label: 'Latency (ms)', data: perf.recentLatencies, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.4, pointRadius: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 9 } } } } }
      });
    }

    // Cost chart (per model)
    var costCtx = document.getElementById('costChart');
    if (costCtx && costs.models) {
      if (_costChart) _costChart.destroy();
      var modelNames = Object.keys(costs.models);
      var modelCosts = modelNames.map(function(m) { return costs.models[m].cost; });
      var bgColors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#3b82f6', '#14b8a6'];
      _costChart = new Chart(costCtx, {
        type: 'doughnut',
        data: {
          labels: modelNames,
          datasets: [{ data: modelCosts, backgroundColor: bgColors.slice(0, modelNames.length) }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 12 } } } }
      });
    }

    // Tool stats
    var toolStatsEl = document.getElementById('toolStatsGrid');
    if (toolStatsEl && perf.toolStats) {
      var entries = Object.entries(perf.toolStats).sort(function(a, b) { return b[1].totalCalls - a[1].totalCalls; }).slice(0, 12);
      if (entries.length > 0) {
        toolStatsEl.innerHTML = entries.map(function(entry) {
          var name = entry[0];
          var s = entry[1];
          var rateColor = s.successRate >= 90 ? 'text-green-600' : s.successRate >= 70 ? 'text-yellow-600' : 'text-red-600';
          return '<div class="bg-gray-50 rounded-lg p-2 border border-gray-100">' +
            '<div class="flex items-center justify-between mb-1"><span class="text-xs font-medium text-gray-700 truncate">' + name + '</span><span class="text-[10px] ' + rateColor + ' font-semibold">' + s.successRate + '%</span></div>' +
            '<div class="flex items-center gap-2 text-[10px] text-gray-400"><span>' + s.totalCalls + ' calls</span><span>' + s.avgDurationMs + 'ms avg</span></div></div>';
        }).join('');
      } else {
        toolStatsEl.innerHTML = '<div class="col-span-2 text-xs text-gray-400 text-center py-2">No tool calls yet</div>';
      }
    }

    // Provider health
    var providerEl = document.getElementById('providerHealthGrid');
    if (providerEl && health) {
      var providers = Object.keys(health);
      if (providers.length > 0) {
        providerEl.innerHTML = providers.map(function(p) {
          var h = health[p];
          var statusColor = h.available ? 'bg-green-500' : 'bg-red-500';
          var statusText = h.available ? 'Healthy' : 'Degraded';
          return '<div class="bg-gray-50 rounded-lg p-2 border border-gray-100">' +
            '<div class="flex items-center gap-2 mb-1"><div class="w-2 h-2 rounded-full ' + statusColor + '"></div>' +
            '<span class="text-xs font-medium text-gray-700">' + p + '</span><span class="text-[10px] text-gray-400 ml-auto">' + statusText + '</span></div>' +
            '<div class="flex items-center gap-2 text-[10px] text-gray-400"><span>' + h.successCount + ' ok</span><span>' + h.errorCount + ' err</span>' +
            (h.avgLatencyMs ? '<span>' + Math.round(h.avgLatencyMs) + 'ms</span>' : '') + '</div></div>';
        }).join('');
      } else {
        providerEl.innerHTML = '<div class="col-span-2 text-xs text-gray-400 text-center py-2">No provider calls yet</div>';
      }
    }
  } catch (err) {
    var grid2 = document.getElementById('metricsGrid');
    if (grid2) grid2.innerHTML = '<div class="col-span-2 text-center text-xs text-red-400 py-4">Could not load metrics: ' + err.message + '</div>';
  }
}

// ============================================================
// RESIZE HANDLE
// ============================================================
function setupResizeHandle() {
  const handle = document.getElementById('mainResize');
  const chatPane = document.getElementById('chatPane');
  if (!handle || !chatPane) return;
  let dragging = false;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = chatPane.parentElement.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct > 20 && pct < 80) chatPane.style.width = pct + '%';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
  });
}

// ============================================================
// PREVIEW
// ============================================================
function copyPreviewUrl() {
  const url = document.getElementById('previewUrl').value;
  if (url) navigator.clipboard.writeText(url);
}
function refreshPreview() {
  const frame = document.getElementById('previewFrame');
  if (frame && frame.src) frame.src = frame.src;
}
function showPreview(url) {
  document.getElementById('previewUrl').value = url;
  const ph = document.getElementById('previewPlaceholder');
  if (ph) ph.style.display = 'none';
  const frame = document.getElementById('previewFrame');
  frame.style.display = '';
  frame.src = url;
  switchWorkspaceTab('preview');
}

// ============================================================
// WEBSOCKET
// ============================================================
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.onopen = () => { wsReconnectAttempt = 0; updateConnectionStatus('connected'); console.log('[WS] Connected'); };
    ws.onmessage = e => { try { handleWebSocketMessage(JSON.parse(e.data)); } catch (err) { console.warn('[WS] Bad msg:', err); } };
    ws.onclose = () => { updateConnectionStatus('disconnected'); scheduleReconnect(); };
    ws.onerror = () => { updateConnectionStatus('error'); };
  } catch { scheduleReconnect(); }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectAttempt++;
  wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; connectWebSocket(); },
    Math.min(1000 * Math.pow(2, wsReconnectAttempt), 30000));
}

function handleWebSocketMessage(msg) {
  if (msg.type === 'system_event' && msg.payload?.event === 'connected')
    console.log('[WS] Ack:', msg.payload.clientId);

  // Handle agent events relayed over WebSocket (for multi-client sync)
  if (msg.type === 'agent_event' && msg.payload?.type === 'approval') {
    // Another client might show the approval — optional for future multi-user
    console.log('[WS] Approval event relayed:', msg.payload.data?.id);
  }
}

function updateConnectionStatus(status) {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const c = {
    connected: { bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-500', label: 'Live' },
    disconnected: { bg: 'bg-yellow-50', text: 'text-yellow-600', dot: 'bg-yellow-500', label: 'Reconnecting' },
    error: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', label: 'Disconnected' },
  }[status] || { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', label: 'Disconnected' };
  badge.className = `flex items-center gap-1.5 px-2 py-1 rounded-full ${c.bg} ${c.text} text-xs`;
  badge.innerHTML = `<div class="w-1.5 h-1.5 rounded-full ${c.dot}"></div><span>${c.label}</span>`;
}

function sendWSMessage(type, payload) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type, id: Date.now().toString(36), payload }));
}

// ============================================================
// APPROVAL CARD — Interactive approve/reject UI
// ============================================================
function showApprovalCard(div, data) {
  const approvalId = data.id;
  const toolName = data.toolName || 'Unknown Tool';
  const toolArgs = data.toolArgs || {};
  const riskLevel = data.riskLevel || 'medium';
  const description = data.description || '';
  const category = data.category || '';

  const riskColors = {
    low: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: 'text-blue-500' },
    medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', icon: 'text-yellow-500' },
    high: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', icon: 'text-orange-500' },
    critical: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: 'text-red-500' },
  };
  const rc = riskColors[riskLevel] || riskColors.medium;

  // Format tool arguments for display
  const argsEntries = Object.entries(toolArgs);
  const argsHtml = argsEntries.length > 0
    ? `<div class="mt-2 bg-white bg-opacity-60 rounded p-2 font-mono text-xs space-y-0.5">
        ${argsEntries.map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          const truncated = val.length > 120 ? val.substring(0, 120) + '...' : val;
          return `<div><span class="text-gray-400">${escapeHtml(k)}:</span> <span class="text-gray-700">${escapeHtml(truncated)}</span></div>`;
        }).join('')}
      </div>`
    : '';

  const cardId = `approval-${approvalId}`;
  const cardHtml = `
    <div id="${cardId}" class="mt-3 ${rc.bg} ${rc.border} border rounded-lg overflow-hidden approval-card" data-approval-id="${approvalId}">
      <div class="px-3 py-2 flex items-center justify-between border-b ${rc.border}">
        <div class="flex items-center gap-2">
          <i class="fas fa-shield-alt ${rc.icon}"></i>
          <span class="font-semibold text-sm text-gray-800">Approval Required</span>
          <span class="px-1.5 py-0.5 rounded text-xs font-medium ${rc.badge}">${riskLevel.toUpperCase()}</span>
          ${category ? `<span class="text-xs text-gray-400">${escapeHtml(category)}</span>` : ''}
        </div>
        <div class="flex items-center gap-1 text-xs text-gray-400">
          <i class="fas fa-clock"></i>
          <span id="${cardId}-timer">60s</span>
        </div>
      </div>
      <div class="px-3 py-2">
        <div class="text-sm text-gray-700">
          <span class="font-semibold text-indigo-600">${escapeHtml(toolName)}</span>
          ${description ? `<span class="text-gray-500 ml-1">— ${escapeHtml(description)}</span>` : ''}
        </div>
        ${argsHtml}
      </div>
      <div id="${cardId}-actions" class="px-3 py-2 border-t ${rc.border} flex items-center gap-2">
        <button onclick="handleApproval('${approvalId}', true)" class="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition flex items-center gap-1">
          <i class="fas fa-check"></i> Approve
        </button>
        <button onclick="handleApproval('${approvalId}', false)" class="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition flex items-center gap-1">
          <i class="fas fa-times"></i> Reject
        </button>
        <div class="flex-1"></div>
        <span class="text-xs text-gray-400">Auto-approves on timeout</span>
      </div>
    </div>
  `;
  div.innerHTML += cardHtml;

  // Countdown timer
  let remaining = 60;
  const timerEl = document.getElementById(`${cardId}-timer`);
  const countdown = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(countdown);
      resolveApprovalCard(approvalId, true, 'timeout');
    }
  }, 1000);

  // Store the interval so we can clear it on manual action
  const card = document.getElementById(cardId);
  if (card) card._countdownInterval = countdown;

  // Scroll into view
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
}

function handleApproval(approvalId, approved) {
  // Send approval response via WebSocket
  sendWSMessage('approval_response', {
    approvalId: approvalId,
    approved: approved,
  });

  resolveApprovalCard(approvalId, approved, 'user');
}

function resolveApprovalCard(approvalId, approved, source) {
  const cardId = `approval-${approvalId}`;
  const card = document.getElementById(cardId);
  if (!card) return;

  // Clear countdown
  if (card._countdownInterval) clearInterval(card._countdownInterval);

  // Update the actions area with the result
  const actionsEl = document.getElementById(`${cardId}-actions`);
  if (actionsEl) {
    const sourceLabel = source === 'timeout' ? '(auto-approved on timeout)' : '';
    if (approved) {
      actionsEl.innerHTML = `<div class="flex items-center gap-2 text-green-600 text-xs font-medium">
        <i class="fas fa-check-circle"></i> Approved ${sourceLabel}
      </div>`;
      card.className = card.className.replace(/bg-\w+-50/, 'bg-green-50').replace(/border-\w+-200/g, 'border-green-200');
    } else {
      actionsEl.innerHTML = `<div class="flex items-center gap-2 text-red-600 text-xs font-medium">
        <i class="fas fa-times-circle"></i> Rejected
      </div>`;
      card.className = card.className.replace(/bg-\w+-50/, 'bg-red-50').replace(/border-\w+-200/g, 'border-red-200');
    }
  }

  // Update timer
  const timerEl = document.getElementById(`${cardId}-timer`);
  if (timerEl) timerEl.textContent = approved ? '✓' : '✗';
}

setInterval(() => { sendWSMessage('ping', { timestamp: Date.now() }); }, 30000);

// ============================================================
// CHAT
// ============================================================
async function sendMessage() {
  // Get text from whichever input is visible (home page or active chat)
  const homeInput = document.getElementById('chatInput');
  const activeInput = document.getElementById('chatInputActive');
  const input = homeInput && homeInput.offsetParent !== null ? homeInput : (activeInput || homeInput);
  const message = input.value.trim();
  if (!message || isStreaming) return;

  // Switch from home page to chat mode
  switchToChatMode();

  input.value = ''; autoResize(input);
  isStreaming = true; updateSendButton(true);
  addChatMessage('user', message);

  // Show Trace tab while agent works
  switchWorkspaceTab('trace');
  const tracePanel = document.getElementById('traceContent');
  tracePanel.innerHTML = '';

  const assistantDiv = addChatMessage('assistant', '', true);
  const contentDiv = assistantDiv.querySelector('.message-content');
  streamedText = '';  // Reset streamed text accumulator for new message

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId: currentConversationId, workspaceId: currentWorkspace }),
    });
    currentConversationId = res.headers.get('X-Conversation-Id') || currentConversationId;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { handleSSEEvent(JSON.parse(line.slice(6)), contentDiv, tracePanel); } catch {}
        }
      }
    }
  } catch (err) {
    contentDiv.innerHTML = `<div class="text-red-500"><i class="fas fa-exclamation-triangle mr-1"></i>${err.message}</div>`;
  }

  isStreaming = false; updateSendButton(false);
  refreshFileTree();
  // Refresh conversation list after each message (updates title, timestamps)
  loadConversationList();
  // Focus the active chat input for follow-up messages
  const chatActiveInput = document.getElementById('chatInputActive');
  if (chatActiveInput) chatActiveInput.focus();
}

function sendQuickAction(msg) {
  const homeInput = document.getElementById('chatInput');
  const activeInput = document.getElementById('chatInputActive');
  const input = homeInput && homeInput.offsetParent !== null ? homeInput : (activeInput || homeInput);
  input.value = msg;
  sendMessage();
}

// ============================================================
// AGENT PAGE NAVIGATION
// ============================================================
// Navigate to a dedicated AI agent page (opens in the platform browser)
function navigateToAgent(agentId) {
  window.location.href = '/' + agentId;
}

// Switch from home page view to active chat view
function switchToChatMode() {
  const home = document.getElementById('homePage');
  const chatHeader = document.getElementById('chatHeader');
  const chatMessages = document.getElementById('chatMessages');
  const chatInputArea = document.getElementById('chatInputArea');
  const chatPane = document.getElementById('chatPane');
  const workspacePane = document.getElementById('workspacePane');
  const resizeHandle = document.getElementById('mainResize');

  if (home) home.style.display = 'none';
  if (chatHeader) chatHeader.style.display = '';
  if (chatMessages) chatMessages.style.display = '';
  if (chatInputArea) chatInputArea.style.display = '';
  // Restore chat pane to split width, show workspace
  if (chatPane) { chatPane.style.width = '45%'; chatPane.style.minWidth = '320px'; }
  if (workspacePane) workspacePane.style.display = '';
  if (resizeHandle) resizeHandle.style.display = '';
}

// Switch back to home page view
function switchToHomePage() {
  const home = document.getElementById('homePage');
  const chatHeader = document.getElementById('chatHeader');
  const chatMessages = document.getElementById('chatMessages');
  const chatInputArea = document.getElementById('chatInputArea');
  const chatPane = document.getElementById('chatPane');
  const workspacePane = document.getElementById('workspacePane');
  const resizeHandle = document.getElementById('mainResize');

  if (home) home.style.display = '';
  if (chatHeader) chatHeader.style.display = 'none';
  if (chatMessages) { chatMessages.style.display = 'none'; chatMessages.innerHTML = ''; }
  if (chatInputArea) chatInputArea.style.display = 'none';
  // Full width for home page, hide workspace
  if (chatPane) { chatPane.style.width = '100%'; chatPane.style.minWidth = '0'; }
  if (workspacePane) workspacePane.style.display = 'none';
  if (resizeHandle) resizeHandle.style.display = 'none';
}

// ============================================================
// SSE HANDLER
// ============================================================
function handleSSEEvent(event, contentDiv, tracePanel) {
  switch (event.type) {
    case 'thinking': {
      const agentLabel = event.data.agentType && event.data.agentType !== 'router'
        ? `<span class="font-mono text-xs px-1 rounded ${agentBadgeColor(event.data.agentType)}">${event.data.agentType}</span> ` : '';
      addTraceItem(tracePanel, agentLabel + event.data.content, 'fas fa-brain', 'text-purple-500');
      showThinking(contentDiv, event.data.content);
      break;
    }
    case 'text':
      removeThinking(contentDiv);
      if (event.data.delta) {
        // Token-by-token streaming: append raw text and show live
        streamedText += event.data.content;
        appendStreamedText(contentDiv, event.data.content, streamedText);
      } else {
        // Final text: render full content as markdown (end of stream)
        const finalContent = event.data.content || streamedText;
        if (finalContent) {
          contentDiv.innerHTML = renderMarkdown(finalContent);
        }
        streamedText = '';  // Reset for next iteration
      }
      break;
    case 'tool_call': {
      const tcAgent = event.data.agentType && event.data.agentType !== 'router'
        ? `<span class="font-mono text-xs px-1 rounded ${agentBadgeColor(event.data.agentType)}">${event.data.agentType}</span> ` : '';
      addTraceItem(tracePanel,
        `${tcAgent}<span class="text-yellow-600 font-semibold">${event.data.toolName}</span>(${truncateArgs(event.data.toolArgs)})`,
        'fas fa-wrench', 'text-yellow-500');
      showToolCall(contentDiv, event.data.toolName, event.data.toolArgs);
      break;
    }
    case 'tool_result':
      addTraceItem(tracePanel,
        `${event.data.toolName}: ${event.data.success ? '<span class="text-green-600">OK</span>' : '<span class="text-red-500">Fail</span>'} (${event.data.durationMs}ms)`,
        event.data.success ? 'fas fa-check-circle' : 'fas fa-times-circle',
        event.data.success ? 'text-green-500' : 'text-red-500');
      showToolResult(contentDiv, event.data);
      break;
    case 'component':
      renderGenUIComponent(contentDiv, event.data);
      // Add trace item for repair-related status badges
      if (event.data.name === 'status_badge') {
        const s = event.data.props.status;
        const lbl = event.data.props.label || '';
        if (lbl === 'Auto-Repair') {
          const icon = s === 'running' ? 'fas fa-tools' : s === 'success' ? 'fas fa-check-double' : 'fas fa-exclamation-circle';
          const color = s === 'running' ? 'text-yellow-500' : s === 'success' ? 'text-green-500' : 'text-red-500';
          addTraceItem(tracePanel, `<span class="font-semibold">Repair:</span> ${event.data.props.detail || s}`, icon, color);
        } else if (lbl === 'Parallel Execution') {
          const icon = s === 'running' ? 'fas fa-project-diagram' : s === 'success' ? 'fas fa-check-double' : 'fas fa-exclamation-circle';
          const color = s === 'running' ? 'text-blue-500' : s === 'success' ? 'text-green-500' : 'text-red-500';
          addTraceItem(tracePanel, `<span class="font-semibold">Parallel:</span> ${event.data.props.detail || s}`, icon, color);
        } else {
          // Agent lane status badges (CODE, DESIGN, TEST, etc.)
          const icon = s === 'running' ? 'fas fa-spinner fa-spin' : s === 'success' ? 'fas fa-check-circle' : 'fas fa-times-circle';
          const color = s === 'success' ? 'text-green-500' : s === 'failed' ? 'text-red-500' : 'text-blue-500';
          addTraceItem(tracePanel, `<span class="font-mono text-xs px-1 rounded ${agentBadgeColor(lbl.toLowerCase())}">${lbl}</span> ${event.data.props.detail || s}`, icon, color);
        }
      }
      break;
    case 'approval':
      addTraceItem(tracePanel,
        `<span class="text-orange-600 font-semibold">Approval Required:</span> ${event.data.toolName} <span class="text-gray-400">[${event.data.riskLevel || 'medium'}]</span>`,
        'fas fa-shield-alt', 'text-orange-500');
      showApprovalCard(contentDiv, event.data);
      break;
    case 'error':
      addTraceItem(tracePanel, event.data.message, 'fas fa-exclamation-triangle', 'text-red-500');
      contentDiv.innerHTML += `<div class="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
        <i class="fas fa-exclamation-triangle mr-1"></i>${event.data.message}</div>`;
      break;
    case 'done':
      removeThinking(contentDiv);
      if (event.data.usage) {
        totalTokens += event.data.usage.totalTokens || 0;
        totalCost += event.data.usage.totalCostUSD || 0;
        updateTokenCounter();
      }
      addTraceItem(tracePanel,
        `Completed in ${((event.data.usage?.totalDurationMs || 0) / 1000).toFixed(1)}s`,
        'fas fa-flag-checkered', 'text-green-500');
      break;
  }
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
  tracePanel.scrollTop = tracePanel.scrollHeight;
}

// ============================================================
// CHAT UI HELPERS
// ============================================================
function addWelcomeMessage() {
  document.getElementById('chatMessages').innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="text-center py-16">
        <div class="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-robot text-indigo-500 text-2xl"></i>
        </div>
        <h2 class="text-xl font-bold text-gray-800 mb-2">Chat to build anything</h2>
        <p class="text-gray-500 text-sm max-w-md mx-auto mb-8">Write code, search knowledge base, manage files, deploy — all in natural language.</p>
        <div class="flex flex-wrap justify-center gap-2">
          <button onclick="sendQuickAction('Show me the system status and available tools')" class="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs text-gray-600 transition border border-gray-200"><i class="fas fa-heartbeat mr-1 text-green-500"></i>System Status</button>
          <button onclick="sendQuickAction('Create a new Hono web app with a REST API and Tailwind frontend')" class="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs text-gray-600 transition border border-gray-200"><i class="fas fa-code mr-1 text-blue-500"></i>Create Web App</button>
          <button onclick="sendQuickAction('Search the web for the latest Hono framework features')" class="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs text-gray-600 transition border border-gray-200"><i class="fas fa-search mr-1 text-yellow-500"></i>Web Search</button>
          <button onclick="sendQuickAction('List my GitHub repositories')" class="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs text-gray-600 transition border border-gray-200"><i class="fab fa-github mr-1 text-gray-500"></i>GitHub Repos</button>
        </div>
      </div>
    </div>`;
}

function addChatMessage(role, content, placeholder = false) {
  const chatDiv = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'max-w-2xl mx-auto message-enter';
  const isUser = role === 'user';
  div.innerHTML = `
    <div class="flex gap-3 ${isUser ? 'flex-row-reverse' : ''}">
      <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isUser ? 'bg-indigo-600' : 'bg-gray-100'}">
        <i class="fas ${isUser ? 'fa-user' : 'fa-robot'} text-xs ${isUser ? 'text-white' : 'text-indigo-500'}"></i>
      </div>
      <div class="flex-1 ${isUser ? 'text-right' : ''} min-w-0">
        <div class="message-content inline-block text-left rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser ? 'bg-indigo-600 text-white rounded-tr-sm max-w-[85%]' : 'bg-gray-50 text-gray-800 rounded-tl-sm w-full border border-gray-200'}">
          ${placeholder ? '<div class="thinking-indicator"><span class="thinking-dot inline-block w-1.5 h-1.5 bg-indigo-400 rounded-full mx-0.5"></span><span class="thinking-dot inline-block w-1.5 h-1.5 bg-indigo-400 rounded-full mx-0.5" style="animation-delay:0.2s"></span><span class="thinking-dot inline-block w-1.5 h-1.5 bg-indigo-400 rounded-full mx-0.5" style="animation-delay:0.4s"></span></div>' : (isUser ? escapeHtml(content) : renderMarkdown(content))}
        </div>
      </div>
    </div>`;
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
  return div;
}

function showThinking(div, text) {
  const el = div.querySelector('.thinking-indicator');
  if (el) el.innerHTML = `<span class="text-gray-400 text-xs"><i class="fas fa-brain mr-1 text-purple-500"></i>${escapeHtml(text)}</span>`;
}
function removeThinking(div) { const el = div.querySelector('.thinking-indicator'); if (el) el.remove(); }

function appendText(div, text) {
  const el = div.querySelector('.streamed-text');
  if (el) el.textContent += text;
  else div.innerHTML += `<span class="streamed-text">${escapeHtml(text)}</span>`;
}

// Streaming-aware text appender: shows raw text live, periodically re-renders markdown
let _streamRenderTimer = null;
function appendStreamedText(div, delta, fullText) {
  removeThinking(div);
  // Fast path: append raw text character-by-character
  let el = div.querySelector('.streamed-text');
  if (!el) {
    // Clear any previous non-streaming content
    const existingTools = div.querySelectorAll('.tool-execution');
    div.innerHTML = '';
    existingTools.forEach(t => div.appendChild(t));
    el = document.createElement('div');
    el.className = 'streamed-text prose prose-sm max-w-none';
    div.appendChild(el);
  }
  // Periodically re-render as markdown for live formatting (every 300ms)
  if (_streamRenderTimer) clearTimeout(_streamRenderTimer);
  _streamRenderTimer = setTimeout(() => {
    if (el && fullText) {
      try {
        el.innerHTML = renderMarkdown(fullText);
      } catch {
        el.textContent = fullText;
      }
    }
    _streamRenderTimer = null;
  }, 300);
  // Immediate: show raw text so user sees typing effect with no delay
  if (!_streamRenderTimer) {
    // First chunk — just set it
    el.textContent = fullText;
  }
}

function showToolCall(div, toolName, args) {
  div.innerHTML += `
    <div class="tool-execution mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
      <div class="flex items-center gap-2 text-yellow-600">
        <i class="fas fa-wrench" style="font-size:10px"></i>
        <span class="font-semibold">${toolName}</span>
        <div class="flex-1"></div>
        <div class="thinking-dot inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full"></div>
      </div>
      <div class="mt-1 text-gray-400 font-mono text-[11px] truncate">${truncateArgs(args)}</div>
    </div>`;
}

function showToolResult(div, data) {
  const lastTool = div.querySelector('.tool-execution:last-child');
  if (!lastTool) return;
  const dot = lastTool.querySelector('.thinking-dot');
  if (dot) { dot.className = `inline-block w-1.5 h-1.5 rounded-full ${data.success ? 'bg-green-500' : 'bg-red-500'}`; dot.style.animation = 'none'; }
  if (data.output && typeof data.output === 'object') {
    lastTool.innerHTML += `<pre class="mt-1 text-gray-500 overflow-x-auto max-h-24 overflow-y-auto text-[11px]"><code>${escapeHtml(JSON.stringify(data.output, null, 2).substring(0, 300))}</code></pre>`;
  }
}

// ============================================================
// GENUI COMPONENTS
// ============================================================
function renderGenUIComponent(div, data) {
  const { name, props } = data;
  switch (name) {
    case 'chart': {
      const id = 'chart-' + Date.now();
      div.innerHTML += `<div class="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200"><canvas id="${id}" height="200"></canvas></div>`;
      setTimeout(() => { const ctx = document.getElementById(id); if (ctx) new Chart(ctx, { type: props.type || 'bar', data: { labels: props.labels, datasets: props.datasets }, options: { responsive: true, plugins: { title: { display: !!props.title, text: props.title } } } }); }, 100);
      break;
    }
    case 'table':
      div.innerHTML += `<div class="mt-3 overflow-x-auto rounded-lg border border-gray-200"><table class="w-full text-xs">
        <thead><tr class="bg-gray-50">${(props.headers||[]).map(h=>`<th class="px-3 py-2 text-left text-gray-500">${h}</th>`).join('')}</tr></thead>
        <tbody>${(props.rows||[]).map(r=>`<tr class="border-t border-gray-100">${r.map(c=>`<td class="px-3 py-2 text-gray-700">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      break;
    case 'code_block': {
      const hl = props.language && hljs.getLanguage(props.language) ? hljs.highlight(props.code, { language: props.language }).value : escapeHtml(props.code);
      div.innerHTML += `<div class="mt-3">${props.filename ? `<div class="bg-gray-100 px-3 py-1.5 rounded-t-lg text-xs text-gray-500 flex justify-between items-center"><span><i class="fas fa-file-code mr-1"></i>${props.filename}</span><button onclick="copyCode(this)" class="hover:text-gray-800 transition"><i class="fas fa-copy"></i></button></div>` : ''}<pre class="bg-gray-50 rounded-${props.filename?'b':''}lg p-3 overflow-x-auto border border-gray-200"><code class="language-${props.language||'text'}">${hl}</code></pre></div>`;
      break;
    }
    case 'terminal':
      div.innerHTML += `<div class="mt-3 bg-gray-900 rounded-lg p-3 font-mono text-xs border border-gray-200"><div class="text-gray-500">$ ${escapeHtml(props.command||'')}</div><div class="text-green-400 whitespace-pre-wrap">${escapeHtml(props.output||'')}</div>${props.exitCode!==undefined?`<div class="${props.exitCode===0?'text-green-400':'text-red-400'}">Exit code: ${props.exitCode}</div>`:''}</div>`;
      break;
    case 'file_tree':
      div.innerHTML += `<div class="mt-3 p-3 bg-gray-50 rounded-lg text-xs border border-gray-200">${renderFileTreeHTML(props.files||[])}</div>`;
      break;
    case 'search_results':
      div.innerHTML += `<div class="mt-3 space-y-2">${(props.results||[]).map(r=>`<a href="${r.url}" target="_blank" class="block p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition border border-gray-200"><div class="text-sm text-indigo-600 font-medium">${r.title}</div><div class="text-xs text-gray-400 truncate">${r.url}</div><div class="text-xs text-gray-500 mt-1">${r.snippet||''}</div></a>`).join('')}</div>`;
      break;
    case 'source_cards':
      div.innerHTML += `<div class="mt-3"><div class="text-xs text-gray-500 mb-2"><i class="fas fa-database mr-1"></i>Sources for: "${props.query}"</div><div class="space-y-1">${(props.sources||[]).map(s=>`<div class="p-2 bg-gray-50 rounded border border-gray-200 text-xs"><div class="font-semibold text-gray-700">${s.documentTitle||'Unknown'}</div><div class="text-gray-500 mt-1">${(s.content||'').substring(0,200)}...</div><div class="text-gray-400 mt-1">Score: ${s.score||0} | Type: ${s.searchType||'hybrid'}</div></div>`).join('')}</div></div>`;
      break;
    case 'status_badge': {
      const colors = { running: 'yellow', success: 'green', failed: 'red', info: 'blue' };
      const icons = { running: 'fa-sync fa-spin', success: 'fa-check-circle', failed: 'fa-times-circle', info: 'fa-info-circle' };
      const bgColors = { running: 'bg-yellow-50 border-yellow-200', success: 'bg-green-50 border-green-200', failed: 'bg-red-50 border-red-200', info: 'bg-blue-50 border-blue-200' };
      const textColors = { running: 'text-yellow-700', success: 'text-green-700', failed: 'text-red-700', info: 'text-blue-700' };
      const s = props.status || 'info';
      const bg = bgColors[s] || bgColors.info;
      const tc = textColors[s] || textColors.info;
      const ic = icons[s] || icons.info;
      let errorsHtml = '';
      if (props.errors && props.errors.length > 0) {
        errorsHtml = `<div class="mt-1.5 space-y-0.5">${props.errors.map(e =>
          `<div class="text-xs ${tc} opacity-80"><span class="font-mono bg-white bg-opacity-50 px-1 rounded">${e.category}</span> ${escapeHtml(e.message.substring(0,120))}${e.file ? ` <span class="text-gray-400">${e.file}</span>` : ''}</div>`
        ).join('')}</div>`;
      }
      div.innerHTML += `<div class="mt-2 p-2.5 ${bg} border rounded-lg text-xs ${tc} flex items-start gap-2">
        <i class="fas ${ic} mt-0.5 shrink-0"></i>
        <div class="min-w-0">
          <span class="font-semibold">${escapeHtml(props.label || 'Status')}</span>
          <span class="opacity-75 ml-1">${escapeHtml(props.detail || '')}</span>
          ${errorsHtml}
        </div>
      </div>`;
      break;
    }
    case 'progress_bar': {
      const pct = Math.min(100, Math.max(0, ((props.value || 0) / (props.max || 100)) * 100));
      div.innerHTML += `<div class="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
        <div class="flex justify-between mb-1"><span class="text-gray-600">${escapeHtml(props.label || '')}</span><span class="text-gray-400">${pct.toFixed(0)}%</span></div>
        <div class="w-full bg-gray-200 rounded-full h-1.5"><div class="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style="width:${pct}%"></div></div>
      </div>`;
      break;
    }
    default:
      div.innerHTML += `<div class="mt-2 p-2 bg-gray-50 rounded-lg text-xs text-gray-500 border border-gray-200"><i class="fas fa-puzzle-piece mr-1"></i>Component: ${name}</div>`;
  }
}

// ============================================================
// TRACE PANEL
// ============================================================
function addTraceItem(panel, content, icon, color) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const div = document.createElement('div');
  div.className = 'flex gap-2 text-xs message-enter';
  div.innerHTML = `<span class="text-gray-400 shrink-0 w-14 font-mono">${time}</span><i class="${icon} ${color} shrink-0 mt-0.5" style="font-size:10px"></i><span class="text-gray-600 break-words min-w-0">${content}</span>`;
  panel.appendChild(div);
}

// ============================================================
// FILE TREE
// ============================================================
async function loadWorkspaces() {
  try {
    const res = await fetch('/api/workspace');
    const data = await res.json();
    if (data.success) {
      const opts = data.data.workspaces.length > 0
        ? data.data.workspaces.map(w => `<option value="${w.id}" ${w.id === currentWorkspace ? 'selected' : ''}>${w.name}</option>`).join('')
        : '<option value="default">default</option>';
      ['workspaceSelect', 'workspaceSelectSide'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
    }
  } catch {}
}

async function loadWorkspace(id) { currentWorkspace = id; refreshFileTree(); }

async function refreshFileTree() {
  try {
    const res = await fetch(`/api/workspace/${currentWorkspace}/tree`);
    const data = await res.json();
    if (data.success) {
      const html = renderFileTreeHTML(data.data.tree);
      const el = document.getElementById('fileTree');
      if (el) el.innerHTML = html;
    }
  } catch {
    const el = document.getElementById('fileTree');
    if (el) el.innerHTML = '<div class="text-gray-400 text-xs px-2">Could not load files</div>';
  }
}

async function refreshSideFileTree() {
  try {
    const res = await fetch(`/api/workspace/${currentWorkspace}/tree`);
    const data = await res.json();
    if (data.success) {
      const el = document.getElementById('fileTreeSide');
      if (el) el.innerHTML = renderFileTreeHTML(data.data.tree);
    }
  } catch {
    const el = document.getElementById('fileTreeSide');
    if (el) el.innerHTML = '<div class="text-gray-400 text-xs px-2">Could not load files</div>';
  }
}

function renderFileTreeHTML(nodes, depth = 0) {
  if (!nodes || !nodes.length) return '<div class="text-gray-400 text-xs px-2">Empty</div>';
  return nodes.map(node => {
    const indent = depth * 14;
    const icon = node.type === 'directory' ? 'fas fa-folder text-yellow-500' : getFileIcon(node.name);
    if (node.type === 'directory') {
      return `<div><div class="file-tree-item flex items-center gap-1.5" style="padding-left:${indent+8}px" onclick="this.nextElementSibling.classList.toggle('hidden');this.querySelector('.fa-folder').classList.toggle('fa-folder-open')"><i class="${icon} text-xs"></i><span class="text-xs truncate">${node.name}</span></div><div>${renderFileTreeHTML(node.children||[], depth+1)}</div></div>`;
    }
    return `<div class="file-tree-item flex items-center gap-1.5" style="padding-left:${indent+8}px" onclick="openFile('${node.path}')" title="${node.name} (${formatSize(node.size)})"><i class="${icon} text-xs"></i><span class="text-xs truncate">${node.name}</span></div>`;
  }).join('');
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return { ts:'fab fa-js text-blue-500', tsx:'fab fa-react text-cyan-500', js:'fab fa-js text-yellow-500', jsx:'fab fa-react text-cyan-500', py:'fab fa-python text-green-500', html:'fab fa-html5 text-orange-500', css:'fab fa-css3 text-blue-500', json:'fas fa-brackets-curly text-yellow-600', md:'fab fa-markdown text-gray-500', sql:'fas fa-database text-blue-400', sh:'fas fa-terminal text-green-400', yml:'fas fa-file-code text-pink-500', yaml:'fas fa-file-code text-pink-500', toml:'fas fa-file-code text-orange-400', lock:'fas fa-lock text-gray-400', env:'fas fa-key text-yellow-600', gitignore:'fab fa-git text-orange-500', dockerfile:'fab fa-docker text-blue-500' }[ext] || 'fas fa-file text-gray-400';
}

function openFile(path) { sendQuickAction(`Read the file at ${path} and show me its contents`); }

async function createWorkspace() {
  const name = prompt('Workspace name:');
  if (!name) return;
  try { await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); loadWorkspaces(); } catch {}
}

// ============================================================
// RAG
// ============================================================
async function loadRAGDocs() {
  try {
    const res = await fetch('/api/rag/documents');
    const data = await res.json();
    if (data.success) { const el = document.getElementById('ragDocCountSide'); if (el) el.textContent = `${data.data.count} documents indexed`; }
  } catch {}
}
function showRAGPanel() { document.getElementById('ragModal').style.display = 'flex'; loadRAGDocList(); }
function hideRAGPanel() { document.getElementById('ragModal').style.display = 'none'; }

async function loadRAGDocList() {
  try {
    const res = await fetch('/api/rag/documents');
    const data = await res.json();
    if (data.success && data.data.documents.length > 0) {
      document.getElementById('ragDocList').innerHTML = data.data.documents.map(d => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div><div class="text-sm font-medium text-gray-700">${d.title}</div><div class="text-xs text-gray-400">${d.sourceType} | ${d.chunkCount} chunks | ${new Date(d.createdAt).toLocaleDateString()}</div></div>
          <button onclick="deleteRAGDoc('${d.id}')" class="text-red-400 hover:text-red-500 text-xs"><i class="fas fa-trash"></i></button>
        </div>`).join('');
    }
  } catch {}
}

async function ingestDocument() {
  const title = document.getElementById('ragTitle').value, content = document.getElementById('ragContent').value, sourceType = document.getElementById('ragType').value;
  if (!title || !content) return alert('Title and content required');
  try {
    const res = await fetch('/api/rag/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, sourceType }) });
    const data = await res.json();
    if (data.success) { document.getElementById('ragTitle').value = ''; document.getElementById('ragContent').value = ''; loadRAGDocList(); loadRAGDocs(); alert(`Ingested: ${data.data.chunkCount} chunks`); }
  } catch (e) { alert('Ingest failed: ' + e.message); }
}

async function deleteRAGDoc(id) {
  if (!confirm('Delete this document?')) return;
  try { await fetch(`/api/rag/documents/${id}`, { method: 'DELETE' }); loadRAGDocList(); loadRAGDocs(); } catch {}
}

// ============================================================
// TERMINAL — Direct command execution via API
// ============================================================
var _termHistory = [];
var _termHistoryIdx = -1;

async function executeTerminalCmd() {
  var input = document.getElementById('terminalInput');
  var cmd = input.value.trim();
  if (!cmd) return;
  
  // Store in history
  _termHistory.unshift(cmd);
  if (_termHistory.length > 50) _termHistory.pop();
  _termHistoryIdx = -1;
  input.value = '';

  var output = document.getElementById('terminalOutput');
  output.innerHTML += '<div class="text-green-400">$ ' + escapeHtml(cmd) + '</div>';
  output.innerHTML += '<div class="text-gray-500 term-loading"><i class="fas fa-spinner fa-spin"></i> Running...</div>';
  output.scrollTop = output.scrollHeight;

  try {
    var resp = await fetch('/api/system/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, workspaceId: currentWorkspace || 'default' }),
    });
    var data = await resp.json();
    // Remove loading indicator
    var loading = output.querySelector('.term-loading');
    if (loading) loading.remove();

    if (data.success && data.data) {
      var d = data.data;
      if (d.output) {
        output.innerHTML += '<div class="text-gray-300 whitespace-pre-wrap">' + escapeHtml(d.output) + '</div>';
      }
      if (d.stderr) {
        output.innerHTML += '<div class="text-red-400 whitespace-pre-wrap">' + escapeHtml(d.stderr) + '</div>';
      }
      if (d.exitCode !== 0) {
        output.innerHTML += '<div class="text-red-400">Exit code: ' + d.exitCode + '</div>';
      }
    } else {
      output.innerHTML += '<div class="text-red-400">Error: ' + (data.error ? data.error.message : 'Unknown error') + '</div>';
    }
  } catch (err) {
    var loading2 = output.querySelector('.term-loading');
    if (loading2) loading2.remove();
    output.innerHTML += '<div class="text-red-400">Error: ' + err.message + '</div>';
  }
  output.scrollTop = output.scrollHeight;
}

function clearTerminal() {
  var output = document.getElementById('terminalOutput');
  output.innerHTML = '<div class="text-gray-500">Terminal cleared.</div>';
}

// Terminal history navigation
document.addEventListener('keydown', function(e) {
  var input = document.getElementById('terminalInput');
  if (document.activeElement !== input) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _termHistoryIdx = Math.min(_termHistoryIdx + 1, _termHistory.length - 1);
    if (_termHistory[_termHistoryIdx]) input.value = _termHistory[_termHistoryIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    _termHistoryIdx = Math.max(_termHistoryIdx - 1, -1);
    input.value = _termHistoryIdx >= 0 ? _termHistory[_termHistoryIdx] : '';
  }
});

// ============================================================
// SETTINGS
// ============================================================
// ============================================================
// DEPLOY STATUS
// ============================================================
async function loadDeployStatus() {
  try {
    var resp = await fetch('/api/system/deploy/status');
    var data = await resp.json();
    if (!data.success) return;
    var histEl = document.getElementById('deployHistory');
    if (!histEl) return;
    var deps = data.data.deployments || [];
    if (deps.length === 0) {
      histEl.innerHTML = '<div class="text-xs text-gray-400 text-center py-4"><i class="fas fa-rocket text-gray-300 text-2xl mb-2 block"></i>No deployments yet. Deploy your workspace to see history.</div>';
      return;
    }
    histEl.innerHTML = deps.map(function(d) {
      var statusColors = { deployed: 'bg-green-500', building: 'bg-yellow-500', pending: 'bg-blue-500', failed: 'bg-red-500' };
      var dot = statusColors[d.status] || 'bg-gray-400';
      var time = new Date(d.timestamp).toLocaleString();
      return '<div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">' +
        '<div class="w-2 h-2 rounded-full ' + dot + ' shrink-0"></div>' +
        '<div class="flex-1 min-w-0"><div class="text-xs font-medium text-gray-700">' + (d.platform || 'unknown') + '</div>' +
        '<div class="text-[10px] text-gray-400">' + time + (d.url ? ' · <a href="' + d.url + '" target="_blank" class="text-indigo-500 hover:underline">' + d.url + '</a>' : '') + '</div></div>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">' + d.status + '</span></div>';
    }).join('');
  } catch (err) {
    var histEl2 = document.getElementById('deployHistory');
    if (histEl2) histEl2.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">Could not load deploy status</div>';
  }
}

// ============================================================
// GIT STATUS
// ============================================================
async function loadGitStatus() {
  try {
    var resp = await fetch('/api/system/git/status?workspaceId=' + encodeURIComponent(currentWorkspace || 'default'));
    var data = await resp.json();
    if (!data.success) return;
    var d = data.data;

    // Status dot
    var dotEl = document.getElementById('gitStatusDot');
    if (dotEl) dotEl.className = 'w-2 h-2 rounded-full ' + (d.isGitRepo ? (d.isClean ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-300');

    // Branch name
    var branchEl = document.getElementById('gitBranchName');
    if (branchEl) branchEl.textContent = d.isGitRepo ? (d.branch || 'detached') : 'Not a git repo';

    // Clean badge
    var cleanEl = document.getElementById('gitCleanBadge');
    if (cleanEl) {
      if (d.isGitRepo) {
        cleanEl.textContent = d.isClean ? 'Clean' : d.changedFileCount + ' changed';
        cleanEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full ' + (d.isClean ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600');
      } else {
        cleanEl.textContent = 'No git';
        cleanEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500';
      }
    }

    // Remote URL
    var remoteEl = document.getElementById('gitRemoteUrl');
    if (remoteEl) remoteEl.textContent = d.remoteUrl || 'No remote configured';

    // Changed files
    var changedEl = document.getElementById('gitChangedFiles');
    if (changedEl) {
      if (d.changes && d.changes.length > 0) {
        changedEl.innerHTML = d.changes.slice(0, 8).map(function(ch) {
          var statusColors = { M: 'text-yellow-500', A: 'text-green-500', D: 'text-red-500', '??': 'text-blue-500' };
          var color = statusColors[ch.status] || 'text-gray-400';
          return '<div class="flex items-center gap-1"><span class="font-mono ' + color + ' w-4">' + ch.status + '</span><span class="text-gray-600 truncate">' + ch.file + '</span></div>';
        }).join('') + (d.changes.length > 8 ? '<div class="text-gray-400">... and ' + (d.changes.length - 8) + ' more</div>' : '');
      } else {
        changedEl.innerHTML = '';
      }
    }

    // Commit history
    var histEl = document.getElementById('gitCommitHistory');
    if (histEl) {
      if (d.commits && d.commits.length > 0) {
        histEl.innerHTML = d.commits.map(function(c) {
          return '<div class="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">' +
            '<span class="text-[10px] font-mono text-indigo-500 shrink-0">' + c.hash + '</span>' +
            '<span class="text-xs text-gray-600 truncate">' + escapeHtml(c.message) + '</span></div>';
        }).join('');
      } else {
        histEl.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">No commits</div>';
      }
    }
  } catch (err) {
    var histEl2 = document.getElementById('gitCommitHistory');
    if (histEl2) histEl2.innerHTML = '<div class="text-xs text-red-400 text-center py-2">Failed to load git status</div>';
  }
}

function showSettings() { document.getElementById('settingsModal').style.display = 'flex'; loadSystemInfo(); }
function hideSettings() { document.getElementById('settingsModal').style.display = 'none'; }

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    if (data.success) {
      const d = data.data, ws = d.websocket || {}, costs = d.costs || {};
      document.getElementById('systemInfo').innerHTML = `
        <div class="space-y-1.5">
          <div>Status: <span class="text-green-600 font-semibold">${d.status}</span></div>
          <div>Version: <span class="text-indigo-600">${d.version || '1.9.0'}</span></div>
          <div>Database: <span class="${d.database==='connected'?'text-green-600':'text-red-500'}">${d.database}</span></div>
          <div>Redis: <span class="${(d.redis||'')=='connected'?'text-green-600':'text-red-500'}">${d.redis||'unknown'}</span></div>
          <div>ChromaDB: <span class="${(d.chromadb||'')=='connected'?'text-green-600':'text-red-500'}">${d.chromadb||'unknown'}</span></div>
          <div>LLM Providers: <span class="text-indigo-600">${d.llmProviders.join(', ')}</span></div>
          <div>Tools: <span class="text-indigo-600">${d.toolCount}</span></div>
          <div>Memory: ${d.memory.used} / ${d.memory.total}</div>
          <div>WebSocket Clients: <span class="text-indigo-600">${ws.connectedClients || 0}</span></div>
          <div>Session Cost: <span class="text-yellow-600">$${(costs.sessionTotal||0).toFixed(6)}</span></div>
          <div>Uptime: ${Math.floor(d.uptime / 60)} min</div>
        </div>`;
    }
  } catch { document.getElementById('systemInfo').innerHTML = '<div class="text-red-500">Could not load</div>'; }
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function agentBadgeColor(agent) {
  const colors = {
    code: 'bg-blue-100 text-blue-700',
    design: 'bg-pink-100 text-pink-700',
    test: 'bg-green-100 text-green-700',
    reviewer: 'bg-orange-100 text-orange-700',
    deploy: 'bg-purple-100 text-purple-700',
    rag: 'bg-yellow-100 text-yellow-700',
    router: 'bg-gray-100 text-gray-700',
  };
  return colors[agent] || colors.router;
}
function renderMarkdown(t) { if (!t) return ''; try { return marked.parse(t); } catch { return escapeHtml(t); } }
function truncateArgs(a) { const s = typeof a === 'string' ? a : JSON.stringify(a); return s.length > 80 ? s.substring(0,80)+'...' : s; }
function formatSize(b) { if (!b) return '0 B'; if (b < 1024) return b+' B'; if (b < 1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
function handleInputKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function updateSendButton(s) {
  // Update home send button
  const b = document.getElementById('sendBtn');
  if (b) { b.innerHTML = s ? '<i class="fas fa-spinner fa-spin" style="font-size:10px"></i> <span>Sending</span>' : '<i class="fas fa-plus" style="font-size:10px"></i> <span>Send</span>'; b.disabled = s; }
  // Update active chat send button
  const b2 = document.getElementById('sendBtnActive');
  if (b2) { b2.innerHTML = s ? '<i class="fas fa-spinner fa-spin text-white text-xs"></i>' : '<i class="fas fa-arrow-up text-white text-xs"></i>'; b2.disabled = s; }
}
function updateTokenCounter() {
  const text = `Tokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(4)}`;
  const el1 = document.getElementById('tokenCounter'); if (el1) el1.textContent = text;
  const el2 = document.getElementById('tokenCounterActive'); if (el2) el2.textContent = text;
}
function copyCode(btn) { const code = btn.closest('.mt-3').querySelector('code').textContent; navigator.clipboard.writeText(code); btn.innerHTML = '<i class="fas fa-check text-green-500"></i>'; setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i>', 2000); }
