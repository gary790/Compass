import pg from 'pg';
import { dbConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('Database');
const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbDisabled = false;

export function getPool(): pg.Pool | null {
  if (dbDisabled) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: dbConfig.url,
      max: dbConfig.maxConnections,
      idleTimeoutMillis: dbConfig.idleTimeout,
    });

    pool.on('connect', () => logger.debug('New database connection established'));
    pool.on('error', () => {}); // silenced — testConnection handles logging
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  if (!p) throw new Error('Database not available');
  const start = Date.now();
  try {
    const result = await p.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms`, { rows: result.rowCount });
    return result;
  } catch (error: any) {
    logger.error(`Query failed: ${error.message}`, { text: text.substring(0, 200) });
    throw error;
  }
}

export async function getClient(): Promise<pg.PoolClient> {
  const p = getPool();
  if (!p) throw new Error('Database not available');
  return p.connect();
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() as time');
    logger.info(`Database connected: ${result.rows[0].time}`);
    return true;
  } catch {
    logger.warn('PostgreSQL not available — running without database');
    dbDisabled = true;
    return false;
  }
}
