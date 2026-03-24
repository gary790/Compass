import { getPool, closePool } from './client.js';
import { createLogger } from '../utils/index.js';
import bcrypt from 'bcryptjs';

const logger = createLogger('Seed');

async function seed() {
  logger.info('Seeding database...');
  const pool = getPool();

  if (!pool) {
    logger.error('Database not available — cannot seed.');
    logger.error('Ensure DATABASE_URL is set and PostgreSQL is running.');
    process.exit(1);
  }

  try {
    // Create default admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO users (email, name, password_hash, settings)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [
      'admin@agentic-rag.local',
      'Admin',
      passwordHash,
      JSON.stringify({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o',
        theme: 'dark',
        approvalMode: 'dangerous',
        maxBudgetPerDay: 50,
      }),
    ]);

    logger.info('Default admin user created: admin@agentic-rag.local / admin123');

    // Create a sample document for RAG testing
    await pool.query(`
      INSERT INTO documents (id, title, source_type, content, chunk_count, metadata, tsvector_content)
      VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('english', $4))
      ON CONFLICT (id) DO NOTHING
    `, [
      'doc_welcome',
      'Agentic RAG Platform Guide',
      'markdown',
      `# Agentic RAG Platform Guide

## Overview
The Agentic RAG Platform is a self-hosted AI development platform featuring:
- Mixture-of-Experts (MoE) LLM routing across 6 providers
- Hybrid search (BM25 + Vector + Reciprocal Rank Fusion)
- 30+ tools for file operations, shell, git, GitHub, deployment, and more
- GenUI streaming dashboard with real-time agent visualization
- Workspace management with file explorer
- One-click deployment to Cloudflare Pages and Vercel

## Quick Start
1. Clone the repository
2. Copy .env.example to .env and add your API keys
3. Run docker-compose up -d
4. Open http://localhost:3000

## Tools
The platform includes tools for:
- File operations: read, write, edit, delete, search
- Shell execution: run commands, npm scripts
- Git: init, status, commit, push, branch, diff
- GitHub: create repo, read/edit files, create PRs, list issues
- Deployment: Cloudflare Pages, Vercel
- Web: search, scrape, fetch
- Code: analyze, generate, test, refactor, explain
- Database: query, execute, schema
- RAG: ingest, query, list, delete`,
      1,
      '{"category": "documentation"}',
    ]);

    logger.info('Sample RAG document created');
    logger.info('Database seeded successfully');
  } catch (error: any) {
    logger.error(`Seed failed: ${error.message}`);
  } finally {
    await closePool();
  }
}

seed();
