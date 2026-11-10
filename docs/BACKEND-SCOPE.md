# Backend scope for the admin panel

What the backend (`codzienniefit/backend`, Azure Functions) has to gain before the panel can run on
real data. Companion to [PLAN.md](PLAN.md); evidence and file:line references are in
[research/backend-audit.md](research/backend-audit.md).

Sizes are backend-only, including tests under that repo's rules: **S** up to a day, **M** a few days,
**L** a week or more.

## Summary

| Block | What                                                                                                   | Size              | Needed by roadmap step |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------- |
| B0    | Admin sign-in with a Firebase claim, reachable from a browser                                          | M                 | L1                     |
| B1    | Challenge and workout status: draft, published, hidden, deleted                                        | L + M             | L6                     |
| B2    | Safe editing: conflicts, omitted fields kept, saved entity in the response, error contract, slim lists | M + M + M + S + S | L3–L5                  |
| B3    | Planning storage: notes, requirements, scratchpad, plan types                                          | M                 | L7                     |
| B4    | Media, YouTube lookup, audit trail                                                                     | M + S + M         | L8                     |
| B5    | Bugs found during the audit                                                                            | S each            | fix alongside          |

Order to build: B0 → B2 → B1 → B3 → B4, each piece deployed and checked with the panel slice that
uses it; the step-by-step sequence is in [ROADMAP.md](ROADMAP.md). B0 and B2 are small and are enough
to retire Retool; B1 is the big one.

Nothing here has to break Retool. Every change below keeps the current request shapes working until
Retool is switched off.

---

## B0. Admin access

Today the only credential that works on the 26 admin functions is the Function App **master key**
(`authLevel: 'admin'` plus `x-functions-key === ADMIN_FUNCTIONS_KEY`). It cannot be shipped to a
browser. The Firebase path in `isAdmin()` reads `verificationResult.customClaims`, which does not
exist on a decoded token, so no claim can ever pass; only one hardcoded uid does.

| #    | Change                                                                                                                                                                                                                                                                                     | Where                                                                                                                     | Size                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| B0.1 | `isAdmin` reads the top-level claim: `decoded.admin === true`. Remove the hardcoded uid. Verify with `checkRevoked: true` on admin calls so a removed admin loses access at once                                                                                                           | `src/modules/services/accountService.ts:168-190`                                                                          | S                          |
| B0.2 | Admin functions go from `authLevel: 'admin'` to `'anonymous'`, guarded in code. Move the guard out of each handler into `makeHandler` (an `admin: true` option on registration) so a new admin route cannot forget it. A test asserts every `manage*` route is registered as admin-guarded | `functions/*/index.ts` (26 registrations), `src/common/inversify/make-handler.ts`, `tests/functions/httpTriggers.test.ts` | M                          |
| B0.3 | Keep the function key as a second accepted credential while Retool is alive, but rotate `ADMIN_FUNCTIONS_KEY` to a value that is **not** the host master key. Remove it when Retool is retired                                                                                             | app settings (a human change)                                                                                             | S                          |
| B0.4 | `acceptDocuments` must merge claims instead of replacing them, or accepting terms in the mobile app wipes `admin`                                                                                                                                                                          | `accountService.ts:149-154`                                                                                               | S                          |
| B0.5 | Granting and revoking admins. Minimum: a documented script a human runs (`setCustomUserClaims` merge). Better: `GET/POST manageAdmins` restricted to a `superAdmin` claim, so the panel can show and edit the admin list                                                                   | new                                                                                                                       | S (script) or M (endpoint) |
| B0.6 | `GET manage/me` → `{ uid, email, displayName, admin, superAdmin }`. The panel calls it after sign-in to confirm the backend agrees the user is an admin                                                                                                                                    | new                                                                                                                       | S                          |
| B0.7 | Reachability from the panel's origin. Either add the panel origins to the Function App CORS list (and to Cloudflare if it answers preflights), or let the panel's Worker forward `/api/*` same-origin (no CORS, no preflight). See PLAN.md §6.4                                            | Azure / Cloudflare config (a human change)                                                                                | S                          |
| B0.8 | With token auth `getUserId()` returns the admin's uid. Pass it to every admin mutation as the actor (needed by B4.3)                                                                                                                                                                       | admin handlers                                                                                                            | S                          |
| B0.9 | Unit tests for `isAdmin`: claim true, claim missing, revoked token, key path, no credentials. Today every test mocks it                                                                                                                                                                    | `tests/`                                                                                                                  | S                          |

Protect the three admin endpoints that are registered anonymous today the same way
(`accounts/{userId}`, `manage/wrapped`), and decide whether `internalConfig` should stay public and
CDN-cached (it carries `promotedChallengeId`).

**Claim propagation.** A new claim only appears in a token after refresh (up to an hour). The panel
forces `getIdToken(true)` right after sign-in, so a newly granted admin has to sign out and in once.

---

## B1. Status: draft, published, hidden, deleted

Today there is only `hidden`, and it is a **list filter only**: `GET /challenges/{id}`,
`/workoutPlans/{id}`, `/liveChallenges/{id}`, all three `/schedule/{id}` endpoints and
`GET /workouts/{id}` return hidden content to anyone, CDN-cached, and ids are sequential. `?dev=true`
needs no auth. A draft cannot be built on that.

### Target model

`status: 'draft' | 'published' | 'hidden' | 'deleted'` on challenges and on workouts.

| Status      | Public lists | Public by id / schedule      | `?dev=true` lists | Admin list                      | Validation                                                     |
| ----------- | ------------ | ---------------------------- | ----------------- | ------------------------------- | -------------------------------------------------------------- |
| `draft`     | no           | **404**                      | **no**            | yes                             | relaxed: saved while incomplete, problems returned as warnings |
| `hidden`    | no           | as today (decision D1 below) | yes               | yes                             | full                                                           |
| `published` | yes          | yes                          | yes               | yes                             | full                                                           |
| `deleted`   | no           | **404**                      | no                | only with `includeDeleted=true` | none (read-only)                                               |

Rules:

- `deleted` is a soft delete: the row stays, with `deletedAtUtc` and `deletedBy`. Ids are never
  reused (`getNewId` scans existing rows, so this holds as long as rows are kept).
- A deleted or draft challenge must still **resolve internally**: user history, badge counting,
  Wrapped, admin user progress. The service therefore needs two explicit read modes, "public
  catalogue" and "internal resolution". Today there is one. This split is what makes the block L.
- Restoring a deleted item returns it to `draft`.
- Publishing runs the full `validateAdminChallenge`. A published or hidden challenge cannot
  reference a draft or deleted workout.
- Deleting a workout that a non-deleted challenge uses returns 409 with the list of challenges
  (needs a reverse lookup; the pattern exists in `manageBadgesHandler.buildAssignedChallenges`).
- A draft or deleted challenge cannot be the promoted challenge or a recommendation target.
- New attempts on a draft or deleted challenge are rejected; open attempts on a challenge that gets
  deleted stay abortable (precedent: `abortAttemptOnMissingPath`).
- Saves that start and end in `draft` do **not** purge the CDN and do not write a schedule
  blueprint. This is what makes autosave of a draft affordable.

Compatibility:

- Old rows have no `Status`: derive on read, `Status ?? (Hidden ? 'hidden' : 'published')`.
- Retool posts bodies without `status`. Omitted means "keep the stored status, else derive from
  `hidden`", the same pattern already used for `recommendedNext`. Otherwise a Retool save republishes
  a draft or resurrects a deleted row.
- Old mobile builds read `hidden`. Keep emitting `hidden = status !== 'published'`. Do not add
  `status` to the public DTO unless the app needs it.

### API

| Endpoint                                                               | Change                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST manageChallenges`, `POST manageWorkouts`                         | accept optional `status`; draft-tolerant validation; response carries warnings           |
| `POST manageChallenges/{id}/status`, `POST manageWorkouts/{id}/status` | `{ status, etag }` for publish, hide, delete, restore without resending the whole entity |
| `GET manageChallenges`, `GET manageWorkouts`                           | `?status=`, `?includeDeleted=true`; deleted excluded by default                          |
| Public by-id and schedule endpoints                                    | 404 for draft and deleted (404 is already `private, no-store`)                           |

### Work

The file-by-file list following the repo's 10-layer checklist is in
[research/backend-audit.md §5c](research/backend-audit.md). In short: DB and app models, admin DTOs,
both repositories, `filterChallenges`, `getDto`, `getDtos`, `getSchedule` (and its cache key),
sections, recommendations, `mapFromAdminChallenge`, `validateAdminChallenge`, the three public
handlers' by-id and schedule methods, `workoutService` equivalents, test helpers and the handler
tests for all three endpoint types.

| #    | Piece                                                                                                                             | Size |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| B1.1 | Challenge status with correct public exclusion and internal resolution                                                            | L    |
| B1.2 | Workout status on top                                                                                                             | M    |
| B1.3 | Draft-tolerant validation: errors on publish, warnings while draft; the repository round-trip check must accept the partial shape | M    |
| B1.4 | Status endpoints, list filters, reverse lookup for workout delete                                                                 | S–M  |

### Decisions needed

- **D1. Should `hidden` content stay reachable by id?** Today it is, and internal builds rely on
  `dev=true` lists followed by an open by id. Options: keep as is (hidden means "unlisted"), or
  require `dev=true` on by-id too. Draft and deleted are 404 either way.
- **D2. Per-instance caches.** Other Function instances keep schedules and catalogues in memory for
  two minutes and can refill the CDN with pre-change content right after a purge. For "unpublish
  now" and "delete now" this is a correctness issue. Options: accept up to two minutes, or shorten
  the TTL for those keys, or make the by-id handlers re-check status from storage.
- **D3. Does a deleted challenge still own its badge** for the single-assignment check?

---

## B2. Safe editing

| #     | Gap today                                                                                                                                                                                   | Change                                                                                                                                                                                                                   | Size            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| B2.1  | **No conflict detection.** Writes are whole-row replace with no etag; `updatedAtUtc` in the body is ignored. Two admins, or an admin and their own stale tab, overwrite each other silently | Return the Table Storage `etag` on every admin read. Accept it on write (`If-Match` header or an `etag` field). Mismatch → **409** with the current entity. A missing etag keeps today's behaviour so Retool still works | M               |
| B2.2  | **Create does not return the entity.** Workout create answers `"Workout W12 updated"` (the id is inside the sentence); challenge returns the internal PascalCase model                      | Every upsert returns the saved admin DTO, with `id` and `etag`                                                                                                                                                           | S               |
| B2.3  | **Error contract.** Validation failures are HTTP 500 with one joined string, Polish or English depending on the entity, no field paths. They are also logged as exceptions in App Insights  | Validation → **422** `{ error, errorCode: 'VALIDATION', issues: [{ path, code, message }] }`. Keep `error` as the joined string so Retool's display is unchanged. Stop reporting validation as exceptions                | M               |
| B2.4  | **Lists return everything.** `GET manageChallenges` sends every challenge with every path and day                                                                                           | `?view=summary` on challenges (no paths, no fancy content) and workouts. The panel lists from the summary and loads one item for editing                                                                                 | S               |
| B2.5  | **Message draft identity is `createdAtUtc`.** The upsert DTO has no `id`; the client must resend the exact timestamp                                                                        | Accept `id` on upsert; keep the timestamp rule as a fallback                                                                                                                                                             | S               |
| B2.6  | **Thin validation.** Challenge: no check of title, image, `lengthDays` against the day count, dates, or duplicate `levelId` across paths. Workout: almost nothing                           | Add the missing rules (as publish-time errors under B1.3)                                                                                                                                                                | S–M             |
| B2.7  | Single-item GET exists only for challenges and workouts                                                                                                                                     | Optional: `manageBadges/{id}`, `manageOffers/{id}`. The lists are small; the panel can read from the list                                                                                                                | S, low priority |
| B2.8  | Ad-hoc response shapes: `manageUserProgress` has no DTO, `accounts/{userId}` returns a raw Firebase `UserRecord` and answers 200 for an unknown user                                        | Typed DTOs, 404 for unknown user                                                                                                                                                                                         | S               |
| B2.9  | The admin DTOs are in the npm package `codziennie-fit-dtos` but `internal.ts` is not exported and the package ships raw `.ts`                                                               | Add an `exports` entry for `./internal` and emit `.d.ts`. The panel then type-checks its schemas against the backend's own types                                                                                         | S               |
| B2.10 | **A field missing from the request is wiped.** Upserts build the row from the request alone and replace the stored row, so a client that predates a field erases it on every save           | Omitted means "keep what is stored", by default, for every field. Details below                                                                                                                                          | S–M             |

### B2.10 Omitted fields keep their stored value

The problem has two halves, and each side can only fix its own.

| Half                                                                    | Fixed by                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A client that knows nothing about a field must not erase it             | **Backend**: it is the only place that sees every field and every client (the new panel, Retool, scripts, a browser tab still running last month's bundle) |
| A client must not overwrite a newer value with the stale copy it loaded | **etag** (B2.1), plus the panel sending back what it loaded with only the edited fields changed (PLAN.md §6.2)                                             |

**Why not just change `POST` to "omitted = unchanged".** Retool relies on the opposite for a few
fields: it clears a challenge's `liveAtUtc`, `endsAtUtc` and `availableAtUtc` by leaving them out of
the request. Flipping the rule for those would make "turn this challenge back into a plan" silently
do nothing.

**The change.** In each admin upsert, before validation:

1. Load the stored entity and map it to the admin DTO (the mapper already exists for the GET).
2. For every DTO field that is **absent** from the request, copy the stored value in. `null` in the
   request still means "clear".
3. Exempt a frozen list of today's fields that Retool clears by omission (the three challenge dates;
   check workouts, badges and offers for others). The list is deleted when Retool is retired.
4. Validate and save as today.

Because the default is "keep", a field added next year is protected without anyone remembering to
write the `recommendedNext`-style special case. That special case and the badge handler's partial
merge then fold into the general rule.

Nested objects need the same care, by identity and not by position:

- a path present in the request is merged with the stored path of the same `pathId` (`levelId` until
  B3.3), so a new per-path field survives
- a path absent from the request is removed, as today
- `days`, content blocks and other arrays are replaced whole when present

Also to settle: columns on the stored row that are **not in the admin DTO at all** (server-computed
values, anything another flow writes). Step 1 does not see them, and the row is still replaced
whole. Either map them through explicitly, or build the row to save from the stored row instead of
from scratch. Table Storage's own `Merge` write mode is not a shortcut here: as far as I know it
ignores null properties, so it cannot clear a field. Worth confirming before ruling it out.

**A `PATCH` endpoint is not needed for this.** It would be the same merge behind a second route, and
every client would have to move to it before the hole closed. Making the existing write safe closes
it for all of them at once. A real `PATCH` becomes worthwhile only if payload size matters (it does
not at this scale).

Tests, per entity: a field omitted keeps its value; `null` clears it; an exempt legacy field omitted
is still cleared; a nested path field omitted keeps its value; a brand-new DTO field with no special
handling is kept (the test that proves the default).

---

## B3. Planning storage

The quote adds functions that exist only in Patryk's local app: notes on days and on variants, plan
requirements with validation, the 7-day table with a scratchpad, preparation status of a plan. The
backend stores none of this, and there is no week entity; a schedule is a flat list of days.

**Where it should not live:** inside the challenge row. The whole schedule is one 64 KB string
column, every challenge save purges the CDN and logs a blueprint, and the public mapping already
leaks one "internal" field (`internalTitle`).

**Proposal: a small document store for panel-only data.** The mobile app never reads it, the panel
owns the schema, and the backend only stores, guards and versions it.

| Endpoint                              |                                                 |
| ------------------------------------- | ----------------------------------------------- |
| `GET manage/panelDocs/{kind}`         | list of `{ id, etag, updatedAtUtc, updatedBy }` |
| `GET manage/panelDocs/{kind}/{id}`    | the JSON document plus `etag`                   |
| `PUT manage/panelDocs/{kind}/{id}`    | replace, with `If-Match`; 409 on mismatch       |
| `DELETE manage/panelDocs/{kind}/{id}` |                                                 |

Documents the panel will keep there:

| kind / id                             | Content                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challengePlanning` / `{challengeId}` | calendar colour, internal note, folder; scratchpad (workout ids); per variant: plan type, preparation status and "what is missing" note, planning notes; per day: note, cell tint; per placed workout: note, card colour; per-challenge requirement overrides and custom plan types |
| `settings` / `planTypes`              | global plan types with their requirements (the rules from `weekValidation.js`)                                                                                                                                                                                                      |
| `settings` / `trainingTypeStyles`     | colour and emoji per `workoutsConfig.trainingTypes` id                                                                                                                                                                                                                              |
| `settings` / `folders`                | challenge folders                                                                                                                                                                                                                                                                   |
| `settings` / `aiProfile`              | example descriptions and style notes for AI-written descriptions                                                                                                                                                                                                                    |

Requirements are **validated in the panel** (the rules are pure functions, ported as they are). The
backend does not need to understand them.

| #    | Piece                                                                                                                                                                                                                                                                                                                                                                     | Size |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| B3.1 | Table + four endpoints, etag-guarded, actor recorded, no CDN purge. Documents can exceed one 64 KB property: chunk across columns (helper exists: `src/common/storage/jsonArrayFields.ts`) or store the body in a blob                                                                                                                                                    | M    |
| B3.2 | Deleting a challenge (B1) marks its planning document deleted too                                                                                                                                                                                                                                                                                                         | S    |
| B3.3 | **Stable path id.** A variant is identified by `levelId`, which must come from `workoutsConfig.challengeLevels`, must be unique per challenge (not validated today) and is what user attempts store. Planning data keyed by `levelId` breaks when a variant's level changes. Add an immutable `pathId` to each path, generated on first save, and key planning data by it | M    |
| B3.4 | **Production fields on a workout** the planner shows on every card: `recordingStatus` (`not_recorded`, `recorded`, `in_editing`, `published`, `live`) and `format` (`premiere`, `live`, `running`). They describe the workout, not one placement, so they belong on the workout row, admin-only                                                                           | S    |

**Alternative if backend capacity is the bottleneck:** keep these documents in a Cloudflare D1
database bound to the panel's Worker, which then has to verify the Firebase token and the `admin`
claim itself. It needs no Azure work, but it splits content across two stores and two backup
regimes, and a challenge delete does not cascade. Recommended only as a stopgap.

**Decision D4. Draft workouts created "z palca".** The quote says a hand-typed training creates a
workout. With B1.2 that is a workout with `status: 'draft'`, a title, training types and
B3.4 fields, and nothing else required. Confirm that `imageRelativePath`, `levelId`,
`durationMinutes` and video or audio can all be empty on a draft.

---

## B4. Media, lookups, audit

| #    | Gap today                                                                                                                                                                                                                                               | Change                                                                                                                                                                                                                                                                                                | Size      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| B4.1 | **Upload goes through the Function**, which buffers the whole file and remuxes in memory. No size contract, no progress, no delete, no folder filter; `GET manageMedia/files` lists the whole container every time. SAS helpers are imported but unused | Phase A (enough to start): `?prefix=` and paging on the list. Phase B: `POST manageMedia/uploads` returns a short-lived SAS URL, the browser uploads straight to blob storage, `POST manageMedia/uploads/{id}/complete` finalises (faststart, content type). Optional: delete, with a "used by" check | S, then M |
| B4.2 | The panel must compute `blurHash` and `heightToWidthRatio` itself; the server computes neither                                                                                                                                                          | Either leave it to the panel (it can: canvas + `blurhash`), or compute on upload-complete and return both                                                                                                                                                                                             | S         |
| B4.3 | **No audit trail.** Badges and offers write one App Insights line with a null actor; everything else writes nothing                                                                                                                                     | `AdminAudit` table: actor uid, time, entity, id, action, before/after etags. Written on every admin mutation. `GET manageAudit?entity=&id=` for a "history" tab                                                                                                                                       | M         |
| B4.4 | Creating a workout from a YouTube URL needs title, duration and thumbnail typed by hand                                                                                                                                                                 | Optional `GET manageWorkouts/youtubeLookup?url=` returning title, duration, thumbnail, and the id of an existing workout with that video. Can also live in the panel's Worker                                                                                                                         | S         |
| B4.5 | `WorkoutConfig` (levels, categories, goals, equipment, training types) has no write endpoint; plan sections are hardcoded                                                                                                                               | Out of scope unless wanted. Retool cannot edit it either                                                                                                                                                                                                                                              | M         |

---

## B5. Bugs found during the audit

Verified in code; the runtime effect is inferred and worth one check each before fixing.

| #    | Bug                                                                                                                                                            | Where                                              | Why the panel cares                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B5.1 | CDN purge URL is built with `/purge_cache` twice; the failure is only logged                                                                                   | `src/modules/services/cacheService.ts:164`, `:171` | If the purge has never worked, "publish" and "unpublish" from the panel will not show up until the CDN TTL expires. Check App Insights for `Failed to clear cache` first |
| B5.2 | Creating a workout from a YouTube URL already in the catalogue overwrites the existing workout (the id is the video id, the write is an unconditional replace) | `workoutService.ts:369-374`                        | The panel's "new workout" form can destroy data. Return 409 instead                                                                                                      |
| B5.3 | Creating an audio workout with `videoUrl: null` throws; the client must send `""`                                                                              | `workoutService.ts:387-391`                        |                                                                                                                                                                          |
| B5.4 | `mp4` and `ogg` uploads always fail (listed as supported, missing from the content-type map)                                                                   | `mediaService.ts:122-140`, `:214`                  |                                                                                                                                                                          |
| B5.5 | `unsend` defaults to `dryRun: true`; a client that omits the flag reports success and changes nothing                                                          | `draftMessagesHandler.ts:378`                      | The panel always sends the flag explicitly                                                                                                                               |
| B5.6 | `createRepeatBadges` hard-deletes every milestone badge of the category before recreating them                                                                 | `badgeService.ts:207-215`                          | The panel adds a confirmation naming what will be replaced                                                                                                               |
| B5.7 | `equipmentIds` and `workoutsLength` on a path are computed at challenge save; changing a workout later leaves them stale until the challenge is re-saved       | `challengeService.ts:741-767`                      | Recompute on workout save, or surface "needs re-save"                                                                                                                    |
| B5.8 | Id allocation is scan-then-write; two simultaneous creates can get the same id                                                                                 | `challengeService.ts:942-952`                      | Rare with a handful of admins; fixed for free if creates use insert-if-absent                                                                                            |

---

## What the panel can do before each block lands

| Without | The panel                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| B0      | runs on mock data and mock sign-in only (phases 0–7)                                                                                        |
| B1      | on real data, shows only "Ukryte" as a toggle like Retool; no draft, no delete, no "z palca" workouts                                       |
| B2.1    | saves with last-writer-wins and warns when `updatedAtUtc` changed since load                                                                |
| B2.2    | re-fetches the list after create to find the new id                                                                                         |
| B2.3    | shows server validation as one banner; field-level errors come from client-side validation only                                             |
| B2.4    | loads full lists (as Retool does)                                                                                                           |
| B2.10   | still keeps every field the admin API returns, because it sends back what it loaded; Retool and fields the API does not return stay exposed |
| B3      | planner works on the schedule only; notes, requirements, scratchpad and plan types stay in the mock or in the browser                       |
| B4.1    | uploads through the existing proxy endpoint with a size limit in the UI                                                                     |
| B4.3    | no history tab                                                                                                                              |
