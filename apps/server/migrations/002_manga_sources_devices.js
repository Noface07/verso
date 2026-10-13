/**
 * Migration 002: Manga, sources, devices, and SSE sync notification triggers
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Alter existing tables
    alter table reading_sessions add column if not exists kind text not null default 'book';
    alter table collections add column if not exists meta jsonb not null default '{}';

    -- New synced tables
    create table if not exists series (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      source text not null,
      source_id text not null,
      title text not null,
      author text,
      cover_url text,
      status text,
      meta jsonb not null default '{}',
      added_at bigint,
      last_read_at bigint,
      last_checked_at bigint,
      updated_at bigint not null,
      deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists chapter_progress (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      series_id text not null,
      source text not null,
      chapter_id text not null,
      chapter_number real,
      title text,
      page int,
      total_pages int,
      read boolean not null default false,
      read_at bigint,
      updated_at bigint not null,
      deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists sources (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      kind text not null,
      name text not null,
      url text not null,
      meta jsonb not null default '{}',
      sort_order int not null default 0,
      updated_at bigint not null,
      deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    create table if not exists devices (
      user_id uuid not null references users(id) on delete cascade,
      id text not null,
      name text not null,
      platform text not null,
      last_seen_at bigint,
      updated_at bigint not null,
      deleted_at bigint,
      server_seq bigint not null default 0,
      primary key (user_id, id)
    );

    -- Indexes and bump_seq triggers for new tables
    do $$
    declare t text;
    begin
      foreach t in array array['series','chapter_progress','sources','devices'] loop
        execute format('create index if not exists %I on %I (user_id, server_seq)', t || '_user_seq_idx', t);
        execute format('drop trigger if exists %I on %I', t || '_seq', t);
        execute format('create trigger %I before insert or update on %I
                        for each row execute function bump_seq()', t || '_seq', t);
      end loop;
    end $$;

    create index if not exists chapter_progress_series_idx on chapter_progress (user_id, series_id);

    -- SSE sync notification trigger
    create or replace function notify_sync() returns trigger language plpgsql as $$
    begin
      perform pg_notify('sync_' || coalesce(new.user_id, old.user_id)::text, '');
      return coalesce(new, old);
    end $$;

    -- Attach notify trigger to all 11 synced tables
    do $$
    declare t text;
    begin
      foreach t in array array[
        'books','progress','annotations','collections','collection_books',
        'reading_sessions','settings','series','chapter_progress','sources','devices'
      ] loop
        execute format('drop trigger if exists %I on %I', t || '_notify', t);
        execute format('create trigger %I after insert or update on %I
                        for each row execute function notify_sync()', t || '_notify', t);
      end loop;
    end $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    do $$
    declare t text;
    begin
      foreach t in array array[
        'books','progress','annotations','collections','collection_books',
        'reading_sessions','settings','series','chapter_progress','sources','devices'
      ] loop
        execute format('drop trigger if exists %I on %I', t || '_notify', t);
      end loop;
    end $$;

    drop function if exists notify_sync cascade;
    drop table if exists devices cascade;
    drop table if exists sources cascade;
    drop table if exists chapter_progress cascade;
    drop table if exists series cascade;
    alter table collections drop column if exists meta;
    alter table reading_sessions drop column if exists kind;
  `);
};
