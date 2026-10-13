# Folio QA Checklist

Use this checklist to verify build quality, UI consistency, and regression safety across phases.

## Phase Verification Baseline
- [ ] Clean install succeeds: `pnpm i`
- [ ] Typecheck passes across all packages: `pnpm -r typecheck`
- [ ] Lint passes across all packages: `pnpm -r lint`
- [ ] Unit tests pass: `pnpm -r test`
- [ ] Builds succeed: `pnpm -r build`

## Client Smoke Test (Manual / Automated)
- [ ] Book Import: Local EPUB file can be dropped or opened via file picker
- [ ] Library Display: Book card/cover renders correctly with title and author
- [ ] Reader Navigation: Opening a book renders reader view, page turns work (keyboard, arrows, wheel)
- [ ] Annotations: Text selection brings up popover, highlights save in 6 colors
- [ ] Bookmarks & Notes: Can add notes and bookmarks, visible in side panels and Notebook page
- [ ] Theme Switching: Light and Dark themes apply cleanly with zero unstyled flickers
- [ ] Responsive Layout: Verified on desktop (≥900px) and phone (390px) viewports
- [ ] Offline Capability: Reader and local library operate fully without network connectivity

## Accessibility & Performance
- [ ] Keyboard Navigation: All buttons, menus, and controls navigable via Tab / Shift+Tab / Enter / Space
- [ ] Axe DevTools / Automated A11y: Zero critical or serious accessibility violations
- [ ] Performance: Smooth 60fps scrolling in library and page transitions in reader
