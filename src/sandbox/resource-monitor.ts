// ============================================================
// SANDBOX RESOURCE MONITOR — Track CPU, memory, disk, processes
// Provides real-time metrics and alerts for sandboxed workspaces
// ============================================================
import { sandboxManager, SandboxInfo, sandboxConfig } from './manager.js';
import { createLogger, generateId } from '../utils/index.js';
import { eventBus } from '../utils/index.js';

const logger = createLogger('ResourceMonitor');

// ============================================================
// TYPES
// ============================================================
export interface ResourceSnapshot {
  workspaceId: string;
  timestamp: number;
  cpu: { usagePercent: number; limit: number };
  memory: { usageMB: number; limitMB: number; percent: number };
  disk: { usageMB: number; limitMB: number; percent: number };
  processes: { count: number; limit: number };
  network: { rxBytes: number; txBytes: number };
  status: 'healthy' | 'warning' | 'critical';
  alerts: ResourceAlert[];
}

export interface ResourceAlert {
  id: string;
  type: 'cpu_high' | 'memory_high' | 'disk_high' | 'oom_risk' | 'process_limit' | 'idle';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface SystemOverview {
  totalContainers: number;
  runningContainers: number;
  stoppedContainers: number;
  failedContainers: number;
  totalCPUUsage: number;
  totalMemoryMB: number;
  totalDiskMB: number;
  averageCPU: number;
  averageMemory: number;
  portRange: { start: number; end: number; used: number };
}

// ============================================================
// ALERT THRESHOLDS
// ============================================================
const THRESHOLDS = {
  cpu: { warning: 75, critical: 90 },
  memory: { warning: 80, critical: 95 },
  disk: { warning: 80, critical: 95 },
  processPercent: { warning: 80, critical: 95 },
};

// ============================================================
// RESOURCE MONITOR CLASS
// ============================================================
class ResourceMonitor {
  private metrics: Map<string, ResourceSnapshot[]> = new Map(); // wsId -> last N snapshots
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private maxSnapshots: number = 60; // Keep 60 snapshots per container (60 min history at 1/min)

  // ============================================================
  // START / STOP MONITORING
  // ============================================================
  start(intervalMs: number = 60000): void {
    if (this.monitorInterval) return;
    this.monitorInterval = setInterval(() => this.collectAllMetrics(), intervalMs);
    logger.info(`Resource monitor started (interval: ${intervalMs / 1000}s)`);
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('Resource monitor stopped');
    }
  }

  // ============================================================
  // COLLECT METRICS — Fetch from all running containers
  // ============================================================
  async collectAllMetrics(): Promise<void> {
    if (!sandboxManager.isDockerAvailable()) return;

    const sandboxes = sandboxManager.listSandboxes().filter(s => s.status === 'running');

    for (const sandbox of sandboxes) {
      try {
        const snapshot = await this.collectMetrics(sandbox);
        this.storeSnapshot(sandbox.workspaceId, snapshot);

        // Emit alerts via event bus
        for (const alert of snapshot.alerts) {
          eventBus.emit('workspace:change', {
            type: 'resource_alert',
            workspaceId: sandbox.workspaceId,
            alert,
          });
        }
      } catch (err: any) {
        logger.warn(`Metrics collection failed for ${sandbox.workspaceId}: ${err.message}`);
      }
    }
  }

  private async collectMetrics(sandbox: SandboxInfo): Promise<ResourceSnapshot> {
    const metrics = await sandboxManager.getMetrics(sandbox.workspaceId);
    const alerts: ResourceAlert[] = [];
    const now = Date.now();

    // CPU alert
    if (metrics.cpuUsagePercent > THRESHOLDS.cpu.critical) {
      alerts.push({
        id: generateId('alert'),
        type: 'cpu_high',
        severity: 'critical',
        message: `CPU usage at ${metrics.cpuUsagePercent.toFixed(1)}% (limit: ${sandbox.resources.cpuLimit * 100}%)`,
        value: metrics.cpuUsagePercent,
        threshold: THRESHOLDS.cpu.critical,
        timestamp: now,
      });
    } else if (metrics.cpuUsagePercent > THRESHOLDS.cpu.warning) {
      alerts.push({
        id: generateId('alert'),
        type: 'cpu_high',
        severity: 'warning',
        message: `CPU usage at ${metrics.cpuUsagePercent.toFixed(1)}%`,
        value: metrics.cpuUsagePercent,
        threshold: THRESHOLDS.cpu.warning,
        timestamp: now,
      });
    }

    // Memory alert
    const memPercent = sandbox.resources.memoryLimitMB > 0
      ? (metrics.memoryUsageMB / sandbox.resources.memoryLimitMB) * 100
      : 0;
    if (memPercent > THRESHOLDS.memory.critical) {
      alerts.push({
        id: generateId('alert'),
        type: 'oom_risk',
        severity: 'critical',
        message: `Memory at ${metrics.memoryUsageMB}MB / ${sandbox.resources.memoryLimitMB}MB (${memPercent.toFixed(0)}%) — OOM risk`,
        value: memPercent,
        threshold: THRESHOLDS.memory.critical,
        timestamp: now,
      });
    } else if (memPercent > THRESHOLDS.memory.warning) {
      alerts.push({
        id: generateId('alert'),
        type: 'memory_high',
        severity: 'warning',
        message: `Memory at ${metrics.memoryUsageMB}MB / ${sandbox.resources.memoryLimitMB}MB (${memPercent.toFixed(0)}%)`,
        value: memPercent,
        threshold: THRESHOLDS.memory.warning,
        timestamp: now,
      });
    }

    // Disk alert
    const diskPercent = sandbox.resources.diskLimitMB > 0
      ? (metrics.diskUsageMB / sandbox.resources.diskLimitMB) * 100
      : 0;
    if (diskPercent > THRESHOLDS.disk.critical) {
      alerts.push({
        id: generateId('alert'),
        type: 'disk_high',
        severity: 'critical',
        message: `Disk at ${metrics.diskUsageMB}MB / ${sandbox.resources.diskLimitMB}MB (${diskPercent.toFixed(0)}%)`,
        value: diskPercent,
        threshold: THRESHOLDS.disk.critical,
        timestamp: now,
      });
    }

    // Process count alert
    const pidsPercent = sandbox.resources.pidsLimit > 0
      ? (metrics.processCount / sandbox.resources.pidsLimit) * 100
      : 0;
    if (pidsPercent > THRESHOLDS.processPercent.critical) {
      alerts.push({
        id: generateId('alert'),
        type: 'process_limit',
        severity: 'critical',
        message: `Process count ${metrics.processCount} / ${sandbox.resources.pidsLimit}`,
        value: pidsPercent,
        threshold: THRESHOLDS.processPercent.critical,
        timestamp: now,
      });
    }

    // Determine overall status
    let status: ResourceSnapshot['status'] = 'healthy';
    if (alerts.some(a => a.severity === 'critical')) status = 'critical';
    else if (alerts.some(a => a.severity === 'warning')) status = 'warning';

    return {
      workspaceId: sandbox.workspaceId,
      timestamp: now,
      cpu: {
        usagePercent: metrics.cpuUsagePercent,
        limit: sandbox.resources.cpuLimit * 100,
      },
      memory: {
        usageMB: metrics.memoryUsageMB,
        limitMB: sandbox.resources.memoryLimitMB,
        percent: memPercent,
      },
      disk: {
        usageMB: metrics.diskUsageMB,
        limitMB: sandbox.resources.diskLimitMB,
        percent: diskPercent,
      },
      processes: {
        count: metrics.processCount,
        limit: sandbox.resources.pidsLimit,
      },
      network: { rxBytes: 0, txBytes: 0 }, // TODO: parse from Docker stats
      status,
      alerts,
    };
  }

  // ============================================================
  // SNAPSHOT STORAGE — Rolling window of metrics
  // ============================================================
  private storeSnapshot(workspaceId: string, snapshot: ResourceSnapshot): void {
    let history = this.metrics.get(workspaceId);
    if (!history) {
      history = [];
      this.metrics.set(workspaceId, history);
    }
    history.push(snapshot);
    if (history.length > this.maxSnapshots) {
      history.splice(0, history.length - this.maxSnapshots);
    }
  }

  // ============================================================
  // QUERY — Get metrics for a workspace
  // ============================================================
  getLatestSnapshot(workspaceId: string): ResourceSnapshot | null {
    const history = this.metrics.get(workspaceId);
    return history ? history[history.length - 1] || null : null;
  }

  getHistory(workspaceId: string, minutes: number = 60): ResourceSnapshot[] {
    const history = this.metrics.get(workspaceId) || [];
    const cutoff = Date.now() - minutes * 60000;
    return history.filter(s => s.timestamp >= cutoff);
  }

  // ============================================================
  // SYSTEM OVERVIEW — Aggregate stats for all containers
  // ============================================================
  getSystemOverview(): SystemOverview {
    const sandboxes = sandboxManager.listSandboxes();
    const running = sandboxes.filter(s => s.status === 'running');
    const stopped = sandboxes.filter(s => s.status === 'stopped');
    const failed = sandboxes.filter(s => s.status === 'failed');

    let totalCPU = 0, totalMem = 0, totalDisk = 0;
    for (const s of running) {
      totalCPU += s.metrics.cpuUsagePercent;
      totalMem += s.metrics.memoryUsageMB;
      totalDisk += s.metrics.diskUsageMB;
    }

    const usedPorts = sandboxes.filter(s => s.allocatedPort && s.status !== 'destroyed').length;

    return {
      totalContainers: sandboxes.length,
      runningContainers: running.length,
      stoppedContainers: stopped.length,
      failedContainers: failed.length,
      totalCPUUsage: Math.round(totalCPU * 100) / 100,
      totalMemoryMB: totalMem,
      totalDiskMB: totalDisk,
      averageCPU: running.length > 0 ? Math.round((totalCPU / running.length) * 100) / 100 : 0,
      averageMemory: running.length > 0 ? Math.round(totalMem / running.length) : 0,
      portRange: {
        start: sandboxConfig.portRangeStart,
        end: sandboxConfig.portRangeEnd,
        used: usedPorts,
      },
    };
  }

  // ============================================================
  // GET ALL CURRENT SNAPSHOTS
  // ============================================================
  getAllLatestSnapshots(): ResourceSnapshot[] {
    const snapshots: ResourceSnapshot[] = [];
    for (const [wsId] of this.metrics) {
      const latest = this.getLatestSnapshot(wsId);
      if (latest) snapshots.push(latest);
    }
    return snapshots;
  }
}

// ============================================================
// SINGLETON
// ============================================================
export const resourceMonitor = new ResourceMonitor();
