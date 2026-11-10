# Phase 1 result

2026-11-10. Phase 1 of [PLAN.md §7](PLAN.md): shell, design system, demo sign-in. Still the Test
environment only: sample data, no network, no Firebase.

## Done when, and whether it is

| Criterion from the plan | Result |
|---|---|
| The demo admin can sign in and move between sections on desktop and phone | yes |
| The no-access user lands on "Brak dostępu" | yes, on sign-in and on a direct visit to any section |
| A deep link survives sign-in | yes: `/design` while signed out goes to the login page and returns to `/design` afterwards |

Checked in a browser, and by `npm run check`: typecheck, lint, 53 tests, production build.

## What was built

**Sign-in, behind one interface** (`src/auth/`)
- `AuthProvider` is what the panel asks of any sign-in system. The Test environment uses the demo
  implementation with two made-up accounts: one administrator, one without access.
- Firebase will be a second implementation of the same interface. No screen, guard or menu changes
  when it arrives.
- The session survives a reload. Signing out reloads the page, so nothing loaded for one person
  stays in memory for the next.
- The address to return to after sign-in only accepts paths inside the panel, so a crafted link
  cannot send someone to another site.

**Guard** (`src/routes/_app.tsx`)
- Every screen lives under one guarded layout route. It runs before any of them loads data or
  renders: signed out goes to the login page, no access goes to "Brak dostępu".
- This decides what the panel shows. The backend still has to check the admin claim on every
  request by itself (backend scope B0).

**Shell** (`src/features/shell/`)
- Top bar with all six sections as real pages, the two tool pages, the environment selector and the
  account menu with sign-out.
- Treningi, Media, Wiadomości, Odznaki and Użytkownicy are placeholders that say which phase
  builds them.
- A skeleton of the shell shows while the session and configuration load.

**Configuration** (`src/data/config.ts`)
- The two backend config documents (`workoutsConfig`, `internalConfig`) are loaded once, before any
  screen renders, from sample data in the backend's shape.
- Labels of training types and levels now come from that configuration; colours stay fixed in
  `src/ui/enums.ts`.
- A test checks that every id used by the sample workouts and challenges exists in the config.

**Components added** (all on `/design`)

| Component | What it is |
|---|---|
| TextField, TextAreaField | label, hint, error, wired for screen readers |
| Switch | on/off setting |
| Dialog | centred on desktop, a sheet from the bottom on a phone |
| confirm() | replaces the browser's confirm box; usable from anywhere |
| Menu | a button opening a short list of actions |
| toast() | short messages that go away by themselves |
| Table | a table from tablet width up, cards on a phone |
| Card, EmptyState | surfaces and "nothing here yet" |

The first real use of `confirm()` is in the planner test: discarding held edits now asks first.

## Not done, or not verified

- **Deployment is still unverified**; nothing has been pushed. The list in
  [PHASE-0-RESULT.md](PHASE-0-RESULT.md) applies, plus: open `/design` while signed out and confirm
  you return to it after signing in.
- **Screens were checked by reading the page**, not by eye: the preview pane's screenshots lag.
  Worth a look yourself at the login page, "Brak dostępu", the dialog on a phone and the table as
  cards.
- **Keyboard and screen-reader behaviour** of the Base UI components (dialog focus trap, menu and
  dropdown arrow keys) was not tested by hand; it is the library's stock behaviour.
- **No component tests in a DOM.** Tests cover logic (sign-in states, redirect rules, merge, mock
  contract). Playwright comes with Phase 2, when there is a first full section to walk through.

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| Config collections | Config in the query cache, loaded by the guarded route | They are two single documents, not lists; a collection adds nothing |
| Mock sign-in and Firebase as two builds | One build; the environment decides | Follows the environment selector |
