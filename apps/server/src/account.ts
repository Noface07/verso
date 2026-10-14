import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from './db.js';
import { SYNC_TABLES, type SyncTableName } from '@verso/shared';
import { storage } from './storage.js';
import './types.js';

async function calculateStorageUsed(userId: string): Promise<number> {
  const files = await storage.list(userId);
  return files.reduce((acc, f) => acc + f.size, 0);
}

export const accountRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Get account info
  app.get(
    '/',
    { preHandler: app.auth },
    async (req, reply) => {
      const r = await pool.query<{ id: string; email: string; created_at: string }>(
        'select id, email, created_at from users where id = $1',
        [req.user.sub],
      );
      const user = r.rows[0];
      if (!user) {
        return reply.code(404).send({ error: 'user not found' });
      }

      const storageUsed = await calculateStorageUsed(user.id);
      return {
        id: user.id,
        email: user.email,
        storageUsed,
        createdAt: user.created_at,
      };
    },
  );

  // Change password
  app.patch<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/password',
    { preHandler: app.auth },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return reply.code(400).send({ error: 'currentPassword and newPassword required' });
      }
      if (newPassword.length < 8) {
        return reply.code(400).send({ error: 'newPassword must be at least 8 characters' });
      }

      const r = await pool.query<{ password_hash: string }>(
        'select password_hash from users where id = $1',
        [req.user.sub],
      );
      const user = r.rows[0];
      if (!user) {
        return reply.code(404).send({ error: 'user not found' });
      }

      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) {
        return reply.code(401).send({ error: 'incorrect current password' });
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await pool.query('update users set password_hash = $1 where id = $2', [newHash, req.user.sub]);

      return { ok: true };
    },
  );

  // List active sessions
  app.get(
    '/sessions',
    { preHandler: app.auth },
    async (req) => {
      const r = await pool.query<{
        token_hash: string;
        device_name: string | null;
        created_at: string;
        expires_at: string;
      }>(
        `select token_hash, device_name, created_at, expires_at
         from refresh_tokens
         where user_id = $1 and expires_at > now()
         order by created_at desc`,
        [req.user.sub],
      );
      return r.rows;
    },
  );

  // Revoke a specific session
  app.delete<{ Params: { tokenHash: string } }>(
    '/sessions/:tokenHash',
    { preHandler: app.auth },
    async (req) => {
      await pool.query(
        'delete from refresh_tokens where user_id = $1 and token_hash = $2',
        [req.user.sub, req.params.tokenHash],
      );
      return { ok: true };
    },
  );

  // Export all user data as a ZIP archive
  app.get(
    '/export',
    { preHandler: app.auth },
    async (req, reply) => {
      const userId = req.user.sub;
      const exportData: Record<string, unknown[]> = {};

      for (const table of Object.keys(SYNC_TABLES) as SyncTableName[]) {
        const r = await pool.query(
          `select * from ${table} where user_id = $1 and deleted_at is null order by updated_at desc`,
          [userId],
        );
        exportData[table] = r.rows.map(({ user_id: _, ...rest }) => rest);
      }

      // Collect file manifest
      const filesManifest = await storage.list(userId);

      reply.raw.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="verso-export-${Date.now()}.zip"`,
        'Cache-Control': 'no-cache',
      });

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(reply.raw);

      // Append metadata
      archive.append(
        JSON.stringify(
          {
            userId,
            email: req.user.email,
            exportedAt: new Date().toISOString(),
            tables: Object.keys(exportData),
            fileCount: filesManifest.length,
          },
          null,
          2,
        ),
        { name: 'manifest.json' },
      );

      // Append table JSONs
      for (const [table, rows] of Object.entries(exportData)) {
        archive.append(JSON.stringify(rows, null, 2), { name: `tables/${table}.json` });
      }

      // Append files list
      archive.append(JSON.stringify(filesManifest, null, 2), { name: 'files.json' });

      await archive.finalize();
    },
  );

  // Delete account cascade
  app.delete(
    '/',
    { preHandler: app.auth },
    async (req) => {
      const userId = req.user.sub;
      // Foreign keys in Postgres have ON DELETE CASCADE
      await pool.query('delete from users where id = $1', [userId]);

      // Remove user storage (R2 or disk)
      await storage.deleteAll(userId);

      return { ok: true };
    },
  );
};

export default accountRoutes;
