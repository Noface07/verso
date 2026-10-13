import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import './types.js';

const ROOT = process.env.FILES_DIR || './data/files';
const MAX_BYTES = (Number(process.env.MAX_FILE_MB) || 300) * 1024 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/;

const filePath = (userId: string, hash: string) => path.join(ROOT, userId, hash);
const exists = (p: string) => fsp.access(p).then(() => true, () => false);

export interface FileItem {
  hash: string;
  size: number;
}

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
      const userDir = path.join(ROOT, req.user.sub);
      try {
        const entries = await fsp.readdir(userDir, { withFileTypes: true });
        const files: FileItem[] = [];
        for (const entry of entries) {
          if (entry.isFile() && HASH_RE.test(entry.name)) {
            const stat = await fsp.stat(path.join(userDir, entry.name));
            files.push({ hash: entry.name, size: stat.size });
          }
        }
        return files;
      } catch {
        return [];
      }
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

      const dir = path.join(ROOT, req.user.sub);
      await fsp.mkdir(dir, { recursive: true });
      const final = filePath(req.user.sub, hash);

      if (await exists(final)) {
        (bodyStream as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
        return { stored: false, exists: true };
      }

      const tmp = `${final}.${crypto.randomUUID()}.part`;
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

      await fsp.rename(tmp, final);
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

      const p = filePath(req.user.sub, hash);
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(p);
      } catch {
        return reply.code(404).send({ error: 'not found' });
      }

      reply
        .header('content-length', stat.size)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .type('application/octet-stream');

      return reply.send(fs.createReadStream(p));
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

      await fsp.rm(filePath(req.user.sub, hash), { force: true });
      return { ok: true };
    },
  );
};

export default fileRoutes;
