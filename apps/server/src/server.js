import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import authRoutes from './auth.js';
import syncRoutes from './sync.js';
import fileRoutes from './files.js';
import { pool } from './db.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET missing or too short (min 32 chars)');
  process.exit(1);
}

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024, trustProxy: true });

const origins = process.env.CORS_ORIGINS || '*';
await app.register(cors, {
  origin: origins === '*' ? true : origins.split(',').map((s) => s.trim()),
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
});
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(jwt, { secret: process.env.JWT_SECRET });

app.decorate('auth', async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

app.get('/health', async () => {
  await pool.query('select 1');
  return { ok: true };
});

app.get('/me', { preHandler: app.auth }, async (req) => ({
  id: req.user.sub,
  email: req.user.email,
}));

await app.register(authRoutes, { prefix: '/auth' });
await app.register(syncRoutes, { prefix: '/sync' });
await app.register(fileRoutes, { prefix: '/files' });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: 8080 });