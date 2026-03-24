// ============================================================
// AGENTIC RAG PLATFORM — Frontend v1.2 (Light Theme)
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

  // Toggle off if clicking the same one
  if (activeSidebar === name && name !== 'chat') {
    closeSidePanel();
    return;
  }

  // Highlight active button
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sidebar-btn[data-sidebar="${name}"]`);
  if (btn) btn.classList.add('active');

  activeSidebar = name;

  // "chat" = toggle conversation history panel
  if (name === 'chat') {
    if (activeSidebar === 'chat') {
      closeSidePanel();
      return;
    }
    panel.style.display = 'flex';
    title.textContent = 'Conversations';
    content.innerHTML = buildConversationListPanel();
    loadConversationList();
    activeSidebar = 'chat';
    return;
  }

  // Show slide-out panel
  panel.style.display = 'flex';

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
    case 'workflows':
      title.textContent = 'Workflows';
      content.innerHTML = buildWorkflowsPanel();
      break;
  }
}

function closeSidePanel() {
  document.getElementById('sidePanel').style.display = 'none';
  if (activeSidebar && activeSidebar !== 'chat') {
    document.querySelectorAll('.sidebar-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sidebar === 'chat');
    });
  }
  activeSidebar = null;
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
  document.getElementById('chatMessages').innerHTML = '';
  addWelcomeMessage();
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
    const el = document.getElementById(`wspanel-${p}`);
    if (!el) return;
    if (p === tab) {
      // Terminal needs flex layout, others block/flex
      el.style.display = (p === 'terminal') ? 'flex' : '';
      el.style.display = el.style.display || ''; // reset to CSS default
      // For non-terminal panels, just remove display:none
      if (p !== 'terminal') el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // Load data on switch
  if (tab === 'explorer') refreshFileTree();
  if (tab === 'metrics') loadMetrics();
}

async function loadMetrics() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    if (data.success) {
      const d = data.data;
      const grid = document.getElementById('metricsGrid');
      const placeholder = document.getElementById('metricsPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      grid.innerHTML = [
        { label: 'Status', value: d.status, color: 'text-green-600' },
        { label: 'Version', value: d.version || '1.1.0', color: 'text-indigo-600' },
        { label: 'Tools', value: d.toolCount, color: 'text-blue-600' },
        { label: 'Memory', value: d.memory.used, color: 'text-yellow-600' },
        { label: 'Uptime', value: Math.floor(d.uptime / 60) + ' min', color: 'text-gray-700' },
        { label: 'Database', value: d.database, color: d.database === 'connected' ? 'text-green-600' : 'text-red-500' },
        { label: 'Session Tokens', value: totalTokens.toLocaleString(), color: 'text-purple-600' },
        { label: 'Session Cost', value: '$' + totalCost.toFixed(4), color: 'text-orange-600' },
      ].map(m => `
        <div class="bg-gray-50 rounded-xl p-4 border border-gray-200">
          <div class="text-xs text-gray-400 mb-1">${m.label}</div>
          <div class="text-lg font-bold ${m.color}">${m.value}</div>
        </div>`).join('');
    }
  } catch {
    document.getElementById('metricsGrid').innerHTML = '<div class="col-span-2 text-center text-xs text-red-400 py-4">Could not load metrics</div>';
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

setInterval(() => { sendWSMessage('ping', { timestamp: Date.now() }); }, 30000);

// ============================================================
// CHAT
// ============================================================
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || isStreaming) return;

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
}

function sendQuickAction(msg) {
  document.getElementById('chatInput').value = msg;
  sendMessage();
}

// ============================================================
// SSE HANDLER
// ============================================================
function handleSSEEvent(event, contentDiv, tracePanel) {
  switch (event.type) {
    case 'thinking':
      addTraceItem(tracePanel, event.data.content, 'fas fa-brain', 'text-purple-500');
      showThinking(contentDiv, event.data.content);
      break;
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
    case 'tool_call':
      addTraceItem(tracePanel,
        `<span class="text-yellow-600 font-semibold">${event.data.toolName}</span>(${truncateArgs(event.data.toolArgs)})`,
        'fas fa-wrench', 'text-yellow-500');
      showToolCall(contentDiv, event.data.toolName, event.data.toolArgs);
      break;
    case 'tool_result':
      addTraceItem(tracePanel,
        `${event.data.toolName}: ${event.data.success ? '<span class="text-green-600">OK</span>' : '<span class="text-red-500">Fail</span>'} (${event.data.durationMs}ms)`,
        event.data.success ? 'fas fa-check-circle' : 'fas fa-times-circle',
        event.data.success ? 'text-green-500' : 'text-red-500');
      showToolResult(contentDiv, event.data);
      break;
    case 'component':
      renderGenUIComponent(contentDiv, event.data);
      break;
    case 'approval':
      addTraceItem(tracePanel, event.data.message, 'fas fa-shield-alt', 'text-orange-500');
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
// TERMINAL
// ============================================================
function executeTerminalCmd() {
  const input = document.getElementById('terminalInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  document.getElementById('terminalOutput').innerHTML += `<div class="text-green-400">$ ${escapeHtml(cmd)}</div>`;
  input.value = '';
  sendQuickAction(`Run this command in the workspace: ${cmd}`);
}

// ============================================================
// SETTINGS
// ============================================================
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
          <div>Version: <span class="text-indigo-600">${d.version || '1.1.0'}</span></div>
          <div>Database: <span class="${d.database==='connected'?'text-green-600':'text-red-500'}">${d.database}</span></div>
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
function renderMarkdown(t) { if (!t) return ''; try { return marked.parse(t); } catch { return escapeHtml(t); } }
function truncateArgs(a) { const s = typeof a === 'string' ? a : JSON.stringify(a); return s.length > 80 ? s.substring(0,80)+'...' : s; }
function formatSize(b) { if (!b) return '0 B'; if (b < 1024) return b+' B'; if (b < 1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
function handleInputKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function updateSendButton(s) { const b = document.getElementById('sendBtn'); b.innerHTML = s ? '<i class="fas fa-spinner fa-spin text-white text-xs"></i>' : '<i class="fas fa-arrow-up text-white text-xs"></i>'; b.disabled = s; }
function updateTokenCounter() { document.getElementById('tokenCounter').textContent = `Tokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(4)}`; }
function copyCode(btn) { const code = btn.closest('.mt-3').querySelector('code').textContent; navigator.clipboard.writeText(code); btn.innerHTML = '<i class="fas fa-check text-green-500"></i>'; setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i>', 2000); }
