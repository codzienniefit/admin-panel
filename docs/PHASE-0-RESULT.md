# Phase 0 result

2026-11-10. Covers Phase 0 of [PLAN.md §7](PLAN.md) plus the design work asked for while it was being
built (top menu, colour tones, searchable dropdown, environment selector, components page, error
screen).

## Verdict on the spike: go with TanStack DB

The gate was one challenge with nested days in a collection, a debounced autosave, undo, and a
forced conflict, end to end on the mock. It holds. All of it is covered by an automated test
(`src/features/spike/plannerSession.test.ts`, 8 cases) and was clicked through in a browser.

| Case | Result |
|---|---|
| An edit shows at once and is saved after a 1.2 s pause | works |
| Three quick edits | one save |
| Undo and redo | go through the same save path |
| A second edit to the same day while the first save is in flight | both kept |
| Someone else changed another field | merged silently, their change kept |
| Someone else changed the same day | save stops, my edit is held, I choose |
| The save keeps failing | three tries, then my edit is held and can be retried |
| A field the panel has no schema for | survives every one of the above |
| A workout renamed elsewhere | every cell showing it changes at once |

## What TanStack DB does not do, and what was built around it

These are the findings that matter for the phases ahead. All of it lives in one file,
`src/data/collections/saver.ts`, shared by every entity type.

1. **It rolls optimistic changes back when a save fails.** For an editor that means the user's work
   disappears from the screen. The saver keeps the edits ("held edits") and offers retry or discard.
2. **It has no conflict handling.** The saver does a three-way merge on every save
   (`src/domain/rebase.ts`): what is sent is the latest server version with only this user's changes
   on top. This one mechanism gives both things asked for earlier: unknown fields are never wiped,
   and a stale copy never overwrites someone else's change.
3. **A query collection does not refresh itself after a write.** The saver writes the server's
   response straight into the collection, so there is no refetch after a save.
4. **Rollback cascades** to later edits of the same item that are still waiting. The saver captures
   what is on screen at the moment a save stops, so those are held too.
5. **Joins do not reach inside nested lists.** "Which workout is in this day" cannot be written as a
   query-builder join because days are nested inside the challenge. The spike uses a lookup map
   built from the workouts query; it is still one copy of each workout and updates live.
6. **Hot reload in development** recreates a collection while screens still hold the old one, which
   throws. Data modules now reload the page on a hot update instead. This cannot happen in a
   deployed build.

## What was built

- **Stack**: Vite 8 single-page app on Cloudflare Workers assets, TanStack Router (file routes, code
  split per route), TanStack DB on TanStack Query, Zod 4, Tailwind 4, React 19 with the React
  Compiler, TypeScript 7 strict, Vitest, Biome. The React Router starter is gone.
- **`npm run check`**: typecheck, lint, 31 tests, production build. All pass.
- **Data layer**: the `ApiClient` interface, the in-process mock with latency, failure and
  conflict switches, loose schemas, collections for challenges and workouts, the saver.
- **Environment selector** in the top bar: Test (sample data, everything enabled) and Produkcja
  (listed, not selectable yet).
- **Design system**:
  - tokens from Patryk's app in `src/styles/app.css`
  - ten colour tones, with one place (`src/ui/enums.ts`) deciding which status, training type and
    level gets which tone
  - shared components in `src/ui/`: Button, Tag, StatusBadge, Select, Notice, SaveStatusText,
    WorkoutChip, Skeleton, ErrorScreen
  - **Select** is the one dropdown: tap, a scrollable list of all options, type to filter (also
    without Polish characters), keyboard and touch handled by Base UI
- **Pages**: `/` challenges, `/spike` the planner test screen, `/design` every component in every
  state.
- **Error screen**: any render error shows a calm themed message with "Spróbuj ponownie" and
  "Odśwież stronę"; the raw error is under "Szczegóły techniczne" in small print, with a copy
  button.

## Numbers

| | |
|---|---|
| JavaScript, gzipped | about 270 kB: 142 kB app shell (React, router, Zod, Base UI, mock) + 128 kB TanStack DB |
| CSS, gzipped | 6.5 kB |
| Tests | 31, under a second |

TanStack DB is close to half the JavaScript. It loads with the first screen that reads data, which
is every screen. Worth watching against the bundle budget; not a reason to change course.

## Not done, or not verified

- **Deployment was not exercised.** I do not push. `wrangler.json` is set up for a static app with
  `/api/*` going to the Worker, but the first real check is your push. After it, please look at:
  1. the Cloudflare URL opens the challenges page with three cards
  2. a deep link such as `/design` opens directly (the single-page fallback)
  3. `/api/health` answers `{"ok":true}`
  4. on a phone: no sideways scrolling, the top menu scrolls
- **Browser checks were done in a preview pane** whose screenshots lagged behind the page, so
  several results above were confirmed by reading the page, not by eye. Typed input into the
  dropdown's search box was confirmed with the browser's own text-insertion path; the automation
  tool's keystrokes did not reach it.
- **Playwright** is not set up yet; the conformance suite has only its first six cases.
- **The mock does not keep edits across a reload**, and there is no stress dataset yet. Both belong
  to Phase 2.
- **Undo steps are not merged** when made in quick succession. Phase 5.
- **The planning document** (notes, scratchpad) as a second autosaved document next to the schedule
  was not part of the spike.
- **Lint tool install**: the platform binary of Biome failed to download through npm on this
  machine's connection and was unpacked by hand after checking it against the lockfile checksum.
  A fresh `npm install` elsewhere should not need that.

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| Data source chosen at build time, two deployments | Environment dropdown, one deployment | Asked for during the build |
| shadcn/ui | Base UI used directly, styled with our tokens | Same primitives underneath; fewer moving parts until more components are needed |
| Zustand for planner state | A 30-line store | Enough for undo stacks and save status; add Zustand when it earns its place |
| Mock sign-in in Phase 1 | unchanged | Firebase stays after all of stage 1 |
