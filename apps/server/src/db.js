import pg from 'pg';

// Return BIGINT columns as JS numbers (ms timestamps and seqs fit safely)
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});