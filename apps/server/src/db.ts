import 'dotenv/config';
import pg from 'pg';

// Return BIGINT columns as JS numbers (ms timestamps and seqs fit safely within Number.MAX_SAFE_INTEGER)
pg.types.setTypeParser(20, (v: string) => Number(v));

export let pool: pg.Pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export function setPool(newPool: pg.Pool): void {
  pool = newPool;
}
