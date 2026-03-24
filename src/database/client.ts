import pg from 'pg';
import { dbConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('Database');
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: dbConfig.url,
      max: dbConfig.maxConnections,
      idleTimeoutMillis: dbConfig.idleTimeout,
    });

    pool.on('connect', () => logger.debug('New database connection established'));
    pool.on('error', (err) => logger.error('Unexpected pool error', { error: err.message }));
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms`, { rows: result.rowCount });
    return result;
  } catch (error: any) {
    logger.error(`Query failed: ${error.message}`, { text: text.substring(0, 200) });
    throw error;
  }
}

export async function getClient(): Promise<pg.PoolClient> {
  return getPool().connect();
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
  } catch (error: any) {
    logger.warn(`Database connection failed: ${error.message}`);
    return false;
  }
}
