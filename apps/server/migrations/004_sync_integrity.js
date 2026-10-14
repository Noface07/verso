/**
 * Migration 004: Sync integrity
 *
 * - server_meta.instance_id: a random id created with the database. Clients key
 *   their sync cursor and uploaded-file cache by it, so restoring, wiping or
 *   replacing the database (or pointing the app at a different server) makes
 *   every client re-push and re-pull instead of silently skipping data because
 *   its cursor is ahead of the new sequence.
 * - deleted_users: tombstones for deleted accounts (id + time only, no personal
 *   data) so other signed-in devices learn the account is gone and wipe their
 *   copy instead of re-uploading it.
 */
export const up = (pgm) => {
  pgm.sql(`
    create table if not exists server_meta (
      id          boolean primary key default true check (id),
      instance_id uuid not null default gen_random_uuid(),
      created_at  timestamptz not null default now()
    );
    insert into server_meta (id) values (true) on conflict (id) do nothing;

    create table if not exists deleted_users (
      id         uuid primary key,
      deleted_at timestamptz not null default now()
    );

    alter table server_meta enable row level security;
    alter table deleted_users enable row level security;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    drop table if exists deleted_users;
    drop table if exists server_meta;
  `);
};
