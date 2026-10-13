/**
 * Migration 001: Initial schema
 * (Formerly also shipped as db/init.sql; migrations are now the only schema source.)
 */
export const up = (pgm) => {
  pgm.sql(`
    create extension if not exists citext;
    create sequence if not exists sync_seq;

    create table if not exists users (
      id            uuid primary key default gen_random_uuid(),
      email         citext unique not null,
      password_hash text not null,
      created_at    timestamptz not null default now()
    );

    create table if not exists refresh_tokens (
      token_hash  text primary key,
      user_id     uuid not null references users(id) on delete cascade,
      device_name text,
      expires_at  timestamptz not null,
      created_at  timestamptz not null default now()
    );

    create or replace function bump_seq() returns trigger language plpgsql as $$
    begin
      new.server_seq := nextval('sync_seq');
      return new;
    end $$;

    create table if not exists books (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      title text, author text, format text,
      file_hash text, file_size bigint, cover_hash text,
      meta jsonb not null default '{}',
      added_at bigint, last_opened_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists progress (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      cfi text, percent real, chapter text, device_id text,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists annotations (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      book_id text not null,
      type text not null check (type in ('highlight','note','bookmark')),
      cfi text not null,
      text text, note text,
      color text,
      style text,
      chapter text, created_at bigint,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists collections (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      name text not null, sort_order int not null default 0,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists collection_books (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      collection_id text not null, book_id text not null,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists reading_sessions (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      book_id text not null,
      started_at bigint, ended_at bigint, duration_sec int,
      start_percent real, end_percent real, words_read int, device_id text,
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists settings (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      data jsonb not null default '{}',
      updated_at bigint not null, deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    do $$
    declare t text;
    begin
      foreach t in array array['books','progress','annotations','collections',
                               'collection_books','reading_sessions','settings'] loop
        execute format('create index if not exists %I on %I (user_id, server_seq)', t || '_user_seq_idx', t);
        execute format('drop trigger if exists %I on %I', t || '_seq', t);
        execute format('create trigger %I before insert or update on %I
                        for each row execute function bump_seq()', t || '_seq', t);
      end loop;
    end $$;

    create index if not exists annotations_user_book_idx on annotations (user_id, book_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    drop table if exists settings cascade;
    drop table if exists reading_sessions cascade;
    drop table if exists collection_books cascade;
    drop table if exists collections cascade;
    drop table if exists annotations cascade;
    drop table if exists progress cascade;
    drop table if exists books cascade;
    drop table if exists refresh_tokens cascade;
    drop table if exists users cascade;
    drop function if exists bump_seq cascade;
    drop sequence if exists sync_seq;
  `);
};
