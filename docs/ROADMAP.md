# Roadmap: mock first, then live slice by slice

How the work in [PLAN.md](PLAN.md) and [BACKEND-SCOPE.md](BACKEND-SCOPE.md) is sequenced so that
front end and backend take turns, and every step ends with something deployed that can be looked at,
timed and loaded with data.

Status: proposal, 2026-11-10. Deployment mechanics in §1 are to be confirmed in Phase 0; nothing here
has been run.

Working rules, set by Michał on 2026-11-10:

- **Deploy on push stays.** Cloudflare builds and deploys when a push arrives.
- **Michał does all committing and pushing.** Claude never commits and never pushes; work is left in
  the working tree for him.
- **Michał does the testing on deployed builds, by hand.** Automated tests run locally, on the mock.
- **There is no staging backend**, so §4 applies to anything that touches real data.
- **Firebase sign-in waits** until the panel is complete on sample data (all of stage 1).

## 1. One panel, two environments

The environment is picked in the top bar (a dropdown on laptop widths, a label on a phone).
Switching reloads the page, so data from one environment can never stay on screen in another.

|          | **Test**                                                                              | **Produkcja**                                                    |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Data     | sample data inside the browser, no network                                            | the real backend                                                 |
| Sign-in  | none yet (two demo users from Phase 1)                                                | Firebase, admin claim                                            |
| Shows    | the whole target panel, including features the backend cannot do yet                  | only what the backend supports so far; grows with each slice     |
| Safe to  | try everything: every function is on, nothing leaves the browser                      | read; writes follow §4                                           |
| Exists   | since Phase 0                                                                         | listed but not selectable until slice L1                         |
| Purpose  | design, review with Patryk, speed and scale tests, the specification for backend work | real work                                                        |

There is one deployment, on push. Where the rest of this document says "demo" it means the Test
environment, and "live" means Produkcja.

Both run the same code. The difference is which `ApiClient` is behind the collections and a
**capability list** for Produkcja:

| Capability         | Off means                                                                                                                             | Turned on in                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `writes.<section>` | `off`: the section is read-only, with a banner. `test-only`: saves are allowed only on items created as test items (§4). `on`: normal | L3–L5, section by section, always `test-only` before `on` |
| `etag`             | saves are last-writer-wins, with a warning when `updatedAtUtc` moved                                                                  | L4                                                        |
| `status`           | only the "Ukryj" switch, as in Retool; no draft, trash or "z palca" workouts                                                          | L6                                                        |
| `planning`         | planner edits the schedule only; no notes, requirements, scratchpad, folders                                                          | L7                                                        |
| `summaries`        | lists load full objects                                                                                                               | L5                                                        |

A feature that is off is hidden, not broken. Test always has everything on.

Backend deployments stay as they are today: by hand, by a person, following the backend repo's
`docs/release.md`. Every backend step below is backwards compatible, so Retool keeps working until
it is switched off in L5.

## 2. The check at every deployment

The same five checks each time, on the deployed URL, done by hand by Michał, with the numbers
written into §6. What is handed over with each step is a short list of what to look at and what to
try.

| Check           | How                                                                                                                                                                                                                                                                     | Pass                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Looks**       | Walk the changed screens at desktop, tablet and phone width; compare with the demo and with Patryk's app                                                                                                                                                                | Nothing clipped or overlapping; skeletons match the loaded layout; no layout jump when data arrives                  |
| **Speed**       | A timing overlay in non-production builds shows, per navigation and per request: time to shell, time to data, save round trip. Measure cold and warm, on office Wi-Fi and on a phone over mobile data                                                                   | Targets in the table below                                                                                           |
| **Scale**       | Demo: switch the mock to the **stress dataset** (2,000 workouts, 300 challenges, one 52-week plan with 4 variants, 5,000 media files) and to slow mode. Live: record the size and time of the largest responses                                                         | Lists scroll and search without stutter; planner drag stays smooth; memory steady after ten minutes of use           |
| **Correctness** | Before hand-over, locally on the mock: unit tests, Playwright smoke, conformance suite, the unknown-field round trip. On the deployed build, by hand: the step's walk-through list. On backend steps: a Retool save of a **test item** of each touched type still works | All green; nothing existing was changed                                                                              |
| **Rollback**    | Know the previous version before pushing                                                                                                                                                                                                                                | Panel: roll back to the previous version in Cloudflare, or push a revert. Backend: the rollback in `docs/release.md` |

Speed targets (to be adjusted after the first real measurements in L0):

| Measure                               | Demo                        | Live                                                     |
| ------------------------------------- | --------------------------- | -------------------------------------------------------- |
| Shell visible, first visit            | under 1 s                   | under 1 s                                                |
| First list usable, first visit        | under 1.5 s                 | under 2.5 s warm backend; cold start recorded separately |
| Navigation to a screen already loaded | under 100 ms                | under 100 ms                                             |
| Search or filter on a loaded list     | under 100 ms at stress size | same                                                     |
| Save acknowledged                     | mock latency                | under 1 s warm                                           |

The backend has cold starts. The panel calls the existing `wakeup` endpoint when the login page
opens, so the first real request after sign-in is warm.

## 3. Stage 1: the panel on mock data

Phases 0–7 of [PLAN.md §7](PLAN.md). Each phase ends with the work ready for Michał to commit and push,
which deploys the demo, and the §2 check. No real sign-in and no real data anywhere in this stage: the demo uses
sample data and two demo users.

| Phase                       | Delivers                                                   | What the deployed check is mainly about                                           |
| --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 0 Foundation                | stack, deploy pipeline, mock skeleton, TanStack DB spike   | the pipeline itself; first speed baseline of an empty shell                       |
| 1 Shell and sign-in (mock)  | design system, navigation, guards                          | looks on all widths; skeleton timing rules                                        |
| 2 Workouts and media        | first full section; save, conflict and validation patterns | list at stress size; upload flow; unknown-field round trip                        |
| 3 Content editor            | block editor replacing raw JSON                            | editor on a phone                                                                 |
| 4 Challenges                | content form, variants, statuses                           | conflict flow with two browser tabs                                               |
| 5 Planner                   | 7-day table, drag and drop, undo, autosave                 | 52-week plan at stress size; drag on touch; autosave under slow mode and failures |
| 6 Requirements and calendar | plan types, validation, calendar                           | validation cost on a long plan                                                    |
| 7 Messages, badges, users   | the remaining Retool tabs                                  | full parity walk-through                                                          |

**Review point after Phase 7.** The whole panel exists on the demo. This is the moment to go through
it with Patryk and the team, and to freeze the shapes the backend has to implement: the mock's
request and response formats for statuses, etags, planning documents and errors are the
specification for stage 2.

No backend work is needed for stage 1, and Firebase sign-in is not started during it.

## 4. Rules for anything that touches real data

There is one backend and it is production. These rules hold for every slice in §5.

1. **Existing challenges, workouts, badges, messages, offers, media and users are never modified
   for testing.** Not edited, not re-saved unchanged (a save rewrites the whole row and purges the
   CDN), not hidden, not reordered.
2. **Writes are tested only on items created for the test**, marked `[TEST]` at the start of the
   internal comment (`internalTitle`, or the name where there is no comment field) and kept hidden.
   A test challenge uses test workouts and test badges, not real ones.
3. **The panel enforces it.** A section first goes live as `test-only`: the panel refuses to save
   any item that does not carry the `[TEST]` mark, and says why. It moves to `on` only when Michał
   says the section is accepted.
4. **Some actions cannot be tested safely and are not tested**: sending a message (it goes to real
   users), changing the promoted challenge, changing a real user's e-mail, generating repeat badges
   (it deletes and recreates a whole category). They are covered by the mock and by the backend's
   own tests, and are first used for real, by Michał, when there is a real reason.
5. **Test items stay** until delete exists (L6); there is no way to remove them before that. They
   are hidden and marked, and are cleaned up in L6.
6. **Automated tests never write to the real backend.** The backend repo treats even a local run as
   production, so no write test is pointed at it. Reads are safe.
7. **Claude does not test against production**, and does not commit, push or deploy. Backend changes
   are verified by the backend's own test suite; everything on a deployed build is Michał's check.

## 5. Stage 2: going live in slices

Each slice is: backend change → backend deployed by hand → panel change → pushed by Michał, which
deploys it → §2 check, under the rules in §4. A slice is small enough to finish and observe before the next begins.

### L0. The path to production, with nothing behind it

- **Backend:** nothing.
- **Panel:** the live deployment exists with a single status page that calls public endpoints
  (`workoutsConfig`, `wakeup`) through the same-origin `/api` forwarding.
- **Shows:** the real network path works; first real latency and cold-start numbers; the
  push-to-deploy and rollback routine.

### L1. Sign-in (PLAN Phase 8)

- **Backend:** B0 — admin claim read correctly, admin functions guarded in code, claims merged not
  replaced, `manage/me`, a way to grant the claim, function key kept for Retool.
- **Panel:** Firebase provider behind the existing interface; guard, token refresh, sign-out.
- **Check:** an admin gets in; a real account without the claim is refused by the backend and shown
  "Brak dostępu"; a call with no token is refused; Retool still loads its lists (no save needed).
- **Not before stage 1 is done.** This is the first slice that needs Firebase.

### L2. Everything read-only

- **Backend:** nothing new (the GET endpoints exist). Optional: B2.9 so the panel's schemas are
  type-checked against the backend's.
- **Panel:** HTTP adapter for reading config, workouts, media, badges, challenges, messages, users.
  All writes off.
- **Check:** this is the main **scale and contract** checkpoint. Real data volumes, real response
  sizes and times, every legacy row parsed by the schemas. Mismatches between the mock's idea of the
  data and reality surface here, before any write exists.

### L3. First writes, on endpoints that already exist

- **Backend:** small fixes only — B2.5 (message id), B2.8 (typed user responses), B5.4 (mp4/ogg).
- **Panel:** media upload; messages (draft, send, archive); user e-mail change.
- **Why these first:** uploads never overwrite; a message draft is harmless until sent; none of
  them share rows with other editors.
- **Check:** upload a test image and audio file; create, edit and archive a `[TEST]` draft. Sending
  and e-mail change are not tested (§4.4).

### L4. Safe writes: badges and workouts

- **Backend:** the safe-editing foundation — B2.1 (etag and 409), B2.10 (omitted fields kept),
  B2.2 (saved entity returned), B2.3 (validation errors with fields), plus B5.2 and B5.3.
- **Panel:** writes for badges and workouts; the conflict flow against the real backend.
- **Check:** all on `[TEST]` items: two browser tabs editing the same test workout; a save from a
  build that lacks a field; a Retool save of a test workout and a test badge.

### L5. Challenges, at Retool parity

- **Backend:** B2.4 (summary lists), B2.6 (missing validation).
- **Panel:** challenge content, variants and the schedule through the planner, with explicit save;
  promoted challenge. Hidden only, as in Retool.
- **Check:** build a `[TEST]` challenge from test workouts, two variants, a few weeks; edit it from
  two tabs. The promoted challenge is not touched.
- **Then:** sections move from `test-only` to `on` as they are accepted. When all are, Retool is
  switched off and the shared function key removed (B0.3). From here the panel is the only editor.

### L6. Draft and deleted

- **Backend:** B1 — status on challenges and workouts, public endpoints excluding draft and deleted,
  draft-tolerant validation, status endpoints, "used by" lookup. The largest backend step.
- **Panel:** `status` on — draft, publish, hide, delete, restore, trash; autosave for drafts;
  workouts created "z palca".
- **Check:** on `[TEST]` items: a draft is invisible in the mobile app by list, by id and with
  `?dev=true`; a deleted test challenge still shows in the history of a test account that started it;
  the test items left over from L3–L5 are deleted; publish and unpublish reach the app within the agreed
  time (depends on the CDN purge, B5.1).

### L7. Planning data

- **Backend:** B3 — panel document store, stable path id, production fields on workouts.
- **Panel:** `planning` on — notes, tints, scratchpad, plan types and requirements, preparation
  status, folders, calendar colours from the real store. One-off import of Patryk's existing local
  plans as drafts.
- **Check:** a long plan with many notes saves (document size); two variants keep their own notes
  when one changes level.

### L8. Hardening and extras

- **Backend:** B4 — direct media upload, audit trail, YouTube lookup.
- **Panel:** history tab; AI descriptions and YouTube lookup through the Worker; whichever extras
  were agreed (offers, grant and revoke badge, message unsend); the quote's round of fixes.

### Order at a glance

| Step       | Backend                             | Panel                        | Retool           |
| ---------- | ----------------------------------- | ---------------------------- | ---------------- |
| Phases 0–7 | —                                   | whole panel on mock          | in use           |
| L0         | —                                   | live shell                   | in use           |
| L1         | B0                                  | real sign-in                 | in use           |
| L2         | —                                   | read-only real data          | in use           |
| L3         | B2.5, B2.8, B5.4                    | media, messages, user e-mail | in use           |
| L4         | B2.1, B2.2, B2.3, B2.10, B5.2, B5.3 | badges, workouts             | in use           |
| L5         | B2.4, B2.6                          | challenges                   | **switched off** |
| L6         | B1                                  | draft, delete, "z palca"     | —                |
| L7         | B3                                  | planning data, import        | —                |
| L8         | B4                                  | history, AI, extras          | —                |

## 6. Check log

One row per deployment. Filled in as we go.

| Date | Step | Version | Shell | First list | Navigation | Save | Largest response | Notes |
| ---- | ---- | ------- | ----- | ---------- | ---------- | ---- | ---------------- | ----- |
|      |      |         |       |            |            |      |                  |       |

## 7. Open points for this roadmap

- **Deployment mechanics** on Cloudflare: how one push builds both the demo and the live deployment
  (two Workers, or two environments of one), and how a version is rolled back. To be set up and
  confirmed in Phase 0.
- **The `[TEST]` mark** needs a field on every entity type. Workouts and challenges have
  `internalTitle`, badges have `comment`, messages have the internal description. Media has only the
  file name; a `test/` folder serves there.
- **Backend steps go straight to production.** Each one is backwards compatible and covered by the
  backend's test suite, but the first real run of new backend code is in production. If that is ever
  too thin, the cheapest staging is a second Function App on separate test storage.
