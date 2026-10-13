import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { getNotifyHub } from './notify.js';
import {
  SYNC_TABLES,
  type SyncTableName,
  type SyncPushResponse,
  type SyncPullResponse,
  type EventsTokenResponse,
} from '@folio/shared';
import './types.js';

const JSON_COLS = new Set(['meta', 'data']);
const MAX_PUSH_ROWS = 5000;
const PULL_LIMIT = 1000;

function validRow(row: unknown): row is { id: string; updated_at: number; deleted_at?: number | null; [key: string]: unknown } {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 128 &&
    Number.isFinite(Number(r.updated_at))
  );
}

async function upsert(
  client: PoolClient,
  table: SyncTableName,
  userId: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const incomingUpdated = Number(row.updated_at);
  const existing = await client.query<{ updated_at: number }>(
    `select updated_at from ${table} where user_id = $1 and id = $2`,
    [userId, row.id],
  );

  if (existing.rowCount && existing.rows[0]) {
    if (incomingUpdated <= Number(existing.rows[0].updated_at)) {
      return false;
    }
  }

  const fields = SYNC_TABLES[table];
  const cols = ['user_id', 'id', 'updated_at', 'deleted_at', ...fields];
  const vals: unknown[] = [
    userId,
    row.id,
    incomingUpdated,
    row.deleted_at == null ? null : Number(row.deleted_at),
  ];

  for (const field of fields) {
    const val = row[field];
    if (JSON_COLS.has(field)) {
      vals.push(val != null ? JSON.stringify(val) : '{}');
    } else if (field === 'read') {
      vals.push(val != null ? Boolean(val) : false);
    } else if (field === 'sort_order') {
      vals.push(val != null ? Number(val) : 0);
    } else {
      vals.push(val ?? null);
    }
  }

  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const setCols = cols.slice(2).map((c) => `${c} = excluded.${c}`);
  setCols.push("server_seq = nextval('sync_seq')");
  const set = setCols.join(',');
  const query = `
    insert into ${table} (${cols.join(',')}) values (${ph})
    on conflict (user_id, id) do update set ${set}
    where ${table}.updated_at < excluded.updated_at
  `;

  await client.query(query, vals);
  return true;
}

export const syncRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Push changes from client
  app.post<{ Body: { changes?: Record<string, unknown[]> } }>(
    '/push',
    { preHandler: app.auth },
    async (req, reply) => {
      const changes = req.body?.changes;
      if (!changes || typeof changes !== 'object') {
        return reply.code(400).send({ error: 'changes object required' });
      }

      const total = Object.values(changes).reduce(
        (n, r) => n + (Array.isArray(r) ? r.length : 0),
        0,
      );
      if (total > MAX_PUSH_ROWS) {
        return reply.code(413).send({ error: `max ${MAX_PUSH_ROWS} rows per push` });
      }

      const client = await pool.connect();
      let accepted = 0;
      let stale = 0;
      let invalid = 0;
      const staleIds: Partial<Record<SyncTableName, string[]>> = {};

      try {
        await client.query('begin');
        for (const [tbl, rows] of Object.entries(changes)) {
          const table = tbl as SyncTableName;
          if (!SYNC_TABLES[table] || !Array.isArray(rows)) continue;

          for (const row of rows) {
            if (!validRow(row)) {
              invalid++;
              continue;
            }
            const isAccepted = await upsert(client, table, req.user.sub, row);
            if (isAccepted) {
              accepted++;
            } else {
              stale++;
              if (!staleIds[table]) {
                staleIds[table] = [];
              }
              staleIds[table]!.push(row.id as string);
            }
          }
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }

      const response: SyncPushResponse = {
        accepted,
        stale,
        invalid,
        staleIds,
        serverTime: Date.now(),
      };
      return response;
    },
  );

  // Pull changes from server since seq
  app.get<{ Querystring: { since?: string } }>(
    '/pull',
    { preHandler: app.auth },
    async (req): Promise<SyncPullResponse> => {
      const since = Math.max(0, Number(req.query.since) || 0);
      const fetched: Partial<Record<SyncTableName, Record<string, unknown>[]>> = {};
      let ceiling = Infinity;

      for (const table of Object.keys(SYNC_TABLES) as SyncTableName[]) {
        const r = await pool.query<Record<string, unknown>>(
          `select * from ${table} where user_id = $1 and server_seq > $2
           order by server_seq limit $3`,
          [req.user.sub, since, PULL_LIMIT],
        );
        fetched[table] = r.rows;
        if (r.rows.length === PULL_LIMIT) {
          const lastSeq = Number(r.rows[r.rows.length - 1].server_seq);
          ceiling = Math.min(ceiling, lastSeq);
        }
      }

      const hasMore = ceiling !== Infinity;
      const changes: Partial<Record<SyncTableName, Record<string, unknown>[]>> = {};
      let cursor = since;

      for (const [tbl, rows] of Object.entries(fetched)) {
        const table = tbl as SyncTableName;
        if (!rows) continue;
        changes[table] = rows
          .filter((r) => Number(r.server_seq) <= ceiling)
          .map(({ user_id: _, ...rest }) => rest);

        for (const r of changes[table]!) {
          cursor = Math.max(cursor, Number(r.server_seq));
        }
      }

      if (hasMore) cursor = ceiling;

      return {
        changes,
        cursor,
        hasMore,
        serverTime: Date.now(),
      };
    },
  );

  // Issue 5-minute SSE token
  app.post(
    '/events-token',
    { preHandler: app.auth },
    async (req): Promise<EventsTokenResponse> => {
      const token = app.jwt.sign(
        { sub: req.user.sub, email: req.user.email, type: 'events' },
        { expiresIn: '5m' },
      );
      return { token, expiresIn: 300 };
    },
  );

  // Server-Sent Events stream for live updates
  app.get<{ Querystring: { token?: string } }>(
    '/events',
    async (req, reply) => {
      const token = req.query?.token;
      if (!token || typeof token !== 'string') {
        return reply.code(401).send({ error: 'token required' });
      }

      let userId: string;
      try {
        const decoded = app.jwt.verify<{ sub: string; type?: string }>(token);
        if (decoded.type !== 'events' || !decoded.sub) {
          return reply.code(401).send({ error: 'invalid events token' });
        }
        userId = decoded.sub;
      } catch {
        return reply.code(401).send({ error: 'invalid or expired events token' });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders?.();

      // Send initial comment to establish stream
      reply.raw.write(': stream opened\n\n');

      const channel = `sync_${userId}`;

      let debounceTimer: NodeJS.Timeout | null = null;
      const onNotification = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!reply.raw.writableEnded) {
            reply.raw.write('event: changed\ndata: {}\n\n');
          }
        }, 500);
      };

      // All streams share one LISTEN connection instead of each holding a pooled client.
      const unsubscribe = await getNotifyHub().subscribe(channel, onNotification);

      // Heartbeat comment every 25s
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': keep-alive\n\n');
        }
      }, 25000);

      req.raw.on('close', () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        clearInterval(heartbeat);
        void unsubscribe();
      });
    },
  );
};

export default syncRoutes;
