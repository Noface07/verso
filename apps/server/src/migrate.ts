import { fileURLToPath, pathToFileURL } from 'node:url';
import { runner } from 'node-pg-migrate';
import { buildPoolConfig } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies pending migrations using the same connection settings as the API
 * (including Supabase SSL handling), so it works anywhere the server does.
 */
export async function runMigrations(direction: 'up' | 'down' = 'up', count?: number): Promise<void> {
  const { connectionString, ssl } = buildPoolConfig();
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const applied = await runner({
    databaseUrl: { connectionString, ssl },
    dir: MIGRATIONS_DIR,
    migrationsTable: 'pgmigrations',
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    singleTransaction: true,
    log: (msg) => console.log(msg),
  });
  console.log(
    applied.length
      ? `Migrations ${direction}: ${applied.map((m) => m.name).join(', ')}`
      : 'Database schema is up to date.',
  );
}

// `node dist/migrate.js [up|down] [count]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  const count = process.argv[3] ? Number(process.argv[3]) : undefined;
  runMigrations(direction, count).catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
