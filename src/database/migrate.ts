import { getPool, closePool } from './client.js';
import { createLogger } from '../utils/index.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('Migrate');

async function migrate() {
  logger.info('Running database migrations...');
  const pool = getPool();

  try {
    // Read migration files
    const migrationsDir = path.resolve('./migrations');
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Check which migrations have been run
    const { rows: executed } = await pool.query('SELECT filename FROM _migrations');
    const executedFiles = new Set(executed.map(r => r.filename));

    for (const file of sqlFiles) {
      if (executedFiles.has(file)) {
        logger.info(`Skipping ${file} (already executed)`);
        continue;
      }

      logger.info(`Executing ${file}...`);
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');

      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        logger.info(`Migration ${file} completed`);
      } catch (error: any) {
        await pool.query('ROLLBACK');
        logger.error(`Migration ${file} failed: ${error.message}`);
        throw error;
      }
    }

    logger.info('All migrations complete');
  } catch (error: any) {
    logger.error(`Migration failed: ${error.message}`);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();
