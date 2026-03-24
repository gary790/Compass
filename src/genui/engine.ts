import { GenUIEvent, GenUIComponentType } from '../types/index.js';
import { createLogger, generateId } from '../utils/index.js';

const logger = createLogger('GenUI');

// ============================================================
// SSE STREAM WRITER — Formats GenUI events as SSE
// ============================================================
export class SSEWriter {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private closed = false;

  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
  }

  write(event: GenUIEvent) {
    if (this.closed || !this.controller) return;
    try {
      const data = JSON.stringify(event);
      this.controller.enqueue(this.encoder.encode(`data: ${data}\n\n`));
    } catch (error: any) {
      logger.error(`SSE write error: ${error.message}`);
    }
  }

  writeThinking(content: string, agentType?: string) {
    this.write({
      type: 'thinking',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { content, agentType } as any,
    });
  }

  writeText(content: string, delta: boolean = true) {
    this.write({
      type: 'text',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { content, delta },
    });
  }

  writeComponent(name: GenUIComponentType, props: Record<string, any>) {
    this.write({
      type: 'component',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { name, props },
    });
  }

  writeToolCall(toolName: string, toolArgs: Record<string, any>, agentType: string) {
    this.write({
      type: 'tool_call',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { toolName, toolArgs, agentType } as any,
    });
  }

  writeToolResult(toolName: string, success: boolean, output: any, durationMs: number) {
    this.write({
      type: 'tool_result',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { toolName, success, output, durationMs },
    });
  }

  writeError(message: string, code?: string, recoverable: boolean = true) {
    this.write({
      type: 'error',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { message, code, recoverable },
    });
  }

  writeDone(summary: string, usage?: any) {
    this.write({
      type: 'done',
      id: generateId('evt'),
      timestamp: Date.now(),
      data: { summary, usage: usage || {} },
    });
    this.close();
  }

  close() {
    if (!this.closed && this.controller) {
      try {
        this.controller.close();
      } catch {}
      this.closed = true;
    }
  }
}

// ============================================================
// COMPONENT REGISTRY — Maps component types to rendering hints
// ============================================================
export const GENUI_COMPONENTS: Record<GenUIComponentType, {
  description: string;
  propsSchema: Record<string, string>;
}> = {
  chart: {
    description: 'Interactive chart (bar, line, pie, area)',
    propsSchema: { type: 'string', labels: 'string[]', datasets: 'object[]', title: 'string' },
  },
  table: {
    description: 'Sortable data table',
    propsSchema: { headers: 'string[]', rows: 'any[][]', title: 'string' },
  },
  file_tree: {
    description: 'Interactive file explorer tree',
    propsSchema: { files: 'FileNode[]', rootPath: 'string' },
  },
  code_block: {
    description: 'Syntax-highlighted code block',
    propsSchema: { code: 'string', language: 'string', filename: 'string', showLineNumbers: 'boolean' },
  },
  terminal: {
    description: 'Terminal output display',
    propsSchema: { output: 'string', command: 'string', exitCode: 'number' },
  },
  markdown: {
    description: 'Rich markdown content',
    propsSchema: { content: 'string' },
  },
  approval_gate: {
    description: 'Approval/reject buttons for human-in-the-loop',
    propsSchema: { id: 'string', message: 'string', actions: 'string[]', riskLevel: 'string' },
  },
  deploy_progress: {
    description: 'Deployment progress tracker',
    propsSchema: { steps: 'object[]', currentStep: 'number', projectName: 'string' },
  },
  diff_viewer: {
    description: 'Code diff viewer',
    propsSchema: { original: 'string', modified: 'string', filename: 'string' },
  },
  image_preview: {
    description: 'Image display with zoom',
    propsSchema: { url: 'string', alt: 'string', width: 'number' },
  },
  search_results: {
    description: 'Web search results display',
    propsSchema: { query: 'string', results: 'object[]' },
  },
  source_cards: {
    description: 'RAG source document cards',
    propsSchema: { sources: 'object[]', query: 'string' },
  },
  error_card: {
    description: 'Error display card',
    propsSchema: { message: 'string', code: 'string', suggestion: 'string' },
  },
  review_card: {
    description: 'Code review results card',
    propsSchema: { status: 'string', issues: 'object[]', score: 'number' },
  },
  status_badge: {
    description: 'Status indicator badge',
    propsSchema: { label: 'string', status: 'string', color: 'string' },
  },
  progress_bar: {
    description: 'Progress bar with label',
    propsSchema: { value: 'number', max: 'number', label: 'string' },
  },
  workspace_info: {
    description: 'Workspace information panel',
    propsSchema: { name: 'string', path: 'string', files: 'number', framework: 'string' },
  },
};
