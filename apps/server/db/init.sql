create extension if not exists citext;
create sequence if not exists sync_seq;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table refresh_tokens (
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

create table books (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  title text, author text, format text,
  file_hash text, file_size bigint, cover_hash text,
  meta jsonb not null default '{}',          -- language, series, publisher, word_count, line_count...
  added_at bigint, last_opened_at bigint,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table progress (                      -- id = book id, one row per book
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  cfi text, percent real, chapter text, device_id text,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table annotations (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  book_id text not null,
  type text not null check (type in ('highlight','note','bookmark')),
  cfi text not null,
  text text, note text,
  color text,                                -- yellow | green | blue | pink | purple | custom hex
  style text,                                -- highlight | underline | strikethrough | squiggly
  chapter text, created_at bigint,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table collections (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  name text not null, sort_order int not null default 0,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table collection_books (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  collection_id text not null, book_id text not null,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table reading_sessions (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  book_id text not null,
  started_at bigint, ended_at bigint, duration_sec int,
  start_percent real, end_percent real, words_read int, device_id text,
  updated_at bigint not null, deleted_at bigint,
  server_seq bigint not null default 0,
  primary key (user_id, id)
);

create table settings (                      -- id = 'default' (or per-device keys)
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
    execute format('create index on %I (user_id, server_seq)', t);
    execute format('create trigger %I before insert or update on %I
                    for each row execute function bump_seq()', t || '_seq', t);
  end loop;
end $$;

create index on annotations (user_id, book_id);