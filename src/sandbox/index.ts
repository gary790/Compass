// ============================================================
// SANDBOX MODULE — Docker container isolation per workspace
// ============================================================
export { sandboxManager, sandboxConfig } from './manager.js';
export type { SandboxInfo, SandboxStatus, SandboxCreateOptions, ExecResult } from './manager.js';
export {
  sandboxExec,
  sandboxReadFile,
  sandboxWriteFile,
  sandboxListDir,
  sandboxDeleteFile,
  sandboxSearchFiles,
  getSandboxEnvironment,
} from './executor.js';
export { resourceMonitor } from './resource-monitor.js';
export type { ResourceSnapshot, ResourceAlert, SystemOverview } from './resource-monitor.js';
