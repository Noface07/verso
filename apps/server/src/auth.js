import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from './db.js';

const ACCESS_TTL = '1h';
const REFRESH_DAYS = 90;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

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

export default async function authRoutes(app) {
  async function issueTokens(userId, email, deviceName) {
    const accessToken = app.jwt.sign({ sub: userId, email }, { expiresIn: ACCESS_TTL });
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (token_hash, user_id, device_name, expires_at)
       values ($1, $2, $3, now() + make_interval(days => $4::int))`,
      [sha256(refreshToken), userId, deviceName ?? null, REFRESH_DAYS],
    );
    return { accessToken, refreshToken, user: { id: userId, email } };
  }

  app.post('/register', { schema: credSchema, config: strict }, async (req, reply) => {
    if (process.env.ALLOW_SIGNUP !== 'true') {
      return reply.code(403).send({ error: 'signups disabled' });
    }
    const { email, password, deviceName } = req.body;
    const hash = await bcrypt.hash(password, 12);
    try {
      const r = await pool.query(
        'insert into users (email, password_hash) values ($1, $2) returning id, email',
        [email, hash],
      );
      return reply.code(201).send(await issueTokens(r.rows[0].id, r.rows[0].email, deviceName));
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'email already registered' });
      throw e;
    }
  });

  app.post('/login', { schema: credSchema, config: strict }, async (req, reply) => {
    const { email, password, deviceName } = req.body;
    const r = await pool.query('select id, email, password_hash from users where email = $1', [email]);
    const user = r.rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return reply.code(401).send({ error: 'invalid email or password' });
    return issueTokens(user.id, user.email, deviceName);
  });

  app.post('/refresh', { config: strict }, async (req, reply) => {
    const token = req.body?.refreshToken;
    if (typeof token !== 'string') return reply.code(400).send({ error: 'refreshToken required' });
    // Rotation: the old token is consumed whether or not it's valid
    const r = await pool.query(
      `delete from refresh_tokens t using users u
       where t.token_hash = $1 and t.user_id = u.id and t.expires_at > now()
       returning u.id, u.email, t.device_name`,
      [sha256(token)],
    );
    if (!r.rowCount) return reply.code(401).send({ error: 'invalid refresh token' });
    const { id, email, device_name } = r.rows[0];
    return issueTokens(id, email, device_name);
  });

  app.post('/logout', async (req) => {
    const token = req.body?.refreshToken;
    if (typeof token === 'string') {
      await pool.query('delete from refresh_tokens where token_hash = $1', [sha256(token)]);
    }
    return { ok: true };
  });
}