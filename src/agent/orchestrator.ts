import {
  AgentNode, AgentType, AgentState, OrchestrationState, AgentStepEvent,
  LLMMessage, LLMToolCall, LLMStreamChunk, LLMCompletionRequest, LLMCompletionResponse,
  ToolExecutionResult, GenUIEvent
} from '../types/index.js';
import { callLLM, streamLLM } from '../llm/router.js';
import { RepairEngine, DetectedError } from './repair.js';
import { toolRegistry } from '../tools/index.js';
import { getBestModelForTask, agentConfig } from '../config/index.js';
import { createLogger, generateId, withTimeout, costTracker } from '../utils/index.js';
import { eventBus } from '../utils/index.js';

const logger = createLogger('Orchestrator');

// ============================================================
// SUB-AGENT DEFINITIONS — Each sub-agent is a specialised ReAct unit
// ============================================================
const AGENT_DEFINITIONS: Record<AgentType, Omit<AgentNode, 'id'>> = {
  router: {
    type: 'router',
    name: 'Router Agent',
    description: 'Analyzes user intent, plans sub-tasks, and coordinates execution across agents.',
    systemPrompt: `You are the Router Agent — the central orchestrator of a self-hosted Agentic RAG platform.

CAPABILITIES:
- File operations: read, write, edit, search, delete files
- Shell execution: run commands, npm install/run, process management
- Git: init, status, commit, push, branch, diff, log
- GitHub: create repos, read/edit files, create PRs, list issues
- Deployment: Cloudflare Pages, Vercel, deploy previews
- Web: search, scrape, fetch web content
- Code: analyze, generate, test, refactor, explain
- Database: query (read-only), execute (write), schema introspection
- RAG: ingest documents, hybrid search, list/delete documents

ORCHESTRATION RULES:
1. Decompose complex requests into steps; execute them sequentially.
2. Prefer rag_query before web_search when the user references "project", "docs", or "knowledge base".
3. For coding tasks: read relevant files first → plan changes → write/edit files → verify.
4. For deployment: ensure build succeeds before deploying.
5. Always summarise what you did and any remaining next steps.
6. Keep tool outputs concise — truncate large results.
7. When a tool errors, explain the issue and try an alternative approach.
8. For dangerous operations, explain the risk before executing.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
    tools: [], // Gets ALL tools
    maxIterations: 25,
  },
  rag: {
    type: 'rag',
    name: 'RAG Agent',
    description: 'Searches knowledge base and retrieves relevant context.',
    systemPrompt: `You are the RAG Agent. Your job:
1. Search the knowledge base with rag_query (prefer hybrid search).
2. If the KB lacks information, fall back to web_search.
3. Summarise findings and cite sources.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
    tools: ['rag_query', 'rag_list_docs', 'rag_ingest', 'web_search', 'web_scrape'],
    maxIterations: 5,
  },
  code: {
    type: 'code',
    name: 'Code Agent',
    description: 'Generates, edits, analyses, and tests code.',
    systemPrompt: `You are the Code Agent — an expert software engineer. Rules:
1. Read existing files before editing.
2. Write clean, well-commented, production-ready code.
3. Use code_generate for new files, edit_file for surgical changes.
4. Run tests after changes when a test framework is available.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o', temperature: 0.3, maxTokens: 8192 },
    tools: [
      'read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory',
      'shell_exec', 'npm_install', 'npm_run', 'code_generate', 'code_analyze', 'code_test', 'code_refactor',
      'git_status', 'git_commit',
    ],
    maxIterations: 15,
  },
  deploy: {
    type: 'deploy',
    name: 'Deploy Agent',
    description: 'Handles building and deploying projects.',
    systemPrompt: `You are the Deploy Agent. Steps:
1. Ensure the project builds (npm run build or the specified build command).
2. Deploy using deploy_cloudflare or deploy_vercel.
3. Report the live URL on success, or the error on failure.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
    tools: ['shell_exec', 'npm_run', 'deploy_cloudflare', 'deploy_vercel', 'deploy_status', 'deploy_preview', 'read_file', 'list_directory'],
    maxIterations: 10,
  },
  design: {
    type: 'design',
    name: 'Design Agent',
    description: 'Creates UI layouts and frontend assets.',
    systemPrompt: `You are the Design Agent. Create beautiful, responsive web UIs with Tailwind CSS. Generate complete HTML/CSS/JS.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o', temperature: 0.5, maxTokens: 8192 },
    tools: ['write_file', 'read_file', 'code_generate', 'web_search'],
    maxIterations: 10,
  },
  test: {
    type: 'test',
    name: 'Test Agent',
    description: 'Generates and runs tests.',
    systemPrompt: `You are the Test Agent. Generate comprehensive tests, run them, and report results.`,
    llmConfig: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 4096 },
    tools: ['read_file', 'write_file', 'shell_exec', 'npm_run', 'code_test', 'code_analyze'],
    maxIterations: 10,
  },
  reviewer: {
    type: 'reviewer',
    name: 'Reviewer Agent',
    description: 'Reviews code for security, correctness, and best practices.',
    systemPrompt: `You are the Reviewer Agent. Check for:
1. Security vulnerabilities (XSS, SQL injection, path traversal, etc.)
2. Best practice violations
3. Bugs and edge cases
4. Performance issues
Return PASS or FAIL with specific issues.`,
    llmConfig: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', temperature: 0.3, maxTokens: 4096 },
    tools: ['read_file', 'search_files', 'code_analyze'],
    maxIterations: 5,
  },
};

// ============================================================
// GRAPH-BASED ORCHESTRATION — Multi-agent execution engine
// ============================================================

// Agent selection heuristics (intent → agent routing)
const INTENT_KEYWORDS: Record<AgentType, RegExp[]> = {
  rag: [/search\s+(?:knowledge|docs|documents)/i, /\brag\b/i, /ingest/i, /knowledge\s*base/i],
  code: [/\bcode\b/i, /\bwrite\b.*\b(?:function|class|component|module|api)\b/i, /\brefactor\b/i, /\bimplement\b/i, /create\s+(?:a\s+)?(?:file|app|project|module)/i],
  deploy: [/\bdeploy\b/i, /\bpublish\b/i, /cloudflare/i, /vercel/i, /\bbuild\s+and\s+deploy/i],
  design: [/\bdesign\b/i, /\bui\b/i, /\blayout\b/i, /\bfrontend\b/i, /\bhtml\b/i, /\bcss\b/i, /tailwind/i],
  test: [/\btest\b/i, /\bspec\b/i, /\bcoverage\b/i, /\bunit\s*test/i, /\be2e\b/i],
  reviewer: [/\breview\b/i, /\baudit\b/i, /\bsecurity\s+check/i, /\bcode\s+review/i],
  router: [], // catch-all
};

function detectPrimaryAgent(message: string): AgentType {
  for (const [agent, patterns] of Object.entries(INTENT_KEYWORDS) as [AgentType, RegExp[]][]) {
    if (agent === 'router') continue;
    for (const pattern of patterns) {
      if (pattern.test(message)) return agent;
    }
  }
  return 'router';
}

// ============================================================
// ORCHESTRATOR CLASS
// ============================================================
export type EventCallback = (event: GenUIEvent) => void;

export class Orchestrator {
  private state: OrchestrationState;
  private onEvent: EventCallback;
  private aborted: boolean = false;
  private totalTokens: number = 0;
  private totalCostUSD: number = 0;
  private modelsUsed: Set<string> = new Set();
  private toolsUsed: Set<string> = new Set();
  private repairEngine: RepairEngine = new RepairEngine(3, 8);

  constructor(
    conversationId: string,
    userId: string,
    workspacePath: string,
    onEvent: EventCallback
  ) {
    this.onEvent = onEvent;
    this.state = {
      id: generateId('orch'),
      conversationId,
      userId,
      workspaceId: workspacePath,
      currentNode: 'router',
      status: 'idle',
      messages: [],
      toolResults: new Map(),
      agentOutputs: new Map(),
      iteration: 0,
      maxIterations: agentConfig.maxIterations,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };
  }

  abort() { this.aborted = true; }

  private emit(event: Omit<GenUIEvent, 'id' | 'timestamp'>) {
    const fullEvent: GenUIEvent = {
      ...event,
      id: generateId('evt'),
      timestamp: Date.now(),
    } as GenUIEvent;
    this.onEvent(fullEvent);
    eventBus.emit('agent:step', fullEvent);
  }

  // ============================================================
  // MAIN EXECUTION — Planner → Executor → (optional) Reviewer
  // ============================================================
  async execute(userMessage: string, conversationHistory: LLMMessage[] = []): Promise<string> {
    this.state.status = 'planning';
    logger.info(`Orchestrator starting for: "${userMessage.substring(0, 100)}..."`);

    // Detect which agent best handles this request
    const primaryAgent = detectPrimaryAgent(userMessage);
    const agentDef = AGENT_DEFINITIONS[primaryAgent];
    const model = this.resolveModel(agentDef);

    logger.info(`Primary agent: ${primaryAgent} (${model.provider}/${model.model})`);
    this.emit({ type: 'thinking', data: { content: `Routing to ${agentDef.name}...`, agentType: primaryAgent } });

    // Determine available tools
    const allTools = toolRegistry.getLLMToolDefinitions();
    const tools = agentDef.tools.length === 0
      ? allTools  // router gets everything
      : allTools.filter(t => t && agentDef.tools.includes(t.function.name));

    // Build messages
    const messages: LLMMessage[] = [
      { role: 'system', content: agentDef.systemPrompt },
      ...conversationHistory.slice(-20), // keep last 20 history messages
      { role: 'user', content: userMessage },
    ];

    let finalResponse = '';

    // === ReAct Loop ===
    while (this.state.iteration < this.state.maxIterations && !this.aborted) {
      this.state.iteration++;
      this.state.status = 'executing';
      this.state.currentNode = primaryAgent;
      this.state.updatedAt = Date.now();

      logger.info(`Iteration ${this.state.iteration}/${this.state.maxIterations}`);

      try {
        const llmRequest = {
          provider: model.provider,
          model: model.model,
          messages,
          tools: tools as any,
          temperature: agentDef.llmConfig.temperature,
          maxTokens: agentDef.llmConfig.maxTokens,
        };

        // Use streaming to get token-by-token output
        const response = await this.streamAndCollect(llmRequest);

        // Track costs
        this.totalTokens += response.usage.totalTokens;
        this.totalCostUSD += response.usage.costUSD;
        this.modelsUsed.add(response.model);

        // === STOP: text-only response ===
        if (response.finishReason === 'stop' && response.content) {
          finalResponse = response.content;
          // Signal end of streamed text so frontend can finalize markdown rendering
          this.emit({ type: 'text', data: { content: response.content, delta: false } });
          break;
        }

        // === LENGTH: max tokens hit ===
        if (response.finishReason === 'length') {
          finalResponse = response.content || 'Response was truncated due to length limits.';
          this.emit({ type: 'text', data: { content: finalResponse, delta: false } });
          break;
        }

        // === ACT: Execute tool calls ===
        if (response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.toolCalls,
          });

          // Execute tools (respect concurrency limit)
          const concurrencyLimit = agentConfig.maxConcurrentTools || 3;
          const toolCallBatches = chunkArray(response.toolCalls, concurrencyLimit);

          // Collect all tool results for repair scanning
          const allToolResults: { toolName: string; success: boolean; output: any }[] = [];

          for (const batch of toolCallBatches) {
            const results = await Promise.allSettled(
              batch.map(tc => this.executeTool(tc, primaryAgent))
            );

            for (let i = 0; i < batch.length; i++) {
              const tc = batch[i];
              const settledResult = results[i];

              let resultContent: string;
              if (settledResult.status === 'fulfilled') {
                const result = settledResult.value;
                resultContent = result.success
                  ? JSON.stringify(result.output, null, 2)
                  : `Error: ${result.error}`;
                allToolResults.push({
                  toolName: tc.function.name,
                  success: result.success,
                  output: result.output,
                });
              } else {
                resultContent = `Error: ${settledResult.reason?.message || 'Unknown error'}`;
                allToolResults.push({
                  toolName: tc.function.name,
                  success: false,
                  output: { error: settledResult.reason?.message },
                });
              }

              messages.push({
                role: 'tool',
                content: resultContent.substring(0, 20000),
                tool_call_id: tc.id,
              });
            }
          }

          // === REPAIR LOOP: Scan tool results for auto-fixable errors ===
          const repairResult = this.repairEngine.scanToolResults(allToolResults);
          if (repairResult.shouldRepair && repairResult.repairPrompt) {
            const errorSummary = repairResult.errors.map(e => `[${e.category}] ${e.message.substring(0, 80)}`).join('; ');
            logger.info(`Repair triggered: ${repairResult.errors.length} error(s) — ${errorSummary}`);

            // Emit repair_start event for the frontend
            this.emit({
              type: 'component',
              data: {
                name: 'status_badge',
                props: {
                  label: 'Auto-Repair',
                  status: 'running',
                  color: 'yellow',
                  detail: `Detected ${repairResult.errors.length} error(s): ${errorSummary}`,
                },
              },
            });

            // Record the attempt
            this.repairEngine.recordAttempt(repairResult.errors);

            // Inject repair prompt into the conversation so the LLM fixes the issue
            messages.push({
              role: 'user',
              content: repairResult.repairPrompt,
            });

            // The next iteration of the ReAct loop will pick this up and attempt the fix
          }
        } else if (!response.content) {
          // No tools, no content — break
          finalResponse = 'Task completed.';
          break;
        } else {
          // Content but finish_reason is not 'stop' (edge case)
          finalResponse = response.content;
          this.emit({ type: 'text', data: { content: finalResponse, delta: false } });
          break;
        }

      } catch (error: any) {
        logger.error(`Orchestrator error at iteration ${this.state.iteration}: ${error.message}`);
        this.emit({
          type: 'error',
          data: { message: error.message, code: 'ORCHESTRATOR_ERROR', recoverable: true },
        });

        // Recovery: ask the LLM to try a different approach
        messages.push({
          role: 'user',
          content: `An error occurred: ${error.message}. Try a different approach or explain the issue.`,
        });
      }
    }

    // === Max-iterations guard ===
    if (this.state.iteration >= this.state.maxIterations && !finalResponse) {
      finalResponse = 'Reached the maximum iteration limit. Here is what was accomplished so far.';
      logger.warn('Max iterations reached');
    }

    // === Emit done event with full cost aggregation ===
    this.state.status = 'complete';
    const usage = {
      totalTokens: this.totalTokens,
      totalCostUSD: this.totalCostUSD,
      totalDurationMs: Date.now() - this.state.startedAt,
      modelsUsed: Array.from(this.modelsUsed),
      toolsUsed: Array.from(this.toolsUsed),
    };

    this.emit({
      type: 'done',
      data: { summary: finalResponse.substring(0, 300), usage },
    });

    logger.info(`Orchestration complete: ${this.state.iteration} iterations, ${this.totalTokens} tokens, $${this.totalCostUSD.toFixed(6)}`);

    return finalResponse;
  }

  // ============================================================
  // TOOL EXECUTION — With approval gate & event emission
  // ============================================================
  private async executeTool(toolCall: LLMToolCall, agentType: AgentType): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;
    let toolArgs: Record<string, any>;
    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      toolArgs = {};
    }

    this.toolsUsed.add(toolName);

    // Emit tool_call event
    this.emit({
      type: 'tool_call',
      data: { toolName, toolArgs, agentType },
    });

    // Check approval requirement
    const toolDef = toolRegistry.get(toolName);
    if (toolDef?.definition.requiresApproval && agentConfig.enableHumanBreakpoints) {
      this.emit({
        type: 'approval',
        data: {
          id: generateId('approval'),
          message: `Agent wants to execute: ${toolName}`,
          toolName,
          toolArgs,
          actions: ['approve', 'reject'],
          riskLevel: toolDef.definition.riskLevel,
        },
      });
      // Auto-approve for now (WebSocket approval in future)
    }

    // Execute
    const result = await toolRegistry.execute({
      toolName,
      arguments: toolArgs,
      workspaceId: this.state.workspaceId,
      userId: this.state.userId,
      messageId: this.state.id,
    });

    // Emit tool_result event
    this.emit({
      type: 'tool_result',
      data: {
        toolName,
        success: result.success,
        output: typeof result.output === 'string'
          ? result.output.substring(0, 5000)
          : result.output,
        durationMs: result.durationMs,
      },
    });

    logger.info(`Tool ${toolName}: ${result.success ? 'OK' : 'FAIL'} (${result.durationMs}ms)`);
    return result;
  }

  // ============================================================
  // MODEL RESOLUTION — Fallback-aware
  // ============================================================
  private resolveModel(agentDef: Omit<AgentNode, 'id'>): { provider: any; model: string } {
    try {
      const config = agentDef.llmConfig;
      // Try the best model for the agent's task type
      const taskTypeMap: Partial<Record<AgentType, string>> = {
        code: 'code_generation',
        reviewer: 'code_review',
        rag: 'rag_query',
        deploy: 'classification',
        test: 'code_generation',
        design: 'code_generation',
      };
      const taskType = taskTypeMap[agentDef.type];
      if (taskType) {
        try {
          const best = getBestModelForTask(taskType as any);
          return { provider: best.provider, model: best.model };
        } catch {
          // Fall through to default config
        }
      }
      return { provider: config.provider, model: config.model };
    } catch {
      const best = getBestModelForTask('general_reasoning');
      return { provider: best.provider, model: best.model };
    }
  }

  // ============================================================
  // STREAMING COLLECT — Streams text tokens live, collects tool calls
  // ============================================================
  private async streamAndCollect(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const startMs = Date.now();
    let content = '';
    let hasTextContent = false;
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
    let usage: LLMCompletionResponse['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 };

    try {
      const stream = streamLLM(req);
      let currentToolIndex = -1;

      for await (const chunk of stream) {
        if (this.aborted) break;

        switch (chunk.type) {
          case 'text_delta':
            if (chunk.content) {
              content += chunk.content;
              hasTextContent = true;
              // Emit each text token as a delta SSE event for live streaming
              this.emit({ type: 'text', data: { content: chunk.content, delta: true } });
            }
            break;

          case 'tool_call_delta':
            // Tool call deltas come in parts: first with id+name, then with argument chunks
            if (chunk.toolCallId || chunk.toolName) {
              currentToolIndex++;
              toolCallMap.set(currentToolIndex, {
                id: chunk.toolCallId || generateId('tc'),
                name: chunk.toolName || '',
                args: chunk.toolArgs || '',
              });
            } else if (chunk.toolArgs && currentToolIndex >= 0) {
              const tc = toolCallMap.get(currentToolIndex);
              if (tc) tc.args += chunk.toolArgs;
            }
            break;

          case 'usage':
            if (chunk.usage) usage = chunk.usage;
            break;

          case 'done':
            break;

          case 'error':
            throw new Error(chunk.error || 'Stream error');
        }
      }
    } catch (error: any) {
      // If we collected some streamed text before the error, still return it
      if (!hasTextContent && toolCallMap.size === 0) {
        throw error;
      }
      logger.warn(`Stream error after partial data: ${error.message}`);
    }

    // Build tool calls array
    const toolCalls: LLMToolCall[] = [];
    for (const [, tc] of toolCallMap) {
      if (tc.name) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args || '{}' },
        });
      }
    }

    // Determine finish reason
    let finishReason: LLMCompletionResponse['finishReason'] = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    return {
      id: generateId('stream'),
      provider: req.provider,
      model: req.model,
      content: content || null,
      toolCalls,
      usage,
      finishReason,
      latencyMs: Date.now() - startMs,
    };
  }

  getState(): OrchestrationState {
    return { ...this.state };
  }

  getUsage() {
    return {
      totalTokens: this.totalTokens,
      totalCostUSD: this.totalCostUSD,
      modelsUsed: Array.from(this.modelsUsed),
      toolsUsed: Array.from(this.toolsUsed),
      iterations: this.state.iteration,
      durationMs: Date.now() - this.state.startedAt,
    };
  }
}

// ============================================================
// UTILITY
// ============================================================
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
