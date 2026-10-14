import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { storage, HASH_RE, type FileItem } from './storage.js';
import './types.js';

const TMP_DIR = path.join(process.env.FILES_DIR || './data/files', '.tmp');
const MAX_BYTES = (Number(process.env.MAX_FILE_MB) || 300) * 1024 * 1024;

export { type FileItem };

export const fileRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Pass raw upload stream to route instead of buffering in memory
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });

  // List all files stored for the authenticated user
  app.get(
    '/',
    { preHandler: app.auth },
    async (req): Promise<FileItem[]> => {
      return storage.list(req.user.sub);
    },
  );

  app.put<{ Params: { hash: string } }>(
    '/:hash',
    { preHandler: app.auth },
    async (req, reply) => {
      const { hash } = req.params;
      if (!HASH_RE.test(hash)) {
        return reply.code(400).send({ error: 'invalid hash' });
      }

      const bodyStream = req.body as NodeJS.ReadableStream | undefined;
      if (!bodyStream || typeof (bodyStream as NodeJS.ReadableStream).pipe !== 'function') {
        return reply.code(415).send({ error: 'send body as application/octet-stream' });
      }

      if (await storage.has(req.user.sub, hash)) {
        (bodyStream as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
        return { stored: false, exists: true };
      }

      await fsp.mkdir(TMP_DIR, { recursive: true });
      const tmp = path.join(TMP_DIR, `${req.user.sub}_${hash}_${crypto.randomUUID()}.part`);
      const hasher = crypto.createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          if (size > MAX_BYTES) {
            return cb(new Error('FILE_TOO_LARGE'));
          }
          hasher.update(chunk);
          cb(null, chunk);
        },
      });

      try {
        await pipeline(bodyStream, meter, fs.createWriteStream(tmp));
      } catch (e: unknown) {
        await fsp.rm(tmp, { force: true });
        const err = e as Error;
        if (err.message === 'FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file too large' });
        }
        throw e;
      }

      if (hasher.digest('hex') !== hash) {
        await fsp.rm(tmp, { force: true });
        return reply.code(400).send({ error: 'hash mismatch' });
      }

      await storage.put(req.user.sub, hash, tmp, size);
      return reply.code(201).send({ stored: true, size });
    },
  );

  app.get<{ Params: { hash: string } }>(
    '/:hash',
    { preHandler: app.auth },
    async (req, reply) => {
      const { hash } = req.params;
      if (!HASH_RE.test(hash)) {
        return reply.code(400).send({ error: 'invalid hash' });
      }

      const item = await storage.get(req.user.sub, hash);
      if (!item) {
        return reply.code(404).send({ error: 'not found' });
      }

      reply
        .header('content-length', item.size)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .type('application/octet-stream');

      return reply.send(item.stream);
    },
  );

  app.delete<{ Params: { hash: string } }>(
    '/:hash',
    { preHandler: app.auth },
    async (req, reply) => {
      const { hash } = req.params;
      if (!HASH_RE.test(hash)) {
        return reply.code(400).send({ error: 'invalid hash' });
      }

      await storage.delete(req.user.sub, hash);
      return { ok: true };
    },
  );
};

export default fileRoutes;
