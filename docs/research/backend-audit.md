# Backend audit for a custom React admin panel

Repo: `/Users/mzolnieruk/github/backend` at `fede559` (2026-11-03). Read-only source reading only.
`local.settings.json` was never opened, read or grepped. No script, `az` command or network request was run.
The working tree already had two staged doc edits (`docs/node-runtime-upgrade.md`,
`docs/workout-plan-sections-mobile.md`) before I started; nothing was modified by this audit.

Evidence legend used throughout:

- **[V]** verified in code, with `file:line` (paths relative to the repo root).
- **[D]** stated in the repo's own docs, not verifiable from code (production config).
- **[I]** my inference. Treat as a hypothesis to confirm.

Things I could not verify because they live in production config: the real CORS list, whether
`ADMIN_FUNCTIONS_KEY` equals the host master key, Cloudflare rules and cache TTLs, whether the npm
package is public, and data volumes (how many challenges, workouts, media files).

---

## 0. Headline findings

1. **The whole admin API is protected by one shared secret, and it is the Function App master key.**
   26 functions are registered with `authLevel: 'admin'` [V], which the Azure host only satisfies
   with the host master key; the handlers then compare the same header with `ADMIN_FUNCTIONS_KEY`.
   That key cannot be shipped to a browser. There is no per-user admin identity in practice.
2. **A Firebase-token admin path exists in code but is effectively dead.** `isAdmin()` reads
   `verificationResult.customClaims`, which does not exist on a decoded ID token (claims are
   top-level), so only one hardcoded uid can ever pass [V code, I runtime effect]. And for the 26
   `authLevel: 'admin'` functions the platform rejects the request before that code runs.
3. **A browser SPA on another origin cannot call the API today**: no CORS handling in code or
   `host.json` [V]; platform CORS is `https://portal.azure.com` only [D].
4. **`hidden` is a list-only filter.** `GET /challenges/{id}`, `/workoutPlans/{id}`,
   `/liveChallenges/{id}` and all three `/schedule/{id}` endpoints serve hidden challenges to anyone,
   CDN-cached, and ids are sequential (`C1`, `C2`, …) [V]. `?dev=true` is unauthenticated. A real
   `draft` state cannot reuse this mechanism.
5. **No delete of any kind for challenges, workouts, media, offers or message drafts** [V].
6. **Upserts are whole-row "Replace" with no etag**: last writer wins, silently [V].
7. Smaller bugs found on the way (section 9): CDN purge URL looks doubled, creating a workout with a
   YouTube URL that already exists silently overwrites the existing workout, `mp4`/`ogg` uploads
   always fail, validation failures are returned as HTTP 500.

---

## 1. HTTP endpoint table

Programming model: Azure Functions v4 (`app.http(...)`) registered in `functions/*/index.ts`; there
are no `function.json` files. Route prefix is the default `api` (`host.json` has no `extensions.http`)
[V `host.json:1-17`]. 67 HTTP functions + 1 Service Bus trigger. No timers [V; also D
`docs/flex/migration.md:140`].

`authLevel` defaults to `anonymous` when omitted [V `node_modules/@azure/functions/src/trigger.ts:50`].
A function with no `route` is served at its function name.

Dispatch: `makeHandler` resolves the handler from the DI container and switches on
`request.method` for GET/POST/DELETE/PUT only [V `src/common/inversify/make-handler.ts:25-56`].

### 1a. Admin-oriented endpoints (all flagged ADMIN)

"In-code check" = `accountService.isAdmin(request)` at the top of the handler method.

| Route (`/api/…`) | Methods | Function name | Azure authLevel | In-code check | Handler | Request | Response |
|---|---|---|---|---|---|---|---|
| `manageChallenges` | GET | `manageChallenges` | **admin** | isAdmin | `src/handlers/admin/manageChallangesHandler.ts:39` | none (no paging, no filters) | `ChallengeUpsertAdminDto[]`, every challenge with full paths and days |
| `manageChallenges` | POST | `manageChallenges` | **admin** | isAdmin | `…/manageChallangesHandler.ts:76` | body `ChallengeUpsertAdminDto` | `{ result: "Challenge C12 updated", update: <internal Challenge model, PascalCase> }` (`:132`) |
| `manageChallenges/{id}` | GET | `manageChallengesById` | **admin** | isAdmin | `…/manageChallangesHandler.ts:60` | path `id` | `ChallengeUpsertAdminDto`, 404 if missing |
| `manageChallenges/promotedChallenge` | POST | `manageChallengesPromoted` | **admin** | isAdmin | `…/manageChallangesHandler.ts:140` | `PromotedChallengeUpsertAdminDto` | `{ result, promotedChallengeId }` |
| `manageWorkouts` | GET | `manageWorkouts` | **admin** | isAdmin | `src/handlers/admin/manageWorkoutsHandler.ts:32` | none | `WorkoutResultAdminDto[]` (all) |
| `manageWorkouts` | POST | `manageWorkouts` | **admin** | isAdmin | `…/manageWorkoutsHandler.ts:69` | `WorkoutUpsertAdminDto` | `{ result: "Workout W12 updated" }` only; the id is inside the string (`:113`) |
| `manageWorkouts/{id}` | GET | `manageWorkoutsById` | **admin** | isAdmin | `…/manageWorkoutsHandler.ts:53` | path `id` | `WorkoutResultAdminDto` |
| `manageMedia/files` | GET | `manageMedia` | **admin** | isAdmin | `src/handlers/admin/mediaManagementHandler.ts:25` | none | `AllMediaResponseDto` (every blob in the `public` container, newest first) |
| `manageMedia/files?relativePath=…` | POST | `manageMedia` | **admin** | isAdmin | `…/mediaManagementHandler.ts:41` | raw binary body, query `relativePath` | `MediaUploadResponseDto` |
| `manageBadges` | GET | `manageBadgesGet` | **admin** | isAdmin | `src/handlers/admin/manageBadgesHandler.ts:47` | none | `BadgeResultAdminDto[]` |
| `manageBadges` | POST | `manageBadgesUpsert` | **admin** | isAdmin | `…/manageBadgesHandler.ts:69` → `:100` | `BadgeUpsertAdminDto` | `{ result, savedBadges: BadgeUpsertAdminDto[] }` |
| `manageBadges/createRepeatBadges` | POST | `manageBadgesCreateRepeat` | **admin** | isAdmin | `…/manageBadgesHandler.ts:196` | `CreateRepeatBadgesAdminDto` | `{ result, savedBadges }`. Deletes and recreates all milestone badges of the category (`src/modules/services/badgeService.ts:207-215`) |
| `manageBadges/grantManual` | POST | `manageBadgesGrantManual` | **admin** | isAdmin | `…/manageBadgesHandler.ts:229` | `GrantManualBadgeAdminDto` | `{ result }` |
| `manageBadges/revokeManual` | POST | `manageBadgesRevokeManual` | **admin** | isAdmin | `…/manageBadgesHandler.ts:255` | `RevokeManualBadgeAdminDto` | `{ result }` |
| `manageOffers` | GET | `adminOffersGet` | **admin** | isAdmin | `src/handlers/admin/adminOffersHandler.ts:24` | none | `SpecialOfferResultAdminDto[]` |
| `manageOffers` | POST | `adminOffersUpsert` | **admin** | isAdmin | `…/adminOffersHandler.ts:46` | `SpecialOfferUpsertAdminDto` | `{ result, savedOffers: [SpecialOfferResultAdminDto] }` |
| `manageUsers?query=&email=&name=&limit=&refresh=` | GET | `adminUsersSearch` | **admin** | isAdmin | `src/handlers/admin/adminUsersHandler.ts:35` | query only | `AdminUserSearchResponseDto` |
| `manageUserBadges/{userId}` | GET | `adminUserBadgesGet` | **admin** | isAdmin | `src/handlers/admin/adminUserBadgesHandler.ts:28` | path | `UserBadgesResponseDto` |
| `manageUserBadges/{userId}/grants` | GET | `adminUserBadgeGrantsGet` | **admin** | isAdmin | `…/adminUserBadgesHandler.ts:59` | path | `UserManualBadgeGrantAdminDto[]` |
| `manageUserProgress/{userId}` | GET | `adminUserProgressGet` | **admin** | isAdmin | `src/handlers/admin/adminUserProgressHandler.ts:30` | path | untyped `{ workouts: [...], challenges: [...] }` (`:117-120`), no DTO |
| `manageMessageDrafts/list` | GET | `listDraftMessages` | **admin** | isAdmin | `src/handlers/admin/draftMessagesHandler.ts:42` → `:65` | none | `{ count, messages: DraftMessageListAdminResponseDto[] }` |
| `manageMessageDrafts/upsert` | POST | `upsertMessageDraft` | **admin** | isAdmin | `…/draftMessagesHandler.ts:122` | `DraftMessageUpsertAdminRequestDto` | `DraftMessageActionAdminResponseDto` |
| `manageMessageDrafts/archive` | POST | `archiveMessageDraft` | **admin** | isAdmin | `…/draftMessagesHandler.ts:234` | `DraftMessageIdAdminRequestDto` | `DraftMessageActionAdminResponseDto` |
| `manageMessageDrafts/publish` | POST | `publishMessageDraft` | **admin** | isAdmin | `…/draftMessagesHandler.ts:295` | `DraftMessageIdAdminRequestDto` | `DraftMessageActionAdminResponseDto` |
| `manageMessageDrafts/unsend` | POST | `unsendMessageDraft` | **admin** | isAdmin | `…/draftMessagesHandler.ts:369` | `{ id, dryRun? }`, **`dryRun` defaults to true** (`:378`) | `{ result, message, unsentCount, queuedMessages, dryRun }` |
| `usage/transactions` | GET | `transactions` | **admin** | isAdmin | `src/handlers/admin/usageHandler.ts:24` | none | CSV body `"disabled"` (`:35`), effectively dead |
| `usage/customers` | GET | `customers` | **admin** | isAdmin | `…/usageHandler.ts:38` | none | customers array |
| `usage/fetchCustomers` | POST | `fetchCustomers` | **admin** | isAdmin | `…/usageHandler.ts:57` | none | JSON string of the refresh result |
| `youTubeSync/{action}` | GET, POST | `youTubeSync` | **admin** | isAdmin | `src/handlers/admin/youTubeSyncHandler.ts:34` | path `action` | legacy one-off importer. Reads `videosYouTube.json` from disk, which `.funcignore` excludes, so it cannot work in production [V `.funcignore` comment]. POST is not implemented (501) |
| `accounts/{userId}` | GET | `accounts` | **anonymous** | isAdmin | `src/handlers/admin/userManagementHandler.ts:25` | path | `{ hasProSubscription, account: <Firebase UserRecord> }`; unknown user is **200** `{ message }` (`:37-41`) |
| `accounts/{userId}` | PUT | `accounts` | **anonymous** | isAdmin | `…/userManagementHandler.ts:50` → `:55` | `UserUpdateDto` | `{ result, user: {...}, oldEmail }` |
| `manage/wrapped?userId=` | GET | `adminWrapped` | **anonymous** | isAdmin | `src/handlers/admin/adminWrappedHandler.ts:25` | query `userId` | `{ userId, isWindowOpen, wrapped, userProgress }` |
| `internalConfig` | GET | `internalConfig` | **anonymous** | **none** | `src/handlers/adminConfigHandler.ts:28` | none | `AdminInternalConfigDto`, returned with the **public CDN cache header** (`:87`) |

Notes:

- `internalConfig` is the only admin-purpose endpoint with no protection at all, and it is
  publicly cacheable. Content is low-sensitivity (Polish labels, badge sections,
  `promotedChallengeId`), but because it is edge-cached, a promoted-challenge change depends on the
  CDN purge working.
- The Retool export in the repo (`Panel.json`, dated 2026-08-17, no secrets in it) calls:
  `manageChallenges`, `manageChallenges/{{id}}`, `manageChallenges/promotedChallenge`,
  `manageWorkouts`, `manageMedia/files`, `manageMedia/files?relativePath=…`,
  `manageMessageDrafts/{list,upsert,publish,archive}`, `manageBadges`, `internalConfig`,
  `accounts/{{userId}}`, `manageUserBadges/{{userId}}`, `manageUserProgress/{{userId}}`, and
  `workoutsConfig` (19 references) [V by string search]. It predates offers and user search.

### 1b. "`admin*` routes 404 in production": current state

No registered **route** starts with `admin` or `runtime` today; `tests/functions/httpTriggers.test.ts:103-109`
guards it against the effective route. What still carries the `admin` name:

| Function folder | Function names | Actual route strings |
|---|---|---|
| `functions/adminConfig` | `internalConfig` | `internalConfig` (no explicit route) |
| `functions/adminOffers` | `adminOffersGet`, `adminOffersUpsert` | `manageOffers` (`functions/adminOffers/paths.ts:4`) |
| `functions/adminUserBadges` | `adminUserBadgesGet`, `adminUserBadgeGrantsGet` | `manageUserBadges/{userId}`, `manageUserBadges/{userId}/grants` |
| `functions/adminUserProgress` | `adminUserProgressGet` | `manageUserProgress/{userId}` |
| `functions/adminUsers` | `adminUsersSearch` | `manageUsers` |
| `functions/wrapped` | `adminWrapped` | `manage/wrapped` |

The folder and function names are harmless; only the route matters. The risk is a future function
that omits `route` and is *named* `adminSomething`: its effective route would then be the name. The
test covers that case because it falls back to the function name (`httpTriggers.test.ts:47-49`).
Stale doc: `docs/badges.md` TODO still mentions `GET admin/users/{userId}/badges`.

### 1c. Mobile client endpoints (all `authLevel` anonymous)

"FB" = requires a Firebase ID token (`getUserId` → 401 when missing). "CDN" = sent with
`Cloudflare-CDN-Cache-Control: public` unless `?dev=true`.

| Route (`/api/…`) | Methods | Handler | Auth | Request | Response |
|---|---|---|---|---|---|
| `appConfig` | GET | `src/handlers/appConfigHandler.ts:26` | none | none | `AppConfigDto` (CDN) |
| `workoutsConfig` | GET | `src/handlers/workoutConfigHandler.ts:24` | none | none | `WorkoutConfigDto` (CDN) |
| `wakeup` | GET | `src/handlers/wakeUpHandler.ts:28` | none | none | `{ time, workouts, challenges, config }` (CDN) |
| `files?path=` | GET | `src/handlers/filesHandler.ts:24` | none | query `path` | 302 to the blob URL |
| `challenges` | GET | `src/handlers/challengeHandler.ts:26` | none (FB if `userCompleted` is sent) | `ChallengesRequestDto` as query, `dev` | `LegacyChallengeDto[]` (CDN unless user-specific) |
| `challenges/{id}` | GET | `…/challengeHandler.ts:58` | none | path | `LegacyChallengeDto` (CDN) |
| `challenges/schedule/{id}` | GET | `…/challengeHandler.ts:74` | none | path | `ChallengeScheduleDto` (CDN) |
| `liveChallenges` | GET | `src/handlers/liveChallengeHandler.ts:26` | as above | as above | `LiveChallengeDto[]` |
| `liveChallenges/{id}` | GET | `…/liveChallengeHandler.ts:59` | none | path | `LiveChallengeDto` |
| `liveChallenges/schedule/{id}` | GET | `…/liveChallengeHandler.ts:79` | none | path | `ChallengeScheduleDto` |
| `workoutPlans` | GET | `src/handlers/workoutPlanHandler.ts:27` | as above | `ChallengesRequestDto` + `sectionId` | `WorkoutPlanDto[]` |
| `workoutPlanSections` | GET | `…/workoutPlanHandler.ts:84` | none | `WorkoutPlanSectionsRequestDto` | `WorkoutPlanSectionDto[]` |
| `workoutPlans/{id}` | GET | `…/workoutPlanHandler.ts:64` | none | path | `WorkoutPlanDto` |
| `workoutPlans/schedule/{id}` | GET | `…/workoutPlanHandler.ts:118` | none | path | `ChallengeScheduleDto` |
| `workouts` | GET | `src/handlers/workoutHandler.ts:26` | **FB** | `WorkoutsRequestDto` as query | `WorkoutDto[]` (CDN unless user-specific) |
| `workouts/{id}` | GET | `…/workoutHandler.ts:55` | none | path | `WorkoutDto` (CDN) |
| `user/workouts/progress` | GET | `src/handlers/userProgressHandler.ts:58` → `:91` | FB | none | `UserProgressReponseDto` |
| `user/workouts/{id}/details` | GET | `…/userProgressHandler.ts:199` | FB | path | `UserWorkoutDetailsReponseDto` |
| `user/workouts/favorite` | GET | `…/userProgressHandler.ts:100` | FB | paging | `WorkoutDto[]` |
| `user/workouts/favorite` | POST | `…/userProgressHandler.ts:439` | FB | `UserWorkoutFavoriteRequestDto` | `{ result }` |
| `user/workouts/note` | POST | `…/userProgressHandler.ts:460` | FB | `UserWorkoutNoteRequestDto` (max 500 chars) | `{ result }` |
| `user/workouts/complete` | POST | `…/userProgressHandler.ts:224` | FB | `UserWorkoutCompletetionRequestDto` | `UserWorkoutCompletetionResponseDto` (200, or 208 for a duplicate) |
| `user/workouts/deleteCompletion` | POST | `…/userProgressHandler.ts:275` | FB | `UserWorkoutDeleteCompletetionRequestDto` | `UserWorkoutDeleteCompletetionResponseDto` |
| `user/workouts/editCompletion` | POST | `…/userProgressHandler.ts:318` | FB | `UserWorkoutEditCompletetionRequestDto` | `UserWorkoutEditCompletetionResponseDto` |
| `user/workouts/calendar` | GET | `…/userProgressHandler.ts:150` | FB | `fromDate`, `toDate` | `UserWorkoutCalendarResponseDto` |
| `user/workouts/history` | GET | `…/userProgressHandler.ts:111` | FB | `UserWorkoutHistoryRequestDto` | `UserWorkoutHistoryReponseDto` |
| `user/challenges/history` | GET | `…/userProgressHandler.ts:140` | FB | paging | `UserChallengeHistoryReponseDto` |
| `user/challenges/attemptProgress` | POST | `src/handlers/userChallengeProgressHandler.ts:44` → `:52` | FB | `UserChallengeAttemptUpsertDto` | `UserChallengeAttemptUpsertResponseDto` (409 on `OTHER_CHALLENGE_STARTED`) |
| `user/badges` | GET | `src/handlers/userBadgesHandler.ts:26` | FB | none | `UserBadgesResponseDto` |
| `user/badges/claim` | POST | `…/userBadgesHandler.ts:45` | FB | `ClaimEventBadgeRequestDto` | `ClaimEventBadgeResponseDto` |
| `user/messages` | GET | `src/handlers/userMessagesHandler.ts:31` → `:50` | FB | `MessagesRequestDto` | `UserMessageDto[]` |
| `user/messages/unread` | GET | `…/userMessagesHandler.ts:67` | FB | none | `UnreadMessagesCountDto` |
| `user/notificationToken` | POST | `src/handlers/userNotificationTokenHandler.ts:25` | FB | `UserNotificationTokenUpsertDto` | `{ result }` |
| `user/workouts/wrapped` | GET | `src/handlers/wrappedHandler.ts:23` | FB | none | `WrappedResponseDto` or 204 |
| `offers/verify` | POST | `src/handlers/offersHandler.ts:30` | FB | `VerifyOfferRequestDto` | `VerifyOfferResponseDto` |
| `account/acceptDocuments` | POST | `src/handlers/accountHandler.ts:23` → `:31` | FB | `UserDocumentsAcceptanceDto` | `{ result, message }` |
| `account` | DELETE | `src/handlers/accountHandler.ts:50` | FB | none | `{ result }`. Deletes the Firebase Auth user only (`src/modules/services/accountService.ts:110-123`) |

### 1d. Webhook and queue

| Trigger | Handler | Auth | Notes |
|---|---|---|---|
| `POST /api/events/customer` (function `revenuecat`) | `src/handlers/webhookHandler.ts:47` | `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET` (`:48-51`); a mismatch is a 500, not a 401 | RevenueCat webhook: refreshes subscription, records offer attribution |
| Service Bus queue `user-messages` (function `processMessageQueue`) | `src/handlers/processMessageQueueHandler.ts:31` | connection `SERVICE_BUS_CONNECTION_STRING` | fan-out of published / unsent messages, 250 users per queue message (`src/modules/repositories/messageQueueRepository.ts:13`) |

---

## 2. Authentication and authorization

### 2a. How a mobile user is identified [V]

Firebase Admin SDK is initialised from the `FIREBASE_KEY` env var
(`src/common/expensive-object/expensive-connection.ts:23-27`). The user is identified solely by the
Firebase ID token in the `Authorization` header; the uid comes from the verified token, never from a
path or body field:

```ts
// src/modules/services/accountService.ts:125-147
async getUserId(request: HttpRequest): Promise<string> {
    try {
        const auth = this.expensiveConnection.firebaseAuth
        const token = this.getToken(request)
        if (!token) {
            return null
        }
        const verificationResult = await auth.verifyIdToken(token)
        return verificationResult?.uid
    } catch (e) {
        console.log("Failed to get user id: " + e)
        return null
    }
}

getToken(request: HttpRequest) {
    const authorization = request.headers.get("authorization")
    if (authorization == null || authorization.length < 8) {
        return null
    }
    return authorization.slice(7);
}
```

Details that matter:

- `getToken` strips 7 characters without checking the `Bearer ` prefix.
- `verifyIdToken(token)` is called without `checkRevoked`, so a disabled or revoked user keeps
  working until the token expires (about an hour) [I, from Firebase SDK semantics].
- Each handler opts in by calling `getUserId` and returning `wrapWithMissingAuth` (401). There is no
  middleware, so an endpoint is public unless its handler remembers to check. The catalogue
  endpoints (`challenges`, `workoutPlans`, `liveChallenges`, `workouts/{id}`, configs) are public.
- The only custom claim written anywhere is terms acceptance, and the call **replaces all claims**:

```ts
// src/modules/services/accountService.ts:149-154
async acceptDocuments(userId: String, termsAndPrivacyVersion: number): Promise<void> {
    const auth = this.expensiveConnection.firebaseAuth
    await auth.setCustomUserClaims(userId as string, {
        "acceptedTermsAndPrivacyVersion": termsAndPrivacyVersion
    })
}
```

  [I] `setCustomUserClaims` overwrites the whole claims object, so an `admin: true` claim set on a
  user would be wiped the next time that user accepts terms in the mobile app. This must be fixed
  (merge existing claims) before introducing an admin claim.

### 2b. How admin endpoints protect themselves [V]

Two layers, and both currently resolve to the same shared key.

**Layer 1, platform.** 26 registrations carry `authLevel: 'admin'` (e.g.
`functions/manageChallenges/index.ts:9`). On Azure this level is only satisfied by the host master
key, sent as `x-functions-key` or `?code=`. The local Functions host does not enforce it. The
repo's own doc describes it:

> "Retool sends `x-functions-key`; the platform checks it against the host master key (26 functions
> use `authLevel: admin`), then `accountService.isAdmin` compares it with `ADMIN_FUNCTIONS_KEY`"
> [D `docs/flex/migration.md:138`]

and `docs/flex/migration.md:471-472` says a 403 on an admin read "means `ADMIN_FUNCTIONS_KEY` differs
from the master key", i.e. the two are expected to be equal.

**Layer 2, code.**

```ts
// src/modules/services/accountService.ts:168-190
async isAdmin(request: HttpRequest): Promise<boolean> {
    const functionsKey = request.headers.get('x-functions-key');
    const adminFunctionsKey = process.env.ADMIN_FUNCTIONS_KEY;
    if (functionsKey && adminFunctionsKey && functionsKey === adminFunctionsKey) {
        return true;
    }

    try {
        const auth = this.expensiveConnection.firebaseAuth;
        const token = this.getToken(request);
        if (!token) {
            return false;
        }
        const verificationResult = await auth.verifyIdToken(token);

        // Check if user has admin custom claim
        const customClaims = verificationResult.customClaims || {};
        return customClaims.admin === true || customClaims.isAdmin === true || verificationResult.uid == '<redacted-uid>';
    } catch (error) {
        this.logger.error(`Error checking admin status: ${error}`);
        return false;
    }
}
```

What this means precisely:

- **Is there a concept of an admin user, claim or role?** Nominally yes (`admin` / `isAdmin` custom
  claim), in practice no. `DecodedIdToken` has no `customClaims` member; it only type-checks because
  of the index signature `[key: string]: any`
  (`node_modules/firebase-admin/lib/auth/token-verifier.d.ts:149`). Firebase puts custom claims at
  the top level of the decoded token, so `verificationResult.customClaims` is `undefined` and the
  claim branch can never be true [I]. Nothing in the repo ever *sets* an `admin` claim either [V,
  searched `setCustomUserClaims`: one call, the terms one]. The only Firebase identity that passes
  is the single hardcoded uid.
- `isAdmin` has no unit test; every test mocks it (`tests/helpers.ts:186`, plus the handler tests)
  [V].
- **Where the Firebase path is reachable at all:** only on the three admin endpoints registered
  anonymous: `accounts/{userId}` (GET, PUT), `manage/wrapped`, and `internalConfig` (which checks
  nothing). On the 26 `authLevel: 'admin'` functions a request carrying only a Firebase token is
  rejected by the platform with 401 before `isAdmin` runs [I, standard Functions behaviour; D the
  migration doc's 401 vs 403 explanation matches].
- **Actor identity is lost.** Handlers call `getUserId` "for auditing", and it is `null` whenever the
  caller used the function key, which is always the case for Retool
  (`src/handlers/admin/userManagementHandler.ts:60-73`, `manageBadgesHandler.ts:74`,
  `adminOffersHandler.ts:51`).
- A 403 from `wrapWithInsufficientAccess` ignores its message argument and always returns the same
  Polish text (`src/common/handlers/base.handler.ts:207-218`).

Search evidence: `firebase`, `verifyIdToken`, `Authorization`, `Bearer`, `x-functions-key`,
`authLevel`, `claims`, `isAdmin`, `role`, `scope` across `src/` and `functions/`. `verifyIdToken`
appears twice (the two snippets above). No `role` or `scope` concept exists. Other `Bearer` uses
are outbound calls to Cloudflare and RevenueCat.

### 2c. Consequence for the SPA

The master key grants the Functions host admin API as well as these endpoints, so it must never
reach a browser. Two realistic shapes:

1. **Backend change (cleanest):** set the admin functions to `authLevel: 'anonymous'`, make
   `isAdmin` read top-level claims (`decoded.admin === true`), keep the function key as a second
   accepted credential for Retool during migration, fix `acceptDocuments` to merge claims, add CORS,
   add `GET manage/me`. Size M.
2. **No backend auth change:** the admin-panel repo is a React Router app on Cloudflare Workers
   (`/Users/mzolnieruk/github/admin-panel/wrangler.json`, `workers/`), so its server-side
   loaders/actions could proxy to the API with the key held as a Worker secret, with Firebase or
   Cloudflare Access in front of the Worker. This sidesteps CORS and the key problem, but the
   backend still cannot tell admins apart (no per-user audit) unless the Worker forwards an
   identity header the backend trusts. [I, design option]

---

## 3. CORS

- `host.json` contains only logging and the extension bundle; no `extensions.http`, no
  `customHeaders`, no CORS block [V `host.json:1-17`].
- No code sets `Access-Control-*` headers. Every response helper sets only `content-type` and
  `Cloudflare-CDN-Cache-Control` [V `src/common/handlers/base.handler.ts:57-218`].
- No function registers `OPTIONS`, and `makeHandler` has no `OPTIONS` case
  [V `src/common/inversify/make-handler.ts:45-54`].
- Platform CORS on the Function App is "`https://portal.azure.com` only" per the inventory taken
  read-only on 2026-10-20 [D `docs/flex/migration.md:137`]. Local-dev CORS, if any, would live in
  `local.settings.json`, which I did not read.
- The origin only accepts Cloudflare IP ranges (22 allow rules) [D `docs/flex/migration.md:136`],
  so the SPA must go through `api.codzienniefitapp.com`.

**Verdict:** a browser SPA on another origin cannot call the API today. Every admin call needs a
custom header (`x-functions-key` or `Authorization`) and usually a JSON body, so the browser sends a
preflight that nothing answers for a foreign origin. Fix options: add the SPA origin(s) to the
Function App CORS list (portal / `az`, a human change), or answer CORS at Cloudflare, or use the
same-origin Worker proxy from 2c.

---

## 4. Admin DTOs and validators

### 4a. `src/models/dto/internal.ts`, verbatim (386 lines)

```ts
import { FancyContentDto } from ".";

// ─── Badge admin DTOs ──────────────────────────────────────────────────────────

export interface BadgeUpsertAdminDto {
    id?: string | null;
    name: string;
    imageRelativePath: string;
    comment?: string | null;
    type: 'normal' | 'manual' | 'milestone' | 'perfections';
    // normal only
    sectionId?: string | null;
    subsectionId?: string | null;
    // manual only
    specialCategory?: 'event' | 'specialTraining' | null;
    // milestone (repeat) only
    repeatCategory?: string | null;
    milestoneCount?: number | null;
    activeFromUtc?: string | null;
    activeTillUtc?: string | null;
    isHidden?: boolean | null;
    // event badges (manual + specialCategory 'event') only
    claimToken?: string | null;      // empty/omitted on create → generated server-side
    isClaimLinkActive?: boolean | null;
}

export interface AssignedWorkoutDto {
    id: string;
    name: string;
}

export interface AssignedChallengeDto {
    id: string;
    name: string;
    type: 'plan' | 'challenge';
}

export interface BadgeResultAdminDto {
    id: string;
    name: string;
    imageRelativePath: string;
    comment?: string | null;
    type: string;
    repeatCategory?: string | null;
    milestoneCount?: number | null;
    specialCategory?: string | null;
    sectionId?: string | null;
    subsectionId?: string | null;
    activeFromUtc?: string | null;
    activeTillUtc?: string | null;
    isHidden?: boolean | null;
    claimToken?: string | null;
    isClaimLinkActive?: boolean | null;
    createdAtUtc: string;
    updatedAtUtc: string;
    assignedToWorkouts: AssignedWorkoutDto[];
    assignedToChallenges: AssignedChallengeDto[];
}

export interface CreateRepeatBadgesAdminDto {
    repeatCategory: string; // RepeatCategory enum value
    milestones: number[];
    titleTemplate: string;  // must contain "{x}"
    imageTemplate: string;  // must contain "{x}"
    comment?: string | null;
    activeFromUtc?: string | null;
    activeTillUtc?: string | null;
    isHidden?: boolean | null;
}

export interface BadgeDeleteAdminDto {
    id: string;
}

export interface GrantManualBadgeAdminDto {
    userId: string;
    badgeId: string;
}

export interface RevokeManualBadgeAdminDto {
    userId: string;
    badgeId: string;
    grantedAtUtc: string;
}

// Row of GET manageUserBadges/{userId}/grants — every manual-badge grant
// (admin-granted and event-link claims) with its assignment date.
export interface UserManualBadgeGrantAdminDto {
    grantId: string;
    badgeId: string;
    badgeName: string | null;
    specialCategory: string | null;
    grantedAtUtc: string;
}

// ─── Workout admin DTOs ───────────────────────────────────────────────────────

export interface WorkoutUpsertAdminDto {
    id: string | null | undefined;
    title: string;
    addedAtUtc: string;
    liveAtUtc?: string | null | undefined;
    availableAtUtc?: string | null | undefined;
    internalTitle?: string | null | undefined;
    updatedAtUtc: string;
    hidden: boolean;
    pro: boolean;
    durationMinutes: number;
    imageRelativePath: string;
    audioRelativePath: string | null | undefined;
    videoUrl: string | null | undefined;
    blurHash: string | null | undefined;
    levelId: string;
    equipmentIds: string[];
    trainingTypeIds: string[];
    descriptionFancyContent: AdminFancyContentDto[];
    badgeId?: string | null;
}

export interface AdminFancyContentDto {
    type: string;
    content: string;
    metadata: AdminFancyContentMetadataDto | null | undefined;
}

export interface AdminFancyContentMetadataDto {
    imageRelativePath: string;
    heightToWidthRatio: number;
}

export interface WorkoutResultAdminDto extends WorkoutUpsertAdminDto {
    updatedAtUtc: string;
}

export interface ChallengeUpsertAdminDto {
    id: string;
    title: string;
    subtitle: string;
    addedAtUtc: string;
    updatedAtUtc: string;
    liveAtUtc?: string | null | undefined;
    endsAtUtc?: string | null | undefined;
    availableAtUtc?: string | null | undefined;
    imageRelativePath: string;
    descriptionFancyContent: AdminFancyContentDto[];
    lengthDays: number;
    pro: boolean;
    hidden: boolean;
    internalTitle?: string | null | undefined;
    categoryId?: string | null | undefined;
    goalsIds: string[] | null | undefined;
    difficultyLevelsIds: string[] | null | undefined;
    visibleDaysUpFront?: number | null;
    offeringId?: string | null | undefined;
    offeringDiscountedId?: string | null | undefined;
    /**
     * Every entitlement that unlocks this challenge. The **first** one is what buying this very
     * challenge grants - it is what clients predating the list read, so its position matters.
     */
    unlockedByEntitlementIds?: string[] | null | undefined;
    discountedForEntitlementIds?: string[] | null | undefined;
    paths: ChallengeUpsertPathDetailsDto[];
    badgeId?: string | null;
    perfectCompletionBadgeId?: string | null;
    /**
     * Challenges/plans to suggest after completing this one, in order. Duplicates are dropped on
     * save (first occurrence wins); every id must be an existing challenge other than this one.
     * Omitted → the stored list is kept (a panel predating the field must not wipe it);
     * null or [] → cleared.
     */
    recommendedNext?: ChallengeRecommendationAdminDto[] | null | undefined;
}

// One "do this next" suggestion. An object rather than a bare id so metadata can be added later.
export interface ChallengeRecommendationAdminDto {
    id: string;
}

export interface ChallengeUpsertPathDetailsDto {
    levelId: string;
    equipmentIds: string[] | null | undefined;
    difficultyLevelsIds: string[] | null | undefined;
    frequency: string;
    minimumDaysToComplete: number;
    description?: string | null | undefined;
    pro: boolean | null | undefined;
    days: ChallengeUpsertPathDayDto[];
}

export interface ChallengeUpsertPathDayDto {
  dayIndex: number;
  workoutIds: string[]
}

export interface AllMediaResponseDto {
    files: MediaFileDto[];
}

export interface MediaFileDto {
    path: string;
    type: MediaTypeDto;
    createdAtUtc: string;
}

export enum MediaTypeDto {
    Image = "image",
    Video = "video",
    Audio = "audio",
    Other = "other"
}

export interface MediaUploadResponseDto {
    requestedRelativePath: string;
    relativePath: string;
    type: MediaTypeDto;
    contentType: string;
    cacheControl: string;
    pathSanitized: boolean;
    renamedToAvoidOverwrite: boolean;
    faststartApplied: boolean;
    faststartReason: string;
    originalSizeBytes: number;
    uploadedSizeBytes: number;
    message: string;
}

export enum DraftMessageTargetGroupDto {
    All = "all",
    Subscribers = "subscribers",
    NonSubscribers = "nonSubscribers",
    Challenge = "challenge"
}

export enum DraftMessageStatusDto {
    Draft = "draft",
    Sent = "sent",
    Archived = "archived"
}

// Draft Message Admin DTOs
export interface DraftMessageListAdminResponseDto {
    id: string;
    title: string;
    from: string;
    status: DraftMessageStatusDto;
    createdAtUtc: string;
    targetGroup: DraftMessageTargetGroupDto;
    targetGroupValue?: string 
    sentAtUtc: string | null;
    archivedAtUtc?: string | null;
    fancyContent: AdminFancyContentDto[];
}

export interface DraftMessageUpsertAdminRequestDto {
    title: string;
    from: string;
    targetGroup: DraftMessageTargetGroupDto;
    targetGroupValue?: string
    fancyContent: AdminFancyContentDto[];
    createdAtUtc: string;
    overrideAlreadySent?: boolean;
}

export interface DraftMessageIdAdminRequestDto {
    id: string;
    dryRun?: boolean;
}

export interface DraftMessageDetailAdminResponseDto {
    id: string;
    title: string;
    from: string;
    status: DraftMessageStatusDto;
    createdAtUtc: string;
    targetGroup: DraftMessageTargetGroupDto;
    targetGroupValue?: string
    fancyContent: AdminFancyContentDto[];
    sentAtUtc: string | null;
    archivedAtUtc: string | null;
}

export interface DraftMessageActionAdminResponseDto {
    result: string;
    message: DraftMessageDetailAdminResponseDto;
}

export interface PromotedChallengeUpsertAdminDto {
    promotedChallengeId: string | null;
}

export interface AdminInternalConfigDto {
    draftMessageStates: {
        state: string
        label: string
    }[]
    draftMessageTargetGroups: {
        state: string
        label: string
        requiresTargetGroupValue: string | null
    }[]
    badgeTypes: {
        value: string
        label: string
    }[]
    badgeSections: {
        id: string
        label: string
        subsections: {
            id: string
            label: string
        }[]
    }[]
    promotedChallengeId: string | null
}

// special offers

export interface SpecialOfferAndroidStoreAdminDto {
    productId: string;
    basePlanId: string;
    offerId: string;
}

export interface SpecialOfferIosStoreAdminDto {
    productId: string;
}

export interface SpecialOfferUpsertAdminDto {
    /** Omitted on create; the stored id (`o_1`) on edit. Never derived from the code. */
    id?: string | null;
    /** Normalized to trimmed upper case on save. Unique across offers; may be changed at any time. */
    code: string;
    offeringId: string;
    /** Empty/omitted → null, which makes the app fall back to "Pro". */
    entitlementId?: string | null;
    title?: string | null;
    subtitle?: string | null;
    validFromUtc?: string | null;
    expiresAtUtc?: string | null;
    active: boolean;
    storeAndroid?: SpecialOfferAndroidStoreAdminDto | null;
    storeIos?: SpecialOfferIosStoreAdminDto | null;
}

export interface SpecialOfferResultAdminDto {
    id: string;
    code: string;
    offeringId: string;
    entitlementId: string | null;
    title: string | null;
    subtitle: string | null;
    validFromUtc: string | null;
    expiresAtUtc: string | null;
    active: boolean;
    storeAndroid: SpecialOfferAndroidStoreAdminDto | null;
    storeIos: SpecialOfferIosStoreAdminDto | null;
    /** Production purchases the RevenueCat webhook attributed to this offer (its offering was presented). */
    purchases: number;
    createdAtUtc: string;
    updatedAtUtc: string;
}

// ─── Admin user search ───────────────────────────────────────────────────────

// Row of GET manageUsers — the slim view of a Firebase account.
export interface AdminUserSummaryDto {
    uid: string;
    email: string | null;
    displayName: string | null;
    emailVerified: boolean;
    disabled: boolean;
    /** Sign-in providers, e.g. "password", "google.com", "apple.com". */
    providers: string[];
    createdAtUtc: string | null;
    lastSignInAtUtc: string | null;
}

export interface AdminUserSearchResponseDto {
    users: AdminUserSummaryDto[];
    /** Users matching the criteria before `limit` was applied. */
    totalMatches: number;
    /** True when `totalMatches` exceeds the number of users returned. */
    truncated: boolean;
    /** When the user index behind this answer was read from Firebase (it is cached for up to 30 minutes; an exact-email hit is always live). */
    indexedAtUtc: string;
}
```

Also used by admin endpoints but defined in `src/models/dto/index.ts`: `UserUpdateDto`
(`:726-731`: `email?`, `displayName?`, `phoneNumber?`, `disabled?`), `WorkoutConfigDto` (`:41-54`),
`UserBadgesResponseDto` (`:212-214`).

DTO facts a client author will trip over [V]:

- `ChallengeUpsertAdminDto.updatedAtUtc` and `WorkoutUpsertAdminDto.updatedAtUtc` are required by
  the type but **ignored on write**. The value read back is the Table Storage row `timestamp`
  (`src/modules/repositories/challengeRepository.ts:44`, `workoutRepository.ts:69`).
- `addedAtUtc` is **client-supplied and required** (`new Date(dto.addedAtUtc)`,
  `challengeService.ts:894`, `workoutService.ts:348`). An unparseable value becomes an Invalid Date
  and fails later as a 500.
- `equipmentIds` on a path is validated but then **discarded**; the stored value is recomputed from
  the path's workouts, minus `noeq` / `nomat` (`challengeService.ts:755-767`, `:782`).
  `workoutsLength` is likewise computed at save. If a workout's equipment or duration changes later,
  the challenge must be re-saved (`challengeService.ts:741-742`).
- Admin workout has a single `levelId`; storage and the public DTO have `levelIds[]`
  (`manageWorkoutsHandler.ts:131`, `workoutService.ts:352`).
- `durationMinutes` is stored as seconds (`*60`) and read back with `Math.floor(sec/60)`
  (`workoutService.ts:358`, `manageWorkoutsHandler.ts:137`).
- `unlockedByEntitlementIds[0]` is stored as the legacy single `EntitlementId`, the rest as the
  list (`challengeService.ts:914-917`); the GET re-joins them (`manageChallangesHandler.ts:189-190`).
- `GET manageChallenges` emits `liveAtUtc` / `endsAtUtc` / `availableAtUtc` as **omitted** (not
  `null`) when unset (`manageChallangesHandler.ts:173-175`), while other fields use `?? null`.
- `DraftMessageUpsertAdminRequestDto` has **no `id`**. Identity is `createdAtUtc`: the row key is
  derived from it and an existing draft with the identical timestamp is updated instead
  (`src/modules/services/messageDraftsService.ts:92`, `:162-166`; id generation
  `src/common/helpers/dateHelpers.ts:14-26`). The handler never sets `Id`
  (`draftMessagesHandler.ts:162-169`), so the client must keep and resend the exact `createdAtUtc`.
- `BadgeDeleteAdminDto` exists but no endpoint uses it.
- `blurHash` (workout) and `heightToWidthRatio` (fancy-content image) are supplied by the client;
  the server computes neither.

### 4b. `validateAdminChallenge` (`src/modules/services/challengeService.ts:997-1167`)

Returned as a `string[]`; the handler joins them with `"\n"` and sends **HTTP 500**
(`manageChallangesHandler.ts:91-95`). Rules in execution order, with exact messages:

Shape checks (`validateAccessFieldShapes`, `:957-995`); if any fail, only these are returned:

| Rule | Message |
|---|---|
| body is not a plain object | `Nieprawidłowe dane wyzwania` |
| `entitlementId` / `offeringId` / `offeringDiscountedId` present and not a string | `${field} musi być pojedynczym tekstem` |
| `unlockedByEntitlementIds` / `discountedForEntitlementIds` not an array | `${field} musi być listą tekstów` |
| …contains a non-string | `${field} może zawierać wyłącznie teksty` |
| `recommendedNext` not an array | `recommendedNext musi być listą obiektów z polem id` |
| …contains something other than `{ id: string }` | `recommendedNext może zawierać wyłącznie obiekty z tekstowym polem id` |

Field rules (ids are checked against `GET workoutsConfig`):

| Rule | Message |
|---|---|
| `categoryId` not in `challengeCategories` | `Nieznana categoryId: ${id}` |
| unknown `goalsIds` | `Lista goalsIds zawiera nieznane wartości: ${ids}` |
| unknown `difficultyLevelsIds` | `Lista difficultyLevelsIds zawiera nieznane wartości: ${ids}` |
| `visibleDaysUpFront` not an integer 0..100 (null allowed) | `visibleDaysUpFront musi być liczbą całkowitą od 0 do 100 lub null` |
| `offeringId` set with no unlocking entitlement | `offeringId wymaga podania unlockedByEntitlementIds - zakup musi coś odblokowywać` |
| `offeringDiscountedId` without `offeringId` | `offeringDiscountedId wymaga podania offeringId` |
| `discountedForEntitlementIds` without `offeringDiscountedId` | `discountedForEntitlementIds wymaga podania offeringDiscountedId` |
| `discountedForEntitlementIds` with no unlocking entitlement | `discountedForEntitlementIds wymaga podania unlockedByEntitlementIds - plan bez entitlementu jest darmowy` |
| an id is in both lists | `discountedForEntitlementIds zawiera entitlementy dające już darmowy dostęp, cena ze zniżką nigdy się nie pokaże: ${ids}` |
| `recommendedNext` contains own id | `recommendedNext nie może wskazywać na to samo wyzwanie: ${id}` |
| `recommendedNext` contains unknown challenge ids | `recommendedNext zawiera nieznane wyzwania: ${ids}` |

Path rules:

| Rule | Message |
|---|---|
| `levelId` not in `challengeLevels` | `Nieznany levelId: ${levelId}` |
| unknown path `difficultyLevelsIds` | `Poziom ${levelId} zawiera nieznane difficultyLevelsIds: ${ids}` |
| `minimumDaysToComplete` not in `0..(days with at least one workout)` | `Nieprawidłowa minimalna liczba dni do ukończenia dla poziomu ${levelId}: ${n}, liczba dni z treningami: ${m}` |
| unknown path `equipmentIds` | `Poziom ${levelId} zawiera nieznane equipmentIds: ${ids}` |
| no paths | `Dodaj przynajmniej jedną ścieżkę do wyzwania` |
| a path has no days | `Dodaj przynajmniej jeden dzień do poziomu ${levelId}` |
| `dayIndex` values are not exactly 1..N | `Nieprawidłowy indeks dnia dla poziomu ${levelId}: ${dayIndex}` |
| a day's `workoutIds` is null/undefined | `Lista treningów dla dnia ${dayIndex} jest null/undefined` |
| a workout id does not exist | `Nieznany workoutId: ${workoutId}` |
| a day lists the same workout twice | `Dzień ${dayIndex} poziomu ${levelId} zawiera duplikaty treningów, nie jest to dozwolone` |

**Not validated** [V, by absence]: `title`, `subtitle`, `imageRelativePath`, `lengthDays` (and it is
never compared with the number of days), date fields, `frequency`, **duplicate `levelId` across
paths**, whether referenced workouts are hidden, whether the image exists. `pro` deliberately has no
rule (`:1055-1057`). Also note `:1121` iterates `dto.paths` unguarded after the "no paths" check, so a
body with `paths: null` throws and becomes a generic 500. `path.days.sort(...)` at `:1127` sorts
the request array in place.

Then, in the handler (English messages, also 500):

- fancy content (`src/modules/services/helpers.ts:35-107`), surfaced as
  `Failed to parse challenge: …`: `Item N: Invalid type "x". Supported types are: Text, Title, Image.`;
  `Item N: Content cannot be empty for type "x".`; `Item N: Title cannot contain HTML tags: …`;
  `Item N: Text cannot contain <br> or <br /> tags: …` (same for `<u>`, `<i>`);
  `Item N: Metadata is required for Image type.`; `Item N: ImageRelativePath cannot be empty for Image type.`;
  `Item N: HeightToWidthRatio must be greater than 0 and less than 5.`
- badge rules (`manageChallangesHandler.ts:102-129`; `badgeService.ts:833-881`):
  `Badge 'x' does not exist`; `Badge 'x' is type 'y', only 'normal' badges can be assigned to workouts/challenges`;
  `Badge x is assigned to … — cannot mix workouts and challenges` and related single-assignment messages.
- promoted challenge (`:152`): `Wyzwanie ${id} nie istnieje` (Polish).

### 4c. Workout validation (`manageWorkoutsHandler.ts:75-110`)

Almost none: audio and video are mutually exclusive
(`Workout cannot have both audio and video/YouTube URL. Please provide either audio or video, not both.`),
the fancy-content rules above, and the badge rules. No check of `title`, `levelId`, `equipmentIds`,
`trainingTypeIds` against config, `durationMinutes`, or dates [V].

### 4d. Badge validation (`src/modules/services/badgeValidationService.ts`), **English**

Returned as HTTP 500 `Validation failed: a; b`. Messages: `name is required`;
`imageRelativePath is required`; `imageRelativePath must start with "badges/"`;
`type must be one of: "normal", "manual", "milestone", "perfections"`;
`claimToken/isClaimLinkActive are only allowed for manual badges with specialCategory "event"`;
`activeFromUtc must be a valid ISO date` / `activeTillUtc …`; `activeTillUtc must be after activeFromUtc`;
milestone: `repeatCategory is required for milestone badges`, `Unknown repeatCategory "x". Valid: …`,
`milestoneCount is required for new milestone badges and must be a positive integer`,
`milestoneCount must be a positive integer when provided`,
`sectionId/subsectionId must not be set for milestone badges`, `specialCategory must not be set for milestone badges`;
normal: `sectionId/subsectionId must not be set for normal badges (derived from assignment)`,
`specialCategory must not be set for normal badges`, `repeatCategory/milestoneCount must not be set for normal badges`;
manual: `specialCategory is required for manual badges`, `Unknown specialCategory "x". Valid: event, specialTraining`,
`repeatCategory/milestoneCount must not be set for manual badges`,
`sectionId/subsectionId must not be set for manual badges`,
`activeFromUtc/activeTillUtc must not be set for manual badges`,
`claimToken must be 6-32 characters, letters and digits only`; handler-level
`claimToken "X" is already used by badge Y` (`manageBadgesHandler.ts:131`).
Create-repeat: `repeatCategory is required`, `milestones must be a non-empty array`,
`all milestones must be positive integers`, `milestones must not contain duplicates`,
`titleTemplate is required` / `titleTemplate must contain "{x}"`,
`imageTemplate is required` / `imageTemplate must start with "badges/"`.

### 4e. Offer validation (`src/modules/services/specialOfferService.ts:143-243`), Polish

Returned as HTTP 500 `Validation failed: a; b` (`adminOffersHandler.ts:58-61`):
`Nieprawidłowe dane oferty`; `Oferta ${id} nie istnieje`; `Kod oferty jest wymagany`;
`Kod oferty może zawierać tylko litery, cyfry, "-" i "_" oraz mieć od 3 do 32 znaków`;
`Kod ${code} jest już używany przez ofertę ${id}`;
`Identyfikator oferty RevenueCat (offeringId) jest wymagany`;
`active musi być wartością logiczną (true/false)`; `Tytuł musi być tekstem`; `Podtytuł musi być tekstem`;
`Tytuł jest wymagany dla aktywnej oferty`; `Podtytuł jest wymagany dla aktywnej oferty`;
`Data rozpoczęcia (validFromUtc) ma nieprawidłowy format`; `Data zakończenia (expiresAtUtc) ma nieprawidłowy format`;
`Data zakończenia musi być późniejsza niż data rozpoczęcia`; `Data zakończenia nie może być w przeszłości` (create only);
`entitlementId musi być tekstem`; `storeAndroid jest wymagany dla aktywnej oferty`;
`storeIos jest wymagany dla aktywnej oferty`; `storeAndroid musi być obiektem`;
`storeAndroid.productId jest wymagany`; `storeAndroid.basePlanId jest wymagany`;
`storeAndroid.basePlanId może zawierać tylko małe litery, cyfry i "-"`; `storeAndroid.offerId jest wymagany`;
`storeAndroid.offerId może zawierać tylko małe litery, cyfry i "-"`; `storeIos musi być obiektem`;
`storeIos.productId jest wymagany`; `Offering "${id}" jest już używany przez aktywną ofertę ${id}`;
`Nie udało się zweryfikować offeringu w RevenueCat, spróbuj ponownie`; `Offering "${id}" nie istnieje w RevenueCat`;
`Nie udało się zweryfikować entitlementu w RevenueCat, spróbuj ponownie`; `Entitlement "${id}" nie istnieje w RevenueCat`.

### 4f. Message draft validation (`draftMessagesHandler.ts:122-159`), English, **HTTP 400**

`Request body is required`; `Missing required fields: title, from, targetGroup, fancyContent, createdAtUtc`;
`Invalid targetGroup 'x'. Valid values are: all, subscribers, nonSubscribers, challenge`;
`Invalid createdAtUtc date format: 'x'. Please provide a valid ISO date string.`;
`Invalid overrideAlreadySent flag: …`; `Invalid fancyContent: …`; state errors such as
`Message with id X is already published. Set overrideAlreadySent=true to override draft and saved messages.`
Publish pre-checks (`messageDraftsService.ts:531-545`): `From` at least 2 characters, non-empty
content, `targetGroupValue` for the challenge group. The `challenge` target group is accepted by
the upsert but cannot be published (`:527`), and `internalConfig` hides it (`adminConfigHandler.ts:63-68`).

---

## 5. Challenge lifecycle today, and scoping a real status

### 5a. What exists [V]

| Concept | Where stored | Meaning today |
|---|---|---|
| `Hidden: boolean` | `ChallengeDb.Hidden` (`src/models/db/challenges/challengeDb.ts:12`), `Challenge.Hidden` (`src/models/app/challenge.ts:18`); same on workouts (`workoutDb.ts:8`, `workout.ts:10`) | "unreleased content", filtered from lists only |
| type live vs plan | not stored; derived from `LiveAtUtc != null` | `challengeService.ts:238`, `:580-586`; by-id handlers 404 on the wrong type (`liveChallengeHandler.ts:67-69`, `workoutPlanHandler.ts:72-74`); "legacy" `/challenges` serves both |
| `EndsAtUtc` | column | removes a challenge from the **Live** list (`challengeService.ts:582`) and from recommendations (`:228`). Not applied to plans or by-id |
| `AvailableAtUtc` (release date) | column | used for sorting (`:533-537`) and to keep a not-yet-released challenge out of recommendations (`:231`). **Not** a list filter: a future-dated challenge is still listed |
| `LiveAtUtc` | column | type marker and sort key |
| `categoryId: 'archived'` | column value | archived plans are kept out of plan sections (`src/config/workoutPlanSections.ts:46`, `helpers/workoutPlanSections.ts:58`); still in `/workoutPlans` |
| `?dev=true` | query param, **no auth** (`base.handler.ts:269-271`) | adds hidden challenges to the four list endpoints and switches the response to non-cached |
| client capability filters | query params | `supportsSpecialOfferings`, `supportsEntitlementRules` hide paid / cross-plan challenges from old clients (`challengeService.ts:606-623`) |
| promoted | `WorkoutConfig.PromotedChallengeId` | pinned first in lists (`:462-468`), `promoted: true` in the DTO |

Every place `Hidden` is read or written:

| Place | file:line | Effect |
|---|---|---|
| Challenge list filter | `src/modules/services/challengeService.ts:576` | `includeHidden === true ? all : !Hidden`, the **only** challenge filter |
| Sections | `challengeService.ts:394-401` | goes through `filterChallenges` |
| Recommendations | `challengeService.ts:224-235`, `:245-253`, type `:1258-1264` | hidden targets not suggested unless `includeHidden`; by-id always passes `false` (`:167`, `:178`) |
| Public DTO mapping | `challengeService.ts:814` | `hidden` is **exposed to clients** (`BaseChallengeDto.hidden`, `dto/index.ts:499`) |
| Admin → model | `challengeService.ts:900` | `Hidden: dto.hidden` |
| Model → admin | `src/handlers/admin/manageChallangesHandler.ts:177` | |
| Repository | `src/modules/repositories/challengeRepository.ts:78`, `:114` | no default; an absent column would be `undefined` |
| Handler DTO conversions | `liveChallengeHandler.ts:128`, `workoutPlanHandler.ts:168` | copied explicitly |
| `includeHidden` set from `dev` | `challengeHandler.ts:103`, `liveChallengeHandler.ts:108`, `workoutPlanHandler.ts:104`, `:148` | |
| Workout list filter | `src/modules/services/workoutService.ts:141` | `!w.hidden`; `dev` is inert for workouts |
| Workout mapping | `workoutService.ts:298`, `:356`; `workoutRepository.ts:76`, `:102`; `manageWorkoutsHandler.ts:135`; `youTubeSyncHandler.ts:81` | |

**Where `Hidden` is not applied (the important part):**

- `ChallengeService.getDto(id)` (`:161-168`) and `getDtos` (`:170-179`): no filter. So
  `GET /challenges/{id}`, `/workoutPlans/{id}`, `/liveChallenges/{id}` return a hidden challenge to
  anyone, with the public cache header.
- `ChallengeService.getSchedule(id)` (`:647-695`): no filter, and it embeds the full `WorkoutDto`
  of every scheduled workout through `workoutService.getByIds` (`workoutService.ts:268-275`), which
  does not filter hidden workouts either.
- `WorkoutService.getDto(id)` (`:57-62`): `GET /workouts/{id}` serves hidden workouts.
- Ids are guessable: `C{n}` (`challengeService.ts:942-952`), `W{n}` or the YouTube id
  (`workoutService.ts:369-385`).
- Tests encode this as intended behaviour for `dev=true` schedules
  (`tests/handlers/devParamHandlers.test.ts:203-209`).

### 5b. Does any delete endpoint exist?

| Entity | Delete today |
|---|---|
| Challenge | none; no repository method either |
| Workout | none |
| Media / files | none (and uploads never overwrite) |
| Badge | `DELETE` method exists on the handler but returns 501 and no DELETE trigger is registered (`manageBadgesHandler.ts:94-96`; `functions/manageBadges/index.ts`). Use `isHidden`. `badgeRepository.deleteBadge` is only used internally by `createRepeatBadges` |
| Special offer | same: 501, not registered (`adminOffersHandler.ts:75-77`). Use `active: false` |
| Message draft | no delete; `archive` (state), `unsend` (removes delivered copies) |
| Manual badge grant | `POST manageBadges/revokeManual`, a hard delete of the grant row |
| User account | `DELETE /api/account` by the user themself, Firebase Auth only |
| Workout completion (user) | `POST user/workouts/deleteCompletion` |

Soft-delete precedents to copy: `UserMessageDb.RemovedAtUtc`, draft `State`/`ArchivedAtUtc`, offer
`IsActive`, badge `IsHidden`. Searched `softDelete|isDeleted|DeletedAt`: no hits.

### 5c. Adding `status: 'draft' | 'published' | 'hidden' | 'deleted'`

The hard part is not the field. Today there is **one read path** (`getDto`, `getDtos`,
`getSchedule`, `repository.getAll`) shared by the public catalogue *and* by everything that
resolves a user's history. A deleted or draft challenge must disappear from the first and stay
resolvable for the second, so the service needs two explicit read modes ("public catalogue" vs
"internal resolution"). That split is what makes this M–L rather than S.

Compatibility constraints:

- Old rows have no `Status` column: derive on read, `Status ?? (Hidden ? 'hidden' : 'published')`.
- Upserts are full-row `"Replace"` (`baseRepository.ts:137`), and Retool will keep posting bodies
  without `status` during migration. Treat an omitted `status` as "keep stored, else derive from
  `hidden`", the same pattern already used for `recommendedNext`
  (`challengeService.ts:925-939`). Otherwise a Retool save would republish a draft or resurrect a
  deleted row.
- Old mobile builds read `hidden`. Keep emitting it (`hidden = status !== 'published'`) and think
  twice before adding `status` to the public DTO at all.
- `getNewId` scans existing rows for a free `C{n}` (`:942-952`). Soft delete keeps the row, so ids
  are never reused; a hard delete would allow reuse and collide with stored user progress.

Change list, following the 10-layer checklist in `CLAUDE.md`:

| # | Layer | File and function |
|---|---|---|
| 1 | DB model | `src/models/db/challenges/challengeDb.ts` (`Status?`, probably `DeletedAtUtc?`, `StatusChangedAtUtc?`); `src/models/db/workouts/workoutDb.ts` |
| 2 | App model | `src/models/app/challenge.ts` (`Challenge`, `ChallengesRequest`, `WorkoutPlanSectionsRequest`); `src/models/app/workout.ts` |
| 3 | Client DTO | `src/models/dto/index.ts` `BaseChallengeDto` (`:487`), `WorkoutDto` (`:61`), only if the status is exposed |
| 4 | Admin DTO | `src/models/dto/internal.ts` `ChallengeUpsertAdminDto` (`:135`), `WorkoutUpsertAdminDto` (`:98`), a status enum, a request DTO for a status/delete action |
| 5 | Repository | `challengeRepository.ts` `mapFromDb` (`:32`), `mapToDb` (`:97`); `workoutRepository.ts` `mapFromDb` (`:53`), `mapToDb` (`:89`) |
| 6 | Service | `challengeService.ts`: `filterChallenges` (`:572-576`), `getDto` (`:161`), `getDtos` (`:170`), `getAllDtos` (`:150`), `getSchedule` (`:647`, plus its cache key), `getWorkoutPlanSections` (`:392`), `isSuggestible` / `toRecommendationTarget` / `RecommendationTarget` (`:224`, `:245`, `:1258`), `mapToDtoWithDynamicShallow` (`:801`), `mapFromAdminChallenge` (`:878`), `validateAdminChallenge` (`:997`), `recommendationsFromAdmin` (`:929`), `logScheduleSnapshot` (`:94`). `workoutService.ts`: `filterWorkouts` (`:141`), `getDto` (`:57`), `getByIds` (`:268`), `mapToDto` (`:283`), `mapFromAdminWorkout` (`:336`) |
| 7 | Admin handler | `manageChallangesHandler.ts` `mapToAdminChallenge` (`:164`), list `GET` (`:50`, exclude deleted by default), `POSTPromotedChallenge` (`:150`, must be published), new status/delete route; `manageWorkoutsHandler.ts` `mapToAdminWorkout` (`:121`) and list |
| 8 | Handler conversions | `liveChallengeHandler.ts` `mapLegacyChallengeToLiveChallenge` (`:114`), `GETBYID` (`:59`), schedule (`:79`); `workoutPlanHandler.ts` `mapLegacyChallengeToWorkoutPlan` (`:154`), `GETBYID` (`:64`), schedule (`:118`), sections (`:84`); `challengeHandler.ts` `GETBYID` (`:58`), schedule (`:74`); `workoutHandler.ts` `GETBYID` (`:55`) |
| 9 | Test helper | `tests/helpers.ts` `createMockedWorkout` (`:38`), `createMockedChallenge` (`:64`) |
| 10 | Tests | `tests/services/challengeService.test.ts` (`buildAdminDto`, `:84`), `tests/handlers/{challengesHandler,liveChallengesHandler,workoutPlansHandler,devParamHandlers,workoutsHandler,manageChallengesHandler,manageWorkoutsHandler}.test.ts`, `tests/repositories/challengeRepository.test.ts`, `tests/functions/httpTriggers.test.ts` for new routes |

Other readers of challenges/workouts that need a decision each (they bypass `filterChallenges`):

| Consumer | file:line | Question |
|---|---|---|
| Attempt sync | `src/modules/services/userService.ts:813`, `:835`, `:853`, `:958` | reject *new* attempts on draft/deleted; keep open attempts on a deleted challenge abortable (there is precedent: `abortAttemptOnMissingPath`, `:824-829`, `:937`) |
| Progress / history / names | `userService.ts:187-194` (cached all challenges), `:200`, `:249`, `:330`, `:379` | must keep resolving deleted challenges, or history shows "Wyzwanie" and badge counts drop |
| Badge counting and placement | `badgeService.ts` (`resolveNormalBadgePlacement`, `:883`), `manageBadgesHandler.ts:56-57`, `:298-306` | completed-but-deleted challenges should still count |
| Badge single-assignment check | `manageChallangesHandler.ts:104-107`, `manageWorkoutsHandler.ts:97-101` | does a deleted challenge still "own" its badge? |
| Wrapped | `src/modules/services/wrappedService.ts:187`, `:316`, `:469-470` | internal resolution |
| Message target | `messageDraftsService.ts:135` | internal |
| Admin user progress | `adminUserProgressHandler.ts:57-58` | internal |
| Wake-up | `wakeUpHandler.ts:33-34` | counts only |
| "Next" after completion | `userChallengeProgressHandler.ts:110-113` | goes through `getDto` |
| Admin validation "workout exists" | `challengeService.ts:1136-1151` | should a published challenge be allowed to reference a draft/deleted workout? |
| Deleting a workout | no reverse lookup exists | needs "used by challenges X, Y" (pattern in `manageBadgesHandler.buildAssignedChallenges`) |

Public endpoints that must exclude `draft` and `deleted`:

1. Lists: `GET /challenges`, `/liveChallenges`, `/workoutPlans`, `/workoutPlanSections`, **including
   with `?dev=true`** (the parameter is unauthenticated; whether `dev` should still reveal `hidden`
   is an existing product decision, but it must not reveal drafts).
2. By id: `GET /challenges/{id}`, `/liveChallenges/{id}`, `/workoutPlans/{id}`: currently unfiltered.
3. Schedules: `GET /challenges/schedule/{id}`, `/liveChallenges/schedule/{id}`,
   `/workoutPlans/schedule/{id}`: currently unfiltered, and they leak workout content.
4. Workouts: `GET /workouts` (already filters hidden), `GET /workouts/{id}` (unfiltered),
   `GET user/workouts/favorite` (unfiltered `getByIds`).
5. Recommendation resolution and its random fallback pool (`challengeService.ts:208-222`).
6. `POST user/challenges/attemptProgress` for new attempts.

Validation implication: a real draft should be savable while incomplete, but
`validateAdminChallenge` demands at least one path, at least one day per path, existing workouts
and consecutive day indexes. Draft-tolerant validation ("warnings while draft, errors on publish")
is extra work, and the repository's map round-trip check (`baseRepository.ts:129-135`) must tolerate
the partial shape.

Cache implications:

- Non-dev catalogue responses carry `Cloudflare-CDN-Cache-Control: public`
  (`base.handler.ts:104-114`); `wrapInSuccessWithCacheUnlessDev` (`:121-125`) only downgrades for
  `dev`. Used at `challengeHandler.ts:51,66,79`, `liveChallengeHandler.ts:52,71,84`,
  `workoutPlanHandler.ts:57,76,89,123`. Plain `wrapInSuccessWithCache` at `workoutHandler.ts:46,63`,
  `workoutConfigHandler.ts:28`, `appConfigHandler.ts:35`, `wakeUpHandler.ts:38`,
  `adminConfigHandler.ts:87`.
- Every challenge/workout/config save calls `cacheService.clearApiCache()`
  (`baseService.ts:31-36`), which clears the in-process cache and asks Cloudflare to
  `purge_everything` (`cacheService.ts:160-187`). Two caveats:
  1. the purge URL looks wrong (section 9, item 1); a failure is only logged;
  2. the in-process cache is per instance. Other instances keep `challengeSchedule:{id}` (2 min,
     `challengeService.ts:692`), `challengeRecommendationCatalogue` (2 min, `:265`), `badgeMap`
     (2 min), `workoutConfig` (5 min, `workoutConfigService.ts:35`) and the user-service
     workout/challenge catalogues (2 min). A stale instance can refill the CDN with pre-change
     content right after the purge [I]. For "unpublish now" or "delete now" this is a correctness
     issue, not just staleness.
- 404 responses are already `private, no-store` (`base.handler.ts:170-182`), so turning a by-id
  response into a 404 for draft/deleted is cache-safe once the old 200 is purged.
- Draft previews must be served from the admin API with `wrapInSuccess` (private), never from a
  public route.
- `GET internalConfig` is publicly cached and carries `promotedChallengeId`.

Rough size: challenge status with correct public exclusion and internal resolution **L**; workouts
on top **M**; draft-tolerant validation **M**.

---

## 6. Data model summary

Storage accounts are selected by env var; names in brackets are from [D `docs/flex/migration.md:131`].
All keys below are [V] from the repositories.

**General data account** (`DATA_STORAGE_ACCOUNT_NAME`, [`superfitstorage`])

| Table | PartitionKey | RowKey | Notes |
|---|---|---|---|
| `Challenges` | challengeId | challengeId | one row per challenge; everything nested is JSON in string columns (`challengeRepository.ts:97-129`) |
| `Workouts` | workoutId | workoutId | catalogue of workouts (`workoutRepository.ts:89-110`) |
| `WorkoutConfig` | `Config` | `Config` | single row: equipment/training types, levels, challenge levels/categories/goals, difficulty levels, duration ranges, `PromotedChallengeId` |
| `Badges` | `badge` | badgeId | `badgeRepository.ts:16`, `:90-110` |
| `UserManualBadges` | userId | grant UUID | `userManualBadgeRepository.ts:37-46` |
| `SpecialOffers` | `specialOffer` | offerId (`o_1`…; legacy rows use the code) | `specialOfferRepository.ts:23` |
| `SpecialOfferAttributions` | offerId | RevenueCat event id | analytics only |
| `UserWorkoutProgress` | userId | workoutId | `completionsArrayJson` |
| `UserChallengeProgress` | userId | challengeId | attempts JSON, chunked over 3 columns |
| `UserWorkoutMetadata` | userId | workoutId | favourite flag, user note |
| `UserNotificationTokens` | userId | deviceId | |

Blob container `public` in the same account holds all media; public URLs are
`${BLOBS_PUBLIC_LINK}/public/<relativePath>` (`mediaService.ts:62-64`).

**Messages account** (`MESSAGES_STORAGE_ACCOUNT_NAME`): `DraftMessages` (PK `drafts`, RK = inverted
.NET ticks of `createdAtUtc`), `GroupMessages` (PK `public_0`…`public_29`, RK draftId),
`UserMessages` (PK userId, RK draftId, soft delete via `RemovedAtUtc`), `UserMessagesMetadata`.

**Analytics account** (`ANALYTICS_STORAGE_ACCOUNT_NAME`): `Customers` (each user written twice: PK
userId and PK `Customers`), blob container `revenuecat`.

**Service Bus** queue `user-messages`. **Firebase Auth** holds users; no user table of our own.

Relations:

```
WorkoutConfig (1 row) ── defines ids used by ──┐
                                               ▼
Challenge (C{n})                         Workout (W{n} or YouTube id)
 ├─ LiveAtUtc set  → "live challenge"      ├─ videoUrl (YouTube) XOR audioRelativePath
 ├─ LiveAtUtc null → "workout plan"        ├─ imageRelativePath, blurHash
 ├─ BadgeId / PerfectCompletionBadgeId ─►  ├─ BadgeId ─► Badge (type normal)
 ├─ RecommendedNext[] ─► Challenge ids     └─ levelIds / equipmentIds / trainingTypeIds
 ├─ entitlement / offering ids (RevenueCat)
 └─ Paths[]  (one JSON column, PathsArrayJson)
     ├─ LevelId  ← the path's identity; must be one of WorkoutConfig.challengeLevels
     ├─ Frequency (free text), Description, Pro, DifficultyLevelsIds, MinimumDaysToComplete
     ├─ EquipmentIds, WorkoutsLength  ← derived from the workouts at save time
     └─ Days[] { DayIndex 1..N, WorkoutIds[] }   empty WorkoutIds = rest day
```

- **There is no week entity.** A schedule is a flat list of days; `WeeksCounts = ceil(lengthDays/7)`
  is computed at save (`challengeService.ts:885`), and `lengthDays` is a free number not tied to the
  day count.
- **A path is identified by `levelId`.** User attempts store `path = levelId`
  (`src/models/app/userChallengeProgress.ts:17`); renaming or removing a path strands every open
  attempt on it (`challengeService.ts:110-116`, `userService.ts:819-832`). There is no separate
  path id, so two variants at the same level cannot coexist, and nothing validates that `levelId`
  is unique within a challenge.
- **Schedule edits are destructive for history.** Progress stores only day ticks, so the service
  logs a full "blueprint" on every save as the only record (`challengeService.ts:79-148`).
- **YouTube sync** is a dead one-off importer (see 1a). A workout's video is just a `videoUrl`
  string; nothing syncs.
- **Media flow:** `POST manageMedia/files?relativePath=…` with the file as the raw body → path
  sanitised to a lowercase ASCII slug → if the name exists a numeric suffix is added (never
  overwrites) → MP4/M4A faststart remux → stored with `Cache-Control: public, max-age=31536000,
  immutable` (`mediaService.ts:210-252`, `:49`). The entity then stores `relativePath`.
  `GET /api/files?path=` redirects to the blob.
- **Badges:** `Badges` rows of type normal / milestone / manual / perfections; normal badges are
  attached by putting `badgeId` on a workout or challenge (not both kinds); earned badges are
  computed on read from progress, except manual/event badges, which are rows in `UserManualBadges`.
- **Offers:** `SpecialOffers` keyed by `o_n` with a changeable unique `code`; purchases attributed
  by the RevenueCat webhook into `SpecialOfferAttributions`.
- **Messages:** draft (`draft` → `sent` | `archived`) → publish writes 30 `GroupMessages` cluster
  rows for "all", or enqueues per-user batches on Service Bus for subscribers / non-subscribers →
  `processMessageQueue` writes `UserMessages`.
- **Users / progress:** Firebase uid everywhere; completions per workout, attempts per challenge.

---

## 7. Gaps for a real admin SPA

Sizes: S ≤ 1 day, M = a few days, L = a week or more (backend only, including tests under this
repo's testing rules).

| # | Gap | Truly absent? Evidence | Size |
|---|---|---|---|
| 1 | **Per-user auth on admin endpoints** | Absent in practice. One shared key = host master key; Firebase claim path broken and unreachable on 26 functions (section 2) | **M** |
| 2 | **CORS** | Absent (section 3) | **S** (config), needs a human for the Azure/Cloudflare change |
| 3 | **"me" / session endpoint** | Absent. Searched `whoami`, `/me`, `session`, `currentUser`: nothing | **S** |
| 4 | **Single-item GET** | Partly present: challenges and workouts have `manageX/{id}`. Absent for badges, offers, message drafts, media | **S** |
| 5 | **Pagination / filtering / search on lists** | Absent on every admin list except `manageUsers` (`limit`, max 200). `GET manageChallenges` returns every challenge with every path and day (`manageChallangesHandler.ts:50-52`, `mapPathsToDtos(..., false)`). No summary/list projection | **M** (a slim list DTO is the cheap win) |
| 6 | **Optimistic concurrency** | Absent. `upsertEntity(dbModel, "Replace")` with no etag (`baseRepository.ts:66`, `:137`; `tableStorage.ts:160`); `updatedAtUtc` in the body is ignored. Searched `etag`, `If-Match`, `updateEntity`: nothing. Two admins overwrite each other, and so do an admin and the SPA's own stale tab. Promoted challenge is a read-modify-write of the config row (`workoutConfigService.ts:77-81`) | **M** (Table Storage returns an etag on read, so it is plumbing plus a 409 contract) |
| 7 | **Delete / soft delete** | Absent for challenges, workouts, media, offers, drafts (section 5b) | **L** with status, see 5c |
| 8 | **Draft state** | Absent for challenges and workouts. Only `hidden`, which leaks by id. Message drafts and inactive offers do have a draft-like state | part of 7 |
| 9 | **Audit trail (who changed what)** | Mostly absent. Badges and offers write one log line to App Insights (`badgeAdminAuditService.ts:38-42`, `specialOfferService.ts:279-287`), with `adminUserId` that is `null` for key-authenticated callers. Challenges log schedule blueprints without an actor. Workouts, media, messages, promoted challenge, user edits: nothing. No durable or queryable store; no `updatedBy` column anywhere (searched) | **M** (table + write on every admin mutation), depends on #1 for a real actor |
| 10 | **Create returns the new entity** | Inconsistent. Workout create returns only `"Workout W12 updated"` (`manageWorkoutsHandler.ts:113`); the client must parse the id out of a sentence. Challenge returns the internal PascalCase model under `update`. Badges and offers return proper DTO arrays | **S** |
| 11 | **Error contract** | Inconsistent, see 7a | **M** to normalise without breaking Retool |
| 12 | **Media upload flow** | Proxy upload only: the browser would POST raw bytes through the Function, which buffers the whole file (`request.arrayBuffer()`, `mediaManagementHandler.ts:52`) and remuxes in memory. **No SAS / presigned flow**: `generateBlobSASQueryParameters` and `BlobSASPermissions` are imported but never used (`mediaService.ts:6,9`). No multipart, no progress contract, no delete, no rename, no folder filter; `GET` lists the whole container every time. Practical size ceiling is the Functions request limit and the Cloudflare proxy limit [I, not in repo] | **M** for SAS upload + finalize; **S** for list filter |
| 13 | **Media metadata** | Absent: no image dimensions, no blurHash, no "used by" lookup. The SPA must compute `blurHash` and `heightToWidthRatio` itself | **S–M** |
| 14 | **Editing the catalogue config** | Absent. `WorkoutConfig` (levels, categories, goals, equipment…) has no write endpoint; only `promotedChallengeId` can be set. `upsertDto` exists on the service but nothing calls it (searched). Plan sections are hardcoded in `src/config/workoutPlanSections.ts` | **M** |
| 15 | **Server-side storage for planning-only concepts** | Absent, all of it. Searched `scratchpad`, `planning`, `requirement`, `condition`, `variant`, `layout`, `note`: the only "note" is the *user's* note on a workout. No notes per day or per plan variant, no requirements/conditions on a variant beyond `difficultyLevelsIds` / `frequency` / `description`, no scratchpad of workouts to place, no week-table layout, no week entity at all | **M–L**, see 7b |
| 16 | **Basic field validation** | Thin for challenges (no title / image / lengthDays / date checks, no duplicate `levelId` check) and nearly absent for workouts (section 4b, 4c) | **S–M** |
| 17 | **Stable path identity** | Absent. `levelId` is the identity; changing it breaks open attempts, and the server only warns in logs | **M** if variants need renaming or more than one per level |
| 18 | **Bulk / transactional saves** | Absent. One entity per request; a plan and a new workout it needs are separate, non-atomic calls. Id allocation is a scan-then-write race (`getNewId`), so two simultaneous creates can get the same id and the second overwrites the first [I] | **M** |
| 19 | **Admin-side typed contracts for user tools** | `manageUserProgress` returns an ad-hoc object; `accounts/{userId}` returns a raw Firebase `UserRecord` | **S** |

### 7a. What an error response looks like [V `src/common/handlers/base.handler.ts`]

```jsonc
// 500  wrapInError (:127-154) — also used for VALIDATION failures on challenges, workouts,
//      badges, offers. Each one is additionally reported to App Insights as an exception.
{ "error": "Nieznany levelId: x\nDodaj przynajmniej jeden dzień do poziomu x" }

// 400 (409 when errorCode is OTHER_CHALLENGE_STARTED)  badRequest (:156-168)
{ "error": "Missing required fields: title", "errorCode": null }

// 404  notFound (:170-182)
{ "error": "Challenge C99 not found", "errorCode": null }

// 401  wrapWithMissingAuth (:194-205) — from handler code
{ "error": "Wyglada na to, ze nie jesteśmy w stanie zweryfikować Twojej tozsamosci. W razie problemow daj nam znac." }

// 403  wrapWithInsufficientAccess (:207-218) — the message argument is ignored
{ "error": "Wyglada na to, ze nie masz dostępu do tego zasobu. Miłego dnia!" }

// 501  notImplemented (:57-67)
{ "error": "Not implemented" }
```

Type: `ErrorResponseDto { error: string; errorCode?: ErrorCodesDto | null }` (`dto/index.ts:687-690`).

Inconsistencies the client has to absorb:

- Validation is 500 on challenges/workouts/badges/offers but 400 on message drafts and user search.
- Multiple errors are joined with `"\n"` (challenges) or `"; "` after a `Validation failed: `
  prefix (badges, offers). There is no field-level structure, so errors cannot be attached to form
  fields without string matching.
- Language is mixed: Polish for challenge and offer rules, English for badges, fancy content,
  workouts, drafts and all "Failed to …" wrappers.
- A missing or wrong master key is rejected by the platform with a 401 and no JSON body [I].
- An exception outside a handler's try/catch (e.g. `UserManagementHandler.GET` has none) surfaces
  as a host-generated 500 without this envelope [I].
- `accounts/{userId}` answers 200 `{ message }` for an unknown user.
- Success bodies are the bare payload (array or object); there is no `{ data }` envelope. Mutations
  return `{ result: "<English sentence>", … }`.

### 7b. Where planning data could live

Constraints I can see [V unless marked]:

- The whole schedule is one string column, `PathsArrayJson` (`challengeRepository.ts:112`), with no
  chunking (unlike `UserChallengeProgress`, which spills across three columns via
  `src/common/storage/jsonArrayFields.ts`). Azure Table string properties are capped at 64 KB, about
  32K UTF-16 characters [I]. Free-text notes per day inside that JSON would eat the budget quickly
  on a long multi-path plan.
- Public mapping is explicit field-by-field, so a new nested field would not leak by accident.
  But note that `internalTitle` *is* sent to clients (`dto/index.ts:500`, `challengeService.ts:806`),
  so "internal" is not a guarantee in this codebase.
- Every challenge save purges the whole CDN and writes a schedule blueprint to the log
  (`challengeService.ts:89-92`). Autosaving planner state through `POST manageChallenges` would
  trigger both on every keystroke-level save.

So planning state (notes, variant requirements and their validation, scratchpad, week layout) fits
better in its **own table and endpoint** (e.g. PK = challengeId, one row per document, etag-guarded,
no CDN purge), and only "publish" writes the real challenge. That also gives drafts a home without
touching the public read path at all.

---

## 8. Conventions a client must respect

**Envelope.** Success: bare JSON payload, `content-type: application/json; charset=utf-8`, compact
serialisation (`base.handler.ts:16-18`, `:69-79`). Errors: `{ error, errorCode? }` (7a). Mutations:
`{ result: string, … }`.

**Base URL and routing.** `https://api.codzienniefitapp.com/api/…` [D]. Route matching is
case-insensitive in the handlers (`getNormalizedPath`). Several handlers dispatch on
`path.includes(...)`, so keep paths exact.

**Dates.** ISO 8601 UTC strings as produced by `toISOString()` (`2026-11-03T12:00:00.000Z`). Admin
inputs are parsed with `new Date(x)` (lenient); user attempt dates must match
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$` exactly (`src/common/helpers/dateHelpers.ts:1-12`).
Calendar-day parameters are `YYYY-MM-DD` in Europe/Warsaw. Field suffix is always `…AtUtc`.

**Ids: who generates them.**

| Entity | Id | Generated by |
|---|---|---|
| Challenge | `C{n}`, first free n from 1 | server when `id` is null/empty (`challengeService.ts:886`, `:942-952`). A non-empty unknown `id` **creates** a challenge with that id; there is no existence check |
| Workout | YouTube video id (11 chars) if `videoUrl` is a YouTube URL, otherwise `W{n}` | server when `id` is null/empty (`workoutService.ts:343`, `:369-385`). See section 9, items 2 and 3 |
| Badge | `m_{category}_{count}`, `n_{k}`, `s_{k}`, `pc_{k}`; legacy UUIDs exist | server (`badgeService.ts:34-65`) |
| Offer | `o_{k}`; legacy rows use the code | server (`specialOfferService.ts:255`) |
| Message draft | 19-digit inverted ticks of `createdAtUtc` | server, derived from the client's `createdAtUtc` |
| Manual badge grant | UUID | server |
| Media | sanitised relative path | server; always read `relativePath` from the upload response, since the name may be slugified or suffixed |
| Path within a challenge | `levelId` from `workoutsConfig.challengeLevels` | client picks from config |
| Day | `dayIndex`, 1-based, consecutive | client |

**Upsert semantics.** POST = create-or-replace of the whole entity. Send the full object every time;
an omitted field is written as empty. Exceptions: `recommendedNext` omitted keeps the stored list
(`challengeService.ts:929-939`); badges merge some fields with the existing row
(`manageBadgesHandler.ts:139-180`). There is no PATCH.

**Nullability.** `CLAUDE.md` convention: DB reads default with `?? null`; admin strings are
normalised with `?.trim() || null`; client DTOs should use `null`, not `undefined`. Reality is
mixed: many DTO fields are typed `string | null | undefined`, and some admin GET fields are omitted
rather than null (section 4a). Treat missing and `null` as the same on read; send explicit `null`
on write.

**Hidden / dev.** `?dev=true` is accepted on every public endpoint and only changes the four
challenge list endpoints. It is not authentication.

**Polish validation errors.** Challenge and offer rule messages are Polish and meant to be shown
as-is; the rest is English. There are no error codes on admin endpoints, so the panel should do its
own client-side validation for field-level UX and treat server text as a fallback banner.

**Reference data.** Select options come from `GET /api/workoutsConfig` (`WorkoutConfigDto`:
`equipmentTypes`, `trainingTypes`, `trainingLevels`, `challengeLevels`, `completionStatuses`,
`challengeCategories`, `challengeGoals`, `difficultyLevels`, each `{ id, title, visible }`) and
`GET /api/internalConfig` (draft states, target groups, badge types and sections with Polish labels,
`promotedChallengeId`).

**The DTO npm package.**

- Name `codziennie-fit-dtos`, source `src/models/dto/` (`package.json:2`); `version` is a
  `0.0.0-dev` placeholder, real versions come from semantic-release. Latest git tag `v1.68.0` [V].
- Published by the `release-dto` job on every push to `main` once tests pass, independent of the
  (currently broken) deploy job: `npm ci` then `npx semantic-release` in `src/models/dto`, npm
  registry, OIDC (`id-token: write`, no token secret)
  (`.github/workflows/azure-functions-app-nodejs.yml:304-332`). Version bumps follow
  conventional-commit types [I, semantic-release default; no `.releaserc` in the repo].
- **There is no build step.** `main` is `index.ts`, `types` points at an `index.d.ts` that nothing
  generates, and there is no `files` list or `.npmignore`. So the package ships raw TypeScript
  sources: `index.ts`, `access.ts`, `internal.ts`, `tsconfig.json` [V config, I exact tarball].
- **Can the admin panel consume the admin types from it?** Probably yes, with caveats.
  `internal.ts` is not re-exported from `index.ts` (which only re-exports `./access`), so it would
  be a deep import, `codziennie-fit-dtos/internal` [I]. Use `import type` for interfaces. The three
  enums in `internal.ts` (`MediaTypeDto`, `DraftMessageTargetGroupDto`, `DraftMessageStatusDto`) and
  everything in `access.ts` are runtime code in a `.ts` file inside `node_modules`, which needs the
  bundler to transpile it and gets type-checked under the SPA's own tsconfig. Workable with Vite
  [I], but brittle. A small improvement would be to emit `.d.ts` + JS and add an `exports` map
  with an `./internal` entry.
- The admin DTOs are therefore already distributed to whoever can install the package. Whether the
  package is public on npm I could not check.
- The admin panel repo does not depend on it today (`/Users/mzolnieruk/github/admin-panel/package.json`
  has no such dependency) [V].

---

## 9. Bugs and hazards noticed while reading (not asked for, but relevant)

1. **CDN purge URL is doubled** [V code, I effect]. `cacheService.ts:164` builds
   `…/zones/{id}/purge_cache` and `:171` posts to `` `${cloudflareApiUrl}/purge_cache` ``, i.e.
   `…/purge_cache/purge_cache`. Failures are swallowed and logged as `Failed to clear cache: …`
   (`:184-186`), and every test mocks `clearApiCache`. If Cloudflare rejects that path, admin saves
   have never purged the CDN. Worth one App Insights query before relying on it for
   publish/unpublish. `docs/release.md:68` assumes it works.
2. **Creating a workout from a YouTube URL that is already in the catalogue overwrites the existing
   workout.** The id is the video id and the write is an unconditional replace
   (`workoutService.ts:369-374`, `baseRepository.ts:137`) [V code, I effect].
3. **Creating an audio workout with `videoUrl: null` or omitted throws.**
   `extractYouTubeVideoID` calls `url.match(...)` on the raw value (`workoutService.ts:387-391`),
   giving a 500 `Failed to update workout: TypeError…`. Send `""` [V code, I runtime].
4. **`mp4` and `ogg` uploads always fail.** They are in `supportedExtensions`
   (`mediaService.ts:214`) but have no entry in the content-type map (`:122-140`), so the upload
   throws `Failed to get blob content type` (`:221-224`) [V].
5. **Hidden content is public by id** (section 5a) and `?dev=true` needs no auth.
6. **`setCustomUserClaims` replaces all claims** on terms acceptance (section 2a).
7. **Hardcoded admin uid** in source (`accountService.ts:185`).
8. `unsend` defaults to a dry run; an SPA that forgets `dryRun: false` will report success and
   change nothing (`draftMessagesHandler.ts:378`).
9. `createRepeatBadges` hard-deletes all milestone badges of the category before recreating them
   (`badgeService.ts:207-215`); with no confirmation contract this is the most destructive admin
   call in the API.
10. Admin validation failures are tracked as exceptions in App Insights because they go through
    `wrapInError` (`base.handler.ts:127-143`), which will inflate error rates once a form-heavy SPA
    starts posting invalid drafts.
