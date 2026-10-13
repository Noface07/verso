import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

// Return BIGINT columns as JS numbers (ms timestamps and seqs fit safely within Number.MAX_SAFE_INTEGER)
pg.types.setTypeParser(20, (v: string) => Number(v));

type SslMode = 'disable' | 'require' | 'verify-full';

/** Hosted Postgres providers that only accept TLS connections. */
function isHostedRequiringTls(host: string): boolean {
  return /(^|\.)supabase\.(co|com)$/i.test(host);
}

function readCa(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('-----BEGIN CERTIFICATE-----')) return value.replace(/\\n/g, '\n');
  return fs.readFileSync(value, 'utf8');
}

/**
 * Builds the pg connection config from env.
 *
 * - DATABASE_URL       postgres://user:pass@host:port/db (required outside tests)
 * - DATABASE_SSL       disable | require | verify-full. Default: `require` for Supabase
 *                      hosts or when the URL asks for sslmode, otherwise `disable`.
 * - DATABASE_CA_CERT   CA bundle (file path or PEM). With it, `require` upgrades to
 *                      full verification. Supabase's CA is downloadable from
 *                      Project Settings → Database → SSL Configuration.
 * - DATABASE_POOL_MAX  pool size (default 10). Keep it below the provider's limit
 *                      minus one: the sync event listener holds one extra connection.
 */
export function buildPoolConfig(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  const raw = env.DATABASE_URL;
  const max = Number(env.DATABASE_POOL_MAX) || 10;
  const base: pg.PoolConfig = {
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Hosted poolers drop silent TCP connections; keepalives stop that killing idle clients.
    keepAlive: true,
  };
  if (!raw) return base;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ...base, connectionString: raw };
  }

  // sslmode in the URL would override the `ssl` object below (pg lets the connection
  // string win), and pg treats `require` as full verification, which fails against
  // Supabase's private CA. Resolve it here and strip it from the URL.
  const urlMode = url.searchParams.get('sslmode');
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(p);
  }

  const explicit = env.DATABASE_SSL as SslMode | undefined;
  const ca = readCa(env.DATABASE_CA_CERT);
  let mode: SslMode;
  if (explicit) mode = explicit;
  else if (urlMode === 'disable') mode = 'disable';
  else if (urlMode === 'verify-full' || urlMode === 'verify-ca') mode = 'verify-full';
  else if (urlMode || isHostedRequiringTls(url.hostname)) mode = 'require';
  else mode = 'disable';

  let ssl: pg.PoolConfig['ssl'] = false;
  if (mode === 'verify-full' || (mode === 'require' && ca)) {
    ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  } else if (mode === 'require') {
    // Encrypted, but the server certificate isn't verified against a CA.
    ssl = { rejectUnauthorized: false };
  }

  return { ...base, connectionString: url.toString(), ssl };
}

/**
 * Supabase's transaction pooler (port 6543) multiplexes clients per transaction,
 * so LISTEN/NOTIFY (used for live sync) silently never fires. Session mode works.
 */
export function describeConnection(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    if (isHostedRequiringTls(url.hostname) && url.port === '6543') {
      warnings.push(
        'DATABASE_URL points at the Supabase transaction pooler (port 6543). Live sync uses ' +
          'LISTEN/NOTIFY, which needs a session connection: use the session pooler URI (port 5432).',
      );
    }
  } catch {
    // Unparseable URL: pg will report it on first connect.
  }
  return warnings;
}

function createPool(): pg.Pool {
  const p = new pg.Pool(buildPoolConfig());
  // An idle client can be dropped by the server or a pooler at any time (restarts,
  // maintenance). Without a listener, pg re-throws that as an uncaught error and
  // the whole API process exits.
  p.on('error', (err) => {
    console.error('Postgres idle client error:', err.message);
  });
  return p;
}

export let pool: pg.Pool = createPool();

export function setPool(newPool: pg.Pool): void {
  pool = newPool;
}
