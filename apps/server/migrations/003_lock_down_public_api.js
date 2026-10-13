/**
 * Migration 003: Lock down tables for hosted Postgres (Supabase)
 *
 * Supabase publishes every table in `public` through its auto-generated REST API
 * to the `anon` and `authenticated` roles, and the anon key is public by design.
 * Without this, anyone holding a project's anon key could read `users` (password
 * hashes) and every user's library. Folio never uses that API: the Fastify server
 * is the only client. So we enable RLS with no policies (deny all) and revoke
 * those roles' privileges, including on tables created by future migrations.
 *
 * The server connects as the tables' owner, which bypasses RLS, so this is a
 * no-op for the app itself and for plain Postgres (Docker) deployments.
 * New tables added later should also `enable row level security`.
 */
export const up = (pgm) => {
  pgm.sql(`
    do $$
    declare
      t text;
      r text;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', t);
      end loop;

      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('revoke all on all tables in schema public from %I', r);
          execute format('revoke all on all sequences in schema public from %I', r);
          execute format('revoke all on all functions in schema public from %I', r);
          execute format('alter default privileges in schema public revoke all on tables from %I', r);
          execute format('alter default privileges in schema public revoke all on sequences from %I', r);
          execute format('alter default privileges in schema public revoke all on functions from %I', r);
        end if;
      end loop;
    end $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    do $$
    declare
      t text;
      r text;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I disable row level security', t);
      end loop;

      -- Restore Supabase's default grants.
      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('grant all on all tables in schema public to %I', r);
          execute format('grant all on all sequences in schema public to %I', r);
          execute format('grant all on all functions in schema public to %I', r);
          execute format('alter default privileges in schema public grant all on tables to %I', r);
          execute format('alter default privileges in schema public grant all on sequences to %I', r);
          execute format('alter default privileges in schema public grant all on functions to %I', r);
        end if;
      end loop;
    end $$;
  `);
};
