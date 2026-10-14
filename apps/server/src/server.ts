import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './auth.js';
import { syncRoutes } from './sync.js';
import { fileRoutes } from './files.js';
import { proxyRoutes } from './proxy.js';
import { accountRoutes } from './account.js';
import { pool, describeConnection } from './db.js';
import { getNotifyHub } from './notify.js';
import { runMigrations } from './migrate.js';
import { userExists, wasDeleted } from './integrity.js';
import { ACCOUNT_DELETED, STORAGE_OFFLINE } from '@verso/shared';
import { storage, StorageOfflineError } from './storage.js';
import './types.js';

export async function createServer(): Promise<FastifyInstance> {
  const jwtSecret = process.env.JWT_SECRET || 'dev_secret_must_be_at_least_32_characters_long_for_hs256';

  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: true,
  });

  const origins = process.env.CORS_ORIGINS || '*';
  await app.register(cors, {
    origin: origins === '*' ? true : origins.split(',').map((s) => s.trim()),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  if (process.env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
    });
  }

  await app.register(jwt, {
    secret: jwtSecret,
  });

  app.decorate('auth', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // Access tokens outlive account deletion by up to their TTL. Reject them, and
    // tell the device the account is gone so it wipes its copy rather than
    // pushing it back (which also failed on the users foreign key).
    if (!(await userExists(req.user.sub))) {
      const deleted = await wasDeleted(req.user.sub);
      return reply
        .code(401)
        .send({ error: deleted ? 'account deleted' : 'unauthorized', code: deleted ? ACCOUNT_DELETED : undefined });
    }
  });

  // Storage offline (PC with s3rver off / tunnel closed): a clear 503 instead of a
  // generic 500, or "not found" for files that do exist.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof StorageOfflineError) {
      return reply.code(503).send({ error: 'book storage is offline', code: STORAGE_OFFLINE });
    }
    return reply.send(err);
  });

  // Health endpoint checks database connectivity
  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  // Is the book file storage reachable? (open in a browser to check your tunnel)
  app.get('/health/storage', async (_req, reply) => {
    try {
      await storage.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, code: STORAGE_OFFLINE });
    }
  });

  // Me endpoint
  app.get('/me', { preHandler: app.auth }, async (req) => ({
    id: req.user.sub,
    email: req.user.email,
  }));

  // Feature routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(syncRoutes, { prefix: '/sync' });
  await app.register(fileRoutes, { prefix: '/files' });
  await app.register(proxyRoutes, { prefix: '/proxy' });
  await app.register(accountRoutes, { prefix: '/account' });

  return app;
}

// Start standalone server when executed directly
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';

  const start = async () => {
    try {
      for (const warning of describeConnection()) console.warn(`WARNING: ${warning}`);
      if (process.env.MIGRATE_ON_START === 'true') {
        await runMigrations();
      }

      const server = await createServer();

      const shutdown = async () => {
        await server.close();
        await getNotifyHub().close();
        await pool.end();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      await server.listen({ host, port });
      console.log(`Verso server listening on http://${host}:${port}`);
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  };

  start();
}
