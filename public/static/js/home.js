// ============================================================
// AGENTIC RAG PLATFORM — Home Page (User-Facing)
// Clean chat + agent navigation experience
// ============================================================

let currentConversationId = null;
let isStreaming = false;
let totalTokens = 0;
let totalCost = 0;
let ws = null;
let wsReconnectTimer = null;
let wsReconnectAttempt = 0;
let conversationList = [];
let streamedText = '';
let convPanelOpen = false;

document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
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
// NAVIGATION
// ============================================================
function navigateToAgent(agentId) {
  window.location.href = '/' + agentId;
}

function switchToChatMode() {
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('chatView').style.display = '';
  const input = document.getElementById('chatInputActive');
  if (input) input.focus();
}

function switchToHomePage() {
  document.getElementById('homePage').style.display = '';
  document.getElementById('chatView').style.display = 'none';
  document.getElementById('chatMessages').innerHTML = '';
  currentConversationId = null;
  closeConvPanel();
}

// ============================================================
// CONVERSATION PANEL
// ============================================================
function toggleConversationPanel() {
  if (convPanelOpen) {
    closeConvPanel();
  } else {
    const panel = document.getElementById('convPanel');
    panel.style.display = 'flex';
    convPanelOpen = true;
    loadConversationList();
  }
}

function closeConvPanel() {
  document.getElementById('convPanel').style.display = 'none';
  convPanelOpen = false;
}

function startNewConversation() {
  currentConversationId = null;
  switchToHomePage();
  document.getElementById('chatInput').focus();
  closeConvPanel();
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
    switchToChatMode();
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.innerHTML = '';

    const msgs = data.data.messages || [];
    for (const msg of msgs) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        addChatMessage(msg.role, msg.content);
      }
    }

    if (data.data.totalTokens) totalTokens = data.data.totalTokens;
    if (data.data.totalCostUSD) totalCost = data.data.totalCostUSD;
    updateTokenCounter();
    renderConversationList();
    closeConvPanel();
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

// ============================================================
// WEBSOCKET
// ============================================================
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.onopen = () => { wsReconnectAttempt = 0; updateConnectionStatus('connected'); };
    ws.onmessage = e => { try { handleWebSocketMessage(JSON.parse(e.data)); } catch {} };
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
  // Minimal handler for home page
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
  const homeInput = document.getElementById('chatInput');
  const activeInput = document.getElementById('chatInputActive');
  const input = homeInput && homeInput.offsetParent !== null ? homeInput : (activeInput || homeInput);
  const message = input.value.trim();
  if (!message || isStreaming) return;

  switchToChatMode();
  input.value = ''; autoResize(input);
  isStreaming = true; updateSendButton(true);
  addChatMessage('user', message);

  const assistantDiv = addChatMessage('assistant', '', true);
  const contentDiv = assistantDiv.querySelector('.message-content');
  streamedText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId: currentConversationId }),
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
          try { handleSSEEvent(JSON.parse(line.slice(6)), contentDiv); } catch {}
        }
      }
    }
  } catch (err) {
    contentDiv.innerHTML = `<div class="text-red-500"><i class="fas fa-exclamation-triangle mr-1"></i>${err.message}</div>`;
  }

  isStreaming = false; updateSendButton(false);
  loadConversationList();
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
// SSE HANDLER
// ============================================================
function handleSSEEvent(event, contentDiv) {
  switch (event.type) {
    case 'thinking':
      showThinking(contentDiv, event.data.content);
      break;
    case 'text':
      removeThinking(contentDiv);
      if (event.data.delta) {
        streamedText += event.data.content;
        appendStreamedText(contentDiv, event.data.content, streamedText);
      } else {
        const finalContent = event.data.content || streamedText;
        if (finalContent) contentDiv.innerHTML = renderMarkdown(finalContent);
        streamedText = '';
      }
      break;
    case 'tool_call':
      showToolCall(contentDiv, event.data.toolName, event.data.toolArgs);
      break;
    case 'tool_result':
      showToolResult(contentDiv, event.data);
      break;
    case 'error':
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
      break;
  }
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
// CHAT UI HELPERS
// ============================================================
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

let _streamRenderTimer = null;
function appendStreamedText(div, delta, fullText) {
  removeThinking(div);
  let el = div.querySelector('.streamed-text');
  if (!el) {
    const existingTools = div.querySelectorAll('.tool-execution');
    div.innerHTML = '';
    existingTools.forEach(t => div.appendChild(t));
    el = document.createElement('div');
    el.className = 'streamed-text prose prose-sm max-w-none';
    div.appendChild(el);
  }
  if (_streamRenderTimer) clearTimeout(_streamRenderTimer);
  _streamRenderTimer = setTimeout(() => {
    if (el && fullText) {
      try { el.innerHTML = renderMarkdown(fullText); } catch { el.textContent = fullText; }
    }
    _streamRenderTimer = null;
  }, 300);
  if (!_streamRenderTimer) el.textContent = fullText;
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
// UTILITIES
// ============================================================
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function renderMarkdown(t) { if (!t) return ''; try { return marked.parse(t); } catch { return escapeHtml(t); } }
function truncateArgs(a) { const s = typeof a === 'string' ? a : JSON.stringify(a); return s.length > 80 ? s.substring(0,80)+'...' : s; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
function handleInputKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function updateSendButton(s) {
  const b = document.getElementById('sendBtn');
  if (b) { b.innerHTML = s ? '<i class="fas fa-spinner fa-spin" style="font-size:10px"></i> <span>Sending</span>' : '<i class="fas fa-plus" style="font-size:10px"></i> <span>Send</span>'; b.disabled = s; }
  const b2 = document.getElementById('sendBtnActive');
  if (b2) { b2.innerHTML = s ? '<i class="fas fa-spinner fa-spin text-white text-xs"></i>' : '<i class="fas fa-arrow-up text-white text-xs"></i>'; b2.disabled = s; }
}
function updateTokenCounter() {
  const text = `Tokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(4)}`;
  const el1 = document.getElementById('tokenCounter'); if (el1) el1.textContent = text;
  const el2 = document.getElementById('tokenCounterActive'); if (el2) el2.textContent = text;
}
