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
