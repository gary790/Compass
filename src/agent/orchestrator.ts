import {
  AgentNode, AgentType, AgentState, OrchestrationState, AgentStepEvent,
  LLMMessage, LLMToolCall, ToolExecutionResult, GenUIEvent
} from '../types/index.js';
import { callLLM } from '../llm/router.js';
import { toolRegistry } from '../tools/index.js';
import { getBestModelForTask, agentConfig } from '../config/index.js';
import { createLogger, generateId, withTimeout } from '../utils/index.js';
import { eventBus } from '../utils/index.js';

const logger = createLogger('Orchestrator');

// ============================================================
// SUB-AGENT DEFINITIONS
// ============================================================
const AGENT_DEFINITIONS: Record<AgentType, Omit<AgentNode, 'id'>> = {
  router: {
    type: 'router',
    name: 'Router Agent',
    description: 'Analyzes user intent and decides which sub-agents to invoke. This is the orchestrator.',
    systemPrompt: `You are the Router Agent in an Agentic RAG platform. Your job is to:
1. Analyze the user's request
2. Break it into sub-tasks
3. Use the available tools to accomplish each sub-task
4. Coordinate between different capabilities (code, files, search, deploy, etc.)

You have access to tools for: file operations, shell commands, git, GitHub, deployment, web search/scraping, code analysis/generation, database operations, and RAG knowledge base search.

IMPORTANT RULES:
- Always think step by step before acting
- Use the RAG knowledge base (rag_query) when you need context about the project or documentation
- Use code_generate for creating new code, code_analyze for reviewing existing code
- Use shell_exec for running builds, tests, and other commands
- Use git tools for version control operations
- Use deploy tools only when explicitly asked to deploy
- If unsure, search the web or ask for clarification
- Keep responses concise and actionable`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
    },
    tools: [], // Gets ALL tools
    maxIterations: 25,
  },
  rag: {
    type: 'rag',
    name: 'RAG Agent',
    description: 'Searches knowledge base and retrieves relevant context.',
    systemPrompt: `You are the RAG Agent. Search the knowledge base to find relevant information for the user's query. Use hybrid search for best results. Summarize the findings clearly.`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2048,
    },
    tools: ['rag_query', 'rag_list_docs', 'rag_ingest', 'web_search', 'web_scrape'],
    maxIterations: 5,
  },
  code: {
    type: 'code',
    name: 'Code Agent',
    description: 'Generates, edits, analyzes, and tests code.',
    systemPrompt: `You are the Code Agent. You write clean, production-ready code. You can create files, edit existing ones, generate tests, and analyze code quality. Always follow best practices for the given language and framework.`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 8192,
    },
    tools: ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory',
            'shell_exec', 'npm_install', 'npm_run', 'code_generate', 'code_analyze', 'code_test', 'code_refactor',
            'git_status', 'git_commit'],
    maxIterations: 15,
  },
  deploy: {
    type: 'deploy',
    name: 'Deploy Agent',
    description: 'Handles building and deploying projects to Cloudflare Pages or Vercel.',
    systemPrompt: `You are the Deploy Agent. You build projects and deploy them. Always run the build command first, verify it succeeds, then deploy.`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2048,
    },
    tools: ['shell_exec', 'npm_run', 'deploy_cloudflare', 'deploy_vercel', 'deploy_status', 'deploy_preview',
            'read_file', 'list_directory'],
    maxIterations: 10,
  },
  design: {
    type: 'design',
    name: 'Design Agent',
    description: 'Creates UI layouts, chooses styles, and generates frontend assets.',
    systemPrompt: `You are the Design Agent. You create beautiful, responsive web interfaces using Tailwind CSS. Generate complete HTML/CSS/JS for UI components.`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 8192,
    },
    tools: ['write_file', 'read_file', 'code_generate', 'web_search'],
    maxIterations: 10,
  },
  test: {
    type: 'test',
    name: 'Test Agent',
    description: 'Generates and runs tests to verify code correctness.',
    systemPrompt: `You are the Test Agent. Generate comprehensive tests and run them. Report results clearly.`,
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 4096,
    },
    tools: ['read_file', 'write_file', 'shell_exec', 'npm_run', 'code_test', 'code_analyze'],
    maxIterations: 10,
  },
  reviewer: {
    type: 'reviewer',
    name: 'Reviewer Agent',
    description: 'Reviews code for security, best practices, and correctness.',
    systemPrompt: `You are the Reviewer Agent. Review the code/output from other agents. Check for:
1. Security vulnerabilities (XSS, SQL injection, etc.)
2. Best practice violations
3. Bugs and edge cases
4. Performance issues
Return a verdict: PASS (safe to proceed) or FAIL (needs fixes) with specific issues.`,
    llmConfig: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.3,
      maxTokens: 4096,
    },
    tools: ['read_file', 'search_files', 'code_analyze'],
    maxIterations: 5,
  },
};

// ============================================================
// ORCHESTRATION ENGINE — The ReAct Loop
// ============================================================

export type EventCallback = (event: GenUIEvent) => void;

export class Orchestrator {
  private state: OrchestrationState;
  private onEvent: EventCallback;
  private aborted: boolean = false;

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

  abort() {
    this.aborted = true;
  }

  private emit(event: Omit<GenUIEvent, 'id' | 'timestamp'>) {
    const fullEvent: GenUIEvent = {
      ...event,
      id: generateId('evt'),
      timestamp: Date.now(),
    } as GenUIEvent;
    this.onEvent(fullEvent);
  }

  // ============================================================
  // MAIN EXECUTION — ReAct Loop (Reason + Act)
  // ============================================================
  async execute(userMessage: string, conversationHistory: LLMMessage[] = []): Promise<string> {
    this.state.status = 'planning';
    logger.info(`Orchestrator starting for: "${userMessage.substring(0, 100)}..."`);

    // Use router agent by default
    const agentDef = AGENT_DEFINITIONS.router;
    const model = this.resolveModel(agentDef);

    // Build messages
    const messages: LLMMessage[] = [
      { role: 'system', content: agentDef.systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    // Get all tool definitions for the router
    const tools = toolRegistry.getLLMToolDefinitions();

    this.emit({ type: 'thinking', data: { content: 'Analyzing your request...' } });

    let finalResponse = '';

    // ReAct Loop
    while (this.state.iteration < this.state.maxIterations && !this.aborted) {
      this.state.iteration++;
      this.state.status = 'executing';
      this.state.updatedAt = Date.now();

      logger.info(`Iteration ${this.state.iteration}/${this.state.maxIterations}`);

      try {
        // REASON: Call LLM
        const response = await withTimeout(
          callLLM({
            provider: model.provider,
            model: model.model,
            messages,
            tools: tools as any,
            temperature: agentDef.llmConfig.temperature,
            maxTokens: agentDef.llmConfig.maxTokens,
          }),
          agentConfig.timeoutMs,
          'LLM call timed out'
        );

        // If LLM returned text (no tool calls) — we're done
        if (response.finishReason === 'stop' && response.content) {
          finalResponse = response.content;

          // Stream the response text
          this.emit({ type: 'text', data: { content: response.content, delta: false } });
          break;
        }

        // ACT: Execute tool calls
        if (response.toolCalls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.toolCalls,
          });

          // Stream thinking if there's content
          if (response.content) {
            this.emit({ type: 'text', data: { content: response.content, delta: false } });
          }

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, any>;

            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              toolArgs = {};
            }

            // Emit tool call event
            this.emit({
              type: 'tool_call',
              data: { toolName, toolArgs, agentType: 'router' as AgentType },
            });

            // Check if tool requires approval
            const toolDef = toolRegistry.get(toolName);
            if (toolDef?.definition.requiresApproval && agentConfig.enableHumanBreakpoints) {
              this.emit({
                type: 'approval',
                data: {
                  id: generateId('approval'),
                  message: `The agent wants to execute: ${toolName}`,
                  toolName,
                  toolArgs,
                  actions: ['approve', 'reject'],
                  riskLevel: toolDef.definition.riskLevel,
                },
              });
              // For now, auto-approve (human-in-the-loop via WebSocket in production)
            }

            // Execute the tool
            const result = await toolRegistry.execute({
              toolName,
              arguments: toolArgs,
              workspaceId: this.state.workspaceId,
              userId: this.state.userId,
              messageId: this.state.id,
            });

            // Emit tool result event
            this.emit({
              type: 'tool_result',
              data: {
                toolName,
                success: result.success,
                output: result.output,
                durationMs: result.durationMs,
              },
            });

            // Add tool result to messages
            const resultContent = result.success
              ? JSON.stringify(result.output, null, 2)
              : `Error: ${result.error}`;

            messages.push({
              role: 'tool',
              content: resultContent.substring(0, 20000), // Limit tool output size
              tool_call_id: toolCall.id,
            });

            // Store result
            this.state.toolResults.set(toolCall.id, result);

            logger.info(`Tool ${toolName}: ${result.success ? 'success' : 'failed'} (${result.durationMs}ms)`);
          }
        } else {
          // No tool calls and no content — shouldn't happen, but break to avoid infinite loop
          finalResponse = response.content || 'Task completed.';
          break;
        }

      } catch (error: any) {
        logger.error(`Orchestrator error at iteration ${this.state.iteration}: ${error.message}`);
        this.emit({
          type: 'error',
          data: { message: error.message, code: 'ORCHESTRATOR_ERROR', recoverable: true },
        });

        // Try to recover by adding error context
        messages.push({
          role: 'user',
          content: `An error occurred: ${error.message}. Please try a different approach or explain the issue.`,
        });
      }
    }

    if (this.state.iteration >= this.state.maxIterations) {
      finalResponse = finalResponse || 'Reached maximum iterations. Here is what was accomplished so far.';
      logger.warn('Max iterations reached');
    }

    // Done
    this.state.status = 'complete';
    this.emit({
      type: 'done',
      data: {
        summary: finalResponse.substring(0, 200),
        usage: {
          totalTokens: 0, // Would aggregate from all LLM calls
          totalCostUSD: 0,
          totalDurationMs: Date.now() - this.state.startedAt,
          modelsUsed: [model.model],
          toolsUsed: Array.from(this.state.toolResults.keys()),
        },
      },
    });

    return finalResponse;
  }

  private resolveModel(agentDef: Omit<AgentNode, 'id'>) {
    try {
      // Try to use the configured model
      const config = agentDef.llmConfig;
      return { provider: config.provider, model: config.model };
    } catch {
      // Fallback to best available
      const best = getBestModelForTask('general_reasoning');
      return { provider: best.provider, model: best.model };
    }
  }

  getState(): OrchestrationState {
    return { ...this.state };
  }
}
