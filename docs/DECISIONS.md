# Architectural Decision Records (ADRs)

This file tracks all significant architecture and design decisions made throughout the project lifecycle.

## Format
- **Date**: YYYY-MM-DD
- **Context**: Problem or requirement being addressed
- **Decision**: The path chosen and reasoning
- **Consequences**: Trade-offs, constraints, or impacts

---

## 2026-10-13: Workspace Restructuring and Monorepo Setup (P0)
- **Context**: Folio was originally a split setup with a Vite frontend in `FE/reader-app` and Fastify backend in `Backend/api`.
- **Decision**: Consolidated into a pnpm monorepo with `apps/client`, `apps/server`, and `packages/shared`. Foliate-js vendored as a git submodule in `apps/client/vendor/foliate-js`.
- **Consequences**: Standardized dependencies, unified scripts for typecheck/lint/test/build across packages, and shared Zod contracts between client and server.

## 2026-10-13: Strict Sync Registry with @folio/shared
- **Context**: Sync table structures must be identical between Dexie on client and Postgres on server.
- **Decision**: Created `SYNC_TABLES` registry and Zod schemas in `@folio/shared/src/sync-schema.ts`. Both client and server import from this shared library.
- **Consequences**: Any schema evolution requires versioning in Dexie and node-pg-migrate migrations on the server.

## 2026-10-13: Supabase as a supported database host
- **Context**: The database needed to move to Supabase. Supabase only accepts TLS (with a private CA that node-postgres rejects under its default `sslmode=require` semantics), its transaction pooler breaks `LISTEN/NOTIFY`, it has tight connection limits, and it exposes every `public` table through a REST API keyed by a public anon key. Separately, `db/init.sql` (what Docker used to create the schema) had drifted: it only contained migration 001, so Docker deployments never got the manga/sources/devices tables or the sync NOTIFY triggers.
- **Decision**: `src/db.ts` builds the pool config from env (auto-TLS for Supabase hosts, optional `DATABASE_CA_CERT` for full verification, `sslmode` stripped from the URL so it can't override it, idle-client error handler, keepalives). Live-sync SSE streams share one dedicated `LISTEN` connection (`src/notify.ts`) instead of each holding a pooled client, with reconnect + re-LISTEN. Migration 003 enables RLS (no policies) and revokes `anon`/`authenticated`. Migrations are now the only schema source: `init.sql` is removed and the API runs them on start (`MIGRATE_ON_START`). `db:check` verifies a deployment end to end. Session pooler (5432) is the documented connection.
- **Consequences**: Docker and Supabase deployments share one code path. Live sync no longer consumes a pool connection per open device. Book files still live on the API host (`FILES_DIR`); moving them to Supabase Storage would be a separate change. No synced-schema columns changed, so no Dexie version bump was needed.

## 2026-10-13: Desktop performance and layout fixes
- **Context**: The desktop app felt slow. Contributing causes: the title bar polled `isMaximized()` over IPC every 500 ms; a full-window `blur(90px)` ambient backdrop plus `backdrop-filter` on sticky chrome re-rasterised on every scroll; `http:default` had no URL scope, so every native request was rejected and `netFetch` waited through its exponential-backoff retries; `fs:default` is read-only, so the desktop blob store always failed over to IndexedDB; dependencies were unoptimised in `tauri dev`. Separately, eleven CSS variables (`--surface-*`, `--text-primary`, `--border-subtle`…) were used ~140 times but never defined, Tailwind v4's `currentColor` border default produced white borders, and several pages had broken scroll and width containers.
- **Decision**: Event-driven `onResized`; ambient cover pre-blurred once into a 36×54 canvas and GPU-upscaled; sticky chrome uses a near-opaque `--chrome` fill (`chrome-surface` utility) instead of backdrop blur; HTTP scope `http(s)://*`, app-data write scope, window-control permissions; `[profile.dev.package."*"] opt-level = 3` and an LTO release profile. Undefined tokens aliased in `tokens.css`; v3-style border default restored; `overflow-wrap: break-word` on body. Store, SeriesDetail and MangaReader loads use a request ticket so a slow earlier response can't overwrite a newer one. Cover object URLs are shared/ref-counted and only loaded near the viewport.
- **Consequences**: Chrome surfaces no longer blur what scrolls beneath them (they are ~88% opaque instead). The HTTP scope is broad because users add arbitrary OPDS catalogs and self-hosted servers.


## 2026-10-14: Sync integrity audit
- **Context**: Devices drifted out of sync and didn't recover even after wiping the server database and R2 bucket; deleting an account didn't remove the data from other devices; a book could hang on "Opening book…".
- **Decision**:
  - Sync bookkeeping (cursor, files known to be on the server) is scoped to server URL + account + a server `instance_id` (migration 004). A changed scope resets the cursor and re-queues every row for upload without touching `updated_at`.
  - The client reconciles its book/cover files against `GET /files` every 10 minutes, so a wiped bucket is refilled from any device that still has the files.
  - Push serialises each user's writes with an advisory lock (sequence numbers are taken before commit, so concurrent pushes could make a pull skip rows) and returns the winning server copy of rejected rows, which the client applies.
  - Account deletion writes a `deleted_users` tombstone. Requests with still-valid tokens, or refreshes carrying the user id hint, get `code: account_deleted`, and those devices wipe their local copy.
  - Downloads are verified against their hash; the reader time-limits each opening step, falls back to the start of the book when a saved position can't be restored, and offers re-downloading.
  - The Render image runs migrations on start (`MIGRATE_ON_START=true`).
- **Consequences**: After this update, every device does one full re-push (timestamps preserved, so the server keeps the newer copy of each row). Covers now sync; they were uploaded and downloaded under the wrong key before.
