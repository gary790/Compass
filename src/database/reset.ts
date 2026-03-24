import { getPool, closePool } from './client.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('Reset');

async function reset() {
  logger.warn('⚠️  Resetting database — all data will be deleted!');
  const pool = getPool();

  try {
    await pool.query(`
      DROP TABLE IF EXISTS tool_executions CASCADE;
      DROP TABLE IF EXISTS agent_sessions CASCADE;
      DROP TABLE IF EXISTS api_key_usage CASCADE;
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS conversations CASCADE;
      DROP TABLE IF EXISTS deployments CASCADE;
      DROP TABLE IF EXISTS chunks CASCADE;
      DROP TABLE IF EXISTS documents CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS _migrations CASCADE;
    `);
    logger.info('All tables dropped');
    logger.info('Run "npm run db:migrate" and "npm run db:seed" to rebuild');
  } catch (error: any) {
    logger.error(`Reset failed: ${error.message}`);
  } finally {
    await closePool();
  }
}

reset();
