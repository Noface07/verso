import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.FILES_DIR || './data/files';
const MAX_BYTES = (Number(process.env.MAX_FILE_MB) || 300) * 1024 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/;

const filePath = (userId, hash) => path.join(ROOT, userId, hash);
const exists = (p) => fsp.access(p).then(() => true, () => false);

export default async function fileRoutes(app) {
  // Hand the raw upload stream to the route instead of buffering it in memory
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.put('/:hash', { preHandler: app.auth }, async (req, reply) => {
    const { hash } = req.params;
    if (!HASH_RE.test(hash)) return reply.code(400).send({ error: 'invalid hash' });
    if (!req.body || typeof req.body.pipe !== 'function') {
      return reply.code(415).send({ error: 'send body as application/octet-stream' });
    }

    const dir = path.join(ROOT, req.user.sub);
    await fsp.mkdir(dir, { recursive: true });
    const final = filePath(req.user.sub, hash);
    if (await exists(final)) {
      req.body.resume();
      return { stored: false, exists: true };
    }

    const tmp = `${final}.${crypto.randomUUID()}.part`;
    const hasher = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > MAX_BYTES) return cb(new Error('FILE_TOO_LARGE'));
        hasher.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(req.body, meter, fs.createWriteStream(tmp));
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      if (e.message === 'FILE_TOO_LARGE') return reply.code(413).send({ error: 'file too large' });
      throw e;
    }

    if (hasher.digest('hex') !== hash) {
      await fsp.rm(tmp, { force: true });
      return reply.code(400).send({ error: 'hash mismatch' });
    }
    await fsp.rename(tmp, final);
    return reply.code(201).send({ stored: true, size });
  });

  // GET also answers HEAD automatically, so clients can cheaply check existence
  app.get('/:hash', { preHandler: app.auth }, async (req, reply) => {
    const { hash } = req.params;
    if (!HASH_RE.test(hash)) return reply.code(400).send({ error: 'invalid hash' });
    const p = filePath(req.user.sub, hash);
    let stat;
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
  });

  app.delete('/:hash', { preHandler: app.auth }, async (req, reply) => {
    const { hash } = req.params;
    if (!HASH_RE.test(hash)) return reply.code(400).send({ error: 'invalid hash' });
    await fsp.rm(filePath(req.user.sub, hash), { force: true });
    return { ok: true };
  });
}