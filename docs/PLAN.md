# Admin panel plan

Status: Phases 0 to 4 are built (see the `PHASE-N-RESULT.md` files next to this one); everything
after them is still a proposal. Last updated 2026-11-10.

Companion documents:

- [STACK-OPTIONS.md](STACK-OPTIONS.md): the front-end stack options with pros and cons. **Decided
  2026-11-10: Option B** (TanStack Router + Query + DB). §5 says what changes if the Phase 0 spike
  sends us back to Option A.
- [BACKEND-SCOPE.md](BACKEND-SCOPE.md): what the backend must gain, in blocks B0–B5.
- [ROADMAP.md](ROADMAP.md): the order of work, with front end and backend taking turns and a
  deployed check after every step.
- [research/](research/): the three inventories this plan is built on (Retool export, backend audit,
  Patryk's planner app).

---

## 1. What we are building

One web app that replaces two tools:

| Today                                             | What it does                                                                                                                                                                                          | Becomes                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Retool panel**                                  | Content admin on the live backend: workouts, challenges and plans, messages, badges, user lookup                                                                                                      | The content sections of the new panel, same functions                          |
| **Plan Treningowy** (Patryk's local Electron app) | Planning: challenges with several plan variants, a 7-day table per week, a scratchpad, notes, plan requirements with validation, a challenge calendar. Local JSON files, no connection to the backend | The planner inside the new panel, working on real challenges and real workouts |

New on top, from the quote:

- Sign-in with Firebase; only accounts with the admin claim get in.
- **Draft** and **deleted** states for challenges and workouts (today there is only "hidden").
- A workout typed "z palca" in the planner creates a real (draft) workout.
- The raw-JSON content fields are replaced by the block editor from the prototype.
- New data models for the planning-only functions (notes, requirements, scratchpad).

Constraints from the brief: React; hosted on Cloudflare, deployed on push; looks like Patryk's app;
usable on a phone; fast, with skeleton loading; built in phases on mock data with no network
requests, with real sign-in and the real API only at the end.

## 2. What the research found

Details and evidence are in [research/](research/). The findings that shape the plan:

**Retool** ([inventory](research/retool-inventory.md))

- Five tabs, 20 backend endpoints, no URL state, no delete, no environments.
- Several things in it are broken and should not be ported: the save-conflict guard saves anyway,
  the badge end date is written under a field name the backend ignores, badge saves wipe section
  fields.
- Offers, user search, granting a badge to a user and message unsend are **not** in Retool although
  the backend has endpoints for them.

**Backend** ([audit](research/backend-audit.md), [scope](BACKEND-SCOPE.md))

- The admin API accepts one credential in practice: the Function App master key. It cannot be put
  in a browser. The Firebase admin-claim path exists in code but cannot pass.
- A browser on another origin cannot call the API at all today (no CORS).
- "Hidden" only hides from lists. Hidden challenges and workouts are served by id to anyone.
- No delete, no draft, no conflict detection, no planning storage. Validation errors arrive as
  HTTP 500 with one joined string.
- A save replaces the whole row, and a field missing from the request is written as empty. A panel
  that predates a field therefore wipes it on every save.

**Patryk's app** ([inventory](research/planner-app-inventory.md))

- Its data model is not the backend's: free-text plans with embedded copies of YouTube videos, weeks
  of seven days, numeric ids. §3 maps one onto the other.
- No design tokens; about 5,700 lines of hard-coded CSS in an Apple-like style. The palette is
  extracted in the inventory.
- Not usable on a phone as built: HTML5 drag and drop (no touch), actions only in right-click menus,
  a 7-column grid with a 1000 px minimum window.
- Its state handling is the cautionary example: plan snapshots kept in several places and re-synced
  by hand.

**This repo**

- React Router 7.9 starter with SSR on Cloudflare Workers, Tailwind 4, React 19. No app code.

## 3. Product model

The panel has one model. The backend's challenge is the entity; the planner's concepts attach to it.

```
Challenge  C{n}                                   status: draft | published | hidden | deleted
 ├─ content     title, subtitle, description blocks, image, dates, access (pro, entitlements,
 │              offerings), goals, difficulty levels, category, badges, recommended next
 ├─ variants[]  = backend "paths" = Patryk's "plans"
 │    ├─ pathId (stable, new), levelId (from config), workouts per week, min days, description, pro
 │    └─ days[]  { dayIndex 1..N, workoutIds[] }        shown as weeks × 7
 └─ planning    (panel-only document)
      ├─ calendar colour, internal note, folder, scratchpad (workout ids)
      ├─ requirement overrides, challenge-only plan types
      └─ per variant: plan type, preparation status + "what is missing", planning notes,
                      per day: note, tint; per placed workout: note, card colour

Workout  W{n} or YouTube id                       status: draft | published | hidden | deleted
 └─ content + recording status, format (premiere / live / running)
```

### Mapping Patryk's model onto it

| Patryk's app                               | New panel                                                 | Note                                                                  |
| ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Challenge name                             | `title` (+ `subtitle`)                                    |                                                                       |
| `weeksCount`                               | `lengthDays`                                              | The table shows `ceil(lengthDays / 7)` weeks; the last may be partial |
| `startDate`                                | `liveAtUtc` for a live challenge                          | Plans have no start date; see decision 4                              |
| Plan (variant)                             | path                                                      | Identified by `levelId` today; needs a stable id (backend B3.3)       |
| Plan type and its conditions               | planning: plan type per variant; types in settings        | Rules ported as they are; validated in the panel                      |
| Plan status, "czego brakuje"               | planning: preparation status per variant                  | Separate from the challenge's publication status                      |
| Week → day → trainings                     | `days[dayIndex].workoutIds`                               | `dayIndex = week × 7 + day + 1`                                       |
| Training from the YouTube library          | reference to a workout in the catalogue                   | No copies; a renamed workout changes everywhere                       |
| Training "z palca"                         | a **draft workout**                                       | Backend B1.2                                                          |
| Training types (colour, emoji)             | `workoutsConfig.trainingTypes` + style in settings        |                                                                       |
| Wideo / Audio / Rozpiska                   | derived from the workout (video URL, audio file, neither) |                                                                       |
| Recording status, format                   | fields on the workout                                     | Backend B3.4                                                          |
| Day note, day tint, card colour, card note | planning document                                         |                                                                       |
| Scratchpad                                 | planning document, list of workout ids                    | Shared by all variants, as today                                      |
| Folders, calendar colour, internal note    | planning document / settings                              |                                                                       |
| Description with "Napisz z AI"             | description blocks; AI through the Worker                 | Last phase, needs a server-side key                                   |
| YouTube library search (Fuse + synonyms)   | search over the workout catalogue, same engine            |                                                                       |
| `Workouts.csv` id mapping                  | not needed, ids are real                                  | Used once, to import his existing plans                               |
| CSV export                                 | kept                                                      |                                                                       |
| `.ptchallenge.json` import/export          | one-off import of existing local plans as drafts          | Last phase                                                            |

Rules that differ and need a decision are listed in §9 (for example Retool allows three workouts a
day, the planner has no limit, and the backend forbids the same workout twice in one day).

## 4. Pages and routes

Every screen has a URL; filters and view state are typed search params, so any view can be shared.
Route names are English, labels are Polish (decision 8).

| Route                                                    | Screen                                                                                       | From                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| `/login`                                                 | Sign-in                                                                                      | new                        |
| `/forbidden`                                             | "Brak dostępu": signed in, not an admin                                                      | new                        |
| `/`                                                      | redirects to `/challenges`                                                                   |                            |
| `/challenges?status=&type=&folder=&q=`                   | Challenges and plans: cards or table, status and type filters, folders                       | Retool + planner           |
| `/challenges/calendar?view=month\|year&y=&m=`            | Challenge calendar with coloured bars, "Bez daty" list                                       | planner                    |
| `/challenges/new`                                        | New challenge (starts as a draft)                                                            | both                       |
| `/challenges/$id`                                        | Challenge overview: status and actions, variants with preparation status, key facts          | planner                    |
| `/challenges/$id/content`                                | Content form: all Retool fields, access, dates, badges, description blocks, recommended next | Retool                     |
| `/challenges/$id/plan/$pathId?week=&day=`                | **Planner**: 7-day table, scratchpad, notes, requirements                                    | planner                    |
| `/challenges/$id/requirements`                           | Requirement overrides and challenge-only plan types                                          | planner                    |
| `/workouts?status=&type=&level=&q=`                      | Workout catalogue                                                                            | Retool                     |
| `/workouts/new`, `/workouts/$id`                         | Workout form                                                                                 | Retool                     |
| `/media?folder=&type=`                                   | Media library: images and audio, upload                                                      | Retool (was inside modals) |
| `/messages`, `/messages/new`, `/messages/$id`            | Messages: draft, preview, send, archive                                                      | Retool                     |
| `/badges`, `/badges/new`, `/badges/$id`                  | Badges                                                                                       | Retool                     |
| `/users?q=`, `/users/$uid?tab=badges\|progress\|account` | User lookup, badges, progress, e-mail                                                        | Retool (+ search)          |
| `/offers`, `/offers/$id`                                 | Special offers                                                                               | optional, backend ready    |
| `/settings/plan-types`, `/training-types`, `/folders`    | Planner settings                                                                             | planner                    |
| `/settings/admins`                                       | Who has admin access                                                                         | new, needs backend B0.5    |

Behaviour:

- **Promoted challenge** is a control on the challenges list, as in Retool.
- **List and detail.** On desktop a detail route opens over its list (the list stays mounted and
  scrolled). On a phone it is a full page.
- **Open variants as tabs.** The planner's tab bar becomes a "recently opened" strip that remembers
  ids only; the URL decides what is shown.
- **Trash.** Deleted items are reachable with `status=deleted` and can be restored.

## 5. Stack

Decided (Option B in [STACK-OPTIONS.md](STACK-OPTIONS.md)):

| Layer                      | Choice                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ |
| Build and hosting          | Vite SPA on Cloudflare Workers static assets; a small Worker for `/api/*`      |
| Routing and URL state      | TanStack Router                                                                |
| Server data                | TanStack Query for fetching, TanStack DB collections and live queries on top   |
| Editor state               | Zustand store with undo history, planner only                                  |
| Forms and contracts        | React Hook Form + Zod; Zod schemas are the source of all entity types          |
| UI                         | shadcn/ui (Base UI) on Tailwind 4, tokens from Patryk's app                    |
| Tables, lists, DnD, search | TanStack Table and Virtual, dnd-kit, Fuse.js                                   |
| Auth                       | Firebase Web SDK behind an `AuthProvider` interface                            |
| Language and tooling       | TypeScript strict, React 19 with the React Compiler, Vitest, Playwright, Biome |

**Fallback if the Phase 0 spike fails** (Option A: TanStack Query without DB): §6.2 changes from
collections to query-cache conventions (one list query per entity type with detail views derived
from it, shared selector hooks for joins, one helper for optimistic update and rollback). Pages,
model, mock, auth, design and phases stay as written.

## 6. Architecture

### 6.1 Layers

```
routes/        URL → screen. Search-param schemas, guards, preload. No data logic.
features/      One folder per area (challenges, planner, workouts, media, messages, badges, users,
               content-editor, settings). Components, forms, live queries.
domain/        Pure TypeScript, no React, no I/O: requirement validation, weeks ↔ days mapping,
               content-block validation, calendar lanes, date rules, CSV export. Unit-tested.
data/
  schemas/     Zod schemas = entity types.
  collections/ One collection per entity type. The only place screens read from and write to.
  api/         ApiClient interface + two adapters: mock/ (in-process) and http/ (fetch).
auth/          AuthProvider interface + mock and Firebase implementations, session, guard.
ui/            Design tokens, shared components, skeletons.
worker/        /api/* forwarding and the few endpoints that need a secret.
```

Dependencies point one way: routes → features → collections → api. `domain/` depends on nothing.
Screens never call `fetch` and never see which adapter is active.

### 6.2 Data flow

**One copy of each entity.** Every backend entity type is a collection keyed by id: `challenges`,
`workouts`, `badges`, `messages`, `offers`, `media`, `planning`, `settings`, plus the two config
documents. A collection is filled by one TanStack Query fetch through the `ApiClient`.

**Screens read with live queries.** A list, a detail form, a planner cell and a select option are
all queries over the same collections. Examples of what becomes a declaration rather than code to
keep in sync:

- planner cell: the day's `workoutIds` joined to `workouts` for title, duration, types, image
- workout page: "used in" = challenges whose days contain this id
- badge page: assigned workouts and challenges
- calendar: challenges with a date, coloured by planning data
- status filters and search over whole lists, instantly, with no loading state

**Screens write through the collection.** `collection.update(id, draft => …)` shows at once
everywhere; the collection's handler calls the `ApiClient`; a failure rolls the change back and
raises a toast. No screen holds its own copy of server data. The two exceptions are form state
(until submit) and the planner's undo history (§6.6).

**Loading whole lists.** At this size (dozens of challenges, hundreds of workouts) lists are loaded
once and kept. Challenges load as summaries; the full challenge with its days loads when opened
(backend B2.4; until then the full list is loaded, as Retool does).

**Errors are typed.** The adapters throw one `ApiError` with a `kind`: `validation` (with field
issues), `conflict` (with the current server version), `unauthorized`, `forbidden`, `notFound`,
`network`, `server`. Handling is central: validation maps onto form fields, conflict opens the
conflict dialog (§6.7), unauthorized refreshes the token once and then signs out.

**Contracts are checked.** Every response is parsed with its Zod schema in development and in the
mock, so drift between panel and backend shows as a named error at the boundary instead of an
`undefined` three screens later. A type-level test compares the schemas with the backend's own
admin DTOs once the DTO package exports them (backend B2.9).

**Fields the panel does not know survive a save.** Today a panel that predates a backend field wipes
it: saves rebuild the payload from form fields and the backend replaces the whole row. The new panel
never rebuilds a payload:

- Schemas are **loose at every level** (challenge, variant, day, content block, metadata): known
  fields are validated, unknown fields are kept as they came.
- A collection holds the object exactly as the server sent it. An edit changes only the fields the
  user touched; a save sends that object back, unknown fields included.
- Forms write changed fields into the object. They never construct one from their inputs.
- Clearing a field sends an explicit `null`. The panel never drops a key to mean "empty".
- Every save carries the etag (§6.7), so a value that changed on the server since load is not
  overwritten with the copy the panel loaded.

This is enforced by a test, not by care: the mock adds a random unknown field to every entity and
every nested object, and the conformance suite fails if any save loses one.

It protects fields the admin API returns. The backend half, which also covers Retool, scripts and
fields the API does not return, is B2.10 in [BACKEND-SCOPE.md](BACKEND-SCOPE.md).

### 6.3 Mock layer

The mock is an **in-process implementation of `ApiClient`**. No service worker, no network.

- **A small in-memory database** seeded from typed fixtures: synthetic but realistic Polish data
  (about 25 challenges and plans with variants and schedules, 150 workouts, 40 badges, 20 messages,
  offers, users, media). No real user data: the mock build is deployed publicly.
- **It implements the target contract**, including what the backend does not have yet: statuses,
  etags and 409s, summary lists, planning documents, field-level validation errors with the
  backend's own Polish messages. The mock is therefore also the executable specification for
  [BACKEND-SCOPE.md](BACKEND-SCOPE.md).
- **It behaves like a backend newer than the panel**: every entity and nested object comes back with
  an extra field the panel has no schema for, and saving must return it unchanged (§6.2).
- **Latency and failure are controllable**: default 150–400 ms per call; a developer menu in the
  mock build sets slow mode, error rate, "next save conflicts", and resets the data. This is how
  skeletons, rollbacks and the conflict dialog get exercised.
- **Edits persist in the browser** (versioned `localStorage` snapshot), so a demo survives a reload.
- **Images and audio are bundled placeholders**, so even media makes no request.
- **Selected in the top bar**: the environment dropdown (`src/data/environment.ts`) decides which
  `ApiClient` is created. "Test" is this mock; "Produkcja" is added with the live slices. Switching
  reloads the page.

One **conformance test suite** runs against any `ApiClient`. It runs on the mock from Phase 2. Against the real backend only its
read-only part runs: there is no staging backend, so no automated test ever writes to it
([ROADMAP.md §4](ROADMAP.md)). Writes are checked by hand on test items.

### 6.4 Transport and deployment

- **Static SPA on Cloudflare**, deployed on push. Assets are served from the edge with SPA fallback;
  only `/api/*` invokes the Worker. (To verify in Phase 0: the exact Vite plugin and `wrangler.json`
  settings for this layout.)
- **Same-origin API (recommended, decision 1).** The browser calls `/api/…` on the panel's own
  origin and the Worker forwards to `api.codzienniefitapp.com` with the user's `Authorization`
  header untouched. No CORS configuration on Azure, no preflight request before every call, and the
  backend still does the authorisation. The alternative is calling the API directly with CORS
  enabled (backend B0.7).
- **Worker-held secrets** for the two things that need them: AI descriptions (OpenRouter) and
  YouTube lookups. Those endpoints verify the Firebase token and the admin claim themselves.
- **Environments.** One deployment, on push, with two environments chosen in the top bar: **Test**
  (sample data in the browser, every function on) and **Produkcja** (the real backend, only what it
  supports so far). Claude never commits or pushes. See [ROADMAP.md §1](ROADMAP.md).

### 6.5 Authentication and authorisation

The rule: **the backend decides**; the panel only reflects the decision.

```
AuthProvider (interface)        signIn · signOut · getToken · session$
 ├─ MockAuthProvider            two demo users: admin, and one without access
 └─ FirebaseAuthProvider        Firebase Web SDK; same project as the mobile app
```

- **Session states:** `loading`, `signedOut`, `forbidden`, `admin`. The guarded layout route reads
  the session before any child route loads: `signedOut` → `/login?redirect=…`, `forbidden` →
  `/forbidden`. Deep links survive the sign-in round trip.
- **The claim.** After sign-in the panel forces a token refresh and reads `admin === true` from the
  token's claims, then confirms with `GET manage/me` (backend B0.6). The client check is for the
  user's benefit; every admin endpoint enforces the claim itself (backend B0.1–B0.2).
- **Tokens.** The adapter asks the provider for a token per request (the SDK refreshes it shortly
  before expiry). A 401 triggers one forced refresh and retry, then sign-out. A 403 moves the
  session to `forbidden`. Nothing is stored by our code.
- **Sign-out** clears every collection and the query cache.
- **Mock phase.** The login screen offers the two demo users, so the forbidden path and the guards
  are real code from Phase 1; Phase 8 swaps the provider and nothing else.
- **Admin accounts** are existing Firebase users with the claim set (backend B0.5). Sign-in methods:
  decision 9.
- **Optional hardening:** multi-factor sign-in for admin accounts; Cloudflare Access in front of
  the panel as a second gate.

### 6.6 The planner

The planner edits two documents of one challenge: the **schedule** (variants and days, part of the
challenge) and the **planning document** (notes, tints, scratchpad, plan types).

- **Working state.** All edits go through the collections, so they show at once. A small store
  keeps what is not server data: the undo and redo stacks (as inverse operations, 50 steps, edits
  within 600 ms merged), the clipboard, the drag in progress, the save status.
- **Stable identity.** Variants by `pathId`, days by `dayIndex`, placements by workout id within a
  day. No array-index addressing, which is where Patryk's app loses and duplicates things.
- **Drag and drop** with dnd-kit: between days, between weeks, to and from the scratchpad
  (scratchpad → day copies, day → scratchpad moves, as today). Works with touch and keyboard. Every
  drag action also exists as a menu action ("Przenieś do…").
- **Requirements** are pure functions from `domain/`, run on the visible weeks and their
  neighbours, shown as the green/red week frame with the ✓/⚠ list, as today.
- **Saving** (decision 2):
  - a **draft** challenge autosaves 1.2 s after the last change, one save in flight at a time
  - a **published or hidden** challenge does not autosave its schedule; changes are staged and
    saved with "Zapisz zmiany", because they reach users at once
  - the planning document always autosaves (it is never public)
  - a visible status: "Zapisano 12:41", "Zapisywanie…", "Niezapisane zmiany", "Błąd zapisu"
  - leaving with unsaved changes asks first; closing the tab flushes with a keep-alive request
- **Fixed on the way**, from the inventory: Cmd+Z inside a text field undoes text, not the plan;
  the scratchpad is part of undo; one notes field per variant; one normaliser for workout defaults.

### 6.7 Status and conflicts

**Status** is shown as a badge everywhere an item appears: Szkic, Opublikowane, Ukryte, Usunięte.

| Action           | From → to                 | Checks                                                |
| ---------------- | ------------------------- | ----------------------------------------------------- |
| Opublikuj        | draft, hidden → published | full validation; no draft or deleted workouts inside  |
| Ukryj            | published → hidden        |                                                       |
| Cofnij do szkicu | hidden → draft            |                                                       |
| Usuń             | any → deleted             | confirm; for a workout, lists the challenges using it |
| Przywróć         | deleted → draft           |                                                       |

A draft can be saved incomplete; problems are listed as "do uzupełnienia przed publikacją".

**Conflicts.** Every entity carries the server's etag. A save with a stale etag returns 409 with the
current version. The panel then takes the server's version and re-applies only the fields this user
changed:

- no field changed on both sides → the save is retried by itself, and a toast says the item was
  updated by someone else in the meantime
- the same field changed on both sides → a dialog shows both values and offers "Wczytaj wersję z
  serwera" or "Nadpisz moimi zmianami"; autosave stops until the user chooses

This replaces Retool's guard, which does not work.

### 6.8 Design system and loading

**Tokens** are CSS variables in the Tailwind 4 theme, taken from Patryk's app:

| Role                         | Value                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Background / surface / hover | `#f5f5f7` / `#ffffff` / `#e8e8ed`                                                           |
| Text / muted                 | `#1d1d1f` / `#86868b`                                                                       |
| Border / input border        | `#e5e5e7` / `#d2d2d7`                                                                       |
| Primary (hover, tint)        | `#0071e3` (`#0077ed`, `rgba(0,113,227,.12)`)                                                |
| Success / danger / warning   | `#34c759` / `#ff3b30` / `#ffd60a`                                                           |
| Radius                       | 10 px controls, 12 px cells and menus, 16 px cards, 20 px dialogs                           |
| Font                         | system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …`), 15 px / 500 body |
| Calendar palette             | the 12 colours in `calendarColors.js`                                                       |

The full token list, shadows, component specs and the recording-status and training-type colours
are in the [planner inventory §5](research/planner-app-inventory.md). The phone preview inside the
content editor keeps the mobile app's own colours, since it imitates the app.

Changed on purpose: dialogs animate in 150–200 ms (the sample takes 0.8–1.2 s); no splash screen
(the sample shows one for a fixed 2.8 s); in-app dialogs and toasts replace the roughly 70 native
`alert` and `confirm` calls.

**Loading rules:**

1. Every route has a skeleton that matches its layout (card grid, table rows, form, week table),
   with a shimmer that respects reduced-motion.
2. A skeleton appears only if loading takes longer than 150 ms and then stays at least 300 ms, so
   fast responses do not flash.
3. Data already loaded is shown immediately and refreshed in the background.
4. Filtering, sorting and searching never show a skeleton; they run on loaded data.
5. Saves are optimistic: the UI changes at once; the save status and toasts report the outcome.
6. Empty and error states are designed, with a retry.

### 6.9 Responsive

Three widths: phone (under 640 px), tablet, desktop (1024 px and up). It has to work on a phone, not
be perfect there.

| Element           | Desktop                            | Phone                                                      |
| ----------------- | ---------------------------------- | ---------------------------------------------------------- |
| Navigation        | sidebar                            | bottom bar with the main sections, the rest under "Więcej" |
| Lists             | table or card grid                 | cards                                                      |
| Detail            | opens over the list                | full page                                                  |
| Dialogs           | centred dialog                     | full-height sheet                                          |
| Planner           | weeks stacked, 7 columns each      | one week at a time, days as a vertical list, week switcher |
| Drag and drop     | pointer                            | long-press drag, plus "Przenieś do…" on every card         |
| Right-click menus | kept                               | a "⋯" button on the same items                             |
| Calendar          | month and year grids, drag to move | month list view; moving via the date field                 |

### 6.10 Performance

Targets to check in every phase on the deployed mock build:

- shell and first list visible within about a second on a normal connection
- moving between screens already visited feels instant (data is in the collections)
- routes are code-split; the planner (with dnd-kit) and the Firebase SDK load only when needed
- links preload their route and data on hover or touch-start
- long lists and the media grid are virtualised; images are lazy with fixed aspect ratios
- a bundle-size budget enforced in CI

### 6.11 Quality

- TypeScript strict; no `any` at the API boundary (Zod parses it).
- Unit tests for everything in `domain/`: the requirement rules (including the cross-week cases),
  content-block validation, weeks ↔ days mapping, CSV export.
- Adapter conformance tests (§6.3).
- Playwright smoke tests on the mock build: sign in, edit a workout, build a week in the planner,
  hit a conflict, publish.
- One command runs typecheck, lint, tests, build and the bundle budget; it is run before every
  hand-over.
- Interface text in Polish, kept next to the components; dates stored as UTC, shown in
  Europe/Warsaw; calendar days handled as local midnight, as in the sample's `dateUtils`.

## 7. Phases

Each phase ends deployed. Phases 0–7 run on mock data and mock sign-in. Sizes: S about a week or
less, M one to two weeks, L more.

### Phase 0. Foundation (S)

- Replace the starter with the chosen stack; TypeScript strict, React Compiler, lint, tests, CI.
- Cloudflare deployment of the mock build on push.
- `ApiClient` interface, mock database skeleton, latency controls.
- Design tokens in the Tailwind theme.
- **Spike (gate for Option B):** one challenge collection with nested days, a debounced autosave,
  undo, and a forced 409, end to end on the mock. If it does not hold up, switch to Option A now.

_Done when:_ after Michał pushes, the Cloudflare URL shows a skeleton shell; the spike
result is written down.

### Phase 1. Shell, design system, mock sign-in (M)

- Shared components: buttons, inputs, selects, dialog and sheet, menu, table, card, toast, badge,
  skeletons, empty and error states.
- App shell with responsive navigation, 404 and error boundary.
- `AuthProvider` with the mock implementation; login, forbidden, guard, user menu, sign-out.
- Config collections (`workoutsConfig`, `internalConfig`).

_Done when:_ demo admin can sign in and move between empty sections on desktop and phone; the
no-access user lands on "Brak dostępu"; a deep link survives sign-in.

### Phase 2. Workouts and media (M)

The first complete slice; it sets the patterns every later screen copies.

- Workout list with filters and search in the URL; workout form with all Retool fields.
- Status actions, validation mapped to fields, optimistic save, conflict dialog.
- Media library: images and audio, folders, upload with progress, picker used by forms.
- Adapter conformance tests start here, including the unknown-field round trip (§6.2).

_Done when:_ every item under "Treningi" in the [parity checklist](research/retool-inventory.md)
works on the mock.

### Phase 3. Content block editor (S–M)

- The prototype as a component: paste text → blocks, reorder, Title/Text/Image blocks, bold and
  link, phone preview.
- Validation ported from Retool's rules and the backend's.
- Image block from the media library with measured ratio.
- Used for workout and challenge descriptions and message bodies.

### Phase 4. Challenges: content and structure (M)

- Challenge list (cards and table, type, status, folders), promoted challenge.
- Overview page and content form with every Retool field, access section, badges, recommended next.
- Variants: add, duplicate (as a real copy), remove, per-variant settings.
- Draft, publish, hide, delete, restore.

_Done when:_ every item under "Wyzwania" in the parity checklist works, except the day editor,
which Phase 5 replaces.

### Phase 5. Planner (L)

- 7-day week table, workout cards, totals per day, rest days.
- Add from the catalogue (search with synonyms and duration filter) or create a draft workout.
- Drag and drop between days and the scratchpad; copy and paste; day notes, tints, card colours.
- Planning notes per variant; undo and redo; autosave with status; conflict handling.
- Recently opened variants; CSV export; phone layout.

_Done when:_ a four-week plan with two variants can be built from scratch on desktop, corrected on
a phone, and survives a forced conflict without losing edits.

### Phase 6. Requirements, plan types, calendar (M)

- Plan types and requirements editor (global and per challenge); week validation in the planner.
- Preparation status of variants; training-type styles; folders.
- Challenge calendar, month and year, with drag to move and the "Bez daty" list.

### Phase 7. Messages, badges, users (M)

- Messages with the block editor, preview, send, archive.
- Badges, with the Retool bugs fixed; claim link.
- Users: search, badges, progress as a readable view, e-mail change.
- Optional, if wanted (decision 6): offers, grant and revoke a badge, message unsend.

_Done when:_ the whole parity checklist passes on the mock. **This is the point to review the panel
with Patryk and the team before any real data is involved.**

### After Phase 7: going live in slices

Phases 8 and 9 are not delivered as two big steps. They are cut into slices L0–L8 in
[ROADMAP.md](ROADMAP.md), where backend and panel take turns and each slice is deployed and
checked for looks, speed and scale. Phase 8 is slice L1; Phase 9 is slices L2–L8. The two sections
below say what each phase contains.

### Phase 8. Real sign-in (S–M) — needs backend B0

- Firebase provider behind the same interface; project configuration per environment.
- Claim check, `manage/me`, token refresh and 401/403 handling, sign-out clearing data.
- Worker verifies tokens for its own endpoints; admins page if B0.5 has the endpoint.

_Done when:_ real admin accounts sign in on the deployed panel (still on mock data); a real account
without the claim is refused by the backend and by the panel.

### Phase 9. Real data and cutover (L) — needs backend B1–B3

- HTTP adapter per resource, passing the read-only part of the conformance suite.
- **Read-only first** on production data: every screen loads real data, writes disabled.
- Writes enabled section by section, least risky first (media, badges, messages, workouts,
  challenges last), with Retool still available.
- One-off import of Patryk's existing local plans as drafts.
- AI descriptions and YouTube lookup through the Worker.
- Retool switched off; the shared function key removed (backend B0.3).
- The quote's round of fixes within a week of delivery.

## 8. Backend track

Details in [BACKEND-SCOPE.md](BACKEND-SCOPE.md); the order in which backend and panel take turns is
in [ROADMAP.md](ROADMAP.md). No backend work is needed before Phase 7 is done; the table says what
could be started earlier if there is capacity.

| Backend block                                                               | Size   | Needed by     | Can start                                         |
| --------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------- |
| B0 admin access                                                             | M      | Phase 8       | now                                               |
| B2 safe editing (etag, saved entity in response, error contract, summaries) | M      | Phase 9       | now                                               |
| B1 status (draft, deleted)                                                  | L + M  | Phase 9       | now; the contract is fixed by the mock in Phase 2 |
| B3 planning storage, stable path id, workout production fields              | M      | Phase 9       | after Phase 5 confirms the document shape         |
| B4 media upload, audit trail, YouTube lookup                                | M      | after cutover | any time                                          |
| B5 bugs                                                                     | S each | alongside     | now                                               |

The mock (Phases 2–5) is the reference for the request and response shapes of B1–B3. If the backend
changes a shape, the mock and the conformance tests change with it.

## 9. Decisions needed

| #   | Decision                                                                                                                                                                | Recommendation                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **How the panel reaches the API**: through the panel's own Worker (same origin) or directly with CORS                                                                   | Through the Worker: no CORS setup, no preflight requests, same enforcement            |
| 2   | **Autosave**: everything, or only drafts                                                                                                                                | Autosave drafts and planning data; explicit save for published and hidden challenges  |
| 3   | **Where planning data lives**: backend document store, or Cloudflare D1 next to the panel                                                                               | Backend (one store, one backup, one auth). D1 only as a stopgap                       |
| 4   | **Calendar date of a challenge**: Patryk's app has `startDate`; the backend has `liveAtUtc` (live challenges only) and `availableAtUtc`                                 | Use `liveAtUtc`, else `availableAtUtc`; plans without either go to "Bez daty"         |
| 5   | **Should hidden content stay reachable by id** in the public API                                                                                                        | Product call for the mobile team; drafts and deleted are 404 either way               |
| 6   | **Beyond parity**: offers, user search, grant/revoke badge, message unsend, repeat badges. The backend has them; Retool does not; the quote says "all Retool functions" | User search yes (replaces pasting ids). The rest as a priced add-on or after delivery |
| 7   | ~~Stack option A or B~~                                                                                                                                                 | **Decided: B**, gated by the Phase 0 spike                                            |
| 8   | **Route language**: English paths (`/challenges/C12`) or Polish (`/wyzwania/C12`)                                                                                       | English paths, Polish labels                                                          |
| 9   | **Sign-in methods and first admins**: e-mail and password, Google, or both; which accounts                                                                              | Whatever the admins' existing Firebase accounts use; list needed for B0.5             |
| 10  | **Workouts per day**: Retool allows three, the planner any number                                                                                                       | Ask mobile whether the app handles more than three; keep three until confirmed        |
| 11  | **Requirement rule quirk**: "min. N dni między" counts differently inside a week and across a week boundary in Patryk's app                                             | Fix it to count the same way; confirm with Patryk                                     |

## 10. Risks

| Risk                                                                                                                           | Effect                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **There is no staging backend** (confirmed). Retool has no environment switch, and the backend repo treats local as production | Testing could change live content                                                        | The rules in [ROADMAP.md §4](ROADMAP.md): existing items are never modified for testing; each section goes live as `test-only`, where the panel refuses to save anything not marked `[TEST]`; no automated test writes to the backend; unsafe actions (sending a message, promoted challenge) are not tested |
| Backend status work (B1) is large and touches the public read path                                                             | Phase 9 slips                                                                            | Start B1 early; the panel can go live on hidden-only (as Retool) and gain drafts when B1 lands                                                                                                                                                                                                               |
| TanStack DB is a release candidate                                                                                             | Rework in the data layer                                                                 | Phase 0 spike; adapters and query functions are shared with Option A                                                                                                                                                                                                                                         |
| Path identity is `levelId`                                                                                                     | Planning data detaches when a variant's level changes; two variants cannot share a level | Backend B3.3; until then the panel forbids changing the level of a variant that has planning data                                                                                                                                                                                                            |
| CDN purge may never have worked (backend B5.1)                                                                                 | Publish and unpublish from the panel appear late                                         | Check App Insights before Phase 9                                                                                                                                                                                                                                                                            |
| The mock build is public                                                                                                       | Someone finds a demo of the panel                                                        | Synthetic data only; `noindex`; move behind Cloudflare Access if wanted                                                                                                                                                                                                                                      |
| Scope against a fixed quote                                                                                                    | Extras in decision 6 and the phone layout of the planner grow the work                   | Decide 6 early; phone support is "works", not "polished"                                                                                                                                                                                                                                                     |
| Planning documents can outgrow one Table Storage property                                                                      | Saves fail on long plans with many notes                                                 | Chunked storage in B3.1; a size check in the conformance tests                                                                                                                                                                                                                                               |

## 11. Reference

| Document                                                               | Use it for                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [research/retool-inventory.md](research/retool-inventory.md)           | Every Retool screen, field, label, endpoint, known bug, and the parity checklist                |
| [research/retool/code-extract.txt](research/retool/code-extract.txt)   | The content validator and all payload builders, verbatim                                        |
| [research/backend-audit.md](research/backend-audit.md)                 | Endpoint table, admin DTOs verbatim, validation messages, auth, status change list, conventions |
| [research/planner-app-inventory.md](research/planner-app-inventory.md) | Features, data model, requirement rules, design tokens, phone problem spots                     |
| Content editor prototype                                               | `https://claude.ai/artifact/6sC41uanfuqX9Ntz33mzpW`                                             |
