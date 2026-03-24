import { EventEmitter } from 'events';
import path from 'path';
import { PlatformEvent, PlatformEventType } from '../types/index.js';

// ============================================================
// GLOBAL EVENT BUS — Used for cross-module communication
// ============================================================
class PlatformEventBus extends EventEmitter {
  emit(type: PlatformEventType, data: any): boolean {
    const event: PlatformEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    return super.emit(type, event);
  }

  on(type: PlatformEventType, listener: (event: PlatformEvent) => void): this {
    return super.on(type, listener);
  }
}

export const eventBus = new PlatformEventBus();
eventBus.setMaxListeners(100);

// ============================================================
// LOGGER — Structured logging
// ============================================================
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';

class Logger {
  private context: string;
  private minLevel: LogLevel;

  constructor(context: string) {
    this.context = context;
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  private levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.minLevel];
  }

  private format(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const prefix = `${color}[${timestamp}] [${level.toUpperCase()}] [${this.context}]${RESET}`;
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data, null, 0)}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string, data?: any) {
    if (this.shouldLog('debug')) console.log(this.format('debug', message, data));
  }

  info(message: string, data?: any) {
    if (this.shouldLog('info')) console.log(this.format('info', message, data));
  }

  warn(message: string, data?: any) {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, data));
  }

  error(message: string, data?: any) {
    if (this.shouldLog('error')) console.error(this.format('error', message, data));
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

// ============================================================
// ID GENERATION
// ============================================================
let counter = 0;
export function generateId(prefix: string = ''): string {
  counter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}${counter}` : `${timestamp}${random}${counter}`;
}

// ============================================================
// ASYNC UTILITIES
// ============================================================
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  backoff: number = 2
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries) {
        await sleep(delayMs * Math.pow(backoff, i));
      }
    }
  }
  throw lastError;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(error => { clearTimeout(timer); reject(error); });
  });
}

// ============================================================
// TEXT UTILITIES
// ============================================================
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

export function sanitizePath(input: string): string {
  // Prevent path traversal
  return input.replace(/\.\.\//g, '').replace(/\.\.\\/g, '').replace(/^\/+/, '');
}

export function isValidWorkspacePath(basePath: string, targetPath: string): boolean {
  const resolved = path.resolve(basePath, targetPath);
  return resolved.startsWith(path.resolve(basePath));
}

// ============================================================
// ENCRYPTION UTILITIES (for API keys at rest)
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encrypt(text: string, secretKey: string): string {
  const key = scryptSync(secretKey, 'agentic-rag-salt', 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string, secretKey: string): string {
  const key = scryptSync(secretKey, 'agentic-rag-salt', 32);
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// COST TRACKER
// ============================================================
class CostTracker {
  private costs: Map<string, number> = new Map();
  private sessionTotal: number = 0;

  addCost(model: string, cost: number) {
    const current = this.costs.get(model) || 0;
    this.costs.set(model, current + cost);
    this.sessionTotal += cost;
  }

  getModelCost(model: string): number {
    return this.costs.get(model) || 0;
  }

  getSessionTotal(): number {
    return this.sessionTotal;
  }

  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    this.costs.forEach((cost, model) => {
      summary[model] = Math.round(cost * 1000000) / 1000000;
    });
    summary['total'] = Math.round(this.sessionTotal * 1000000) / 1000000;
    return summary;
  }

  reset() {
    this.costs.clear();
    this.sessionTotal = 0;
  }
}

export const costTracker = new CostTracker();
