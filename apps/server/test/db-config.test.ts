import { describe, it, expect } from 'vitest';
import { buildPoolConfig, describeConnection } from '../src/db.js';

const SUPABASE_SESSION =
  'postgres://postgres.abcdefgh:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

describe('buildPoolConfig', () => {
  it('leaves SSL off for local Postgres', () => {
    const cfg = buildPoolConfig({ DATABASE_URL: 'postgres://reader:pw@localhost:5432/reader' });
    expect(cfg.ssl).toBe(false);
    expect(cfg.connectionString).toBe('postgres://reader:pw@localhost:5432/reader');
  });

  it('enables encrypted SSL automatically for Supabase hosts', () => {
    const cfg = buildPoolConfig({ DATABASE_URL: SUPABASE_SESSION });
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('also recognises direct db.<ref>.supabase.co hosts', () => {
    const cfg = buildPoolConfig({
      DATABASE_URL: 'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres',
    });
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('strips sslmode from the URL so it cannot override the ssl object', () => {
    const cfg = buildPoolConfig({ DATABASE_URL: `${SUPABASE_SESSION}?sslmode=require&application_name=folio` });
    expect(cfg.connectionString).not.toContain('sslmode');
    expect(cfg.connectionString).toContain('application_name=folio');
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('verifies the certificate when a CA is supplied', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----';
    const cfg = buildPoolConfig({ DATABASE_URL: SUPABASE_SESSION, DATABASE_CA_CERT: pem });
    expect(cfg.ssl).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
    });
  });

  it('honours an explicit DATABASE_SSL=disable', () => {
    const cfg = buildPoolConfig({ DATABASE_URL: SUPABASE_SESSION, DATABASE_SSL: 'disable' });
    expect(cfg.ssl).toBe(false);
  });

  it('reads the pool size from DATABASE_POOL_MAX', () => {
    expect(buildPoolConfig({ DATABASE_URL: SUPABASE_SESSION, DATABASE_POOL_MAX: '4' }).max).toBe(4);
    expect(buildPoolConfig({ DATABASE_URL: SUPABASE_SESSION }).max).toBe(10);
  });
});

describe('describeConnection', () => {
  it('warns about the Supabase transaction pooler', () => {
    const url = SUPABASE_SESSION.replace(':5432/', ':6543/');
    expect(describeConnection({ DATABASE_URL: url })).toHaveLength(1);
  });

  it('is quiet for the session pooler', () => {
    expect(describeConnection({ DATABASE_URL: SUPABASE_SESSION })).toEqual([]);
  });
});
