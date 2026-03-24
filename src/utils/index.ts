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
// COST TRACKER — Enhanced with detailed per-model breakdown
// ============================================================
interface ModelUsage {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  avgLatencyMs: number;
  lastUsedAt: number;
}

class CostTracker {
  private models: Map<string, ModelUsage> = new Map();
  private sessionTotal: number = 0;
  private sessionStartedAt: number = Date.now();
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalRequests: number = 0;

  addCost(model: string, cost: number, inputTokens: number = 0, outputTokens: number = 0, latencyMs: number = 0) {
    const existing = this.models.get(model) || { cost: 0, inputTokens: 0, outputTokens: 0, requestCount: 0, avgLatencyMs: 0, lastUsedAt: 0 };
    existing.cost += cost;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.requestCount++;
    existing.avgLatencyMs = (existing.avgLatencyMs * (existing.requestCount - 1) + latencyMs) / existing.requestCount;
    existing.lastUsedAt = Date.now();
    this.models.set(model, existing);

    this.sessionTotal += cost;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalRequests++;
  }

  getModelCost(model: string): number {
    return this.models.get(model)?.cost || 0;
  }

  getSessionTotal(): number {
    return this.sessionTotal;
  }

  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    this.models.forEach((usage, model) => {
      summary[model] = Math.round(usage.cost * 1000000) / 1000000;
    });
    summary['total'] = Math.round(this.sessionTotal * 1000000) / 1000000;
    return summary;
  }

  getDetailedSummary() {
    const models: Record<string, any> = {};
    this.models.forEach((usage, model) => {
      models[model] = {
        cost: Math.round(usage.cost * 1000000) / 1000000,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        requestCount: usage.requestCount,
        avgLatencyMs: Math.round(usage.avgLatencyMs),
        lastUsedAt: new Date(usage.lastUsedAt).toISOString(),
      };
    });
    return {
      sessionTotal: Math.round(this.sessionTotal * 1000000) / 1000000,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalRequests: this.totalRequests,
      sessionDurationMin: Math.round((Date.now() - this.sessionStartedAt) / 60000 * 10) / 10,
      sessionStartedAt: new Date(this.sessionStartedAt).toISOString(),
      models,
      total: Math.round(this.sessionTotal * 1000000) / 1000000,
    };
  }

  reset() {
    this.models.clear();
    this.sessionTotal = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalRequests = 0;
    this.sessionStartedAt = Date.now();
  }
}

export const costTracker = new CostTracker();

// ============================================================
// PERFORMANCE TRACKER — Request timing, tool execution metrics
// ============================================================
interface ToolMetric {
  name: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastCalledAt: number;
}

interface DeploymentRecord {
  id: string;
  platform: string;
  status: 'pending' | 'building' | 'deployed' | 'failed';
  url?: string;
  timestamp: number;
  duration?: number;
  error?: string;
}

class PerformanceTracker {
  private requestCount: number = 0;
  private totalRequestDurationMs: number = 0;
  private toolMetrics: Map<string, ToolMetric> = new Map();
  private recentLatencies: number[] = [];
  private deployments: DeploymentRecord[] = [];
  private maxLatencyHistory = 100;
  private startedAt: number = Date.now();

  recordRequest(durationMs: number) {
    this.requestCount++;
    this.totalRequestDurationMs += durationMs;
    this.recentLatencies.push(durationMs);
    if (this.recentLatencies.length > this.maxLatencyHistory) {
      this.recentLatencies.shift();
    }
  }

  recordToolExecution(name: string, durationMs: number, success: boolean) {
    const existing = this.toolMetrics.get(name) || { name, totalCalls: 0, successCount: 0, failureCount: 0, avgDurationMs: 0, maxDurationMs: 0, lastCalledAt: 0 };
    existing.totalCalls++;
    if (success) existing.successCount++;
    else existing.failureCount++;
    existing.avgDurationMs = (existing.avgDurationMs * (existing.totalCalls - 1) + durationMs) / existing.totalCalls;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
    existing.lastCalledAt = Date.now();
    this.toolMetrics.set(name, existing);
  }

  addDeployment(record: DeploymentRecord) {
    this.deployments.unshift(record);
    if (this.deployments.length > 50) this.deployments.pop();
  }

  getDeployments(): DeploymentRecord[] {
    return [...this.deployments];
  }

  getSnapshot() {
    const sorted = [...this.recentLatencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    const toolStats: Record<string, any> = {};
    this.toolMetrics.forEach((m, name) => {
      toolStats[name] = {
        totalCalls: m.totalCalls,
        successRate: m.totalCalls > 0 ? Math.round(m.successCount / m.totalCalls * 100) : 0,
        avgDurationMs: Math.round(m.avgDurationMs),
        maxDurationMs: Math.round(m.maxDurationMs),
      };
    });

    return {
      totalRequests: this.requestCount,
      avgLatencyMs: this.requestCount > 0 ? Math.round(this.totalRequestDurationMs / this.requestCount) : 0,
      p50LatencyMs: Math.round(p50),
      p95LatencyMs: Math.round(p95),
      p99LatencyMs: Math.round(p99),
      uptimeMinutes: Math.round((Date.now() - this.startedAt) / 60000),
      toolStats,
      totalToolCalls: Array.from(this.toolMetrics.values()).reduce((s, m) => s + m.totalCalls, 0),
      recentLatencies: this.recentLatencies.slice(-20).map(l => Math.round(l)),
    };
  }
}

export const performanceTracker = new PerformanceTracker();
