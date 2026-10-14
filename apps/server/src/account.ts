import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from './db.js';
import { SYNC_TABLES, type SyncTableName } from '@verso/shared';
import { storage } from './storage.js';
import { forgetUser } from './integrity.js';
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
      // Tombstone + delete in one transaction (rows cascade via foreign keys).
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          'insert into deleted_users (id) values ($1) on conflict (id) do nothing',
          [userId],
        );
        await client.query('delete from users where id = $1', [userId]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
      forgetUser(userId);

      // Wake this user's other signed-in devices: their next sync gets
      // "account deleted" and wipes their copy instead of re-uploading it.
      await pool.query('select pg_notify($1, $2)', [`sync_${userId}`, '']).catch(() => {});

      // The account is already gone; a storage hiccup must not make the client
      // think deletion failed. Retry file removal in the background.
      void (async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await storage.deleteAll(userId);
            return;
          } catch (err) {
            req.log.warn({ err, attempt }, 'deleting account files failed; retrying');
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
          }
        }
        req.log.error({ userId }, 'could not delete account files');
      })();

      return { ok: true };
    },
  );
};

export default accountRoutes;
