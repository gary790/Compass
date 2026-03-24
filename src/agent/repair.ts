// ============================================================
// REPAIR ENGINE — Autonomous build/test/lint error detection & fix
// Pattern: detect failure → extract error → diagnose → generate fix → re-verify
// ============================================================
import { createLogger } from '../utils/index.js';

const logger = createLogger('RepairEngine');

// ============================================================
// ERROR CLASSIFICATION
// ============================================================
export type ErrorCategory =
  | 'build_error'       // tsc, webpack, vite, esbuild compile failures
  | 'test_failure'      // jest, mocha, vitest test assertion failures
  | 'lint_error'        // eslint, prettier violations
  | 'runtime_error'     // node crash, unhandled rejection
  | 'dependency_error'  // missing module, version conflict
  | 'syntax_error'      // JSON parse, YAML, etc.
  | 'type_error'        // TypeScript type mismatch
  | 'unknown';

export interface DetectedError {
  category: ErrorCategory;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  rawOutput: string;
  suggestion?: string;
}

export interface RepairAttempt {
  errorHash: string;
  category: ErrorCategory;
  attempts: number;
  lastAttemptAt: number;
  fixed: boolean;
}

export interface RepairResult {
  detected: boolean;
  errors: DetectedError[];
  repairPrompt: string | null;
  shouldRepair: boolean;
}

// ============================================================
// ERROR DETECTION PATTERNS
// ============================================================
const ERROR_PATTERNS: {
  category: ErrorCategory;
  patterns: RegExp[];
  fileExtractor?: RegExp;
  lineExtractor?: RegExp;
}[] = [
  {
    category: 'type_error',
    patterns: [
      /TS\d{4,5}:/,
      /error TS\d+:/,
      /Type '.*' is not assignable/,
      /Property '.*' does not exist on type/,
      /Cannot find name '.*'/,
      /Cannot find module '.*'/,
      /Argument of type '.*' is not assignable/,
    ],
    fileExtractor: /(?:^|\s)([^\s]+\.tsx?)\((\d+),(\d+)\)/m,
    lineExtractor: /\((\d+),(\d+)\)/,
  },
  {
    category: 'build_error',
    patterns: [
      /Build failed/i,
      /Compilation failed/i,
      /ERROR in\s/,
      /Module not found/i,
      /SyntaxError:.*Unexpected token/,
      /Failed to compile/i,
      /vite.*error/i,
      /esbuild.*error/i,
      /webpack.*error/i,
    ],
    fileExtractor: /(?:^|\s)([^\s]+\.[jt]sx?):(\d+)/m,
  },
  {
    category: 'test_failure',
    patterns: [
      /FAIL\s+[\w/]/,
      /Test Suites:.*failed/i,
      /Tests:.*failed/i,
      /AssertionError/i,
      /expect\(.*\)\.to/,
      /✗|✕|×.*test/i,
      /FAILED.*test/i,
    ],
    fileExtractor: /(?:FAIL|●)\s+([^\s]+\.[jt]sx?)/m,
  },
  {
    category: 'lint_error',
    patterns: [
      /\d+ errors? and \d+ warnings?/,
      /eslint.*error/i,
      /prettier.*error/i,
      /\d+:\d+\s+error\s+/,
    ],
    fileExtractor: /([^\s]+\.[jt]sx?):(\d+):(\d+)/m,
  },
  {
    category: 'dependency_error',
    patterns: [
      /Cannot find module '.*'/,
      /Module not found: Error: Can't resolve/,
      /ERR! missing:.*required by/,
      /ERESOLVE unable to resolve dependency tree/,
      /peer dep missing/i,
      /npm ERR!/,
    ],
  },
  {
    category: 'runtime_error',
    patterns: [
      /Error: listen EADDRINUSE/,
      /UnhandledPromiseRejection/,
      /ReferenceError:/,
      /TypeError:/,
      /RangeError:/,
      /ENOENT: no such file or directory/,
      /EACCES: permission denied/,
    ],
    fileExtractor: /at\s+(?:\w+\s+)?\(?([^\s:]+\.(?:js|ts|mjs)):(\d+)/m,
  },
  {
    category: 'syntax_error',
    patterns: [
      /SyntaxError:/,
      /Unexpected token/,
      /Unexpected end of JSON input/,
      /Invalid or unexpected token/,
    ],
    fileExtractor: /([^\s]+\.[jt]sx?):(\d+)/m,
  },
];

// ============================================================
// TOOLS THAT CAN PRODUCE FAILURES WE SHOULD AUTO-REPAIR
// ============================================================
const REPAIRABLE_TOOLS = new Set([
  'shell_exec', 'npm_run', 'npm_install', 'code_test',
  'deploy_cloudflare', 'deploy_vercel', 'deploy_preview',
]);

// ============================================================
// REPAIR ENGINE CLASS
// ============================================================
export class RepairEngine {
  private attempts: Map<string, RepairAttempt> = new Map();
  private maxAttemptsPerError: number;
  private maxTotalRepairs: number;
  private totalRepairs: number = 0;

  constructor(maxAttemptsPerError = 3, maxTotalRepairs = 8) {
    this.maxAttemptsPerError = maxAttemptsPerError;
    this.maxTotalRepairs = maxTotalRepairs;
  }

  // ============================================================
  // SCAN TOOL RESULTS FOR ERRORS
  // ============================================================
  scanToolResults(toolResults: { toolName: string; success: boolean; output: any }[]): RepairResult {
    const errors: DetectedError[] = [];

    for (const result of toolResults) {
      // Only scan tools that can produce repairable errors
      if (!REPAIRABLE_TOOLS.has(result.toolName)) continue;

      // Extract text to scan from various output shapes
      const textToScan = this.extractTextFromOutput(result.output);
      if (!textToScan) continue;

      // Check if the tool itself reported failure
      const hasFailed = !result.success ||
        (result.output?.exitCode && result.output.exitCode !== 0);

      if (!hasFailed) continue;

      // Detect specific error categories
      const detected = this.detectErrors(textToScan);
      errors.push(...detected);
    }

    // If no specific errors detected but tools failed, create a generic error
    if (errors.length === 0) {
      const failedTools = toolResults.filter(r => !r.success || r.output?.exitCode);
      if (failedTools.length > 0) {
        // Don't repair generic failures — let the LLM handle them naturally
        return { detected: false, errors: [], repairPrompt: null, shouldRepair: false };
      }
    }

    // Check repair budget
    const shouldRepair = errors.length > 0 &&
      this.totalRepairs < this.maxTotalRepairs &&
      errors.some(e => this.canRetry(e));

    // Build repair prompt
    const repairPrompt = shouldRepair ? this.buildRepairPrompt(errors) : null;

    if (errors.length > 0) {
      logger.info(`Detected ${errors.length} error(s): ${errors.map(e => e.category).join(', ')}`);
    }

    return {
      detected: errors.length > 0,
      errors,
      repairPrompt,
      shouldRepair,
    };
  }

  // ============================================================
  // DETECT ERRORS in text output
  // ============================================================
  private detectErrors(text: string): DetectedError[] {
    const errors: DetectedError[] = [];
    const seenMessages = new Set<string>();

    for (const pattern of ERROR_PATTERNS) {
      for (const regex of pattern.patterns) {
        const match = regex.exec(text);
        if (match) {
          // Extract file + line info
          let file: string | undefined;
          let line: number | undefined;
          let column: number | undefined;

          if (pattern.fileExtractor) {
            const fileMatch = pattern.fileExtractor.exec(text);
            if (fileMatch) {
              file = fileMatch[1];
              line = fileMatch[2] ? parseInt(fileMatch[2]) : undefined;
              column = fileMatch[3] ? parseInt(fileMatch[3]) : undefined;
            }
          }

          // Extract a useful error message (first matching line + a few context lines)
          const errorMsg = this.extractErrorMessage(text, match.index);

          // Deduplicate
          const dedupeKey = `${pattern.category}:${file || ''}:${errorMsg.substring(0, 80)}`;
          if (seenMessages.has(dedupeKey)) continue;
          seenMessages.add(dedupeKey);

          errors.push({
            category: pattern.category,
            message: errorMsg,
            file,
            line,
            column,
            rawOutput: text.substring(
              Math.max(0, match.index - 200),
              Math.min(text.length, match.index + 500)
            ),
            suggestion: this.getSuggestion(pattern.category, errorMsg),
          });

          break; // one match per pattern category is enough
        }
      }
    }

    return errors;
  }

  // ============================================================
  // EXTRACT ERROR MESSAGE (the relevant portion of output)
  // ============================================================
  private extractErrorMessage(text: string, matchIndex: number): string {
    const lines = text.split('\n');
    let targetLine = 0;
    let charCount = 0;

    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1;
      if (charCount >= matchIndex) {
        targetLine = i;
        break;
      }
    }

    // Take the matching line + 2 lines of context
    const start = Math.max(0, targetLine);
    const end = Math.min(lines.length, targetLine + 4);
    return lines.slice(start, end).join('\n').trim();
  }

  // ============================================================
  // GENERATE SUGGESTIONS
  // ============================================================
  private getSuggestion(category: ErrorCategory, message: string): string {
    switch (category) {
      case 'type_error':
        return 'Fix the TypeScript type error by adjusting types, adding type guards, or updating the interface.';
      case 'build_error':
        return 'Fix the build error — check imports, syntax, and configuration.';
      case 'test_failure':
        return 'Fix the failing test — update the test expectation or fix the code being tested.';
      case 'lint_error':
        return 'Fix lint violations — follow the style guide rules.';
      case 'dependency_error':
        if (message.includes('Cannot find module'))
          return 'Install the missing dependency with npm_install.';
        return 'Resolve the dependency conflict — check package versions.';
      case 'runtime_error':
        if (message.includes('EADDRINUSE'))
          return 'Port is in use — kill the existing process or use a different port.';
        return 'Fix the runtime error — check the stack trace for the source.';
      case 'syntax_error':
        return 'Fix the syntax error — check for missing brackets, commas, or quotes.';
      default:
        return 'Investigate and fix the error.';
    }
  }

  // ============================================================
  // BUILD REPAIR PROMPT — Structured instructions for the LLM
  // ============================================================
  private buildRepairPrompt(errors: DetectedError[]): string {
    const errorDescriptions = errors.map((e, i) => {
      const loc = e.file ? `\n   File: ${e.file}${e.line ? `:${e.line}` : ''}` : '';
      return `${i + 1}. [${e.category.toUpperCase()}]${loc}
   Error: ${e.message}
   ${e.suggestion ? `Suggestion: ${e.suggestion}` : ''}`;
    }).join('\n\n');

    return `
AUTOMATED REPAIR — The following error(s) were detected after the previous action:

${errorDescriptions}

REPAIR INSTRUCTIONS:
1. Read the file(s) mentioned in the error(s) to understand the context.
2. Apply the minimal fix needed to resolve each error.
3. After fixing, re-run the build/test command to verify the fix.
4. If the same error persists after 3 attempts, explain the issue to the user and ask for guidance.

Do NOT add unrelated changes. Focus only on the reported errors.`.trim();
  }

  // ============================================================
  // RETRY TRACKING
  // ============================================================
  private canRetry(error: DetectedError): boolean {
    const hash = this.hashError(error);
    const attempt = this.attempts.get(hash);
    if (!attempt) return true;
    return attempt.attempts < this.maxAttemptsPerError && !attempt.fixed;
  }

  recordAttempt(errors: DetectedError[]): void {
    this.totalRepairs++;
    for (const error of errors) {
      const hash = this.hashError(error);
      const existing = this.attempts.get(hash);
      if (existing) {
        existing.attempts++;
        existing.lastAttemptAt = Date.now();
      } else {
        this.attempts.set(hash, {
          errorHash: hash,
          category: error.category,
          attempts: 1,
          lastAttemptAt: Date.now(),
          fixed: false,
        });
      }
    }
  }

  markFixed(errors: DetectedError[]): void {
    for (const error of errors) {
      const hash = this.hashError(error);
      const attempt = this.attempts.get(hash);
      if (attempt) attempt.fixed = true;
    }
  }

  private hashError(error: DetectedError): string {
    // Hash on category + file + first 60 chars of message for deduplication
    return `${error.category}:${error.file || ''}:${error.message.substring(0, 60)}`;
  }

  // ============================================================
  // EXTRACT TEXT FROM TOOL OUTPUT (handles various shapes)
  // ============================================================
  private extractTextFromOutput(output: any): string | null {
    if (!output) return null;
    if (typeof output === 'string') return output;

    const parts: string[] = [];
    if (output.stdout) parts.push(output.stdout);
    if (output.stderr) parts.push(output.stderr);
    if (output.error) parts.push(typeof output.error === 'string' ? output.error : JSON.stringify(output.error));
    if (output.output) parts.push(typeof output.output === 'string' ? output.output : JSON.stringify(output.output));
    if (output.message) parts.push(output.message);

    return parts.length > 0 ? parts.join('\n') : null;
  }

  // ============================================================
  // STATS
  // ============================================================
  getStats() {
    return {
      totalRepairs: this.totalRepairs,
      maxTotalRepairs: this.maxTotalRepairs,
      trackedErrors: this.attempts.size,
      fixedErrors: Array.from(this.attempts.values()).filter(a => a.fixed).length,
      attempts: Array.from(this.attempts.values()),
    };
  }
}
