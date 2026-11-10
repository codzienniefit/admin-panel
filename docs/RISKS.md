# Risks

What could go wrong with the panel, how likely and how bad, what is already done about it, and what
would close it. Written 2026-11-10, after Phase 4. Add to it when a shortcut is taken; strike a row
when it is closed, with the date.

**Likelihood** and **impact** are low, medium or high. Impact is judged by the worst realistic
outcome: "high" means app users see wrong content, data is lost, or access is given to the wrong
person.

Related: [SECURITY.md](SECURITY.md), [ROADMAP.md](ROADMAP.md), [BACKEND-SCOPE.md](BACKEND-SCOPE.md).

## 1. The ones to watch

The five that deserve attention first.

| # | Risk | Why it is at the top |
|---|---|---|
| R1 | A panel bug changes real content once the backend is connected | One backend, it is production, no staging |
| R2 | The mock and the real backend disagree | Four phases are built against a contract the backend does not implement yet |
| R3 | Access control is weaker than it looks | Today's backend protects the admin API with one shared master key |
| R4 | Nothing has ever been deployed | Every phase result says "deployment unverified" |
| R5 | TanStack DB is a release candidate | The whole data layer stands on it |

## 2. Data and production

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R1 | **A panel bug changes real content.** There is no staging; a wrong save reaches app users at once | M | H | Nothing writes to the backend yet. Rules for stage 2: `[TEST]` items only, enforced by the panel, sections go live one at a time ([ROADMAP.md §4](ROADMAP.md)). Publish and hide ask first | A staging backend, or at least a nightly export that a row can be restored from. Until then: the `test-only` switch per section |
| R6 | **An old panel build wipes fields a newer backend added** (the Retool problem) | M | H | Loose schemas at every level; saves are "latest server version plus my changes"; tests assert an unknown field survives every kind of save | Backend B2.10: an omitted field means "keep". Then both sides protect it |
| R7 | **Two people edit the same challenge**; one overwrites the other | M | M | Etag on every save; silent merge of different fields; a held-edits notice with a choice for the same field. Tested | Backend etags (B2). Until they exist the HTTP adapter can only compare `updatedAtUtc`, which is weaker |
| R8 | **Changing a variant's level breaks it for people who started it.** Attempts store the level id; the stable `pathId` exists only in the mock | M | H | The variant dialog warns. Two variants on one level are refused | Backend B3.3 (`pathId` on attempts). Until then the HTTP adapter must refuse a level change on a published challenge |
| R9 | **Actions that cannot be tested safely**: sending a message, changing the promoted challenge, repeat badges | L | H | Listed in ROADMAP §4.4; covered by the mock only; first real use is by Michał, on purpose | A staging backend |
| R10 | **A save rewrites a whole row and purges the CDN** on today's backend, even when nothing changed | M | M | The panel sends only when something differs (`applyChallengeChange` returns "no change") | Backend partial updates |
| R11 | **Shortening a challenge deletes days** with workouts in them | L | M | Asks first and says how many workouts go | Undo for the content form, or keeping removed days until save is confirmed |

## 3. The backend contract

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R2 | **The mock and the real backend disagree**: statuses, etags, error shapes, validation wording, field names | H | M | The mock is one implementation of `ApiClient`; its contract tests are written against the interface and will run against the HTTP adapter. Rules were copied from the backend's validators | Stage 2 slice L2 (everything read-only against real data) as early as possible; the mock's formats handed to the backend as the specification after Phase 7 |
| R12 | **Draft, hidden and deleted do not exist on the backend** | H | M | Scope B2/L6. Until then the adapter maps: draft and deleted are unavailable, hidden is the existing flag | Backend L6 |
| R13 | **The panel's rules are stricter or looser than the backend's** | M | L | Server refusals arrive as the same `{ path, message }` list and show the same way, so a mismatch is visible, not silent | A shared rule source, or contract tests with real refusals recorded in L2 |
| R14 | **Backend cold starts** make the first request slow | H | L | Planned: call `wakeup` when the login page opens | Measured in L0 |

## 4. Technology

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R5 | **TanStack DB is 1.0.0-rc.** Its API or behaviour can change before 1.0; fewer people have met its bugs | M | M | Used only through `data/collections/` and `useLiveQuery`; the saver and the merge are ours and tested (8 spike cases, rebase tests). Version pinned by the lock file | 1.0 released and adopted; or, worst case, collections replaced by TanStack Query alone behind the same module |
| R15 | **Very new majors**: Vite 8, TypeScript 7, React 19.3 with the Compiler, Vitest 5, Biome 2 | M | L | Lock file; `npm run check` on every change; no deprecated APIs in use | Time |
| R16 | **React Compiler and libraries that mutate** (React Hook Form's `formState`, `watch`). A component can silently stop updating | L | M | Forms verified in the browser, including error display; pattern kept identical between the two forms | A browser test per form; `useFormState`/`useWatch` if a stale form is ever seen |
| R17 | **Hot reload recreates collections** in development and shows an error screen | M | L | Data modules reload the page on change; a friendly error screen | Development only; never in a build |
| R18 | **JavaScript size**: about 390 kB gzipped in total, about 310 kB on first load | M | L | Routes are split; heavy editors load on demand | Measure on a phone over mobile data in L0; split the vendor chunk if the 1 s target is missed |
| R19 | **Long lists page by 50 rows** instead of virtual scrolling | L | L | Search-first lists; stress dataset checked (2,000 workouts) | TanStack Virtual when someone needs to scroll thousands |
| R20 | **Sample data in `localStorage`** is limited (large uploads are not kept) and can go stale between versions | M | L | Storage key is versioned (`cf.mock.v3`); "Dane testowe…" restores | Test environment only |

## 5. Not verified

Things believed to work that nobody has seen work.

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R4 | **Deployment has never been exercised.** Build, Worker, SPA fallback, deploy on push | M | M | Production build runs locally through `vite preview` (Cloudflare's local runtime): routes, `/api/health` and headers work there | The first push, with the check in [DEFINITION-OF-DONE.md §8](DEFINITION-OF-DONE.md) |
| R21 | **The security headers could block something on the real site** that works locally | L | M | Checked against the local production build: no violations walking every section | Same first push: watch the console for "Refused to load". Rollback: delete `public/_headers` |
| R22 | **No browser tests.** Flows are walked by hand or by script in a preview pane | H | M | 190 unit tests cover rules, merging, filters and the mock; the hand checks are a written list | Playwright smoke tests for sign-in, a workout save, a challenge publish, a conflict |
| R23 | **No continuous integration.** `npm run check` runs only if someone runs it | M | M | It is in the definition of done | A GitHub Action running `npm run check` and `npm audit` on push, before Cloudflare builds |
| R24 | **Screens were mostly checked by reading the page**, not by eye; screenshots in the pane lag | M | L | `/design` shows every component; phone width checked for overflow by script | Michał's look at each phase on desktop and phone |
| R25 | **Accessibility is unaudited** | M | L | Base UI primitives; Biome's accessibility rules; labelled fields; keyboard checks | An audit before the wider team uses it |
| R26 | **Layer rules are kept by review only** (who may import what) | M | L | Written in ARCHITECTURE §2; two known exceptions listed | A lint rule for import boundaries |

## 6. Access

Details in [SECURITY.md](SECURITY.md).

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R3 | **The admin API is protected by one shared master key** today; the Firebase admin path in the backend is effectively dead | H | H | The panel does not hold the key and makes no request. Scope B0 defines the fix | Backend B0 (verify the token and the `admin` claim on every admin request) before slice L1 |
| R27 | **The panel's guard is mistaken for protection** | L | H | Documented in ARCHITECTURE §8 and SECURITY §5.1 | Backend B0; a test that a call with no token is refused |
| R28 | **The demo is public.** Someone finds the address | M | L | Sample data only; `noindex`; nothing to reach | Cloudflare Access in front of the site, if it should be private even as a demo |
| R29 | **A secret ends up in the bundle** when AI descriptions or YouTube lookups are added (Patryk's app did this) | M | H | Rule: secrets live in the Worker only (SECURITY §5.8–10) | The Worker endpoints, with token checks, in L8 |

## 7. Product and people

| # | Risk | L | I | In place | Would close it |
|---|---|---|---|---|---|
| R30 | **The plan editor is the Phase 0 test editor.** No drag and drop, notes or weekly totals; Patryk's daily work is exactly this | H | M | It adds, removes and moves workouts with undo and autosave | Phase 5 |
| R31 | **The panel is judged before it reaches parity** and people stay on Retool | M | M | A parity list per section in each phase result | Review with Patryk and the team after Phase 7, before stage 2 |
| R32 | **Two panels in use at once** during the switch; Retool overwrites what the new panel saved | M | H | Conflict detection on the new panel's side only | Backend "omitted means keep" and etags; switch a section fully, then remove it from Retool |
| R33 | **One person knows the system.** Michał commits, pushes, deploys and tests | M | M | These documents; small, tested modules | A second person able to deploy and roll back |
| R34 | **Entitlement and offering ids typed by hand** | M | M | Paid-access fields are checked together (an offering needs an entitlement) | A lookup against RevenueCat, or a picker fed by the backend |
| R35 | **The promoted challenge changes without a confirmation** | L | M | Two steps already: pick, then "Zapisz" | A confirm, if wanted (one line) |
| R36 | **Scope grows inside phases** (design system page, environment selector, content editor were added on the way) | M | L | Each phase result lists departures from the plan | Keep listing them |

## 8. Accepted shortcuts

Deliberate, and safe for now. Each has its row above.

- React Hook Form with the shared rule function instead of a Zod resolver (one rule set).
- The existing `Table` with paging instead of TanStack Table and Virtual (R19).
- No Playwright, no CI (R22, R23).
- Folders for challenges moved to Phase 6.
- The interim plan editor (R30).

## 9. When to reread this

- Before the first push (R4, R21).
- Before slice L1, sign-in (R3, R27).
- Before the first slice that writes to real data, L3 (R1, R6, R7, R32).
- When TanStack DB 1.0 is released (R5).
