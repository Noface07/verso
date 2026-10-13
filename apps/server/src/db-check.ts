/**
 * `pnpm --filter server db:check` — verifies the configured database is usable
 * by Folio: connection + TLS, schema migrations, Supabase API lockdown (RLS),
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

  const info = await pool.query<{ version: string; user: string; ssl: boolean | null }>(
    `select version() as version, current_user as user,
            (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl`,
  );
  const { version, user, ssl } = info.rows[0];
  ok(`connected as ${user} — ${version.split(' on ')[0]}`);
  if (ssl) ok('connection is encrypted (TLS)');
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
    const received = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), 5000);
      void hub.subscribe(channel, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((r) => setTimeout(r, 300));
    await pool.query('select pg_notify($1, $2)', [channel, '']);
    await received;
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
