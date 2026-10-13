# Folio — agent guide

## Commands
- Install: `pnpm i`
- Dev (client): `pnpm --filter client dev` → http://localhost:5173
- Dev (server + db): `pnpm dev:server` → http://localhost:8080
- Typecheck all: `pnpm -r typecheck`
- Lint: `pnpm -r lint`
- Unit tests: `pnpm -r test`
- E2E: `pnpm e2e`
- Tauri desktop: `pnpm --filter client tauri dev`

## Rules
1. Follow BUILD_PLAN.md phase by phase. Do not start a phase until the previous one's acceptance criteria pass.
2. Synced schema lives in packages/shared/src/sync-schema.ts. Any change needs a Dexie version bump AND a server migration AND tests.
3. Styling: only design tokens (CSS variables / Tailwind theme). No raw hex colours outside design/tokens.css.
4. Components: use design/components. Need a new primitive? Add it there with all states and a demo on /dev/components.
5. Never use dangerouslySetInnerHTML. Render external HTML with lib/safeHtml (DOMParser → React nodes).
6. All network calls go through lib/net.ts (rate limits, proxy, native HTTP).
7. All writes to synced tables go through lib/db helpers that set updated_at (clock-offset aware) and _dirty = 1.
8. Every user-visible string goes through i18n `t()` (from P12 on; add keys as you go).
9. Commit after each task: `P<phase>.<task>: <summary>`. Keep PR-sized changes.
10. When reality differs from the plan, write it in docs/DECISIONS.md with date, context, decision.

## Definition of done (per task)
- Typecheck, lint, tests green
- Works in dark + light theme, desktop + 390px phone width
- Keyboard accessible
- No console errors or React warnings
