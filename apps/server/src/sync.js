import { pool } from './db.js';

export const TABLES = {
  books: ['title', 'author', 'format', 'file_hash', 'file_size', 'cover_hash', 'meta',
          'added_at', 'last_opened_at'],
  progress: ['cfi', 'percent', 'chapter', 'device_id'],
  annotations: ['book_id', 'type', 'cfi', 'text', 'note', 'color', 'style', 'chapter', 'created_at'],
  collections: ['name', 'sort_order'],
  collection_books: ['collection_id', 'book_id'],
  reading_sessions: ['book_id', 'started_at', 'ended_at', 'duration_sec', 'start_percent',
                     'end_percent', 'words_read', 'device_id'],
  settings: ['data'],
};
const JSON_COLS = new Set(['meta', 'data']);
const MAX_PUSH_ROWS = 5000;
const PULL_LIMIT = 1000;

function validRow(row) {
  return row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128
    && Number.isFinite(Number(row.updated_at));
}

async function upsert(client, table, userId, row) {
  const fields = TABLES[table];
  const cols = ['user_id', 'id', 'updated_at', 'deleted_at', ...fields];
  const vals = [
    userId,
    row.id,
    Number(row.updated_at),
    row.deleted_at == null ? null : Number(row.deleted_at),
    ...fields.map((c) => (row[c] ?? (JSON_COLS.has(c) ? {} : null))),
  ];
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const set = cols.slice(2).map((c) => `${c} = excluded.${c}`).join(',');
  const r = await client.query(
    `insert into ${table} (${cols.join(',')}) values (${ph})
     on conflict (user_id, id) do update set ${set}
     where ${table}.updated_at < excluded.updated_at`,
    vals,
  );
  return r.rowCount === 1;
}

export default async function syncRoutes(app) {
  app.post('/push', { preHandler: app.auth }, async (req, reply) => {
    const changes = req.body?.changes;
    if (!changes || typeof changes !== 'object') {
      return reply.code(400).send({ error: 'changes object required' });
    }
    const total = Object.values(changes).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0);
    if (total > MAX_PUSH_ROWS) return reply.code(413).send({ error: `max ${MAX_PUSH_ROWS} rows per push` });

    const client = await pool.connect();
    let accepted = 0, stale = 0, invalid = 0;
    try {
      await client.query('begin');
      for (const [table, rows] of Object.entries(changes)) {
        if (!TABLES[table] || !Array.isArray(rows)) continue;
        for (const row of rows) {
          if (!validRow(row)) { invalid++; continue; }
          (await upsert(client, table, req.user.sub, row)) ? accepted++ : stale++;
        }
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    // "stale" rows lost to a newer server version; the client gets that version on its next pull
    return { accepted, stale, invalid };
  });

  app.get('/pull', { preHandler: app.auth }, async (req) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    const fetched = {};
    let ceiling = Infinity;

    for (const table of Object.keys(TABLES)) {
      const r = await pool.query(
        `select * from ${table} where user_id = $1 and server_seq > $2
         order by server_seq limit $3`,
        [req.user.sub, since, PULL_LIMIT],
      );
      fetched[table] = r.rows;
      if (r.rows.length === PULL_LIMIT) {
        ceiling = Math.min(ceiling, r.rows[r.rows.length - 1].server_seq);
      }
    }

    const hasMore = ceiling !== Infinity;
    const changes = {};
    let cursor = since;
    for (const [table, rows] of Object.entries(fetched)) {
      changes[table] = rows
        .filter((r) => r.server_seq <= ceiling)
        .map(({ user_id, ...rest }) => rest);
      for (const r of changes[table]) cursor = Math.max(cursor, r.server_seq);
    }
    if (hasMore) cursor = ceiling;

    return { changes, cursor, hasMore };
  });
}