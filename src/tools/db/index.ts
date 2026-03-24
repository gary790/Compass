import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { query as dbQuery } from '../../database/client.js';

// ============================================================
// DB QUERY (read-only)
// ============================================================
toolRegistry.register(
  {
    name: 'db_query',
    category: 'database',
    description: 'Execute a read-only SQL query against the PostgreSQL database. Only SELECT and EXPLAIN statements are allowed.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query (SELECT only)' },
        params: { type: 'array', items: {}, description: 'Query parameters (for parameterized queries)' },
      },
      required: ['sql'],
    },
    riskLevel: 'safe',
  },
  z.object({ sql: z.string(), params: z.array(z.any()).optional() }),
  async (args) => {
    // Safety check: only allow read operations
    const normalized = args.sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('EXPLAIN') && !normalized.startsWith('WITH')) {
      throw new Error('Only SELECT, EXPLAIN, and WITH (CTE) queries are allowed. Use db_execute for write operations.');
    }

    const result = await dbQuery(args.sql, args.params);
    return {
      rows: result.rows.slice(0, 100), // Limit to 100 rows
      rowCount: result.rowCount,
      fields: result.fields?.map(f => ({ name: f.name, dataType: f.dataTypeID })),
    };
  }
);

// ============================================================
// DB EXECUTE (write operations)
// ============================================================
toolRegistry.register(
  {
    name: 'db_execute',
    category: 'database',
    description: 'Execute a write SQL operation (INSERT, UPDATE, DELETE, CREATE TABLE). Use with caution.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL statement' },
        params: { type: 'array', items: {}, description: 'Query parameters' },
      },
      required: ['sql'],
    },
    requiresApproval: true,
    riskLevel: 'dangerous',
  },
  z.object({ sql: z.string(), params: z.array(z.any()).optional() }),
  async (args) => {
    // Block extremely dangerous operations
    const normalized = args.sql.trim().toUpperCase();
    if (normalized.includes('DROP DATABASE') || normalized.includes('TRUNCATE')) {
      throw new Error('DROP DATABASE and TRUNCATE are blocked for safety.');
    }

    const result = await dbQuery(args.sql, args.params);
    return { rowCount: result.rowCount, command: result.command };
  }
);

// ============================================================
// DB SCHEMA
// ============================================================
toolRegistry.register(
  {
    name: 'db_schema',
    category: 'database',
    description: 'Get database schema information — tables, columns, types, and indexes.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Specific table name (optional, shows all tables if omitted)' },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ table: z.string().optional() }),
  async (args) => {
    if (args.table) {
      // Get columns for specific table
      const columns = await dbQuery(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [args.table]
      );

      // Get indexes
      const indexes = await dbQuery(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE tablename = $1`,
        [args.table]
      );

      return {
        table: args.table,
        columns: columns.rows,
        indexes: indexes.rows,
      };
    }

    // List all tables
    const tables = await dbQuery(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );

    return {
      tables: tables.rows.map((r: any) => r.table_name),
      count: tables.rowCount,
    };
  }
);

export default toolRegistry;
