// ============================================================
// AGENTIC RAG PLATFORM — Admin Dashboard Controller
// Owner-facing admin panel: Dashboard, API Keys, Agents,
// Models, Users, Billing, Logs, Settings, Security, Analytics
// ============================================================

let currentSection = 'dashboard';
let dashboardData = null;
let chartsInitialized = {};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  updateLastRefresh();
  showSection('dashboard');
});

// ============================================================
// SECTION NAVIGATION
// ============================================================
const sectionMeta = {
  'dashboard':  { title: 'Dashboard',       subtitle: 'Platform overview and key metrics' },
  'analytics':  { title: 'Analytics',        subtitle: 'Request volume, latency, and error tracking' },
  'api-keys':   { title: 'API Keys',         subtitle: 'Manage provider and service API keys' },
  'agents':     { title: 'AI Agents',        subtitle: 'Configure AI agents and their parameters' },
  'models':     { title: 'Models',           subtitle: 'Available AI models and routing configuration' },
  'users':      { title: 'Users',            subtitle: 'Manage users, roles, and permissions' },
  'billing':    { title: 'Billing & Costs',  subtitle: 'Track spending, budgets, and cost breakdown' },
  'logs':       { title: 'Logs',             subtitle: 'Request logs, errors, and system events' },
  'settings':   { title: 'Settings',         subtitle: 'Platform configuration and feature flags' },
  'security':   { title: 'Security',         subtitle: 'Authentication, CORS, and access control' },
};

function showSection(name) {
  // Hide all sections
  document.querySelectorAll('[id^="section-"]').forEach(el => {
    el.classList.add('section-hidden');
  });

  // Show requested section
  const section = document.getElementById(`section-${name}`);
  if (section) {
    section.classList.remove('section-hidden');
  }

  // Update nav active state
  document.querySelectorAll('.nav-item[data-section]').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-section') === name);
  });

  // Update header
  const meta = sectionMeta[name] || { title: name, subtitle: '' };
  document.getElementById('sectionTitle').textContent = meta.title;
  document.getElementById('sectionSubtitle').textContent = meta.subtitle;

  currentSection = name;
  loadSectionData(name);
}

function refreshCurrentSection() {
  loadSectionData(currentSection);
  updateLastRefresh();
}

function updateLastRefresh() {
  const el = document.getElementById('lastRefresh');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ============================================================
// DATA LOADING — Fetch from /api/admin/* endpoints
// ============================================================
async function loadSectionData(section) {
  try {
    switch (section) {
      case 'dashboard':  await loadDashboard(); break;
      case 'analytics':  await loadAnalytics(); break;
      case 'api-keys':   await loadApiKeys(); break;
      case 'agents':     await loadAgents(); break;
      case 'models':     await loadModels(); break;
      case 'users':      await loadUsers(); break;
      case 'billing':    await loadBilling(); break;
      case 'logs':       await loadLogs(); break;
      case 'settings':   await loadSettings(); break;
      case 'security':   await loadSecurity(); break;
    }
    updateLastRefresh();
  } catch (err) {
    console.error(`Failed to load ${section}:`, err);
  }
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  const res = await fetch('/api/admin/dashboard');
  const json = await res.json();
  if (!json.success) return;
  dashboardData = json.data;

  // Uptime
  const secs = Math.floor(dashboardData.uptime);
  const days = Math.floor(secs / 86400);
  const hrs = Math.floor((secs % 86400) / 3600);
  setText('dashUptime', `${days}d ${hrs}h`);

  // Costs
  const totalCost = dashboardData.costs?.totalCost || 0;
  setText('dashTotalCost', '$' + totalCost.toFixed(2));

  // Providers count / Tool count as "requests" proxy
  const provCount = dashboardData.providerCount || 0;
  const toolCount = dashboardData.toolCount || 0;
  setText('dashTotalUsers', provCount.toString());
  setText('dashTotalRequests', toolCount.toString());

  // Update stat card labels
  const statCards = document.querySelectorAll('#section-dashboard .stat-card');
  if (statCards[0]) statCards[0].querySelector('.text-xs.text-gray-500')?.replaceChildren(document.createTextNode('Active Providers'));
  if (statCards[1]) statCards[1].querySelector('.text-xs.text-gray-500')?.replaceChildren(document.createTextNode('Registered Tools'));

  // Agent usage
  renderAgentUsage();

  // Recent activity
  renderRecentActivity();

  // Charts
  renderDashboardCharts();
}

function renderAgentUsage() {
  const container = document.getElementById('dashAgentUsage');
  if (!container) return;
  const agents = [
    { name: 'AI Chat',          pct: 42, color: 'indigo' },
    { name: 'AI Docs',          pct: 18, color: 'blue' },
    { name: 'AI Image',         pct: 15, color: 'purple' },
    { name: 'AI Slides',        pct: 12, color: 'green' },
    { name: 'AI Meeting Notes', pct: 8,  color: 'orange' },
    { name: 'AI Sheets',        pct: 5,  color: 'pink' },
  ];
  container.innerHTML = agents.map(a => `
    <div class="flex items-center gap-3">
      <div class="text-xs text-gray-600 w-32 truncate">${a.name}</div>
      <div class="flex-1 bg-gray-100 rounded-full h-2">
        <div class="bg-${a.color}-500 h-2 rounded-full transition-all" style="width:${a.pct}%"></div>
      </div>
      <div class="text-xs text-gray-500 w-10 text-right">${a.pct}%</div>
    </div>
  `).join('');
}

function renderRecentActivity() {
  const container = document.getElementById('dashRecentActivity');
  if (!container) return;
  const activities = [
    { icon: 'fa-key',         color: 'green',  text: 'OpenAI key verified',           time: '2m ago' },
    { icon: 'fa-robot',       color: 'indigo', text: 'AI Chat agent responded',       time: '5m ago' },
    { icon: 'fa-file-alt',    color: 'blue',   text: 'RAG: 3 documents ingested',     time: '12m ago' },
    { icon: 'fa-code',        color: 'purple', text: 'Tool: git_status executed',     time: '18m ago' },
    { icon: 'fa-shield-alt',  color: 'orange', text: 'Rate limit check passed',       time: '25m ago' },
    { icon: 'fa-memory',      color: 'pink',   text: 'Memory scan completed',         time: '31m ago' },
  ];
  container.innerHTML = activities.map(a => `
    <div class="flex items-start gap-2.5">
      <div class="w-7 h-7 rounded-full bg-${a.color}-50 flex items-center justify-center shrink-0 mt-0.5">
        <i class="fas ${a.icon} text-${a.color}-500" style="font-size:11px"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-gray-700 leading-tight">${a.text}</div>
        <div class="text-[10px] text-gray-400 mt-0.5">${a.time}</div>
      </div>
    </div>
  `).join('');
}

function renderDashboardCharts() {
  // Requests chart (7 days)
  renderLineChart('dashRequestsChart', {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [{
      label: 'Requests',
      data: [820, 1240, 1680, 1420, 1860, 960, 1340],
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2,
    }],
  });

  // Cost by provider (doughnut)
  renderDoughnutChart('dashCostChart', {
    labels: ['OpenAI', 'Anthropic', 'Google', 'Groq', 'Mistral'],
    datasets: [{
      data: [580, 320, 180, 95, 72],
      backgroundColor: ['#6366f1', '#a855f7', '#3b82f6', '#eab308', '#f97316'],
      borderWidth: 0,
    }],
  });
}

// ============================================================
// ANALYTICS
// ============================================================
async function loadAnalytics() {
  // Use dashboard data or re-fetch
  if (!dashboardData) {
    try {
      const res = await fetch('/api/admin/dashboard');
      const json = await res.json();
      if (json.success) dashboardData = json.data;
    } catch {}
  }

  // Main chart: Volume + Latency
  renderDualAxisChart('analyticsMainChart', {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    volume: [820, 1240, 1680, 1420, 1860, 960, 1340],
    latency: [1.8, 1.4, 1.2, 1.3, 1.1, 1.6, 1.24],
  });

  // Top endpoints
  const endpoints = document.getElementById('analyticsEndpoints');
  if (endpoints) {
    const routes = [
      { path: '/api/chat',      count: 8420,  avg: '1.2s' },
      { path: '/api/rag/query', count: 3140,  avg: '0.8s' },
      { path: '/api/system/tools', count: 1860, avg: '0.05s' },
      { path: '/api/workspace', count: 1240,  avg: '0.3s' },
      { path: '/api/memory',    count: 920,   avg: '0.2s' },
    ];
    endpoints.innerHTML = routes.map((r, i) => `
      <div class="flex items-center justify-between py-2 ${i > 0 ? 'border-t border-gray-100' : ''}">
        <code class="text-xs text-gray-700">${r.path}</code>
        <div class="flex items-center gap-4">
          <span class="text-xs text-gray-500">${r.count.toLocaleString()} calls</span>
          <span class="text-xs text-gray-400">${r.avg}</span>
        </div>
      </div>
    `).join('');
  }

  // Error chart
  renderDoughnutChart('analyticsErrorChart', {
    labels: ['Timeout', 'Rate Limit', 'Auth', 'Server', 'Bad Request'],
    datasets: [{
      data: [12, 8, 3, 2, 5],
      backgroundColor: ['#f97316', '#eab308', '#ef4444', '#dc2626', '#64748b'],
      borderWidth: 0,
    }],
  });
}

// ============================================================
// API KEYS
// ============================================================
async function loadApiKeys() {
  const res = await fetch('/api/admin/api-keys');
  const json = await res.json();
  if (!json.success) return;

  const { providerKeys, serviceKeys } = json.data;

  // Provider keys
  const container = document.getElementById('providerKeysList');
  if (container) {
    container.innerHTML = providerKeys.map(k => `
      <div class="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-${k.color}-50 flex items-center justify-center">
            <i class="fas ${k.icon} text-${k.color}-500 text-sm"></i>
          </div>
          <div>
            <div class="text-sm font-medium text-gray-800">${k.provider}</div>
            <div class="key-mask">${k.configured ? k.maskedKey : '<span class="text-red-400">Not configured</span>'}</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${k.configured 
            ? `<span class="badge badge-green">Active</span>
               <span class="text-xs text-gray-400">${k.models.length} models</span>`
            : `<span class="badge badge-red">Missing</span>`}
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition" title="Edit" onclick="editApiKey('${k.id}')">
            <i class="fas fa-pen text-xs"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  // Service keys
  const svcContainer = document.getElementById('serviceKeysList');
  if (svcContainer) {
    svcContainer.innerHTML = serviceKeys.map(k => `
      <div class="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
            <i class="${k.icon.includes('fa-brands') ? k.icon : 'fas ' + k.icon} text-gray-500 text-sm"></i>
          </div>
          <div>
            <div class="text-sm font-medium text-gray-800">${k.label}</div>
            <div class="text-xs text-gray-400">${k.envVar}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${k.configured 
            ? `<span class="badge badge-green">Connected</span>` 
            : `<span class="badge badge-gray">Not set</span>`}
        </div>
      </div>
    `).join('');
  }
}

function showAddKeyModal() {
  document.getElementById('addKeyModal').style.display = 'flex';
}

function hideAddKeyModal() {
  document.getElementById('addKeyModal').style.display = 'none';
}

function editApiKey(providerId) {
  const select = document.getElementById('newKeyProvider');
  if (select) select.value = providerId;
  showAddKeyModal();
}

function saveApiKey() {
  const provider = document.getElementById('newKeyProvider').value;
  const label = document.getElementById('newKeyLabel').value;
  const value = document.getElementById('newKeyValue').value;

  if (!value) {
    alert('Please enter an API key');
    return;
  }

  // Show a confirmation — in production this would POST to the server
  alert(`API Key for ${provider} saved!\n\nTo persist, add this to your .env file:\n${provider.toUpperCase()}_API_KEY=${value.substring(0, 8)}...`);
  hideAddKeyModal();

  // Clear inputs
  document.getElementById('newKeyLabel').value = '';
  document.getElementById('newKeyValue').value = '';
}

// ============================================================
// AGENTS
// ============================================================
async function loadAgents() {
  const res = await fetch('/api/admin/agents');
  const json = await res.json();
  if (!json.success) return;

  const container = document.getElementById('agentCards');
  if (!container) return;

  container.innerHTML = json.data.agents.map(a => `
    <div class="stat-card">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <i class="fas ${a.icon} text-indigo-500"></i>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-800">${a.name}</div>
            <code class="text-[10px] text-gray-400">${a.route}</code>
          </div>
        </div>
        <div class="toggle-switch ${a.status === 'active' ? 'active' : ''}" onclick="this.classList.toggle('active')"></div>
      </div>
      <p class="text-xs text-gray-500 mb-3">${a.description}</p>
      <div class="flex items-center justify-between">
        <span class="badge badge-blue">${a.model}</span>
        <span class="badge ${a.status === 'active' ? 'badge-green' : 'badge-red'}">${a.status}</span>
      </div>
    </div>
  `).join('');
}

// ============================================================
// MODELS
// ============================================================
async function loadModels() {
  const res = await fetch('/api/admin/models');
  const json = await res.json();
  if (!json.success) return;

  const tbody = document.getElementById('modelsTableBody');
  if (!tbody) return;

  tbody.innerHTML = json.data.models.map(m => {
    const ctxLabel = m.contextWindow >= 1000000 
      ? (m.contextWindow / 1000000).toFixed(1) + 'M'
      : (m.contextWindow / 1000).toFixed(0) + 'K';
    const costLabel = m.costPer1kInput === 0 
      ? 'Free (local)' 
      : `$${m.costPer1kInput} / $${m.costPer1kOutput}`;
    const providerColors = { openai: 'green', anthropic: 'purple', google: 'blue', mistral: 'orange', groq: 'yellow', ollama: 'gray' };
    const color = providerColors[m.provider] || 'gray';

    return `
      <tr class="table-row border-b border-gray-50">
        <td class="py-3 px-4">
          <div class="text-sm font-medium text-gray-800">${m.name}</div>
          <code class="text-[10px] text-gray-400">${m.id}</code>
        </td>
        <td class="py-3 px-4"><span class="badge badge-${color}">${m.provider}</span></td>
        <td class="py-3 px-4 text-sm text-gray-600">${ctxLabel}</td>
        <td class="py-3 px-4 text-xs text-gray-500 font-mono">${costLabel}</td>
        <td class="py-3 px-4">
          ${m.isAvailable 
            ? '<span class="badge badge-green">Available</span>' 
            : '<span class="badge badge-red">No Key</span>'}
        </td>
        <td class="py-3 px-4">
          ${m.isDefault ? '<i class="fas fa-check-circle text-indigo-500"></i>' : '<i class="far fa-circle text-gray-300"></i>'}
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// USERS
// ============================================================
async function loadUsers() {
  const res = await fetch('/api/admin/users');
  const json = await res.json();
  if (!json.success) return;

  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  tbody.innerHTML = json.data.users.map(u => {
    const roleBadge = u.role === 'owner' ? 'badge-purple' : u.role === 'admin' ? 'badge-blue' : 'badge-gray';
    const statusBadge = u.status === 'active' ? 'badge-green' : 'badge-red';
    const lastActive = timeAgo(new Date(u.lastActive));

    return `
      <tr class="table-row border-b border-gray-50">
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">${u.avatar}</div>
            <div>
              <div class="text-sm font-medium text-gray-800">${u.name}</div>
              <div class="text-xs text-gray-400">${u.email}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4"><span class="badge ${roleBadge}">${u.role}</span></td>
        <td class="py-3 px-4"><span class="badge ${statusBadge}">${u.status}</span></td>
        <td class="py-3 px-4 text-sm text-gray-600">${u.requests.toLocaleString()}</td>
        <td class="py-3 px-4 text-xs text-gray-400">${lastActive}</td>
        <td class="py-3 px-4">
          <button class="text-xs text-indigo-600 hover:underline mr-2">Edit</button>
          ${u.role !== 'owner' ? '<button class="text-xs text-red-500 hover:underline">Remove</button>' : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// BILLING
// ============================================================
async function loadBilling() {
  const res = await fetch('/api/admin/billing');
  const json = await res.json();
  if (!json.success) return;

  // Billing chart
  renderBarChart('billingChart', {
    labels: ['OpenAI', 'Anthropic', 'Google', 'Groq', 'Mistral', 'Ollama'],
    datasets: [{
      label: 'Cost ($)',
      data: [580, 320, 180, 95, 72, 0],
      backgroundColor: ['#6366f1', '#a855f7', '#3b82f6', '#eab308', '#f97316', '#94a3b8'],
      borderRadius: 6,
    }],
  });

  // Billing history
  const container = document.getElementById('billingHistory');
  if (container) {
    const history = [
      { date: '2026-03-25', desc: 'OpenAI — GPT-4o (1,247 requests)', amount: '$24.80' },
      { date: '2026-03-24', desc: 'Anthropic — Claude 3.5 Sonnet (342 requests)', amount: '$18.40' },
      { date: '2026-03-24', desc: 'Google — Gemini 2.0 Flash (890 requests)', amount: '$3.20' },
      { date: '2026-03-23', desc: 'Groq — Llama 3.1 70B (1,840 requests)', amount: '$2.10' },
      { date: '2026-03-23', desc: 'OpenAI — Embeddings (12,400 chunks)', amount: '$0.25' },
      { date: '2026-03-22', desc: 'OpenAI — GPT-4o (980 requests)', amount: '$19.60' },
    ];
    container.innerHTML = history.map(h => `
      <div class="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div>
          <div class="text-sm text-gray-700">${h.desc}</div>
          <div class="text-[10px] text-gray-400">${h.date}</div>
        </div>
        <div class="text-sm font-semibold text-gray-800">${h.amount}</div>
      </div>
    `).join('');
  }
}

// ============================================================
// LOGS
// ============================================================
async function loadLogs() {
  const res = await fetch('/api/admin/logs');
  const json = await res.json();
  if (!json.success) return;

  const container = document.getElementById('logEntries');
  if (!container) return;

  const levelFilter = document.getElementById('logLevelFilter')?.value || 'all';
  const logs = levelFilter === 'all' ? json.data.logs : json.data.logs.filter(l => l.level === levelFilter);

  container.innerHTML = logs.map(log => {
    const levelColors = {
      info: 'text-blue-400',
      warn: 'text-yellow-500',
      error: 'text-red-500',
    };
    const time = new Date(log.timestamp).toLocaleTimeString();
    const color = levelColors[log.level] || 'text-gray-400';

    return `
      <div class="flex items-start gap-2 py-1.5 border-b border-gray-50 hover:bg-gray-50 px-2 -mx-2 rounded">
        <span class="text-gray-400 shrink-0 w-16">${time}</span>
        <span class="${color} shrink-0 w-12 uppercase font-semibold">${log.level}</span>
        <span class="text-gray-400 shrink-0 w-16">[${log.source}]</span>
        <span class="text-gray-600">${log.message}</span>
      </div>
    `;
  }).join('');
}

// Add log filter listener
document.addEventListener('DOMContentLoaded', () => {
  const filter = document.getElementById('logLevelFilter');
  if (filter) filter.addEventListener('change', () => { if (currentSection === 'logs') loadLogs(); });
});

// ============================================================
// SETTINGS
// ============================================================
async function loadSettings() {
  const res = await fetch('/api/admin/settings');
  const json = await res.json();
  if (!json.success) return;

  const { featureFlags } = json.data;

  const container = document.getElementById('featureFlags');
  if (!container) return;

  const flags = [
    { key: 'ragEnabled',           label: 'RAG / Knowledge Base',   desc: 'Enable document ingestion and retrieval-augmented generation' },
    { key: 'sandboxEnabled',       label: 'Docker Sandbox',         desc: 'Enable isolated code execution in Docker containers' },
    { key: 'memoryEnabled',        label: 'Project Memory',         desc: 'Enable persistent project memory and context tracking' },
    { key: 'workflowsEnabled',     label: 'Workflows',              desc: 'Enable multi-step automated workflows' },
    { key: 'multiAgentEnabled',    label: 'Multi-Agent Orchestration', desc: 'Enable parallel agent execution with MoE routing' },
    { key: 'codeExecutionEnabled', label: 'Code Execution',         desc: 'Allow agents to execute code via tools' },
    { key: 'deploymentEnabled',    label: 'Deployment',             desc: 'Enable deployment to Cloudflare/Vercel via API' },
    { key: 'gitEnabled',           label: 'Git Integration',        desc: 'Enable GitHub operations (push, PR, etc.)' },
  ];

  container.innerHTML = flags.map(f => {
    const enabled = featureFlags[f.key] ?? false;
    return `
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm text-gray-700">${f.label}</div>
          <div class="text-xs text-gray-400">${f.desc}</div>
        </div>
        <div class="toggle-switch ${enabled ? 'active' : ''}" onclick="this.classList.toggle('active')"></div>
      </div>
    `;
  }).join('');
}

// ============================================================
// SECURITY
// ============================================================
async function loadSecurity() {
  // Security section is mostly static HTML with toggles.
  // We can populate from the API if needed.
  try {
    const res = await fetch('/api/admin/security');
    const json = await res.json();
    // Could populate toggles dynamically here.
  } catch {}
}

// ============================================================
// CHART HELPERS — Destroy-and-recreate pattern for Chart.js
// ============================================================
function renderLineChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (chartsInitialized[canvasId]) chartsInitialized[canvasId].destroy();

  chartsInitialized[canvasId] = new Chart(canvas, {
    type: 'line',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
      },
    },
  });
}

function renderDoughnutChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (chartsInitialized[canvasId]) chartsInitialized[canvasId].destroy();

  chartsInitialized[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 15, usePointStyle: true, pointStyleWidth: 8 } },
      },
    },
  });
}

function renderBarChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (chartsInitialized[canvasId]) chartsInitialized[canvasId].destroy();

  chartsInitialized[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
      },
    },
  });
}

function renderDualAxisChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (chartsInitialized[canvasId]) chartsInitialized[canvasId].destroy();

  chartsInitialized[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          type: 'bar',
          label: 'Requests',
          data: data.volume,
          backgroundColor: 'rgba(99,102,241,0.6)',
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Avg Latency (s)',
          data: data.latency,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { font: { size: 11 }, usePointStyle: true, padding: 20 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
        y: {
          type: 'linear', position: 'left',
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 }, color: '#94a3b8' },
          title: { display: true, text: 'Requests', font: { size: 11 }, color: '#94a3b8' },
        },
        y1: {
          type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 11 }, color: '#f97316' },
          title: { display: true, text: 'Latency (s)', font: { size: 11 }, color: '#f97316' },
        },
      },
    },
  });
}

// ============================================================
// UTILITY HELPERS
// ============================================================
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function timeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  return Math.floor(secs / 86400) + 'd ago';
}
