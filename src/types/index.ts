// ============================================================
// CORE TYPES — Foundation for the entire platform
// ============================================================

// --- LLM Provider Types ---
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq' | 'ollama';

export interface LLMModelConfig {
  provider: LLMProvider;
  model: string;
  displayName: string;
  maxTokens: number;
  contextWindow: number;
  costPer1kInput: number;   // USD
  costPer1kOutput: number;  // USD
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  speed: 'fastest' | 'fast' | 'medium' | 'slow';
  bestFor: string[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;  // JSON Schema
  };
}

export interface LLMCompletionRequest {
  provider: LLMProvider;
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  responseFormat?: 'text' | 'json';
}

export interface LLMCompletionResponse {
  id: string;
  provider: LLMProvider;
  model: string;
  content: string | null;
  toolCalls: LLMToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  latencyMs: number;
}

export interface LLMStreamChunk {
  type: 'text_delta' | 'tool_call_delta' | 'usage' | 'done' | 'error';
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;  // partial JSON
  usage?: LLMCompletionResponse['usage'];
  error?: string;
}

// --- Embedding Types ---
export interface EmbeddingRequest {
  provider: LLMProvider;
  model: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: { totalTokens: number; costUSD: number };
}

// --- Tool Types ---
export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  longDescription?: string;
  parameters: Record<string, any>;  // Zod schema serialized to JSON Schema
  requiresApproval?: boolean;  // human-in-the-loop
  timeout?: number;  // ms
  riskLevel: 'safe' | 'moderate' | 'dangerous';
}

export type ToolCategory = 
  | 'file' | 'shell' | 'git' | 'github' | 'deploy' 
  | 'web' | 'code' | 'database' | 'rag' | 'image' | 'system' | 'sandbox';

export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, any>;
  workspaceId: string;
  userId: string;
  messageId: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output: any;
  error?: string;
  durationMs: number;
  metadata?: Record<string, any>;
}

// --- Agent Types ---
export type AgentType = 'router' | 'rag' | 'code' | 'deploy' | 'design' | 'test' | 'reviewer';

export type AgentState = 
  | 'idle' | 'planning' | 'executing' | 'reviewing' 
  | 'waiting_human' | 'looping' | 'complete' | 'failed';

export interface AgentNode {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  systemPrompt: string;
  llmConfig: {
    provider: LLMProvider;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  tools: string[];  // tool names available to this agent
  maxIterations: number;
}

export interface AgentEdge {
  from: string;  // node id
  to: string;    // node id
  condition?: (state: OrchestrationState) => boolean;
  label?: string;
}

export interface OrchestrationGraph {
  nodes: Map<string, AgentNode>;
  edges: AgentEdge[];
  entryNode: string;
  exitNodes: string[];
}

export interface OrchestrationState {
  id: string;
  conversationId: string;
  userId: string;
  workspaceId: string;
  currentNode: string;
  status: AgentState;
  messages: LLMMessage[];
  toolResults: Map<string, ToolExecutionResult>;
  agentOutputs: Map<string, string>;
  iteration: number;
  maxIterations: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
  metadata: Record<string, any>;
  pendingApproval?: {
    toolName: string;
    args: Record<string, any>;
    message: string;
  };
}

export interface AgentStepEvent {
  type: 'agent_start' | 'agent_thinking' | 'agent_tool_call' | 'agent_tool_result' | 
        'agent_transition' | 'agent_review' | 'agent_approval' | 'agent_complete' | 'agent_error';
  agentId: string;
  agentType: AgentType;
  timestamp: number;
  data: any;
}

// --- RAG Types ---
export interface RAGDocument {
  id: string;
  title: string;
  sourceUrl?: string;
  sourceType: 'pdf' | 'markdown' | 'html' | 'text' | 'code' | 'url';
  content: string;
  metadata: Record<string, any>;
  chunkCount: number;
  createdAt: Date;
}

export interface RAGChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  embedding?: number[];
  metadata: {
    heading?: string;
    pageNumber?: number;
    language?: string;
    [key: string]: any;
  };
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  document: RAGDocument;
  score: number;
  searchType: 'vector' | 'bm25' | 'hybrid';
}

export interface RAGSearchRequest {
  query: string;
  topK?: number;
  searchType?: 'vector' | 'bm25' | 'hybrid';
  filters?: Record<string, any>;
  collection?: string;
  rerankModel?: string;
}

export interface RAGIngestRequest {
  content: string;
  title: string;
  sourceUrl?: string;
  sourceType: RAGDocument['sourceType'];
  metadata?: Record<string, any>;
  collection?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

// --- GenUI Types ---
export type GenUIComponentType = 
  | 'chart' | 'table' | 'file_tree' | 'code_block' | 'terminal'
  | 'markdown' | 'approval_gate' | 'deploy_progress' | 'diff_viewer'
  | 'image_preview' | 'search_results' | 'source_cards' | 'error_card'
  | 'review_card' | 'status_badge' | 'progress_bar' | 'workspace_info';

export interface GenUIEvent {
  type: 'thinking' | 'text' | 'component' | 'tool_call' | 'tool_result' | 
        'approval' | 'error' | 'done' | 'agent_step';
  id: string;
  timestamp: number;
  data: GenUIThinkingData | GenUITextData | GenUIComponentData | 
        GenUIToolCallData | GenUIToolResultData | GenUIApprovalData | 
        GenUIErrorData | GenUIDoneData | AgentStepEvent;
}

export interface GenUIThinkingData {
  content: string;
  agentType?: AgentType;
}

export interface GenUITextData {
  content: string;
  delta: boolean;  // true = append, false = replace
}

export interface GenUIComponentData {
  name: GenUIComponentType;
  props: Record<string, any>;
}

export interface GenUIToolCallData {
  toolName: string;
  toolArgs: Record<string, any>;
  agentType: AgentType;
}

export interface GenUIToolResultData {
  toolName: string;
  success: boolean;
  output: any;
  durationMs: number;
}

export interface GenUIApprovalData {
  id: string;
  message: string;
  toolName: string;
  toolArgs: Record<string, any>;
  actions: ('approve' | 'reject' | 'edit')[];
  riskLevel: ToolDefinition['riskLevel'];
  description?: string;
  category?: string;
}

export interface GenUIErrorData {
  message: string;
  code?: string;
  recoverable: boolean;
}

export interface GenUIDoneData {
  summary: string;
  usage: {
    totalTokens: number;
    totalCostUSD: number;
    totalDurationMs: number;
    modelsUsed: string[];
    toolsUsed: string[];
  };
}

// --- WebSocket Types ---
export interface WSMessage {
  type: WSMessageType;
  id: string;
  payload: any;
}

export type WSMessageType = 
  | 'chat_message' | 'chat_stream' | 'approval_response'
  | 'terminal_input' | 'terminal_output' | 'terminal_resize'
  | 'file_changed' | 'file_created' | 'file_deleted'
  | 'workspace_sync' | 'workspace_update'
  | 'agent_event' | 'system_event'
  | 'ping' | 'pong';

// --- Workspace Types ---
export interface Workspace {
  id: string;
  userId: string;
  name: string;
  path: string;
  config: WorkspaceConfig;
  status: 'active' | 'archived' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceConfig {
  framework?: string;
  language?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  buildCommand?: string;
  startCommand?: string;
  deployTarget?: 'cloudflare' | 'vercel' | 'none';
  env?: Record<string, string>;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: FileNode[];
  language?: string;
}

// --- User Types ---
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  apiKeys: EncryptedAPIKeys;
  settings: UserSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface EncryptedAPIKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  mistral?: string;
  groq?: string;
  github?: string;
  cloudflare?: string;
  vercel?: string;
}

export interface UserSettings {
  defaultProvider: LLMProvider;
  defaultModel: string;
  theme: 'dark' | 'light' | 'system';
  approvalMode: 'all' | 'dangerous' | 'none';
  maxBudgetPerDay: number;  // USD
}

// --- Conversation Types ---
export interface Conversation {
  id: string;
  userId: string;
  projectId?: string;
  title: string;
  model: string;
  totalTokens: number;
  totalCostUSD: number;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  tokensUsed: number;
  costUSD: number;
  model?: string;
  durationMs?: number;
  createdAt: Date;
}

// --- Deployment Types ---
export interface Deployment {
  id: string;
  projectId: string;
  userId: string;
  platform: 'cloudflare' | 'vercel';
  projectName: string;
  url?: string;
  status: 'pending' | 'building' | 'deploying' | 'live' | 'failed';
  buildLogs: string;
  config: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

// --- API Response Types ---
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// --- Event Emitter Type ---
export type PlatformEventType = 
  | 'agent:step' | 'agent:complete' | 'agent:error'
  | 'tool:start' | 'tool:complete' | 'tool:error'
  | 'rag:ingest' | 'rag:query'
  | 'deploy:start' | 'deploy:complete' | 'deploy:error'
  | 'workspace:change' | 'workspace:create' | 'workspace:delete'
  | 'user:login' | 'user:logout';

export interface PlatformEvent {
  type: PlatformEventType;
  timestamp: number;
  userId?: string;
  data: any;
}
