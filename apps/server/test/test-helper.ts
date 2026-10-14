import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { newDb, DataType, type IMemoryDb } from 'pg-mem';
import type { FastifyInstance } from 'fastify';
import { setPool } from '../src/db.js';
import { createServer } from '../src/server.js';

export interface TestContext {
  app: FastifyInstance;
  mem: IMemoryDb;
  cleanup: () => Promise<void>;
}

export async function setupTestApp(testId: string = 'default'): Promise<TestContext> {
  const testDir = `./data/test_files_${testId}_${Date.now()}`;
  process.env.FILES_DIR = testDir;
  process.env.JWT_SECRET = 'test_secret_must_be_at_least_32_characters_long_for_hs256';
  process.env.ALLOW_SIGNUP = 'true';
  process.env.NODE_ENV = 'test';

  const mem = newDb();

  // Register functions
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  // Create sequence
  mem.public.query('create sequence sync_seq;');

  // Migration 004 tables, and a no-op stand-in for pg_advisory_xact_lock (pg-mem
  // doesn't implement advisory locks; tests run single-connection anyway).
  mem.public.query(`
    create table server_meta (id boolean primary key, instance_id text not null);
    insert into server_meta values (true, '00000000-0000-4000-8000-000000000001');
    create table deleted_users (id text primary key, deleted_at timestamptz default now());
  `);
  mem.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.bigint],
    returns: DataType.text,
    implementation: () => '',
  });
  mem.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.text,
    implementation: () => '',
  });

  // Create tables with default nextval for server_seq
  mem.public.query(`
    create table users (
      id text primary key default gen_random_uuid(),
      email text unique not null,
      password_hash text not null,
      created_at timestamptz default now()
    );

    create table refresh_tokens (
      token_hash text primary key,
      user_id text not null references users(id) on delete cascade,
      device_name text,
      expires_at timestamptz not null,
      created_at timestamptz default now()
    );

    create table books (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      title text, author text, format text,
      file_hash text, file_size bigint, cover_hash text,
      meta jsonb not null default '{}',
      added_at bigint, last_opened_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table progress (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      cfi text, percent real, chapter text, device_id text,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table annotations (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      book_id text not null,
      type text not null,
      cfi text not null,
      text text, note text, color text, style text, chapter text, created_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table collections (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      name text not null, sort_order int not null default 0,
      meta jsonb not null default '{}',
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table collection_books (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      collection_id text not null, book_id text not null,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table reading_sessions (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      book_id text not null,
      started_at bigint, ended_at bigint, duration_sec int,
      start_percent real, end_percent real, words_read int, device_id text,
      kind text not null default 'book',
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table settings (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      data jsonb not null default '{}',
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table series (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      source text not null, source_id text not null, title text not null,
      author text, cover_url text, status text,
      meta jsonb not null default '{}',
      added_at bigint, last_read_at bigint, last_checked_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table chapter_progress (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      series_id text not null, source text not null, chapter_id text not null,
      chapter_number real, title text, page int, total_pages int,
      read boolean not null default false, read_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table sources (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      kind text not null, name text not null, url text not null,
      meta jsonb not null default '{}', sort_order int not null default 0,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );

    create table devices (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      name text not null, platform text not null, last_seen_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default nextval('sync_seq'),
      primary key (user_id, id)
    );
  `);

  const pgAdapter = mem.adapters.createPg();
  const pool = new pgAdapter.Pool();
  setPool(pool as unknown as import('pg').Pool);

  const app = await createServer();
  await app.ready();

  const cleanup = async () => {
    await app.close();
    await pool.end();
    await fsp.rm(testDir, { recursive: true, force: true });
  };

  return { app, mem, cleanup };
}
