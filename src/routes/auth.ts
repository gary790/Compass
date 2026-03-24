import { Hono } from 'hono';
import { authConfig, serverConfig } from '../config/index.js';
import { query as dbQuery } from '../database/client.js';
import { createLogger, generateId, encrypt, decrypt } from '../utils/index.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const logger = createLogger('AuthRoute');
const authRoutes = new Hono();

function signToken(payload: object): string {
  return jwt.sign(payload, authConfig.jwtSecret, { expiresIn: authConfig.jwtExpiresIn } as any);
}

// ============================================================
// POST /api/auth/register — Create new user
// ============================================================
authRoutes.post('/register', async (c) => {
  try {
    const { email, name, password } = await c.req.json();

    if (!email || !name || !password) {
      return c.json({ success: false, error: { code: 'VALIDATION', message: 'email, name, and password are required' } }, 400);
    }

    if (password.length < 8) {
      return c.json({ success: false, error: { code: 'VALIDATION', message: 'Password must be at least 8 characters' } }, 400);
    }

    const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);

    const result = await dbQuery(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [email.toLowerCase(), name, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken({ userId: user.id, email: user.email });

    logger.info(`User registered: ${email}`);
    return c.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        token,
      },
    });
  } catch (error: any) {
    if (error.code === '23505') {
      return c.json({ success: false, error: { code: 'DUPLICATE', message: 'Email already registered' } }, 409);
    }
    logger.error(`Registration failed: ${error.message}`);
    return c.json({ success: false, error: { code: 'REGISTER_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// POST /api/auth/login — Authenticate user
// ============================================================
authRoutes.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ success: false, error: { code: 'VALIDATION', message: 'email and password are required' } }, 400);
    }

    const result = await dbQuery(
      'SELECT id, email, name, password_hash, settings FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }, 401);
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }, 401);
    }

    const token = signToken({ userId: user.id, email: user.email });

    logger.info(`User logged in: ${email}`);
    return c.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, settings: user.settings },
        token,
      },
    });
  } catch (error: any) {
    logger.error(`Login failed: ${error.message}`);
    return c.json({ success: false, error: { code: 'LOGIN_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// GET /api/auth/me — Get current user (requires auth)
// ============================================================
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, authConfig.jwtSecret) as any;

    const result = await dbQuery(
      'SELECT id, email, name, settings, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
    }

    return c.json({ success: true, data: { user: result.rows[0] } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' } }, 401);
  }
});

// ============================================================
// PUT /api/auth/settings — Update user settings
// ============================================================
authRoutes.put('/settings', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, authConfig.jwtSecret) as any;
    const settings = await c.req.json();

    await dbQuery('UPDATE users SET settings = $1 WHERE id = $2', [JSON.stringify(settings), decoded.userId]);

    return c.json({ success: true, data: { updated: true } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'UPDATE_ERROR', message: error.message } }, 500);
  }
});

// ============================================================
// PUT /api/auth/api-keys — Save encrypted API keys
// ============================================================
authRoutes.put('/api-keys', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, authConfig.jwtSecret) as any;
    const apiKeys = await c.req.json();

    // Encrypt each API key
    const encryptedKeys: Record<string, string> = {};
    for (const [provider, key] of Object.entries(apiKeys)) {
      if (key && typeof key === 'string') {
        encryptedKeys[provider] = encrypt(key, serverConfig.secretKey);
      }
    }

    await dbQuery('UPDATE users SET api_keys = $1 WHERE id = $2', [JSON.stringify(encryptedKeys), decoded.userId]);

    return c.json({ success: true, data: { saved: true, providers: Object.keys(encryptedKeys) } });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'SAVE_ERROR', message: error.message } }, 500);
  }
});

export default authRoutes;
