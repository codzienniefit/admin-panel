# Architecture

How the panel is built today, 2026-11-10, after Phases 0 to 4. [PLAN.md](PLAN.md) says what is
intended; this says what exists. Where they differ, this document is right about the code.

Related: [CODE-GUIDELINES.md](CODE-GUIDELINES.md), [DEFINITION-OF-DONE.md](DEFINITION-OF-DONE.md),
[SECURITY.md](SECURITY.md), [RISKS.md](RISKS.md).

## 1. In one paragraph

A single-page React app, served as static files by Cloudflare. Every entity (challenge, workout,
media file, badge) exists once in the browser, in a TanStack DB collection. Screens read from the
collections with live queries and write by describing a change. One module, the saver, turns every
change into a save that is merged onto the latest server version. The server is behind one
interface, `ApiClient`. Today its only implementation is a mock that runs in the browser and makes
no network requests.

## 2. Parts

```
routes/        one file per address; reads params and search, renders a feature
features/      screens, one folder per area
ui/            shared components, no knowledge of entities
domain/        pure rules and transformations, with tests
data/
  schemas/     Zod schemas; the source of every entity type
  api/         ApiClient interface, errors, the mock
  collections/ one collection per entity, the saver
auth/          AuthProvider interface, the mock provider
lib/           the small store for state that is not server data
worker/        Cloudflare Worker behind /api/* (only /api/health today)
```

**Allowed imports** go one way:

| From | May import |
|---|---|
| `routes` | `features`, `data`, `auth`, `ui` |
| `features` | other `features` (sparingly), `data`, `domain`, `auth`, `ui`, `lib` |
| `ui` | `ui`, `lib`, text and date helpers from `domain`, **types** from `data` |
| `data` | `data`, `domain`, `lib` |
| `domain` | `domain`; types, error shapes and blank-object helpers from `data/schemas` and `data/api/errors` |
| `auth` | `auth`, `lib`, `data/environment` |
| `lib` | nothing of ours |

`domain` never imports React, the collections or the API client. That is what keeps it testable in
milliseconds. `ui` never reads a collection: a shared component gets its data as props.

Two known exceptions, both small: `ui/EnvironmentSelect.tsx` reads `data/environment` directly, and
`data/environment.ts` imports the `Tone` type from `ui`. These rules are kept by review, not by a
tool (see [RISKS.md](RISKS.md)).

## 3. Stack

| Concern | Choice |
|---|---|
| Build and hosting | Vite 8, Cloudflare Workers static assets, deploy on push |
| UI | React 19 with the React Compiler, Tailwind 4 tokens, Base UI primitives |
| Routing | TanStack Router, file routes, code split per route |
| Server data | TanStack DB collections on TanStack Query |
| Forms | React Hook Form, validated by the shared rule functions |
| Validation | Zod 4 at the boundary |
| Language | TypeScript 7, strict |
| Lint and format | Biome 2 |
| Tests | Vitest 5 |

Why these: [STACK-OPTIONS.md](STACK-OPTIONS.md).

## 4. How data flows

```
        read                                   write
screen ──────► useLiveQuery(collection)        screen ──► collection.update(id, draft => …)
                     ▲                                          │ optimistic, shown at once
                     │                                          ▼
              collection (one copy)  ◄──── confirmed ────  saver
                     ▲                                          │ rebase(base, mine, latest)
                     │ list()                                   ▼
                  ApiClient  ◄──────────────────────────  ApiClient.save(etag)
```

1. **Read.** A screen subscribes with `useLiveQuery`. It never copies an entity into `useState`.
   When the collection changes, every screen showing that entity updates.
2. **Write.** A screen calls `collection.update(id, draft => { … })`. The change shows at once.
3. **Save.** The saver (`data/collections/saver.ts`) does not send the screen's object. It takes the
   latest version known from the server and lays only this user's changes on top
   (`domain/rebase.ts`, a three-way merge). Then it saves with the version's etag.
4. **Outcome.**
   - Saved: the collection takes the server's answer.
   - Someone else changed a different field: both changes are kept; the screen is told it merged.
   - Someone else changed the same field: the save stops. The user's edits are **held**, not lost,
     and `HeldEditsNotice` offers "mine" or "theirs".
   - Network or server failure: the edits are held, with retry.
   - Validation failure: returned to the screen as a list of `{ path, message }`; nothing is held.

**Forms** (workout editor, challenge Treść tab) hold what is being typed in React Hook Form and
write to the collection only on save. They send only the fields that differ, so a form open for an
hour does not overwrite a colleague's change to another field.

**Autosaving editors** (the plan editor) write each edit to the collection through paced mutations
(`createPacedMutations` with a 1.2 s debounce). Undo and redo are inverse operations
(`domain/schedule.ts`), not snapshots.

## 5. Fields the panel does not know

The old panel sent back whole objects built from its own form, so any field added to the backend
later was wiped on the next save. Three things prevent that here:

- Every schema is a `z.looseObject`, at every level, so unknown fields survive parsing.
- A save is "latest server version plus my changes", so unknown fields travel back untouched.
- The mock adds a field named `x_addedByNewerBackend` to every object at every level, and tests
  assert it survives each kind of save.

Backend scope B2.10 ("an omitted field means keep") is the second line of defence, on the server.

## 6. Rules: one function per entity

`workoutIssues`, `challengeIssues` and `contentIssues` in `domain/` return a list of
`{ path, message }`. The same function is called by:

- the form, to put messages next to fields;
- the status actions, to refuse publishing with reasons;
- the mock server, to answer like the real one will.

So the panel and its test server cannot disagree. The real backend stays the authority: whatever it
refuses arrives in the same shape and is shown the same way.

Statuses are `draft`, `published`, `hidden`, `deleted`. A draft needs only a name; `published` and
`hidden` need complete content.

## 7. The server boundary

`data/api/types.ts` defines `ApiClient`: config, challenges, workouts, media, badges. Errors are
`ApiError` with a `kind`: validation, conflict, unauthorized, forbidden, notFound, network, server.

`data/environment.ts` picks the implementation at start-up from the environment selector:

| Environment | ApiClient | AuthProvider | State |
|---|---|---|---|
| Test | mock, in the browser | mock, two made-up people | available |
| Produkcja | HTTP adapter | Firebase | listed, not available yet |

The mock (`data/api/mock/`) implements the **target** contract, including statuses, etags and
conflicts the real backend does not have yet. It can be told to be slow, to fail the next save, or
to make the next save meet someone else's change (account menu → "Dane testowe…"). Its data is
generated from a fixed seed and kept in `localStorage`.

Nothing outside `data/api/` knows which implementation is running.

## 8. Sign-in

`auth/types.ts` defines `AuthProvider`: a session that is `loading`, `signedOut`, `forbidden` or
`admin`, plus sign-in methods, sign-out and a token per request.

The pathless route `routes/_app.tsx` guards every screen: no session redirects to `/login` with the
address to return to; a signed-in person without the admin claim sees `/forbidden`. The return
address is checked by `auth/redirect.ts` so it can only point inside the panel.

This guard is for the user's convenience. Access is enforced by the backend, on every request (see
[SECURITY.md](SECURITY.md)).

## 9. Addresses

Everything that can be looked at has an address that can be sent to a colleague.

| Address | Screen |
|---|---|
| `/challenges?q=&status=&kind=&sort=&view=` | challenge list, filters in the address |
| `/challenges/new` | new challenge |
| `/challenges/$challengeId` | challenge, Przegląd tab |
| `/challenges/$challengeId/content` | challenge, Treść tab |
| `/challenges/$challengeId/plan/$pathId` | plan of one variant |
| `/workouts?…`, `/workouts/$workoutId`, `/workouts/new` | workout list; editor over the list |
| `/media` | media library |
| `/messages`, `/badges`, `/users` | placeholders until Phase 7 |
| `/design` | every shared component in every state |
| `/spike` | the Phase 0 plan editor with its test controls |
| `/login`, `/forbidden` | sign-in and "no access" |

Search parameters are validated with Zod; an unknown value is dropped, not an error.

## 10. State that is not server data

| State | Where |
|---|---|
| Entities | collections, nowhere else |
| Filters, tabs, the open item | the address |
| What is being typed in a form | React Hook Form |
| Dialog open, hover, selection | `useState` in the component |
| Toasts, the confirm dialog, save status, held edits, mock controls | small stores (`lib/store.ts`), read with `useStore` |
| Environment, demo user, sample data | `localStorage` |

There is no global app store and no context for data.

## 11. Design system

Tokens (colours, radii, shadows) are Tailwind `@theme` values in `styles/app.css`, taken from
Patryk's app. Ten tones are applied with `data-tone` and three CSS variables. `ui/enums.ts` is the
only place that decides the label and tone of a status, training type or level, so the same thing
has the same colour everywhere. `/design` shows every component; visual changes are checked there
first.

## 12. Errors and loading

- Loading shows skeletons, after a short delay so fast loads do not flash.
- A failed load shows `ErrorScreen`: a plain message, with the technical detail in small type.
  It is the router's default error component, so no raw error reaches the screen.
- A failed save never loses input (section 4).

## 13. The Worker

`worker/index.ts` answers `/api/health` and nothing else. Everything else is static files, with
`index.html` as the fallback for client-side routes. `public/_headers` sets the security headers.
Forwarding to the backend and the two endpoints that need a secret arrive in stage 2.

## 14. Not built yet

| Thing | When |
|---|---|
| Planner: drag and drop, notes, scratchpad | Phase 5 |
| Requirements, plan types, calendar, folders | Phase 6 |
| Messages, badges, users | Phase 7 |
| Firebase sign-in, HTTP adapter, Worker forwarding | stage 2, [ROADMAP.md](ROADMAP.md) |
| Browser tests (Playwright) | not set up; see [RISKS.md](RISKS.md) |
