import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { createLogger, generateId } from '../utils/index.js';
import { eventBus } from '../utils/index.js';
import type { WSMessage, WSMessageType, GenUIEvent } from '../types/index.js';

const logger = createLogger('WebSocket');

// ============================================================
// CLIENT CONNECTION MANAGER
// ============================================================
interface WSClient {
  id: string;
  ws: any;
  userId: string;
  conversationId?: string;
  connectedAt: number;
}

const clients = new Map<string, WSClient>();
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// ============================================================
// WebSocket SETUP — must be called from the main app
// ============================================================
export function setupWebSocket(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any });

  app.get('/ws', upgradeWebSocket((c) => {
    const clientId = generateId('ws');

    return {
      onOpen(evt: any, ws: any) {
        const client: WSClient = {
          id: clientId,
          ws,
          userId: 'default-user',
          connectedAt: Date.now(),
        };
        clients.set(clientId, client);
        logger.info(`Client connected: ${clientId} (total: ${clients.size})`);

        // Send welcome message
        sendToClient(client, {
          type: 'system_event',
          id: generateId('msg'),
          payload: {
            event: 'connected',
            clientId,
            timestamp: Date.now(),
          },
        });
      },

      onMessage(event: any, ws: any) {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          handleClientMessage(clientId, data);
        } catch (error: any) {
          logger.error(`Invalid WS message from ${clientId}: ${error.message}`);
        }
      },

      onClose() {
        clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId} (total: ${clients.size})`);
      },

      onError(error: any) {
        logger.error(`WS error for ${clientId}: ${error.message}`);
        clients.delete(clientId);
      },
    };
  }));

  // Forward platform events to all subscribed WS clients
  eventBus.on('agent:step', (event: any) => {
    broadcastToAll({
      type: 'agent_event',
      id: generateId('msg'),
      payload: event,
    });
  });

  return { injectWebSocket };
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================
function handleClientMessage(clientId: string, msg: WSMessage) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'ping':
      sendToClient(client, { type: 'pong', id: msg.id, payload: { timestamp: Date.now() } });
      break;

    case 'approval_response':
      handleApprovalResponse(msg.payload);
      break;

    case 'chat_message':
      // Bind client to a conversation
      if (msg.payload?.conversationId) {
        client.conversationId = msg.payload.conversationId;
      }
      break;

    case 'workspace_sync':
      // Client is requesting workspace sync — could relay file watcher events
      logger.info(`Workspace sync requested by ${clientId}`);
      break;

    default:
      logger.debug(`Unhandled WS message type: ${msg.type}`);
  }
}

function handleApprovalResponse(payload: { approvalId: string; approved: boolean; editedArgs?: Record<string, any> }) {
  const pending = pendingApprovals.get(payload.approvalId);
  if (!pending) {
    logger.warn(`No pending approval found: ${payload.approvalId}`);
    return;
  }

  clearTimeout(pending.timeout);
  pending.resolve(payload.approved);
  pendingApprovals.delete(payload.approvalId);
  logger.info(`Approval ${payload.approvalId}: ${payload.approved ? 'APPROVED' : 'REJECTED'}`);
}

// ============================================================
// APPROVAL SYSTEM — Request approval from connected clients
// ============================================================
export function requestApproval(approvalId: string, timeoutMs: number = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      logger.warn(`Approval ${approvalId} timed out — auto-approving`);
      resolve(true); // Auto-approve on timeout
    }, timeoutMs);

    pendingApprovals.set(approvalId, { resolve, timeout });
  });
}

// ============================================================
// BROADCAST HELPERS
// ============================================================
function sendToClient(client: WSClient, msg: WSMessage) {
  try {
    client.ws.send(JSON.stringify(msg));
  } catch (error: any) {
    logger.error(`Failed to send to ${client.id}: ${error.message}`);
    clients.delete(client.id);
  }
}

function broadcastToAll(msg: WSMessage) {
  for (const client of clients.values()) {
    sendToClient(client, msg);
  }
}

export function broadcastToConversation(conversationId: string, msg: WSMessage) {
  for (const client of clients.values()) {
    if (client.conversationId === conversationId) {
      sendToClient(client, msg);
    }
  }
}

export function getConnectedClients(): { id: string; userId: string; conversationId?: string; connectedAt: number }[] {
  return Array.from(clients.values()).map(c => ({
    id: c.id,
    userId: c.userId,
    conversationId: c.conversationId,
    connectedAt: c.connectedAt,
  }));
}

export function getPendingApprovalCount(): number {
  return pendingApprovals.size;
}
