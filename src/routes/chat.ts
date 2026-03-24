import { Hono } from 'hono';
import { Orchestrator } from '../agent/orchestrator.js';
import { SSEWriter } from '../genui/engine.js';
import { createLogger, generateId } from '../utils/index.js';
import { workspaceConfig } from '../config/index.js';
import {
  createConversation,
  addMessage,
  getConversation,
  getMessages,
  listConversations,
  deleteConversation,
  updateTitle,
} from '../database/conversations.js';
import path from 'path';

const logger = createLogger('ChatRoute');

const chatRoutes = new Hono();

// ============================================================
// POST /api/chat — Main chat endpoint with SSE streaming
// ============================================================
chatRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { message, conversationId, workspaceId, userId } = body;

  if (!message) {
    return c.json({ success: false, error: { code: 'MISSING_MESSAGE', message: 'Message is required' } }, 400);
  }

  const workspacePath = workspaceId
    ? path.resolve(workspaceConfig.root, workspaceId)
    : path.resolve(workspaceConfig.root, 'default');

  // Get or create conversation (persisted to DB when available)
  let convId = conversationId;
  if (!convId) {
    convId = await createConversation({ workspacePath, userId });
  } else {
    // Ensure conversation exists in our store
    const existing = await getConversation(convId);
    if (!existing) {
      await createConversation({ id: convId, workspacePath, userId });
    }
  }

  // Add user message to persistent store
  await addMessage({
    conversationId: convId,
    role: 'user',
    content: message,
  });

  // Get message history for the orchestrator (without the just-added user message)
  const history = await getMessages(convId);
  const historyWithoutCurrent = history.slice(0, -1);

  // Create SSE stream
  const sseWriter = new SSEWriter();
  const stream = sseWriter.createStream();

  // Create orchestrator
  const orchestrator = new Orchestrator(
    convId,
    userId || 'default-user',
    workspacePath,
    (event) => sseWriter.write(event)
  );

  // Run orchestrator in background
  (async () => {
    try {
      const response = await orchestrator.execute(message, historyWithoutCurrent);

      // Get usage stats from orchestrator
      const usage = orchestrator.getUsage?.() || {};

      // Add assistant response to persistent store
      await addMessage({
        conversationId: convId,
        role: 'assistant',
        content: response,
        tokensUsed: usage.totalTokens || 0,
        costUSD: usage.totalCostUSD || 0,
        model: usage.modelsUsed?.[0] || undefined,
        durationMs: usage.durationMs || 0,
      });

      // Auto-generate a conversation title from the first user message
      const conv = await getConversation(convId);
      if (conv && conv.title === 'New Conversation' && message.length > 0) {
        const title = message.substring(0, 80) + (message.length > 80 ? '...' : '');
        await updateTitle(convId, title);
      }
    } catch (error: any) {
      logger.error(`Chat error: ${error.message}`);
      sseWriter.writeError(error.message, 'ORCHESTRATOR_ERROR');
      sseWriter.close();
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': convId,
    },
  });
});

// ============================================================
// GET /api/chat/conversations — List conversations
// ============================================================
chatRoutes.get('/conversations', async (c) => {
  const userId = c.req.query('userId');
  const convList = await listConversations(userId);
  return c.json({ success: true, data: convList });
});

// ============================================================
// GET /api/chat/:id/history — Get conversation history
// ============================================================
chatRoutes.get('/:id/history', async (c) => {
  const id = c.req.param('id');
  const conv = await getConversation(id);
  if (!conv) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, 404);
  }
  return c.json({
    success: true,
    data: {
      id: conv.id,
      title: conv.title,
      messages: conv.messages,
      totalTokens: conv.totalTokens,
      totalCostUSD: conv.totalCostUSD,
    },
  });
});

// ============================================================
// PATCH /api/chat/:id — Update conversation (e.g., title)
// ============================================================
chatRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  if (body.title) {
    await updateTitle(id, body.title);
  }
  return c.json({ success: true, data: { updated: true } });
});

// ============================================================
// DELETE /api/chat/:id — Delete conversation
// ============================================================
chatRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await deleteConversation(id);
  return c.json({ success: true, data: { deleted: true } });
});

export default chatRoutes;
