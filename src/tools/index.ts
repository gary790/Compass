// ============================================================
// TOOL LOADER — Imports and registers all tool modules
// ============================================================
import './file/index.js';
import './shell/index.js';
import './git/index.js';
import './github/index.js';
import './deploy/index.js';
import './web/index.js';
import './code/index.js';
import './db/index.js';
import './rag/index.js';

import { toolRegistry } from './registry.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('ToolLoader');

export function initializeTools() {
  const tools = toolRegistry.getAll();
  const categories = new Map<string, number>();

  for (const tool of tools) {
    const count = categories.get(tool.category) || 0;
    categories.set(tool.category, count + 1);
  }

  logger.info(`Loaded ${tools.length} tools across ${categories.size} categories:`);
  categories.forEach((count, category) => {
    logger.info(`  ${category}: ${count} tools`);
  });

  return tools;
}

export { toolRegistry };
