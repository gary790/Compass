// ============================================================
// SANDBOX EXECUTOR — Proxy tool execution into Docker containers
// Wraps file, shell, and npm tools to run inside sandboxed environments
// Falls back to host execution when Docker is unavailable
// ============================================================
import { sandboxManager, ExecResult, sandboxConfig } from './manager.js';
import { createLogger } from '../utils/index.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('SandboxExecutor');

// ============================================================
// COMMAND SECURITY — Block dangerous operations in sandboxes
// ============================================================
const BLOCKED_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=/dev', ':(){', 'fork bomb',
  'chmod -R 777 /', 'chown -R', 'iptables', 'ip route', 'ifconfig',
  'mount', 'umount', 'insmod', 'rmmod', 'modprobe',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'docker', 'dockerd', 'containerd',  // No Docker-in-Docker
];

const BLOCKED_PATTERNS = [
  /curl\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)/i,  // curl | bash
  /wget\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)/i,  // wget | bash
  />\s*\/dev\/sd[a-z]/,                        // write to raw disk
  />\s*\/etc\/(passwd|shadow|sudoers)/,         // overwrite system files
  /sudo\s/,                                     // no sudo in sandboxes
  /nsenter/,                                    // no namespace escape
  /chroot/,                                     // no chroot escape
];

function validateCommand(command: string): { safe: boolean; reason?: string } {
  const cmd = command.toLowerCase().trim();

  for (const blocked of BLOCKED_COMMANDS) {
    if (cmd.includes(blocked.toLowerCase())) {
      return { safe: false, reason: `Blocked dangerous command: ${blocked}` };
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Blocked dangerous pattern: ${pattern.source}` };
    }
  }

  return { safe: true };
}

// ============================================================
// SANDBOXED SHELL EXECUTION
// ============================================================
export async function sandboxExec(
  workspaceId: string,
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
    userId?: string;
    toolName?: string;
  } = {}
): Promise<ExecResult> {
  // Validate command
  const validation = validateCommand(command);
  if (!validation.safe) {
    return {
      exitCode: 126,
      stdout: '',
      stderr: validation.reason || 'Command blocked',
      durationMs: 0,
    };
  }

  // If Docker is available, execute in container
  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running') {
      logger.info(`Sandboxed exec [${workspaceId}]: ${command.substring(0, 100)}`);
      return sandboxManager.exec(workspaceId, command, options);
    }
    // Auto-create sandbox if not exists
    try {
      await sandboxManager.create({ workspaceId });
      return sandboxManager.exec(workspaceId, command, options);
    } catch (err: any) {
      logger.warn(`Failed to create sandbox for ${workspaceId}: ${err.message} — falling back to host`);
    }
  }

  // Fallback: host execution (existing behavior)
  return sandboxManager.exec(workspaceId, command, options);
}

// ============================================================
// SANDBOXED FILE OPERATIONS — Read/write via container exec
// ============================================================

/** Read a file inside the sandbox container */
export async function sandboxReadFile(
  workspaceId: string,
  filePath: string,
  encoding: string = 'utf-8'
): Promise<{ content: string; size: number; modified: string }> {
  const safePath = sanitizePath(filePath);

  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running' && sandbox.containerId) {
      const fullPath = `${sandboxConfig.containerWorkspacePath}/${safePath}`;
      const result = await sandboxManager.exec(workspaceId, `cat "${fullPath}"`, { timeout: 10000 });

      if (result.exitCode !== 0) {
        throw new Error(`File read failed: ${result.stderr}`);
      }

      // Get file stats
      const statResult = await sandboxManager.exec(
        workspaceId,
        `stat -c '%s %Y' "${fullPath}" 2>/dev/null || echo "0 0"`,
        { timeout: 5000 }
      );
      const [size, mtime] = (statResult.stdout.trim().split(' ') || ['0', '0']);

      return {
        content: result.stdout,
        size: parseInt(size) || 0,
        modified: new Date(parseInt(mtime) * 1000).toISOString(),
      };
    }
  }

  // Fallback: direct filesystem access
  const hostPath = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId, safePath);
  const wsRoot = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId);
  if (!hostPath.startsWith(wsRoot)) throw new Error('Path traversal detected');

  const content = await fs.readFile(hostPath, { encoding: encoding as BufferEncoding });
  const stats = await fs.stat(hostPath);
  return {
    content,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

/** Write a file inside the sandbox container */
export async function sandboxWriteFile(
  workspaceId: string,
  filePath: string,
  content: string
): Promise<{ size: number; created: boolean }> {
  const safePath = sanitizePath(filePath);

  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running' && sandbox.containerId) {
      const fullPath = `${sandboxConfig.containerWorkspacePath}/${safePath}`;
      const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

      // Create parent directories
      await sandboxManager.exec(workspaceId, `mkdir -p "${dirPath}"`, { timeout: 5000 });

      // Write file using heredoc to handle special characters
      // Base64 encode to safely transmit content
      const b64 = Buffer.from(content, 'utf-8').toString('base64');
      const result = await sandboxManager.exec(
        workspaceId,
        `echo "${b64}" | base64 -d > "${fullPath}"`,
        { timeout: 30000 }
      );

      if (result.exitCode !== 0) {
        throw new Error(`File write failed: ${result.stderr}`);
      }

      // Get written file size
      const statResult = await sandboxManager.exec(
        workspaceId,
        `stat -c '%s' "${fullPath}" 2>/dev/null || echo "0"`,
        { timeout: 5000 }
      );

      return {
        size: parseInt(statResult.stdout.trim()) || content.length,
        created: true,
      };
    }
  }

  // Fallback: direct filesystem
  const hostPath = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId, safePath);
  const wsRoot = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId);
  if (!hostPath.startsWith(wsRoot)) throw new Error('Path traversal detected');

  await fs.mkdir(path.dirname(hostPath), { recursive: true });
  await fs.writeFile(hostPath, content, 'utf-8');
  const stats = await fs.stat(hostPath);
  return { size: stats.size, created: true };
}

/** List directory contents inside sandbox */
export async function sandboxListDir(
  workspaceId: string,
  dirPath: string = '.',
  recursive: boolean = false
): Promise<{ name: string; type: string; size: number; modified: string }[]> {
  const safePath = sanitizePath(dirPath);

  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running' && sandbox.containerId) {
      const fullPath = `${sandboxConfig.containerWorkspacePath}/${safePath}`;
      const cmd = recursive
        ? `find "${fullPath}" -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '.*' -printf '%y %s %T@ %P\\n' 2>/dev/null | head -200`
        : `ls -la --time-style=+%s "${fullPath}" 2>/dev/null | tail -n +2`;

      const result = await sandboxManager.exec(workspaceId, cmd, { timeout: 10000 });
      if (result.exitCode !== 0) return [];

      if (recursive) {
        return result.stdout.trim().split('\n').filter(Boolean).map(line => {
          const parts = line.split(' ');
          const type = parts[0] === 'd' ? 'directory' : 'file';
          const size = parseInt(parts[1]) || 0;
          const modified = new Date(parseFloat(parts[2]) * 1000).toISOString();
          const name = parts.slice(3).join(' ');
          return { name, type, size, modified };
        });
      }

      return result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split(/\s+/);
        const type = parts[0]?.startsWith('d') ? 'directory' : 'file';
        const size = parseInt(parts[4]) || 0;
        const modified = new Date(parseInt(parts[5]) * 1000).toISOString();
        const name = parts.slice(6).join(' ');
        return { name, type, size, modified };
      }).filter(item => item.name && !item.name.startsWith('.') && item.name !== 'node_modules');
    }
  }

  // Fallback: direct filesystem
  const hostPath = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId, safePath);
  const entries = await fs.readdir(hostPath, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    try {
      const stats = await fs.stat(path.join(hostPath, entry.name));
      items.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch {
      items.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size: 0, modified: '' });
    }
  }
  return items;
}

/** Delete a file/directory inside the sandbox */
export async function sandboxDeleteFile(
  workspaceId: string,
  filePath: string,
  recursive: boolean = false
): Promise<{ deleted: boolean }> {
  const safePath = sanitizePath(filePath);

  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running' && sandbox.containerId) {
      const fullPath = `${sandboxConfig.containerWorkspacePath}/${safePath}`;
      const cmd = recursive ? `rm -rf "${fullPath}"` : `rm -f "${fullPath}"`;
      const result = await sandboxManager.exec(workspaceId, cmd, { timeout: 10000 });
      return { deleted: result.exitCode === 0 };
    }
  }

  // Fallback
  const hostPath = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId, safePath);
  const wsRoot = path.resolve(sandboxConfig.hostWorkspaceRoot, workspaceId);
  if (!hostPath.startsWith(wsRoot)) throw new Error('Path traversal detected');
  await fs.rm(hostPath, { recursive });
  return { deleted: true };
}

/** Search file contents inside sandbox using grep */
export async function sandboxSearchFiles(
  workspaceId: string,
  pattern: string,
  options: { path?: string; include?: string; maxResults?: number } = {}
): Promise<{ file: string; line: number; content: string }[]> {
  const safePath = sanitizePath(options.path || '.');
  const maxResults = options.maxResults || 20;

  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running' && sandbox.containerId) {
      const searchPath = `${sandboxConfig.containerWorkspacePath}/${safePath}`;
      const includeFlag = options.include ? `--include='${options.include}'` : '';
      const cmd = `grep -rn ${includeFlag} --exclude-dir=node_modules --exclude-dir=.git -m ${maxResults} "${pattern}" "${searchPath}" 2>/dev/null | head -${maxResults}`;

      const result = await sandboxManager.exec(workspaceId, cmd, { timeout: 15000 });
      if (result.exitCode !== 0 && result.exitCode !== 1) return [];

      return result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (!match) return null;
        const file = match[1].replace(searchPath + '/', '');
        return { file, line: parseInt(match[2]), content: match[3].trim().substring(0, 200) };
      }).filter(Boolean) as any;
    }
  }

  // Fallback: return empty (host grep handled by existing tools)
  return [];
}

// ============================================================
// PATH SANITIZATION
// ============================================================
function sanitizePath(input: string): string {
  // Remove path traversal attempts
  return input
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    .replace(/^\/+/, '')
    .replace(/\0/g, '');
}

// ============================================================
// WORKSPACE ENVIRONMENT INFO
// ============================================================
export async function getSandboxEnvironment(workspaceId: string): Promise<{
  mode: 'docker' | 'host';
  containerId?: string;
  containerName?: string;
  ipAddress?: string;
  port?: number;
  nodeVersion?: string;
  npmVersion?: string;
}> {
  if (sandboxManager.isDockerAvailable()) {
    const sandbox = sandboxManager.getSandbox(workspaceId);
    if (sandbox && sandbox.status === 'running') {
      let nodeVersion = 'unknown';
      let npmVersion = 'unknown';
      try {
        const nv = await sandboxManager.exec(workspaceId, 'node --version', { timeout: 5000 });
        nodeVersion = nv.stdout.trim();
        const npmv = await sandboxManager.exec(workspaceId, 'npm --version', { timeout: 5000 });
        npmVersion = npmv.stdout.trim();
      } catch { /* not critical */ }

      return {
        mode: 'docker',
        containerId: sandbox.containerId?.substring(0, 12) || undefined,
        containerName: sandbox.containerName,
        ipAddress: sandbox.ipAddress || undefined,
        port: sandbox.allocatedPort || undefined,
        nodeVersion,
        npmVersion,
      };
    }
  }

  return { mode: 'host' };
}
