/**
 * `pnpm --filter server db:check` — verifies the configured database is usable
 * by Verso: connection + TLS, schema migrations, Supabase API lockdown (RLS),
 * and a LISTEN/NOTIFY round trip (what live sync depends on).
 */
import { randomUUID } from 'node:crypto';
import { pool, describeConnection } from './db.js';
import { NotifyHub } from './notify.js';

const EXPECTED_TABLES = [
  'users',
  'refresh_tokens',
  'books',
  'progress',
  'annotations',
  'collections',
  'collection_books',
  'reading_sessions',
  'settings',
  'series',
  'chapter_progress',
  'sources',
  'devices',
];

let failed = false;
const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const bad = (msg: string) => {
  failed = true;
  console.log(`  ✖ ${msg}`);
};

async function main() {
  for (const warning of describeConnection()) console.log(`  ! ${warning}`);

  const client = await pool.connect();
  let version: string;
  let user: string;
  let tls: string | null;
  try {
    const info = await client.query<{ version: string; user: string }>(
      'select version() as version, current_user as user',
    );
    ({ version, user } = info.rows[0]);
    // Inspect our own socket: through a pooler, pg_stat_ssl describes the
    // pooler -> Postgres hop rather than this app's connection.
    const stream = (client as unknown as { connection: { stream: { encrypted?: boolean; getProtocol?: () => string | null } } })
      .connection.stream;
    tls = stream.encrypted ? (stream.getProtocol?.() ?? 'TLS') : null;
  } finally {
    client.release();
  }
  ok(`connected as ${user} — ${version.split(' on ')[0]}`);
  if (tls) ok(`connection is encrypted (${tls})`);
  else console.log('  ! connection is not encrypted (fine for local Docker, not for a hosted DB)');

  const tables = await pool.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
  );
  const present = new Map(tables.rows.map((r) => [r.tablename, r.rowsecurity]));
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length) bad(`missing tables: ${missing.join(', ')} — run \`pnpm --filter server db:migrate\``);
  else ok(`schema present (${EXPECTED_TABLES.length} core tables)`);

  const migrations = await pool
    .query<{ name: string }>('select name from pgmigrations order by run_on')
    .catch(() => ({ rows: [] as { name: string }[] }));
  if (migrations.rows.length) ok(`migrations applied: ${migrations.rows.map((m) => m.name).join(', ')}`);
  else bad('no migrations recorded — run `pnpm --filter server db:migrate`');

  const hasApiRoles = await pool.query(`select 1 from pg_roles where rolname = 'anon'`);
  if (hasApiRoles.rowCount) {
    const open = [...present].filter(([, rls]) => !rls).map(([t]) => t);
    if (open.length) bad(`RLS disabled (exposed via Supabase REST API): ${open.join(', ')}`);
    else ok('all public tables have RLS enabled (Supabase REST API cannot read them)');
    const grants = await pool.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
    );
    if (grants.rowCount) bad(`anon/authenticated still have grants on: ${grants.rows.map((g) => g.table_name).join(', ')}`);
    else ok('anon/authenticated roles have no table privileges');
  }

  // LISTEN/NOTIFY round trip over the same path the SSE endpoint uses.
  const hub = new NotifyHub();
  const channel = `folio_check_${randomUUID()}`;
  try {
    let resolveReceived!: () => void;
    const received = new Promise<void>((resolve) => (resolveReceived = resolve));
    // Wait until LISTEN is in place, then NOTIFY from a different connection,
    // exactly as a sync push from another device would.
    await hub.subscribe(channel, () => resolveReceived());
    await pool.query('select pg_notify($1, $2)', [channel, '']);
    await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 10s')), 10_000)),
    ]);
    ok('LISTEN/NOTIFY works (live sync between devices)');
  } catch (err) {
    bad(
      `LISTEN/NOTIFY failed (${(err as Error).message}). On Supabase use the session pooler ` +
        '(port 5432) or the direct connection, not the transaction pooler (port 6543).',
    );
  } finally {
    await hub.close();
  }
}

main()
  .catch((err) => {
    bad(`could not connect: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    console.log(failed ? '\nDatabase check FAILED' : '\nDatabase check passed');
    process.exit(failed ? 1 : 0);
  });
