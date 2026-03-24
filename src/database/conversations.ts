// ============================================================
// CONVERSATION PERSISTENCE — PostgreSQL with in-memory fallback
// ============================================================
import { query as dbQuery } from './client.js';
import { createLogger, generateId } from '../utils/index.js';
import { LLMMessage } from '../types/index.js';

const logger = createLogger('ConversationStore');

// ============================================================
// IN-MEMORY FALLBACK (used when PostgreSQL is unavailable)
// ============================================================
interface InMemoryConversation {
  id: string;
  title: string;
  messages: LLMMessage[];
  workspacePath: string;
  model?: string;
  totalTokens: number;
  totalCostUSD: number;
  createdAt: Date;
  updatedAt: Date;
}

const memoryStore = new Map<string, InMemoryConversation>();

// ============================================================
// CREATE CONVERSATION
// ============================================================
export async function createConversation(opts: {
  id?: string;
  userId?: string;
  workspacePath: string;
  title?: string;
  model?: string;
}): Promise<string> {
  const id = opts.id || generateId('conv');
  const title = opts.title || 'New Conversation';

  // Always store in memory for fast access during the session
  memoryStore.set(id, {
    id,
    title,
    messages: [],
    workspacePath: opts.workspacePath,
    model: opts.model,
    totalTokens: 0,
    totalCostUSD: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Persist to DB if available
  try {
    await dbQuery(
      `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, opts.userId || null, title, opts.model || null]
    );
    logger.debug(`Conversation ${id} persisted to DB`);
  } catch (error: any) {
    logger.debug(`Conversation ${id} stored in memory only (DB: ${error.message})`);
  }

  return id;
}

// ============================================================
// ADD MESSAGE
// ============================================================
export async function addMessage(opts: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: any[];
  toolCallId?: string;
  tokensUsed?: number;
  costUSD?: number;
  model?: string;
  durationMs?: number;
}): Promise<string> {
  const msgId = generateId('msg');

  // Add to in-memory store
  const conv = memoryStore.get(opts.conversationId);
  if (conv) {
    conv.messages.push({
      role: opts.role,
      content: opts.content,
      tool_calls: opts.toolCalls,
      tool_call_id: opts.toolCallId,
    });
    conv.totalTokens += opts.tokensUsed || 0;
    conv.totalCostUSD += opts.costUSD || 0;
    conv.updatedAt = new Date();

    // Keep in-memory history manageable (last 60 messages)
    if (conv.messages.length > 60) {
      conv.messages = conv.messages.slice(-50);
    }
  }

  // Persist to DB
  try {
    await dbQuery(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id,
                             tokens_used, cost_usd, model, duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        msgId,
        opts.conversationId,
        opts.role,
        opts.content,
        opts.toolCalls ? JSON.stringify(opts.toolCalls) : null,
        opts.toolCallId || null,
        opts.tokensUsed || 0,
        opts.costUSD || 0,
        opts.model || null,
        opts.durationMs || null,
      ]
    );

    // Update conversation stats
    await dbQuery(
      `UPDATE conversations
       SET message_count = message_count + 1,
           total_tokens = total_tokens + $2,
           total_cost_usd = total_cost_usd + $3,
           updated_at = NOW()
       WHERE id = $1`,
      [opts.conversationId, opts.tokensUsed || 0, opts.costUSD || 0]
    );
  } catch (error: any) {
    logger.debug(`Message ${msgId} stored in memory only (DB: ${error.message})`);
  }

  return msgId;
}

// ============================================================
// GET CONVERSATION with messages
// ============================================================
export async function getConversation(id: string): Promise<{
  id: string;
  title: string;
  messages: LLMMessage[];
  workspacePath: string;
  totalTokens: number;
  totalCostUSD: number;
} | null> {
  // Check in-memory first (fastest)
  const mem = memoryStore.get(id);
  if (mem) {
    return {
      id: mem.id,
      title: mem.title,
      messages: mem.messages,
      workspacePath: mem.workspacePath,
      totalTokens: mem.totalTokens,
      totalCostUSD: mem.totalCostUSD,
    };
  }

  // Fall back to DB
  try {
    const convResult = await dbQuery(
      `SELECT id, title, total_tokens, total_cost_usd FROM conversations WHERE id = $1`,
      [id]
    );
    if (convResult.rows.length === 0) return null;

    const conv = convResult.rows[0];

    const msgResult = await dbQuery(
      `SELECT role, content, tool_calls, tool_call_id
       FROM messages WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const messages: LLMMessage[] = msgResult.rows.map((row: any) => ({
      role: row.role,
      content: row.content,
      ...(row.tool_calls ? { tool_calls: row.tool_calls } : {}),
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
    }));

    // Cache in memory for fast subsequent access
    memoryStore.set(id, {
      id: conv.id,
      title: conv.title,
      messages,
      workspacePath: '', // Not stored in DB conversations table — caller supplies it
      model: undefined,
      totalTokens: parseInt(conv.total_tokens) || 0,
      totalCostUSD: parseFloat(conv.total_cost_usd) || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      id: conv.id,
      title: conv.title,
      messages,
      workspacePath: '',
      totalTokens: parseInt(conv.total_tokens) || 0,
      totalCostUSD: parseFloat(conv.total_cost_usd) || 0,
    };
  } catch {
    return null;
  }
}

// ============================================================
// GET MESSAGES (just the LLMMessage array for the orchestrator)
// ============================================================
export async function getMessages(conversationId: string): Promise<LLMMessage[]> {
  const conv = await getConversation(conversationId);
  return conv?.messages || [];
}

// ============================================================
// LIST CONVERSATIONS
// ============================================================
export async function listConversations(userId?: string): Promise<{
  id: string;
  title: string;
  messageCount: number;
  lastMessage?: string;
  totalTokens: number;
  totalCostUSD: number;
  updatedAt: string;
}[]> {
  // Try DB first for complete list
  try {
    const result = await dbQuery(
      `SELECT c.id, c.title, c.message_count, c.total_tokens, c.total_cost_usd, c.updated_at,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
       FROM conversations c
       ${userId ? 'WHERE c.user_id = $1' : ''}
       ORDER BY c.updated_at DESC
       LIMIT 50`,
      userId ? [userId] : []
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      messageCount: row.message_count,
      lastMessage: row.last_message?.substring(0, 100),
      totalTokens: parseInt(row.total_tokens) || 0,
      totalCostUSD: parseFloat(row.total_cost_usd) || 0,
      updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
    }));
  } catch {
    // Fall back to in-memory
    return Array.from(memoryStore.values()).map(conv => ({
      id: conv.id,
      title: conv.title,
      messageCount: conv.messages.length,
      lastMessage: conv.messages[conv.messages.length - 1]?.content?.substring(0, 100),
      totalTokens: conv.totalTokens,
      totalCostUSD: conv.totalCostUSD,
      updatedAt: conv.updatedAt.toISOString(),
    }));
  }
}

// ============================================================
// DELETE CONVERSATION
// ============================================================
export async function deleteConversation(id: string): Promise<void> {
  // Remove from memory
  memoryStore.delete(id);

  // Remove from DB (CASCADE deletes messages)
  try {
    await dbQuery('DELETE FROM conversations WHERE id = $1', [id]);
    logger.info(`Conversation ${id} deleted from DB`);
  } catch (error: any) {
    logger.debug(`Conversation ${id} deleted from memory only (DB: ${error.message})`);
  }
}

// ============================================================
// UPDATE CONVERSATION TITLE
// ============================================================
export async function updateTitle(id: string, title: string): Promise<void> {
  const mem = memoryStore.get(id);
  if (mem) mem.title = title;

  try {
    await dbQuery(
      'UPDATE conversations SET title = $2, updated_at = NOW() WHERE id = $1',
      [id, title]
    );
  } catch {}
}
