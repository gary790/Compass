import { Hono } from 'hono';
import { Orchestrator } from '../agent/orchestrator.js';
import { SSEWriter } from '../genui/engine.js';
import { createLogger, generateId } from '../utils/index.js';
import { LLMMessage } from '../types/index.js';
import { workspaceConfig } from '../config/index.js';
import path from 'path';

const logger = createLogger('ChatRoute');

const chatRoutes = new Hono();

// Store active conversations in memory (production: use Redis)
const conversations = new Map<string, { messages: LLMMessage[]; workspacePath: string }>();

// ============================================================
// POST /api/chat — Main chat endpoint with SSE streaming
// ============================================================
chatRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { message, conversationId, workspaceId } = body;

  if (!message) {
    return c.json({ success: false, error: { code: 'MISSING_MESSAGE', message: 'Message is required' } }, 400);
  }

  const convId = conversationId || generateId('conv');
  const workspacePath = workspaceId
    ? path.resolve(workspaceConfig.root, workspaceId)
    : path.resolve(workspaceConfig.root, 'default');

  // Get or create conversation
  if (!conversations.has(convId)) {
    conversations.set(convId, { messages: [], workspacePath });
  }
  const conv = conversations.get(convId)!;

  // Add user message to history
  conv.messages.push({ role: 'user', content: message });

  // Create SSE stream
  const sseWriter = new SSEWriter();
  const stream = sseWriter.createStream();

  // Create orchestrator
  const orchestrator = new Orchestrator(
    convId,
    'default-user',
    conv.workspacePath,
    (event) => sseWriter.write(event)
  );

  // Run orchestrator in background
  (async () => {
    try {
      const response = await orchestrator.execute(
        message,
        conv.messages.slice(0, -1) // Pass history without current message
      );

      // Add assistant response to history
      conv.messages.push({ role: 'assistant', content: response });

      // Keep conversation history manageable
      if (conv.messages.length > 50) {
        conv.messages = conv.messages.slice(-40);
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
chatRoutes.get('/conversations', (c) => {
  const convList = Array.from(conversations.entries()).map(([id, conv]) => ({
    id,
    messageCount: conv.messages.length,
    lastMessage: conv.messages[conv.messages.length - 1]?.content?.substring(0, 100),
    workspacePath: conv.workspacePath,
  }));
  return c.json({ success: true, data: convList });
});

// ============================================================
// GET /api/chat/:id/history — Get conversation history
// ============================================================
chatRoutes.get('/:id/history', (c) => {
  const id = c.req.param('id');
  const conv = conversations.get(id);
  if (!conv) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, 404);
  }
  return c.json({ success: true, data: { id, messages: conv.messages } });
});

// ============================================================
// DELETE /api/chat/:id — Delete conversation
// ============================================================
chatRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  conversations.delete(id);
  return c.json({ success: true, data: { deleted: true } });
});

export default chatRoutes;
