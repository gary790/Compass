// ============================================================
// AGENTIC RAG PLATFORM — Frontend Application v1.2
// New layout: Narrow sidebar + Chat | Workspace panels
// ============================================================

// --- State ---
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

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  loadWorkspaces();
  loadWorkspace('default');
  loadRAGDocs();
  loadSystemInfo();
  connectWebSocket();
  setupResizeHandle();
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });
});

// ============================================================
// NARROW SIDEBAR NAVIGATION
// ============================================================
function switchSidebar(name) {
  const panel = document.getElementById('sidePanel');
  const title = document.getElementById('sidePanelTitle');
  const content = document.getElementById('sidePanelContent');

  // Toggle off if same
  if (activeSidebar === name) {
    closeSidePanel();
    return;
  }

  // Update active button
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sidebar-btn[data-sidebar="${name}"]`);
  if (btn) btn.classList.add('active');

  activeSidebar = name;

  // Special actions (chat just focuses input, no panel)
  if (name === 'chat') {
    closeSidePanel();
    document.getElementById('chatInput').focus();
    // Also start a new conversation
    currentConversationId = null;
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.innerHTML = '';
    addWelcomeMessage();
    return;
  }

  // Show expandable side panel with appropriate content
  panel.classList.remove('hidden');
  panel.classList.add('flex');

  switch (name) {
    case 'agents':
      title.textContent = 'Agents';
      content.innerHTML = buildAgentsPanel();
      break;
    case 'explorer':
      title.textContent = 'File Explorer';
      content.innerHTML = buildExplorerSideContent();
      refreshFileTree();
      break;
    case 'rag':
      title.textContent = 'Knowledge Base';
      content.innerHTML = buildRAGSideContent();
      loadRAGDocs();
      break;
    case 'tools':
      title.textContent = 'Tools';
      content.innerHTML = '<div class="text-xs text-gray-500 py-4">Loading tools...</div>';
      loadToolsList();
      break;
    case 'workflows':
      title.textContent = 'Workflows';
      content.innerHTML = buildWorkflowsPanel();
      break;
  }
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.add('hidden');
  panel.classList.remove('flex');
  // Don't deselect "chat" button
  if (activeSidebar !== 'chat') {
    document.querySelectorAll('.sidebar-btn').forEach(b => {
      if (b.dataset.sidebar === 'chat') b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  activeSidebar = null;
}

function buildAgentsPanel() {
  const agents = [
    { icon: 'fa-lightbulb', name: 'Planner', desc: 'Task decomposition & planning', color: 'text-yellow-400' },
    { icon: 'fa-code', name: 'Coder', desc: 'Write & edit code', color: 'text-blue-400' },
    { icon: 'fa-terminal', name: 'Executor', desc: 'Run commands & builds', color: 'text-green-400' },
    { icon: 'fa-search', name: 'Researcher', desc: 'Search web & knowledge', color: 'text-purple-400' },
    { icon: 'fa-file-alt', name: 'Writer', desc: 'Documentation & content', color: 'text-pink-400' },
    { icon: 'fa-bug', name: 'Debugger', desc: 'Find & fix errors', color: 'text-red-400' },
    { icon: 'fa-cloud', name: 'DevOps', desc: 'Deploy & infrastructure', color: 'text-orange-400' },
  ];
  return `<div class="space-y-1.5">${agents.map(a => `
    <div class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-700 cursor-pointer transition text-xs"
         onclick="sendQuickAction('Use the ${a.name} agent to help me')">
      <div class="w-7 h-7 rounded-md bg-surface-700 flex items-center justify-center shrink-0">
        <i class="fas ${a.icon} ${a.color}" style="font-size:11px"></i>
      </div>
      <div>
        <div class="text-gray-200 font-medium">${a.name}</div>
        <div class="text-gray-500" style="font-size:10px">${a.desc}</div>
      </div>
    </div>`).join('')}</div>`;
}

function buildExplorerSideContent() {
  return `
    <div class="flex items-center justify-between mb-2">
      <select id="workspaceSelectSide" onchange="loadWorkspace(this.value)"
        class="bg-surface-700 border border-gray-600/50 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500 flex-1 mr-2">
        <option value="default">default</option>
      </select>
      <button onclick="refreshFileTree()" class="text-gray-500 hover:text-gray-300 text-xs px-1"><i class="fas fa-sync-alt"></i></button>
    </div>
    <div id="fileTreeSide" class="text-sm">
      <div class="text-gray-500 text-xs py-4">Loading files...</div>
    </div>`;
}

function buildRAGSideContent() {
  return `
    <div id="ragDocCountSide" class="text-xs text-gray-500 mb-3">0 documents indexed</div>
    <button onclick="showRAGPanel()" class="w-full px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium transition">
      <i class="fas fa-plus mr-1"></i>Add Document
    </button>
    <div id="ragDocListSide" class="mt-3 space-y-1.5"></div>`;
}

function buildWorkflowsPanel() {
  const flows = [
    { icon: 'fa-rocket', name: 'Full Stack App', desc: 'Plan → Code → Test → Deploy' },
    { icon: 'fa-book', name: 'Research & Write', desc: 'Search → Analyze → Document' },
    { icon: 'fa-code-branch', name: 'PR Review', desc: 'Fetch → Review → Comment' },
    { icon: 'fa-database', name: 'RAG Pipeline', desc: 'Ingest → Chunk → Embed → Index' },
  ];
  return `<div class="space-y-1.5">${flows.map(f => `
    <div class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-700 cursor-pointer transition text-xs"
         onclick="sendQuickAction('Run the ${f.name} workflow')">
      <div class="w-7 h-7 rounded-md bg-surface-700 flex items-center justify-center shrink-0">
        <i class="fas ${f.icon} text-primary-400" style="font-size:11px"></i>
      </div>
      <div>
        <div class="text-gray-200 font-medium">${f.name}</div>
        <div class="text-gray-500" style="font-size:10px">${f.desc}</div>
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
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">${cat}</div>
          <div class="space-y-0.5">
            ${tools.map(t => `<div class="text-xs py-1 px-2 rounded hover:bg-surface-700 cursor-pointer transition flex items-center gap-1.5" title="${t.description}">
              <i class="fas fa-wrench text-gray-600" style="font-size:9px"></i>
              <span class="text-gray-300">${t.name}</span>
              ${t.riskLevel === 'high' ? '<span class="text-red-400 ml-auto" style="font-size:9px"><i class="fas fa-exclamation-triangle"></i></span>' : ''}
            </div>`).join('')}
          </div>
        </div>`;
      }
      content.innerHTML = html || '<div class="text-xs text-gray-500 py-4">No tools loaded</div>';
    }
  } catch {
    content.innerHTML = '<div class="text-xs text-gray-500 py-4">Could not load tools</div>';
  }
}

// ============================================================
// WORKSPACE TABS (right panel)
// ============================================================
function switchWorkspaceTab(tab) {
  activeWorkspaceTab = tab;

  // Update tab buttons
  document.querySelectorAll('.ws-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.wstab === tab);
  });

  // Show/hide panels
  const panels = ['preview', 'explorer', 'trace', 'terminal', 'deploy', 'github', 'metrics'];
  panels.forEach(p => {
    const el = document.getElementById(`wspanel-${p}`);
    if (el) {
      el.classList.toggle('hidden', p !== tab);
      // For terminal, make sure flexbox is set
      if (p === 'terminal' && p === tab) {
        el.classList.add('flex');
      } else if (p === 'terminal') {
        el.classList.remove('flex');
      }
    }
  });

  // Trigger data loads
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
      if (placeholder) placeholder.classList.add('hidden');
      grid.innerHTML = `
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Status</div>
          <div class="text-lg font-bold text-green-400">${d.status}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Version</div>
          <div class="text-lg font-bold text-primary-400">${d.version || '1.1.0'}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Tools</div>
          <div class="text-lg font-bold text-blue-400">${d.toolCount}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Memory</div>
          <div class="text-lg font-bold text-yellow-400">${d.memory.used}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Uptime</div>
          <div class="text-lg font-bold text-gray-300">${Math.floor(d.uptime / 60)} min</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Database</div>
          <div class="text-lg font-bold ${d.database === 'connected' ? 'text-green-400' : 'text-red-400'}">${d.database}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Session Tokens</div>
          <div class="text-lg font-bold text-purple-400">${totalTokens.toLocaleString()}</div>
        </div>
        <div class="bg-surface-800 rounded-xl p-4 border border-gray-700/50">
          <div class="text-xs text-gray-500 mb-1">Session Cost</div>
          <div class="text-lg font-bold text-orange-400">$${totalCost.toFixed(4)}</div>
        </div>`;
    }
  } catch {
    document.getElementById('metricsGrid').innerHTML = '<div class="col-span-2 text-center text-xs text-red-400 py-4">Could not load metrics</div>';
  }
}

// ============================================================
// RESIZE HANDLE — drag between chat and workspace
// ============================================================
function setupResizeHandle() {
  const handle = document.getElementById('mainResize');
  const chatPane = document.getElementById('chatPane');
  if (!handle || !chatPane) return;

  let isDragging = false;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = chatPane.parentElement;
    const rect = container.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    if (newWidth > 20 && newWidth < 80) {
      chatPane.style.width = newWidth + '%';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
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
  const frame = document.getElementById('previewFrame');
  const placeholder = document.getElementById('previewPlaceholder');
  const urlInput = document.getElementById('previewUrl');

  urlInput.value = url;
  if (placeholder) placeholder.classList.add('hidden');
  frame.classList.remove('hidden');
  frame.src = url;
  switchWorkspaceTab('preview');
}

// ============================================================
// WEBSOCKET — Real-time agent events
// ============================================================
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsReconnectAttempt = 0;
      updateConnectionStatus('connected');
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      } catch (e) {
        console.warn('[WS] Invalid message:', e);
      }
    };

    ws.onclose = () => {
      updateConnectionStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error:', err);
      updateConnectionStatus('error');
    };
  } catch (e) {
    console.warn('[WS] Connection failed:', e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectAttempt++;
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempt), 30000);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case 'system_event':
      if (msg.payload?.event === 'connected') {
        console.log('[WS] Server acknowledged:', msg.payload.clientId);
      }
      break;
    case 'agent_event':
      const tracePanel = document.getElementById('wspanel-trace');
      if (tracePanel && msg.payload) handleWSAgentEvent(msg.payload, tracePanel);
      break;
    case 'pong':
      break;
    default:
      console.debug('[WS] Unhandled:', msg.type);
  }
}

function handleWSAgentEvent(event, tracePanel) {
  // Background agent events
}

function updateConnectionStatus(status) {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const configs = {
    connected: { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-400', label: 'Live' },
    disconnected: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-400', label: 'Reconnecting' },
    error: { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400', label: 'Disconnected' },
  };
  const c = configs[status] || configs.error;
  badge.className = `flex items-center gap-1.5 px-2 py-1 rounded-full ${c.bg} ${c.text} text-xs`;
  badge.innerHTML = `<div class="w-1.5 h-1.5 rounded-full ${c.dot}"></div><span>${c.label}</span>`;
}

function sendWSMessage(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, id: Date.now().toString(36), payload }));
  }
}

// Heartbeat
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendWSMessage('ping', { timestamp: Date.now() });
  }
}, 30000);

// ============================================================
// CHAT — Send message and handle SSE streaming
// ============================================================
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || isStreaming) return;

  input.value = '';
  autoResize(input);
  isStreaming = true;
  updateSendButton(true);

  addChatMessage('user', message);

  // Switch workspace panel to Trace for live agent feedback
  switchWorkspaceTab('trace');
  const tracePanel = document.getElementById('wspanel-trace');
  tracePanel.innerHTML = '';

  const assistantDiv = addChatMessage('assistant', '', true);
  const contentDiv = assistantDiv.querySelector('.message-content');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversationId: currentConversationId,
        workspaceId: currentWorkspace,
      }),
    });

    currentConversationId = response.headers.get('X-Conversation-Id') || currentConversationId;

    const reader = response.body.getReader();
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
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event, contentDiv, tracePanel);
          } catch {}
        }
      }
    }
  } catch (error) {
    contentDiv.innerHTML = `<div class="text-red-400"><i class="fas fa-exclamation-triangle mr-1"></i>${error.message}</div>`;
  }

  isStreaming = false;
  updateSendButton(false);
  refreshFileTree();
}

function sendQuickAction(message) {
  document.getElementById('chatInput').value = message;
  sendMessage();
}

// ============================================================
// SSE EVENT HANDLER
// ============================================================
function handleSSEEvent(event, contentDiv, tracePanel) {
  switch (event.type) {
    case 'thinking':
      addTraceItem(tracePanel, 'thinking', event.data.content, 'fas fa-brain', 'text-purple-400');
      showThinking(contentDiv, event.data.content);
      break;

    case 'text':
      removeThinking(contentDiv);
      if (event.data.delta) {
        appendText(contentDiv, event.data.content);
      } else {
        contentDiv.innerHTML = renderMarkdown(event.data.content);
      }
      break;

    case 'tool_call':
      addTraceItem(tracePanel, 'tool_call',
        `<span class="text-yellow-400">${event.data.toolName}</span>(${truncateArgs(event.data.toolArgs)})`,
        'fas fa-wrench', 'text-yellow-400'
      );
      showToolCall(contentDiv, event.data.toolName, event.data.toolArgs);
      break;

    case 'tool_result':
      addTraceItem(tracePanel, 'tool_result',
        `${event.data.toolName}: ${event.data.success ? '<span class="text-green-400">Success</span>' : '<span class="text-red-400">Failed</span>'} (${event.data.durationMs}ms)`,
        event.data.success ? 'fas fa-check-circle' : 'fas fa-times-circle',
        event.data.success ? 'text-green-400' : 'text-red-400'
      );
      showToolResult(contentDiv, event.data);
      break;

    case 'component':
      renderGenUIComponent(contentDiv, event.data);
      break;

    case 'approval':
      addTraceItem(tracePanel, 'approval', event.data.message, 'fas fa-shield-alt', 'text-orange-400');
      break;

    case 'error':
      addTraceItem(tracePanel, 'error', event.data.message, 'fas fa-exclamation-triangle', 'text-red-400');
      contentDiv.innerHTML += `<div class="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
        <i class="fas fa-exclamation-triangle mr-1"></i>${event.data.message}</div>`;
      break;

    case 'done':
      removeThinking(contentDiv);
      if (event.data.usage) {
        totalTokens += event.data.usage.totalTokens || 0;
        totalCost += event.data.usage.totalCostUSD || 0;
        updateTokenCounter();
      }
      addTraceItem(tracePanel, 'done',
        `Completed in ${((event.data.usage?.totalDurationMs || 0) / 1000).toFixed(1)}s`,
        'fas fa-flag-checkered', 'text-green-400'
      );
      break;
  }

  const chatDiv = document.getElementById('chatMessages');
  chatDiv.scrollTop = chatDiv.scrollHeight;
  tracePanel.scrollTop = tracePanel.scrollHeight;
}

// ============================================================
// CHAT UI HELPERS
// ============================================================
function addWelcomeMessage() {
  const chatDiv = document.getElementById('chatMessages');
  chatDiv.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="text-center py-16">
        <div class="w-16 h-16 bg-primary-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-robot text-primary-400 text-2xl"></i>
        </div>
        <h2 class="text-xl font-bold text-white mb-2">Chat to build anything</h2>
        <p class="text-gray-400 text-sm max-w-md mx-auto mb-8">
          Write code, search knowledge base, manage files, deploy — all in natural language.
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <button onclick="sendQuickAction('Show me the system status and available tools')"
            class="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-gray-300 transition border border-gray-700/50">
            <i class="fas fa-heartbeat mr-1 text-green-400"></i>System Status
          </button>
          <button onclick="sendQuickAction('Create a new Hono web app with a REST API and Tailwind frontend')"
            class="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-gray-300 transition border border-gray-700/50">
            <i class="fas fa-code mr-1 text-blue-400"></i>Create Web App
          </button>
          <button onclick="sendQuickAction('Search the web for the latest Hono framework features')"
            class="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-gray-300 transition border border-gray-700/50">
            <i class="fas fa-search mr-1 text-yellow-400"></i>Web Search
          </button>
          <button onclick="sendQuickAction('List my GitHub repositories')"
            class="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-gray-300 transition border border-gray-700/50">
            <i class="fab fa-github mr-1 text-gray-400"></i>GitHub Repos
          </button>
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
      <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isUser ? 'bg-primary-600' : 'bg-surface-700'}">
        <i class="fas ${isUser ? 'fa-user' : 'fa-robot'} text-xs ${isUser ? 'text-white' : 'text-primary-400'}"></i>
      </div>
      <div class="flex-1 ${isUser ? 'text-right' : ''} min-w-0">
        <div class="message-content inline-block text-left rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser ? 'bg-primary-600 text-white rounded-tr-sm max-w-[85%]' : 'bg-surface-700 text-gray-200 rounded-tl-sm w-full'}">
          ${placeholder ? '<div class="thinking-indicator"><span class="thinking-dot inline-block w-1.5 h-1.5 bg-primary-400 rounded-full mx-0.5"></span><span class="thinking-dot inline-block w-1.5 h-1.5 bg-primary-400 rounded-full mx-0.5" style="animation-delay:0.2s"></span><span class="thinking-dot inline-block w-1.5 h-1.5 bg-primary-400 rounded-full mx-0.5" style="animation-delay:0.4s"></span></div>' : (isUser ? escapeHtml(content) : renderMarkdown(content))}
        </div>
      </div>
    </div>`;

  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
  return div;
}

function showThinking(div, text) {
  const existing = div.querySelector('.thinking-indicator');
  if (existing) {
    existing.innerHTML = `<span class="text-gray-400 text-xs"><i class="fas fa-brain mr-1 text-purple-400"></i>${escapeHtml(text)}</span>`;
  }
}

function removeThinking(div) {
  const indicator = div.querySelector('.thinking-indicator');
  if (indicator) indicator.remove();
}

function appendText(div, text) {
  const existing = div.querySelector('.streamed-text');
  if (existing) {
    existing.textContent += text;
  } else {
    div.innerHTML += `<span class="streamed-text">${escapeHtml(text)}</span>`;
  }
}

function showToolCall(div, toolName, args) {
  div.innerHTML += `
    <div class="tool-execution mt-2 p-2 bg-surface-800 rounded-lg border border-gray-700/50 text-xs">
      <div class="flex items-center gap-2 text-yellow-400">
        <i class="fas fa-wrench" style="font-size:10px"></i>
        <span class="font-semibold">${toolName}</span>
        <div class="flex-1"></div>
        <div class="thinking-dot inline-block w-1.5 h-1.5 bg-yellow-400 rounded-full"></div>
      </div>
      <div class="mt-1 text-gray-500 font-mono text-[11px] truncate">${truncateArgs(args)}</div>
    </div>`;
}

function showToolResult(div, data) {
  const lastTool = div.querySelector('.tool-execution:last-child');
  if (lastTool) {
    const dot = lastTool.querySelector('.thinking-dot');
    if (dot) {
      dot.className = `inline-block w-1.5 h-1.5 rounded-full ${data.success ? 'bg-green-400' : 'bg-red-400'}`;
      dot.style.animation = 'none';
    }
    if (data.output && typeof data.output === 'object') {
      const preview = JSON.stringify(data.output, null, 2).substring(0, 300);
      lastTool.innerHTML += `<pre class="mt-1 text-gray-400 overflow-x-auto max-h-24 overflow-y-auto text-[11px]"><code>${escapeHtml(preview)}</code></pre>`;
    }
  }
}

// ============================================================
// GENUI COMPONENT RENDERER
// ============================================================
function renderGenUIComponent(div, data) {
  const { name, props } = data;

  switch (name) {
    case 'chart':
      const chartId = 'chart-' + Date.now();
      div.innerHTML += `<div class="mt-3 p-3 bg-surface-800 rounded-lg border border-gray-700/30"><canvas id="${chartId}" height="200"></canvas></div>`;
      setTimeout(() => {
        const ctx = document.getElementById(chartId);
        if (ctx) new Chart(ctx, { type: props.type || 'bar', data: { labels: props.labels, datasets: props.datasets }, options: { responsive: true, plugins: { title: { display: !!props.title, text: props.title } } } });
      }, 100);
      break;

    case 'table':
      let tableHTML = `<div class="mt-3 overflow-x-auto rounded-lg border border-gray-700/30"><table class="w-full text-xs">
        <thead><tr class="bg-surface-700">${(props.headers || []).map(h => `<th class="px-3 py-2 text-left text-gray-400">${h}</th>`).join('')}</tr></thead>
        <tbody>${(props.rows || []).map(row => `<tr class="border-t border-gray-700/30">${row.map(cell => `<td class="px-3 py-2">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      div.innerHTML += tableHTML;
      break;

    case 'code_block':
      const highlighted = props.language && hljs.getLanguage(props.language)
        ? hljs.highlight(props.code, { language: props.language }).value
        : escapeHtml(props.code);
      div.innerHTML += `<div class="mt-3">
        ${props.filename ? `<div class="bg-surface-700 px-3 py-1.5 rounded-t-lg text-xs text-gray-400 flex justify-between items-center"><span><i class="fas fa-file-code mr-1"></i>${props.filename}</span><button onclick="copyCode(this)" class="hover:text-white transition"><i class="fas fa-copy"></i></button></div>` : ''}
        <pre class="bg-surface-800 rounded-${props.filename ? 'b' : ''}-lg p-3 overflow-x-auto border border-gray-700/30"><code class="language-${props.language || 'text'}">${highlighted}</code></pre></div>`;
      break;

    case 'terminal':
      div.innerHTML += `<div class="mt-3 bg-black/50 rounded-lg p-3 font-mono text-xs border border-gray-700/30">
        <div class="text-gray-500">$ ${escapeHtml(props.command || '')}</div>
        <div class="text-green-400 whitespace-pre-wrap">${escapeHtml(props.output || '')}</div>
        ${props.exitCode !== undefined ? `<div class="${props.exitCode === 0 ? 'text-green-400' : 'text-red-400'}">Exit code: ${props.exitCode}</div>` : ''}</div>`;
      break;

    case 'file_tree':
      div.innerHTML += `<div class="mt-3 p-3 bg-surface-800 rounded-lg text-xs border border-gray-700/30">${renderFileTreeHTML(props.files || [])}</div>`;
      break;

    case 'search_results':
      div.innerHTML += `<div class="mt-3 space-y-2">${(props.results || []).map(r => `
        <a href="${r.url}" target="_blank" class="block p-2.5 bg-surface-800 rounded-lg hover:bg-surface-700 transition border border-gray-700/30">
          <div class="text-sm text-primary-400 font-medium">${r.title}</div>
          <div class="text-xs text-gray-600 truncate">${r.url}</div>
          <div class="text-xs text-gray-400 mt-1">${r.snippet || ''}</div>
        </a>`).join('')}</div>`;
      break;

    case 'source_cards':
      div.innerHTML += `<div class="mt-3"><div class="text-xs text-gray-400 mb-2"><i class="fas fa-database mr-1"></i>Sources for: "${props.query}"</div>
        <div class="space-y-1">${(props.sources || []).map(s => `
          <div class="p-2 bg-surface-800 rounded border border-gray-700/30 text-xs">
            <div class="font-semibold text-gray-300">${s.documentTitle || 'Unknown'}</div>
            <div class="text-gray-400 mt-1">${(s.content || '').substring(0, 200)}...</div>
            <div class="text-gray-500 mt-1">Score: ${s.score || 0} | Type: ${s.searchType || 'hybrid'}</div>
          </div>`).join('')}</div></div>`;
      break;

    default:
      div.innerHTML += `<div class="mt-2 p-2 bg-surface-800 rounded-lg text-xs text-gray-400 border border-gray-700/30">
        <i class="fas fa-puzzle-piece mr-1"></i>Component: ${name}</div>`;
  }
}

// ============================================================
// TRACE PANEL
// ============================================================
function addTraceItem(panel, type, content, icon, color) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const div = document.createElement('div');
  div.className = 'flex gap-2 text-xs message-enter';
  div.innerHTML = `
    <span class="text-gray-600 shrink-0 w-14 font-mono">${time}</span>
    <i class="${icon} ${color} shrink-0 mt-0.5" style="font-size:10px"></i>
    <span class="text-gray-300 break-words min-w-0">${content}</span>`;
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
      // Update all workspace selectors
      const options = data.data.workspaces.length > 0
        ? data.data.workspaces.map(w => `<option value="${w.id}" ${w.id === currentWorkspace ? 'selected' : ''}>${w.name}</option>`).join('')
        : '<option value="default">default</option>';
      
      ['workspaceSelect', 'workspaceSelectSide'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
      });
    }
  } catch {}
}

async function loadWorkspace(id) {
  currentWorkspace = id;
  refreshFileTree();
}

async function refreshFileTree() {
  try {
    const res = await fetch(`/api/workspace/${currentWorkspace}/tree`);
    const data = await res.json();
    if (data.success) {
      const html = renderFileTreeHTML(data.data.tree);
      // Update both workspace explorer and sidebar tree
      const mainTree = document.getElementById('fileTree');
      if (mainTree) mainTree.innerHTML = html;
      const sideTree = document.getElementById('fileTreeSide');
      if (sideTree) sideTree.innerHTML = html;
    }
  } catch {
    const fallback = '<div class="text-gray-500 text-xs px-2">Could not load files</div>';
    const mainTree = document.getElementById('fileTree');
    if (mainTree) mainTree.innerHTML = fallback;
    const sideTree = document.getElementById('fileTreeSide');
    if (sideTree) sideTree.innerHTML = fallback;
  }
}

function renderFileTreeHTML(nodes, depth = 0) {
  if (!nodes || nodes.length === 0) return '<div class="text-gray-500 text-xs px-2">Empty</div>';

  return nodes.map(node => {
    const indent = depth * 14;
    const icon = node.type === 'directory'
      ? 'fas fa-folder text-yellow-500'
      : getFileIcon(node.name);

    if (node.type === 'directory') {
      return `<div>
        <div class="file-tree-item flex items-center gap-1.5" style="padding-left:${indent + 8}px" onclick="this.nextElementSibling.classList.toggle('hidden');this.querySelector('.fa-folder').classList.toggle('fa-folder-open')">
          <i class="${icon} text-xs"></i>
          <span class="text-xs truncate">${node.name}</span>
        </div>
        <div>${renderFileTreeHTML(node.children || [], depth + 1)}</div>
      </div>`;
    }

    return `<div class="file-tree-item flex items-center gap-1.5" style="padding-left:${indent + 8}px"
      onclick="openFile('${node.path}')" title="${node.name} (${formatSize(node.size)})">
      <i class="${icon} text-xs"></i>
      <span class="text-xs truncate">${node.name}</span>
    </div>`;
  }).join('');
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = {
    ts: 'fab fa-js text-blue-400', tsx: 'fab fa-react text-cyan-400',
    js: 'fab fa-js text-yellow-400', jsx: 'fab fa-react text-cyan-400',
    py: 'fab fa-python text-green-400', html: 'fab fa-html5 text-orange-400',
    css: 'fab fa-css3 text-blue-400', json: 'fas fa-brackets-curly text-yellow-300',
    md: 'fab fa-markdown text-gray-400', sql: 'fas fa-database text-blue-300',
    sh: 'fas fa-terminal text-green-300', yml: 'fas fa-file-code text-pink-400',
    yaml: 'fas fa-file-code text-pink-400', toml: 'fas fa-file-code text-orange-300',
    lock: 'fas fa-lock text-gray-500', env: 'fas fa-key text-yellow-500',
    gitignore: 'fab fa-git text-orange-400', dockerfile: 'fab fa-docker text-blue-400',
  };
  return icons[ext] || 'fas fa-file text-gray-500';
}

async function openFile(filePath) {
  sendQuickAction(`Read the file at ${filePath} and show me its contents`);
}

async function createWorkspace() {
  const name = prompt('Workspace name:');
  if (!name) return;
  try {
    await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    loadWorkspaces();
  } catch {}
}

// ============================================================
// RAG MANAGEMENT
// ============================================================
async function loadRAGDocs() {
  try {
    const res = await fetch('/api/rag/documents');
    const data = await res.json();
    if (data.success) {
      const count = `${data.data.count} documents indexed`;
      const el = document.getElementById('ragDocCountSide');
      if (el) el.textContent = count;
    }
  } catch {}
}

function showRAGPanel() { document.getElementById('ragModal').classList.remove('hidden'); loadRAGDocList(); }
function hideRAGPanel() { document.getElementById('ragModal').classList.add('hidden'); }

async function loadRAGDocList() {
  try {
    const res = await fetch('/api/rag/documents');
    const data = await res.json();
    if (data.success && data.data.documents.length > 0) {
      document.getElementById('ragDocList').innerHTML = data.data.documents.map(d => `
        <div class="flex items-center justify-between p-3 bg-surface-700 rounded-lg">
          <div>
            <div class="text-sm font-medium text-gray-200">${d.title}</div>
            <div class="text-xs text-gray-500">${d.sourceType} | ${d.chunkCount} chunks | ${new Date(d.createdAt).toLocaleDateString()}</div>
          </div>
          <button onclick="deleteRAGDoc('${d.id}')" class="text-red-400 hover:text-red-300 text-xs"><i class="fas fa-trash"></i></button>
        </div>`).join('');
    }
  } catch {}
}

async function ingestDocument() {
  const title = document.getElementById('ragTitle').value;
  const content = document.getElementById('ragContent').value;
  const sourceType = document.getElementById('ragType').value;
  if (!title || !content) return alert('Title and content are required');

  try {
    const res = await fetch('/api/rag/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, sourceType }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('ragTitle').value = '';
      document.getElementById('ragContent').value = '';
      loadRAGDocList();
      loadRAGDocs();
      alert(`Document ingested: ${data.data.chunkCount} chunks created`);
    }
  } catch (e) { alert('Ingest failed: ' + e.message); }
}

async function deleteRAGDoc(id) {
  if (!confirm('Delete this document?')) return;
  try {
    await fetch(`/api/rag/documents/${id}`, { method: 'DELETE' });
    loadRAGDocList();
    loadRAGDocs();
  } catch {}
}

// ============================================================
// TERMINAL
// ============================================================
async function executeTerminalCmd() {
  const input = document.getElementById('terminalInput');
  const cmd = input.value.trim();
  if (!cmd) return;

  const output = document.getElementById('terminalOutput');
  output.innerHTML += `<div class="text-green-400">$ ${escapeHtml(cmd)}</div>`;
  input.value = '';

  sendQuickAction(`Run this command in the workspace: ${cmd}`);
}

// ============================================================
// SETTINGS
// ============================================================
function showSettings() { document.getElementById('settingsModal').classList.remove('hidden'); loadSystemInfo(); }
function hideSettings() { document.getElementById('settingsModal').classList.add('hidden'); }

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    if (data.success) {
      const d = data.data;
      const wsInfo = d.websocket || {};
      const costs = d.costs || {};
      document.getElementById('systemInfo').innerHTML = `
        <div class="space-y-1.5">
          <div>Status: <span class="text-green-400 font-semibold">${d.status}</span></div>
          <div>Version: <span class="text-primary-400">${d.version || '1.1.0'}</span></div>
          <div>Database: <span class="${d.database === 'connected' ? 'text-green-400' : 'text-red-400'}">${d.database}</span></div>
          <div>LLM Providers: <span class="text-primary-400">${d.llmProviders.join(', ')}</span></div>
          <div>Tools: <span class="text-primary-400">${d.toolCount}</span></div>
          <div>Memory: ${d.memory.used} / ${d.memory.total} (RSS: ${d.memory.rss || '?'})</div>
          <div>WebSocket Clients: <span class="text-primary-400">${wsInfo.connectedClients || 0}</span></div>
          <div>Session Cost: <span class="text-yellow-400">$${(costs.sessionTotal || 0).toFixed(6)}</span></div>
          <div>Uptime: ${Math.floor(d.uptime / 60)} min</div>
        </div>`;
    }
  } catch {
    document.getElementById('systemInfo').innerHTML = '<div class="text-red-400">Could not load system info</div>';
  }
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  try { return marked.parse(text); }
  catch { return escapeHtml(text); }
}

function truncateArgs(args) {
  const str = typeof args === 'string' ? args : JSON.stringify(args);
  return str.length > 80 ? str.substring(0, 80) + '...' : str;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 128) + 'px';
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function updateSendButton(streaming) {
  const btn = document.getElementById('sendBtn');
  btn.innerHTML = streaming
    ? '<i class="fas fa-spinner fa-spin text-white text-xs"></i>'
    : '<i class="fas fa-arrow-up text-white text-xs"></i>';
  btn.disabled = streaming;
}

function updateTokenCounter() {
  document.getElementById('tokenCounter').textContent =
    `Tokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(4)}`;
}

function copyCode(btn) {
  const code = btn.closest('.mt-3').querySelector('code').textContent;
  navigator.clipboard.writeText(code);
  btn.innerHTML = '<i class="fas fa-check text-green-400"></i>';
  setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i>', 2000);
}
