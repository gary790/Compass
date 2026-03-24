import { ToolDefinition, ToolExecutionRequest, ToolExecutionResult, ToolCategory } from '../types/index.js';
import { createLogger, generateId } from '../utils/index.js';
import { z } from 'zod';

const logger = createLogger('ToolRegistry');

// ============================================================
// TOOL REGISTRY — Central registry for all tools
// ============================================================
type ToolExecutor = (args: Record<string, any>, context: ToolContext) => Promise<any>;

interface ToolContext {
  workspacePath: string;
  userId: string;
  messageId: string;
}

interface RegisteredTool {
  definition: ToolDefinition;
  schema: z.ZodType<any>;
  execute: ToolExecutor;
}

class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(
    definition: ToolDefinition,
    schema: z.ZodType<any>,
    execute: ToolExecutor
  ) {
    this.tools.set(definition.name, { definition, schema, execute });
    logger.debug(`Registered tool: ${definition.name}`);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  getByCategory(category: ToolCategory): ToolDefinition[] {
    return this.getAll().filter(t => t.category === category);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getLLMToolDefinitions(toolNames?: string[]) {
    const names = toolNames || this.getToolNames();
    return names.map(name => {
      const tool = this.tools.get(name);
      if (!tool) return null;
      return {
        type: 'function' as const,
        function: {
          name: tool.definition.name,
          description: tool.definition.description,
          parameters: tool.definition.parameters,
        },
      };
    }).filter(Boolean);
  }

  async execute(req: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const tool = this.tools.get(req.toolName);
    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Unknown tool: ${req.toolName}`,
        durationMs: 0,
      };
    }

    // Validate input
    try {
      tool.schema.parse(req.arguments);
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: `Validation error: ${error.message}`,
        durationMs: 0,
      };
    }

    const start = Date.now();
    try {
      const context: ToolContext = {
        workspacePath: req.workspaceId, // workspace path
        userId: req.userId,
        messageId: req.messageId,
      };

      const output = await tool.execute(req.arguments, context);
      const durationMs = Date.now() - start;

      logger.info(`Tool ${req.toolName} executed in ${durationMs}ms`);

      return {
        success: true,
        output,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - start;
      logger.error(`Tool ${req.toolName} failed: ${error.message}`);

      return {
        success: false,
        output: null,
        error: error.message,
        durationMs,
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();

export { ToolContext };
