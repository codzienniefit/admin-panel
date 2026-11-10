# Front-end stack options

Researched 2026-11-10. Nothing below was built or benchmarked for this project; release facts come
from the projects' own announcements (links at the end), the fit assessment is mine.

## What the stack has to be good at

Taken from the brief and from what the three audits found:

1. **One copy of every entity.** Patryk's app keeps full snapshots of a plan in several places and
   re-syncs them by hand with four near-identical handlers and 23 refs in one component. That is the
   class of bug to design out: a workout renamed in one screen must change in the planner cell, the
   badge form and the calendar without anyone writing code to make it so.
2. **Shareable links.** Filters, the calendar month, the open challenge, variant and day live in the
   URL, typed and validated.
3. **Fast, with good loading states.** Skeletons that match the layout, no flash for fast responses,
   instant navigation between screens already visited.
4. **A heavy editor next to plain CRUD.** Five Retool tabs are forms and tables. The planner is a
   drag-and-drop document editor with undo, autosave and conflict handling.
5. **Mock first, real API last.** The same UI must run on an in-process fake and on HTTP.
6. **A backend that is not REST-shaped.** Whole-entity upsert by POST, no delete, lists that return
   everything, custom actions (publish, archive, promote).
7. **Small data.** Dozens of challenges, hundreds of workouts and media files, a handful of admins.
   Whole lists fit in memory, which makes client-side search, sort and joins viable.

## Where the ecosystem is (November 2026)

| Piece              | Status                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React Router       | v8 since June 2026: middleware and the Vite Environment API are defaults, ESM-only, yearly majors. Server Components still unstable. The repo's scaffold is v7.9 framework mode with SSR                                                                           |
| TanStack Start     | 1.0 stable since 13 October 2026. Selective SSR per route, typed server functions, Cloudflare path. Reported (in third-party upgrade notes, not checked by me) to require Vite 8 and to have had a critical XSS advisory in server-function responses, since fixed |
| TanStack Router    | The router under Start; usable alone as a Vite SPA router. Typed, validated search params                                                                                                                                                                          |
| TanStack Query     | The default for server state; everything else here builds on it                                                                                                                                                                                                    |
| TanStack DB        | **1.0 RC1 on 29 October 2026**; the team calls the API production-ready and stable, no date for the final 1.0. Typed collections filled by TanStack Query from a REST API, live queries with joins, optimistic mutations with automatic rollback                   |
| React Compiler     | 1.0 stable; automatic memoisation, which removes most `useMemo`/`useCallback`/stale-closure handwork                                                                                                                                                               |
| shadcn/ui          | Defaults to Base UI primitives since July 2026; Radix still supported                                                                                                                                                                                              |
| Refine             | v5, headless CRUD framework on TanStack Query v5, with a shadcn/ui integration                                                                                                                                                                                     |
| Cloudflare Workers | Static assets with SPA fallback (`not_found_handling: "single-page-application"`) and `run_worker_first: ["/api/*"]` so only API paths invoke the Worker                                                                                                           |

## The options

### Option A. React Router 8 + TanStack Query (the conservative one)

Keep the scaffold's router, upgrade it to v8, switch it to SPA mode. Server data lives in the
TanStack Query cache; route `clientLoader`s prefetch it; mutations invalidate or patch it.

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **For**     | Lowest risk: both libraries are the most used in their category and long stable. The scaffold already is this, so nothing is thrown away. Most documentation, most people who know it, best support from coding agents                                                                                                                                                                                                                                                                                        |
| **Against** | The Query cache stores **responses**, not entities. A challenge lives in the list response and again in its detail response; a workout title is copied into every screen that fetched it. Keeping them in step is invalidation discipline: correct if you always invalidate broadly (at the cost of refetches), a source of stale-screen bugs when someone forgets. Optimistic updates are written by hand per mutation (snapshot, patch, roll back). Search params are untyped strings; validation is manual |
| **Fit**     | Good for the CRUD tabs. For the planner, cross-entity derived views (workout shown in a cell, "used by" lists, the calendar) are hand-written selectors over several queries                                                                                                                                                                                                                                                                                                                                  |

### Option B. TanStack Router + Query + DB (the declarative one) — recommended

A plain Vite SPA. TanStack Router for routes and URL state. Each backend entity type is a TanStack DB
**collection**, filled by a TanStack Query fetch. Screens read through **live queries**; writes go
through the collection.

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **For**     | **One copy of every entity, by construction.** List, detail, planner cell and select option are all queries over the same collection, so an edit shows everywhere at once, including while it is still being saved. Joins are declared (`challenge.days → workouts`, `badge → assigned challenges`, "which challenges use this workout"), not maintained. Optimistic updates and rollback on failure are built in, not hand-written. With small data loaded whole, search, sort and filter are instant and need no loading state. The router gives typed, validated search params (requirement 2) and per-route pending components with a delay and a minimum display time (requirement 3). It sits on TanStack Query, so the fetch and save functions are the same ones Option A would use |
| **Against** | **TanStack DB is a release candidate**, two weeks old as RC, with few production references. API churn before the final 1.0 is possible. Fewer people know it; fewer examples. Replaces the scaffold's router (the scaffold is still the untouched starter, so the cost is an hour). Conflict handling (our etag 409s) is ours to write inside the save handlers; DB does not solve it. Debounced autosave of a nested document through a collection needs a proof before we rely on it                                                                                                                                                                                                                                                                                                     |
| **Fit**     | Best match for requirements 1, 2, 3 and 7. The planner is the part that benefits most                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**How the risk is contained.** All network code sits behind one `ApiClient` interface (mock and HTTP
adapters). Collections are a thin layer over it. If DB disappoints, the fallback is Option A's data
layer: same adapters, same query functions, hooks rewritten to `useQuery`. Phase 0 includes a one-day
spike on the hardest case (planner autosave of a nested challenge with debounce, undo and a 409)
before anything else is built on it.

### Option C. Refine v5 (the admin-framework one)

A headless CRUD framework: you implement a data provider and an auth provider, declare resources, and
get list, create and edit plumbing, access control hooks and routing glue. UI via its shadcn/ui
integration. Built on TanStack Query.

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **For**     | The five Retool tabs would come together fastest. Auth provider, permission checks and notification plumbing are solved patterns. Mature (v5), MIT core                                                                                                                                                                                                                                                                                                       |
| **Against** | The planner, the block editor and the calendar get nothing from it, and they are the larger half of the work. The backend is not resource-shaped (upsert by POST, no delete, lists without paging, action endpoints), so the data provider is mostly custom methods. It is still the Query cache underneath, so the "two copies" problem of Option A remains. One more abstraction to learn and to work around when a screen does not fit the list/edit mould |
| **Fit**     | Pays off at thirty similar entities. Here there are six, plus one bespoke editor                                                                                                                                                                                                                                                                                                                                                                              |

### Option D. A full-stack framework (TanStack Start with server functions, or Next.js)

Render on the Worker, call the backend from typed server functions that hold the secrets.

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **For**     | Secrets and the backend URL never reach the browser. Typed end-to-end calls. One place for auth middleware                                                                                                                                                                                                                                                                                                                                                   |
| **Against** | Every screen is behind sign-in and Firebase keeps the token in the browser, so server rendering has nothing to render; to use it you would add a cookie session exchange for no visible gain. Start 1.0 is four weeks old and is reported to need Vite 8 and to have already had a critical advisory. Next.js on Cloudflare runs through an adapter and is built around Server Components, which this app does not need. Slower navigation than a cached SPA |
| **Fit**     | Wrong shape for an authenticated internal tool with a separate backend. A small Worker for `/api/*` gives the useful part (secrets, same origin) without it                                                                                                                                                                                                                                                                                                  |

### Comparison

|                            | A. RR8 + Query | B. TS Router + Query + DB | C. Refine         | D. Full-stack     |
| -------------------------- | -------------- | ------------------------- | ----------------- | ----------------- |
| One copy of each entity    | by discipline  | **by construction**       | by discipline     | by discipline     |
| Optimistic UI and rollback | hand-written   | **built in**              | partly built in   | hand-written      |
| Typed URL state            | manual         | **built in**              | manual            | built in (Start)  |
| Maturity                   | **highest**    | DB is RC                  | high              | Start is new      |
| CRUD tabs speed            | good           | good                      | **best**          | good              |
| Planner fit                | fair           | **best**                  | fair              | fair              |
| Easy to change later       | good           | good (falls back to A)    | framework lock-in | framework lock-in |
| Fits Cloudflare as-is      | yes            | yes                       | yes               | needs setup       |

## The rest of the stack (same for A and B)

| Layer                 | Choice                                                                                                                                      | Alternatives considered                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                 | Vite + `@cloudflare/vite-plugin`; static SPA plus a small Worker for `/api/*`                                                               | SSR on the Worker (nothing to render before sign-in)                                                                                                                         |
| Language              | TypeScript strict; React 19 with the **React Compiler** on                                                                                  |                                                                                                                                                                              |
| Contracts             | **Zod** schemas as the single source of types; API responses parsed at the adapter boundary in dev and in the mock                          | Types only (drift from the backend goes unnoticed); generated OpenAPI client (the backend has no spec)                                                                       |
| Planner working state | A small **Zustand** store with undo history (`zundo`), holding ids and pending edits only                                                   | Redux Toolkit (more ceremony), XState (good for flows, heavy for a document)                                                                                                 |
| Forms                 | **React Hook Form + Zod**                                                                                                                   | TanStack Form (fine; smaller ecosystem of ready inputs)                                                                                                                      |
| UI kit                | **shadcn/ui** on Base UI with Tailwind 4 tokens taken from Patryk's app                                                                     | Mantine (more batteries, harder to match the look exactly); React Aria Components (best touch and a11y, most styling work); MUI or Ant Design (their look fights the sample) |
| Tables and long lists | TanStack Table + TanStack Virtual                                                                                                           | AG Grid (overkill)                                                                                                                                                           |
| Drag and drop         | **dnd-kit** (pointer and touch sensors, keyboard)                                                                                           | native HTML5 DnD (no touch, the sample's problem); Pragmatic DnD (HTML5 underneath)                                                                                          |
| Search                | Fuse.js with the synonym table from Patryk's app                                                                                            | server search (not needed at this size)                                                                                                                                      |
| Auth                  | Firebase Web SDK in the browser; the **backend** verifies the token and the `admin` claim; the Worker verifies it too for its own endpoints | Cloudflare Access in front as an extra gate (optional hardening); cookie sessions (only needed for SSR)                                                                      |
| Tests                 | Vitest for domain logic and adapter conformance; Playwright smoke on the mock build                                                         |                                                                                                                                                                              |
| Lint and format       | Biome, or ESLint with the React Compiler rules                                                                                              |                                                                                                                                                                              |

## Decision

**Option B was chosen on 2026-11-10.** The Phase 0 spike remains the gate; Option A is the fallback.

## Recommendation

**Option B**, with the Phase 0 spike as the gate. It is the only option where the property you asked
for, state that cannot drift between screens, comes from the structure and not from care. Its one real
risk is the maturity of TanStack DB, and that risk has a cheap, defined exit to Option A.

Choose **Option A** if a release candidate in the data layer is not acceptable; everything else in the
plan stays the same and the data layer section changes to query-cache conventions.

## Sources

- [React Router v8 announcement](https://remix.run/blog/react-router-v8) and [changelog](https://reactrouter.com/changelog.md)
- [TanStack Start 1.0 is Stable](https://tanstack.com/blog/tanstack-start-1-0)
- [TanStack Start comparison with React Router and Next.js](https://tanstack.com/start/latest/docs/framework/react/comparison)
- [TanStack DB 1.0 RC1](https://tanstack.com/blog/tanstack-db-1.0-rc1-going-all-in-on-oracles) and [overview docs](https://tanstack.com/db/latest/docs/overview.md)
- [Cloudflare Workers: single-page application routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) and [React SPA with an API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Refine documentation](https://refine.dev/core/docs/) and [Refine vs React Admin](https://refine.dev/blog/refine-vs-react-admin/)
- [shadcn/ui vs Base UI vs Radix, 2026](https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026)
- [firebase-auth-cloudflare-workers](https://unpkg.com/firebase-auth-cloudflare-workers@2.0.6/README.md) and [Firebase: verify ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
