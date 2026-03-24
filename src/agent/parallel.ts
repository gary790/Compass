// ============================================================
// PARALLEL AGENT EXECUTOR
// Decomposes complex tasks into sub-tasks, runs agents in parallel lanes,
// tracks dependencies, and merges results into a unified response.
// ============================================================
import {
  AgentType, LLMMessage, LLMToolCall, LLMCompletionRequest,
  LLMCompletionResponse, ToolExecutionResult, GenUIEvent,
} from '../types/index.js';
import { callLLM, streamLLM } from '../llm/router.js';
import { RepairEngine } from './repair.js';
import { requestApproval } from '../routes/websocket.js';
import { toolRegistry } from '../tools/index.js';
import { getBestModelForTask, agentConfig } from '../config/index.js';
import { createLogger, generateId } from '../utils/index.js';
import { eventBus } from '../utils/index.js';

const logger = createLogger('ParallelExecutor');

// ============================================================
// TYPES
// ============================================================

/** A single sub-task produced by the Planner */
export interface SubTask {
  id: string;
  agentType: AgentType;
  title: string;
  instruction: string;
  dependsOn: string[];   // ids of tasks that must finish first
  priority: number;       // 1 = highest
}

/** The structured plan output from the Planner */
export interface ExecutionPlan {
  parallel: boolean;
  reasoning: string;
  tasks: SubTask[];
}

/** Result of a single agent lane */
export interface LaneResult {
  taskId: string;
  agentType: AgentType;
  title: string;
  success: boolean;
  output: string;
  tokens: number;
  costUSD: number;
  durationMs: number;
  toolsUsed: string[];
  iterations: number;
}

/** Callback for streaming events (same signature as Orchestrator) */
export type ParallelEventCallback = (event: GenUIEvent) => void;

// ============================================================
// AGENT DEFINITIONS (subset for parallel lanes)
// ============================================================
const LANE_AGENTS: Record<string, {
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  temperature: number;
  maxTokens: number;
}> = {
  code: {
    systemPrompt: `You are the Code Agent running in a parallel lane. Another agent may be working on a different part of the same project simultaneously.
Rules:
1. Read existing files before editing.
2. Write clean, well-commented, production-ready code.
3. Use code_generate for new files, edit_file for surgical changes.
4. Run tests after changes when a test framework is available.
5. Be specific about file paths and contents.
6. Summarise what you created/changed at the end.`,
    tools: [
      'read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory',
      'shell_exec', 'npm_install', 'npm_run', 'code_generate', 'code_analyze', 'code_test', 'code_refactor',
      'git_status',
    ],
    maxIterations: 15,
    temperature: 0.3,
    maxTokens: 8192,
  },
  design: {
    systemPrompt: `You are the Design Agent running in a parallel lane. Another agent may be working on backend code simultaneously.
Create beautiful, responsive web UIs with Tailwind CSS.
1. Generate complete HTML/CSS/JS files.
2. Use semantic HTML and accessible markup.
3. Include responsive breakpoints.
4. Summarise what you created at the end.`,
    tools: ['write_file', 'read_file', 'list_directory', 'code_generate', 'web_search'],
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 8192,
  },
  test: {
    systemPrompt: `You are the Test/QA Agent running in a parallel lane. Other agents are building code simultaneously.
1. Wait for dependencies if any, then read the generated code.
2. Generate comprehensive tests (unit + integration).
3. Run the test suite and report results.
4. If tests fail, report the failures clearly but do NOT fix code — that's the Code Agent's job.
5. Summarise test coverage and results.`,
    tools: ['read_file', 'write_file', 'list_directory', 'search_files', 'shell_exec', 'npm_run', 'code_test', 'code_analyze'],
    maxIterations: 10,
    temperature: 0.3,
    maxTokens: 4096,
  },
  reviewer: {
    systemPrompt: `You are the Reviewer Agent running in a parallel lane. Other agents are building code simultaneously.
Review code for:
1. Security vulnerabilities (XSS, SQL injection, path traversal, etc.)
2. Best practice violations
3. Bugs and edge cases
4. Performance issues
Return PASS or FAIL with specific issues and file:line references.`,
    tools: ['read_file', 'search_files', 'list_directory', 'code_analyze'],
    maxIterations: 5,
    temperature: 0.3,
    maxTokens: 4096,
  },
  deploy: {
    systemPrompt: `You are the Deploy Agent running in a parallel lane.
1. Ensure the project builds (npm run build).
2. Deploy using deploy_cloudflare or deploy_vercel.
3. Report the live URL on success, or the error on failure.`,
    tools: ['shell_exec', 'npm_run', 'deploy_cloudflare', 'deploy_vercel', 'deploy_status', 'deploy_preview', 'read_file', 'list_directory'],
    maxIterations: 10,
    temperature: 0.3,
    maxTokens: 2048,
  },
  rag: {
    systemPrompt: `You are the RAG Agent running in a parallel lane.
1. Search the knowledge base with rag_query (prefer hybrid search).
2. If the KB lacks information, fall back to web_search.
3. Summarise findings and cite sources.`,
    tools: ['rag_query', 'rag_list_docs', 'rag_ingest', 'web_search', 'web_scrape'],
    maxIterations: 5,
    temperature: 0.3,
    maxTokens: 2048,
  },
  router: {
    systemPrompt: `You are a general-purpose agent running in a parallel lane.
Execute the specific task assigned to you using any available tools.
Summarise what you accomplished at the end.`,
    tools: [], // gets ALL tools
    maxIterations: 15,
    temperature: 0.5,
    maxTokens: 4096,
  },
};

// ============================================================
// PLANNER — Uses LLM to decompose into parallel sub-tasks
// ============================================================

const PLANNER_SYSTEM_PROMPT = `You are a Task Planner for an AI agent platform.

Given a user request, decide if it should be handled by a SINGLE agent or MULTIPLE agents in PARALLEL.

AVAILABLE AGENTS:
- code: Writes/edits code, runs shell commands, manages files
- design: Creates UI/frontend (HTML, CSS, Tailwind, layouts)
- test: Generates and runs tests, QA
- reviewer: Code review, security audit
- deploy: Build and deploy to Cloudflare/Vercel
- rag: Knowledge base search and document ingestion
- router: General-purpose for anything else

RULES:
1. Use parallel=true ONLY when the request clearly has 2+ INDEPENDENT sub-tasks.
2. Tasks that need each other's output should use "dependsOn" (e.g., test depends on code).
3. For simple requests (single action), use parallel=false with one task.
4. Maximum 4 parallel lanes to avoid overwhelming the system.
5. Each task must have a clear, specific instruction.

EXAMPLES of parallelisable requests:
- "Build a REST API with tests" → code + test (test depends on code)
- "Create a landing page with backend API" → design (frontend) + code (backend) in parallel
- "Build a todo app, review the code, and deploy" → code → reviewer (depends on code) + deploy (depends on code)
- "Search docs and write a summary, also create a test for auth" → rag + test in parallel

EXAMPLES of single-agent requests:
- "Fix the bug in auth.ts" → single code agent
- "Deploy to Cloudflare" → single deploy agent
- "Search the knowledge base for React patterns" → single rag agent

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "parallel": true/false,
  "reasoning": "brief explanation",
  "tasks": [
    {
      "id": "task_1",
      "agentType": "code",
      "title": "Short title",
      "instruction": "Detailed instruction for this agent",
      "dependsOn": [],
      "priority": 1
    }
  ]
}`;

export async function planExecution(
  userMessage: string,
  conversationHistory: LLMMessage[]
): Promise<ExecutionPlan> {
  try {
    const model = getBestModelForTask('classification');

    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        ...conversationHistory.slice(-6),
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });

    if (!response.content) {
      return fallbackPlan(userMessage);
    }

    // Parse JSON — strip markdown fences if present
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const plan: ExecutionPlan = JSON.parse(jsonStr);

    // Validate plan
    if (!plan.tasks || plan.tasks.length === 0) {
      return fallbackPlan(userMessage);
    }

    // Ensure IDs exist
    for (const task of plan.tasks) {
      if (!task.id) task.id = generateId('task');
      if (!task.dependsOn) task.dependsOn = [];
      if (!task.priority) task.priority = 1;
    }

    // Cap at 4 parallel tasks
    if (plan.tasks.length > 4) {
      plan.tasks = plan.tasks.slice(0, 4);
    }

    logger.info(`Plan: parallel=${plan.parallel}, ${plan.tasks.length} task(s): ${plan.tasks.map(t => `${t.agentType}(${t.title})`).join(', ')}`);
    return plan;

  } catch (error: any) {
    logger.warn(`Planner failed: ${error.message} — using fallback`);
    return fallbackPlan(userMessage);
  }
}

function fallbackPlan(userMessage: string): ExecutionPlan {
  // Fall back to single-agent mode (router)
  return {
    parallel: false,
    reasoning: 'Fallback to single agent',
    tasks: [{
      id: generateId('task'),
      agentType: 'router',
      title: 'Execute request',
      instruction: userMessage,
      dependsOn: [],
      priority: 1,
    }],
  };
}

// ============================================================
// PARALLEL EXECUTOR — Runs multiple agent lanes concurrently
// ============================================================
export class ParallelExecutor {
  private onEvent: ParallelEventCallback;
  private workspacePath: string;
  private userId: string;
  private conversationId: string;
  private aborted: boolean = false;
  private totalTokens: number = 0;
  private totalCostUSD: number = 0;
  private modelsUsed: Set<string> = new Set();
  private toolsUsed: Set<string> = new Set();
  private startedAt: number = Date.now();

  constructor(
    conversationId: string,
    userId: string,
    workspacePath: string,
    onEvent: ParallelEventCallback,
  ) {
    this.conversationId = conversationId;
    this.userId = userId;
    this.workspacePath = workspacePath;
    this.onEvent = onEvent;
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
  // EXECUTE PLAN — Orchestrates parallel lanes with dependency resolution
  // ============================================================
  async executePlan(
    plan: ExecutionPlan,
    userMessage: string,
    conversationHistory: LLMMessage[],
  ): Promise<{ finalResponse: string; laneResults: LaneResult[] }> {

    // Emit plan overview
    this.emit({
      type: 'component',
      data: {
        name: 'status_badge',
        props: {
          label: 'Parallel Execution',
          status: 'running',
          color: 'blue',
          detail: `${plan.tasks.length} agent(s): ${plan.tasks.map(t => t.agentType).join(', ')} — ${plan.reasoning}`,
        },
      },
    });

    const results = new Map<string, LaneResult>();
    const completed = new Set<string>();
    const running = new Set<string>();
    const failed = new Set<string>();

    // Build dependency graph
    const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
    const pendingTasks = new Set(plan.tasks.map(t => t.id));

    // Resolve tasks in topological order, launching parallel where possible
    while (pendingTasks.size > 0 && !this.aborted) {
      // Find tasks whose dependencies are all satisfied
      const ready: SubTask[] = [];
      for (const taskId of pendingTasks) {
        const task = taskMap.get(taskId)!;
        const depsReady = task.dependsOn.every(
          depId => completed.has(depId) || failed.has(depId)
        );
        if (depsReady && !running.has(taskId)) {
          ready.push(task);
        }
      }

      if (ready.length === 0 && running.size === 0) {
        // Deadlock — remaining tasks have unsatisfied deps that failed
        logger.warn(`Deadlock: ${pendingTasks.size} tasks stuck with unresolvable deps`);
        break;
      }

      if (ready.length === 0) {
        // All ready tasks are already running — wait a tick
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      // Launch all ready tasks in parallel
      const lanePromises: Promise<void>[] = [];

      for (const task of ready) {
        running.add(task.id);

        // Collect outputs from dependency tasks as context
        const depContext = task.dependsOn
          .filter(id => results.has(id))
          .map(id => {
            const r = results.get(id)!;
            return `[${r.agentType} agent — "${r.title}"]: ${r.output.substring(0, 3000)}`;
          })
          .join('\n\n');

        const promise = this.runLane(task, userMessage, conversationHistory, depContext)
          .then(result => {
            results.set(task.id, result);
            completed.add(task.id);
            running.delete(task.id);
            pendingTasks.delete(task.id);

            // Accumulate global stats
            this.totalTokens += result.tokens;
            this.totalCostUSD += result.costUSD;
            result.toolsUsed.forEach(t => this.toolsUsed.add(t));
          })
          .catch(error => {
            logger.error(`Lane ${task.id} (${task.agentType}) failed: ${error.message}`);
            results.set(task.id, {
              taskId: task.id,
              agentType: task.agentType,
              title: task.title,
              success: false,
              output: `Error: ${error.message}`,
              tokens: 0,
              costUSD: 0,
              durationMs: 0,
              toolsUsed: [],
              iterations: 0,
            });
            failed.add(task.id);
            running.delete(task.id);
            pendingTasks.delete(task.id);
          });

        lanePromises.push(promise);
      }

      // Wait for this batch of lanes to settle
      await Promise.allSettled(lanePromises);
    }

    // Collect all lane results
    const laneResults = Array.from(results.values());

    // Merge / Synthesise final response
    const finalResponse = await this.mergeResults(laneResults, userMessage);

    // Emit completion
    this.emit({
      type: 'component',
      data: {
        name: 'status_badge',
        props: {
          label: 'Parallel Execution',
          status: failed.size > 0 ? (completed.size > 0 ? 'running' : 'failed') : 'success',
          color: failed.size > 0 ? (completed.size > 0 ? 'yellow' : 'red') : 'green',
          detail: `${completed.size}/${plan.tasks.length} succeeded, ${failed.size} failed`,
        },
      },
    });

    return { finalResponse, laneResults };
  }

  // ============================================================
  // RUN LANE — Individual agent ReAct loop for one sub-task
  // ============================================================
  private async runLane(
    task: SubTask,
    userMessage: string,
    conversationHistory: LLMMessage[],
    dependencyContext: string,
  ): Promise<LaneResult> {
    const startMs = Date.now();
    const laneId = generateId('lane');
    const agentDef = LANE_AGENTS[task.agentType] || LANE_AGENTS.router;
    const repairEngine = new RepairEngine(2, 4); // Tighter limits per lane
    const toolsUsed = new Set<string>();
    let totalTokens = 0;
    let totalCostUSD = 0;
    let iterations = 0;

    logger.info(`Lane ${laneId} starting: [${task.agentType}] "${task.title}"`);

    // Emit lane start
    this.emit({
      type: 'thinking',
      data: {
        content: `🔀 [${task.agentType.toUpperCase()}] Starting: ${task.title}`,
        agentType: task.agentType,
      },
    });

    // Resolve model
    const model = this.resolveModel(task.agentType);
    this.modelsUsed.add(`${model.provider}/${model.model}`);

    // Resolve tools
    const allTools = toolRegistry.getLLMToolDefinitions();
    const tools = agentDef.tools.length === 0
      ? allTools
      : allTools.filter(t => t && agentDef.tools.includes(t.function.name));

    // Build message context
    const messages: LLMMessage[] = [
      { role: 'system', content: agentDef.systemPrompt },
      ...conversationHistory.slice(-10),
    ];

    // Inject dependency context if available
    if (dependencyContext) {
      messages.push({
        role: 'system',
        content: `CONTEXT FROM COMPLETED PARALLEL AGENTS:\n\n${dependencyContext}\n\nUse this context when executing your task.`,
      });
    }

    // Inject the specific sub-task instruction
    messages.push({
      role: 'user',
      content: `ORIGINAL REQUEST: ${userMessage}\n\nYOUR SPECIFIC TASK: ${task.instruction}`,
    });

    let finalOutput = '';

    // ReAct loop for this lane
    while (iterations < agentDef.maxIterations && !this.aborted) {
      iterations++;

      try {
        const llmRequest: LLMCompletionRequest = {
          provider: model.provider,
          model: model.model,
          messages,
          tools: tools as any,
          temperature: agentDef.temperature,
          maxTokens: agentDef.maxTokens,
        };

        const response = await this.streamAndCollectForLane(llmRequest, task.agentType);
        totalTokens += response.usage.totalTokens;
        totalCostUSD += response.usage.costUSD;

        // STOP: text-only response
        if (response.finishReason === 'stop' && response.content) {
          finalOutput = response.content;
          this.emit({ type: 'text', data: { content: `\n\n**[${task.agentType.toUpperCase()}]** ${response.content}`, delta: false } });
          break;
        }

        // LENGTH
        if (response.finishReason === 'length') {
          finalOutput = response.content || 'Truncated.';
          break;
        }

        // TOOL CALLS
        if (response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.toolCalls,
          });

          const allToolResults: { toolName: string; success: boolean; output: any }[] = [];

          for (const tc of response.toolCalls) {
            const result = await this.executeToolForLane(tc, task.agentType);
            toolsUsed.add(tc.function.name);

            const resultContent = result.success
              ? JSON.stringify(result.output, null, 2)
              : `Error: ${result.error}`;

            allToolResults.push({
              toolName: tc.function.name,
              success: result.success,
              output: result.output,
            });

            messages.push({
              role: 'tool',
              content: resultContent.substring(0, 15000),
              tool_call_id: tc.id,
            });
          }

          // Repair check
          const repairResult = repairEngine.scanToolResults(allToolResults);
          if (repairResult.shouldRepair && repairResult.repairPrompt) {
            repairEngine.recordAttempt(repairResult.errors);
            messages.push({ role: 'user', content: repairResult.repairPrompt });
          }

        } else if (!response.content) {
          finalOutput = 'Lane completed.';
          break;
        } else {
          finalOutput = response.content;
          break;
        }

      } catch (error: any) {
        logger.error(`Lane ${laneId} error at iteration ${iterations}: ${error.message}`);
        messages.push({
          role: 'user',
          content: `Error: ${error.message}. Try a different approach.`,
        });
      }
    }

    const durationMs = Date.now() - startMs;

    // Emit lane completion
    this.emit({
      type: 'component',
      data: {
        name: 'status_badge',
        props: {
          label: task.agentType.toUpperCase(),
          status: finalOutput ? 'success' : 'failed',
          color: finalOutput ? 'green' : 'red',
          detail: `${task.title} — ${iterations} iters, ${totalTokens} tokens, ${(durationMs / 1000).toFixed(1)}s`,
        },
      },
    });

    logger.info(`Lane ${laneId} [${task.agentType}] done: ${iterations} iters, ${totalTokens} tokens, ${durationMs}ms`);

    return {
      taskId: task.id,
      agentType: task.agentType,
      title: task.title,
      success: !!finalOutput,
      output: finalOutput || 'No output produced.',
      tokens: totalTokens,
      costUSD: totalCostUSD,
      durationMs,
      toolsUsed: Array.from(toolsUsed),
      iterations,
    };
  }

  // ============================================================
  // STREAM AND COLLECT — Per-lane streaming (emits with agent prefix)
  // ============================================================
  private async streamAndCollectForLane(
    req: LLMCompletionRequest,
    agentType: AgentType,
  ): Promise<LLMCompletionResponse> {
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
              // Stream text with agent lane prefix for UI demuxing
              this.emit({
                type: 'text',
                data: { content: chunk.content, delta: true, agentType } as any,
              });
            }
            break;

          case 'tool_call_delta':
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
      if (!hasTextContent && toolCallMap.size === 0) throw error;
      logger.warn(`Lane stream error after partial data: ${error.message}`);
    }

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

    return {
      id: generateId('stream'),
      provider: req.provider,
      model: req.model,
      content: content || null,
      toolCalls,
      usage,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      latencyMs: Date.now() - startMs,
    };
  }

  // ============================================================
  // TOOL EXECUTION — Per-lane (with approval + events)
  // ============================================================
  private async executeToolForLane(
    toolCall: LLMToolCall,
    agentType: AgentType,
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;
    let toolArgs: Record<string, any>;
    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      toolArgs = {};
    }

    this.toolsUsed.add(toolName);

    // Emit tool_call with agent type
    this.emit({
      type: 'tool_call',
      data: { toolName, toolArgs, agentType },
    });

    // Check approval
    const toolDef = toolRegistry.get(toolName);
    if (toolDef?.definition.requiresApproval && agentConfig.enableHumanBreakpoints) {
      const approvalId = generateId('approval');
      this.emit({
        type: 'approval',
        data: {
          id: approvalId,
          message: `[${agentType.toUpperCase()}] wants to execute: ${toolName}`,
          toolName,
          toolArgs,
          actions: ['approve', 'reject'],
          riskLevel: toolDef.definition.riskLevel || 'medium',
          description: toolDef.definition.description || '',
          category: toolDef.definition.category || '',
        },
      });

      const approved = await requestApproval(approvalId, 60000);
      if (!approved) {
        this.emit({
          type: 'tool_result',
          data: { toolName, success: false, output: 'Rejected by user', durationMs: 0 },
        });
        return {
          success: false,
          output: 'Rejected by user — tool execution was not approved.',
          error: 'User rejected.',
          durationMs: 0,
        };
      }
    }

    const result = await toolRegistry.execute({
      toolName,
      arguments: toolArgs,
      workspaceId: this.workspacePath,
      userId: this.userId,
      messageId: generateId('msg'),
    });

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

    return result;
  }

  // ============================================================
  // MERGE RESULTS — Synthesise all lane outputs into final response
  // ============================================================
  private async mergeResults(results: LaneResult[], userMessage: string): Promise<string> {
    if (results.length === 0) return 'No agents produced output.';
    if (results.length === 1) return results[0].output;

    // For multi-lane: use LLM to synthesise
    const resultsSummary = results.map(r =>
      `## ${r.agentType.toUpperCase()} Agent — "${r.title}" [${r.success ? 'SUCCESS' : 'FAILED'}]
${r.output.substring(0, 4000)}
(${r.iterations} iterations, ${r.tokens} tokens, ${(r.durationMs / 1000).toFixed(1)}s, tools: ${r.toolsUsed.join(', ') || 'none'})`
    ).join('\n\n---\n\n');

    try {
      const model = getBestModelForTask('general_reasoning');

      const response = await callLLM({
        provider: model.provider,
        model: model.model,
        messages: [
          {
            role: 'system',
            content: `You are a synthesis agent. Multiple agents worked in parallel on parts of a user request. 
Combine their outputs into a single, coherent response. Include:
1. Summary of what each agent accomplished
2. Any files created or modified
3. Any issues or failures
4. Next steps if applicable
Be concise and well-structured.`,
          },
          {
            role: 'user',
            content: `ORIGINAL REQUEST: ${userMessage}\n\nAGENT RESULTS:\n\n${resultsSummary}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2048,
      });

      if (response.content) {
        this.totalTokens += response.usage.totalTokens;
        this.totalCostUSD += response.usage.costUSD;
        return response.content;
      }
    } catch (error: any) {
      logger.warn(`Merge LLM failed: ${error.message} — using concatenation`);
    }

    // Fallback: simple concatenation
    return results.map(r =>
      `### ${r.agentType.toUpperCase()} — ${r.title} [${r.success ? '✅' : '❌'}]\n${r.output}`
    ).join('\n\n---\n\n');
  }

  // ============================================================
  // MODEL RESOLUTION
  // ============================================================
  private resolveModel(agentType: AgentType): { provider: any; model: string } {
    const taskTypeMap: Partial<Record<AgentType, string>> = {
      code: 'code_generation',
      reviewer: 'code_review',
      rag: 'rag_query',
      deploy: 'classification',
      test: 'code_generation',
      design: 'code_generation',
    };
    try {
      const taskType = taskTypeMap[agentType];
      if (taskType) {
        const best = getBestModelForTask(taskType as any);
        return { provider: best.provider, model: best.model };
      }
    } catch { /* fall through */ }

    try {
      return getBestModelForTask('general_reasoning');
    } catch {
      return { provider: 'openai', model: 'gpt-4o' };
    }
  }

  // ============================================================
  // STATS
  // ============================================================
  getUsage() {
    return {
      totalTokens: this.totalTokens,
      totalCostUSD: this.totalCostUSD,
      modelsUsed: Array.from(this.modelsUsed),
      toolsUsed: Array.from(this.toolsUsed),
      durationMs: Date.now() - this.startedAt,
    };
  }
}
