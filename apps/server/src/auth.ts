import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from './db.js';
import type { AuthResponse } from '@folio/shared';
import './types.js';

const ACCESS_TTL = '1h';
const REFRESH_DAYS = 90;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const strict = process.env.NODE_ENV === 'test' ? {} : { rateLimit: { max: 10, timeWindow: '1 minute' } };

const credSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
      deviceName: { type: 'string', maxLength: 100 },
    },
  },
};

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  async function issueTokens(userId: string, email: string, deviceName?: string | null): Promise<AuthResponse> {
    const accessToken = app.jwt.sign({ sub: userId, email }, { expiresIn: ACCESS_TTL });
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      `insert into refresh_tokens (token_hash, user_id, device_name, expires_at)
       values ($1, $2, $3, $4)`,
      [sha256(refreshToken), userId, deviceName ?? null, expiresAt],
    );
    return { accessToken, refreshToken, user: { id: userId, email } };
  }

  app.post<{ Body: { email: string; password: string; deviceName?: string } }>(
    '/register',
    { schema: credSchema, config: strict },
    async (req, reply) => {
      if (process.env.ALLOW_SIGNUP === 'false') {
        return reply.code(403).send({ error: 'signups disabled' });
      }
      const { email, password, deviceName } = req.body;
      const hash = await bcrypt.hash(password, 12);
      try {
        const r = await pool.query<{ id: string; email: string }>(
          'insert into users (email, password_hash) values ($1, $2) returning id, email',
          [email, hash],
        );
        const user = r.rows[0];
        const tokens = await issueTokens(user.id, user.email, deviceName);
        return reply.code(201).send(tokens);
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          return reply.code(409).send({ error: 'email already registered' });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: { email: string; password: string; deviceName?: string } }>(
    '/login',
    { schema: credSchema, config: strict },
    async (req, reply) => {
      const { email, password, deviceName } = req.body;
      const r = await pool.query<{ id: string; email: string; password_hash: string }>(
        'select id, email, password_hash from users where email = $1',
        [email],
      );
      const user = r.rows[0];
      const ok = user && (await bcrypt.compare(password, user.password_hash));
      if (!ok) {
        return reply.code(401).send({ error: 'invalid email or password' });
      }
      return issueTokens(user.id, user.email, deviceName);
    },
  );

  app.post<{ Body: { refreshToken?: string } }>(
    '/refresh',
    { config: strict },
    async (req, reply) => {
      const token = req.body?.refreshToken;
      if (typeof token !== 'string') {
        return reply.code(400).send({ error: 'refreshToken required' });
      }
      // Rotation: old token is deleted atomically
      const r = await pool.query<{ user_id: string; device_name: string | null }>(
        `delete from refresh_tokens
         where token_hash = $1 and expires_at > now()
         returning user_id, device_name`,
        [sha256(token)],
      );
      if (!r.rowCount || !r.rows[0]) {
        return reply.code(401).send({ error: 'invalid refresh token' });
      }
      const { user_id, device_name } = r.rows[0];
      const userRes = await pool.query<{ id: string; email: string }>(
        'select id, email from users where id = $1',
        [user_id],
      );
      if (!userRes.rowCount || !userRes.rows[0]) {
        return reply.code(401).send({ error: 'user not found' });
      }
      const { id, email } = userRes.rows[0];
      return issueTokens(id, email, device_name);
    },
  );

  app.post<{ Body: { refreshToken?: string } }>(
    '/logout',
    async (req) => {
      const token = req.body?.refreshToken;
      if (typeof token === 'string') {
        await pool.query('delete from refresh_tokens where token_hash = $1', [sha256(token)]);
      }
      return { ok: true };
    },
  );
};

export default authRoutes;
