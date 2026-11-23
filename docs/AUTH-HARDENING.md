# Sign-in hardening: what the review found and the approach to build

Written 2026-11-13. It records an independent review of the first sign-in (built 2026-11-11),
defines the sign-in that replaced it, **Firebase stays the sign-in, the backend becomes the
authority** (section 4), and says what of it is built (section 0).

Sections 1 to 3 describe the first sign-in, which no longer exists in the code; file and line
references there point at code as it was on 2026-11-13 before the rebuild.

Contents: 0 state, 1 how it was reviewed, 2 verdict, 3 findings, 4 the approach, 5 rules, 6 what
the backend does, 7 plan, 8 runbook, 9 tests, 10 not checked, 11 sources.

## 0. State on 2026-11-13

Both halves are built and tested against stand-ins for each other. Neither has run against the
real Firebase, Google, Azure host or each other's deployed copy. Nothing is deployed with keys and
`PANEL_ADMIN_UIDS` is empty, so nobody can sign in.

| Rule | State |
| ---- | ----- |
| 1–3, 5 (who is an admin) | Built. The list is `src/config/panelAdmins.ts` in the backend |
| 4, 6 (2-Step Verification, accounts with a second factor) | For people to do |
| 7–9 (session) | Built. Sign-out records the time per admin (table `PanelSignOuts`) and every panel session that began before it is refused; the person stays signed in to the mobile app (the owner's decision, 2026-11-16) |
| 10–13 (cookies, Google's token) | Built. The cookie key also seals the ten-minute note that shows a refused person their own user id; it protects no session |
| 14–16, 19 (host, request checks, table of calls, return address) | Built. `OPEN_FOR_WRITING` in `worker/proxy.ts` holds only `cache` (clearing the app's CDN cache, which changes no data); every area that writes data is closed |
| 17 (limits per admin) | **Not built.** Needed before `sendMessage` and `users` are opened for writing |
| 18 (second step for "send to all" and "change e-mail") | **Not built**, same condition. Sending has a dry run and cannot run twice at once; nobody is notified |
| 20–22, 24, 25 (proxy, files, no master key, signature, backend as authority) | Built. The signature also covers the body |
| 23 (account record cut down) | Built in the backend: the panel's route returns a small typed record |
| 26, 28 (response headers, script policy) | Built |
| 27 (HSTS), 31 (`workers_dev: false`, the route) | **Waiting for the custom domain** ([SIGN-IN-SETUP.md](SIGN-IN-SETUP.md) §3). `preview_urls: false` is set |
| 29, 30 (Trusted Types, dependency install policy) | Not built |
| 32, 33 (settings and secrets) | Three secrets: `GOOGLE_CLIENT_SECRET`, `SIGN_IN_COOKIE_KEY`, `PANEL_SIGNING_SECRET`. The plain settings are typed in Cloudflare as Text, not yet listed in `wrangler.json` |
| 34, 35 (no local keys, nothing sensitive logged) | Built. The Keychain launcher is deleted |
| 36, 37 (records) | Built: the Worker's log lines; the backend's `PanelAudit` table, written for every change made through the panel and readable at `GET manageAudit` |
| 38, 39 (alerts, runbook tried) | Not done |

Accepted as it is: the very same call, byte for byte, can be sent again within the two minutes a
signature is valid, and the `If-Match` header is not part of the signature. Using that needs a
call captured on the encrypted link between Cloudflare and Azure.

## 1. How it was reviewed

- A separate reviewer with no part in writing the code read the documents, the whole Worker
  (`worker/`), the browser side (`src/auth/`, the transport, the login page), the deploy
  configuration and the local launcher. It was told to disagree with the documents wherever the
  code or the facts say otherwise. It worked read-only and saw no key.
- It ran six proofs against the Worker's real code with the repository's own fakes, from a test
  file kept outside the repository. They were run again when this document was written: all six
  pass, which means all six attacks work.
- Every finding of medium severity or higher was then read in the code by the author of the code.
  All of them are real. None was dismissed.
- The Cloudflare and Firebase pages that the approach rests on were read again on 2026-11-13
  (section 11, marked "re-read"). The other sources are the reviewer's and were not re-read.

What held up: no way was found for an anonymous outsider to obtain a session. The protections
against requests from other sites hold on `/auth/*` and `/api/*`. The Google flow is sound. The
cookie attributes are right, and a value sealed for one cookie is refused in another.

## 2. Verdict

The pattern is right. Keeping tokens in the Worker and out of the browser is what current
guidance ranks highest (IETF, "OAuth 2.0 for Browser-Based Applications"), and leaving the
Firebase SDK out of the browser was correct.

Three things were wrong, and no amount of care inside the Worker fixes them:

1. **Who decides.** The Worker was the only gate. The backend took a master key today, and after
   backend step B0 as written it would take an admin's Firebase token from anywhere, so the Worker
   could be walked around.
2. **How admins prove who they are.** A password, which can be guessed at Firebase directly with
   the key that ships in the mobile app, without touching the panel.
3. **What an admin token is.** Any Firebase token of an admin's account, including the one their
   phone holds for the mobile app.

On top of that the Worker carried its own session machinery (two encrypted cookies, hourly
renewal, a 30-day lifetime) that could not be ended and could be tricked (findings 4 and 5).

## 3. Findings

Severity is the reviewer's. "Proof" means one of the six executed cases.

| #   | Severity                             | Finding                                                                                                                                                                                                                                                                       | Where                                                                      | Closed by rule |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| 1   | Critical once the backend key is set | The Worker forwards `POST`, `PUT` and `DELETE` to every `manage…` and `accounts` address, with the master key attached. "Produkcja is read-only" is a rule in the page only. Any script running in an admin's tab can message all users or change a customer's e-mail. Proof. | `worker/proxy.ts:17-18`, `:37`, `:140-145`; `src/data/api/capabilities.ts` | 16, 22, 25     |
| 2   | High                                 | Admins are consumer accounts with a password and no second factor. Guessing does not need the panel. After B0 as written, a stolen Firebase credential works against the backend directly. Today the backend already accepts one hardcoded uid on `accounts/{uid}`.           | `worker/env.ts:62`; `docs/research/backend-audit.md:92-93, 262-281`        | 1–4, 24, 25    |
| 3   | High                                 | Every deploy switches the `workers.dev` address back on, because `wrangler.json` does not switch it off. The Worker answers on any host. Old versions stay reachable at their own addresses. Proof for the host.                                                              | `wrangler.json`; `worker/index.ts:16-26`                                   | 14, 31         |
| 4   | High for an insider                  | A removed admin stays an admin at the Worker for up to 30 days by sending a saved old session cookie with each fresh token cookie. Proof (20 simulated days, no call to Firebase).                                                                                            | `worker/session.ts:104-105`, `:221-231`                                    | 3, 7, 8        |
| 5   | High                                 | Whoever has `SESSION_KEY` can make an admin session for a made-up user with no Firebase account. Proof. A new key does not cancel the Firebase refresh tokens inside cookies already issued. Nothing can be revoked. 30 days, no idle limit.                                  | `worker/session.ts:31`, `:211-231`; `worker/codec.ts:72-88`                | 7–9            |
| 6   | High before writes                   | No record of anything: no log line in the Worker, exceptions swallowed, no record of who sent a message or changed an e-mail, no server-side second step or limit on those two actions.                                                                                       | `worker/index.ts:30-35`; `wrangler.json`                                   | 17, 18, 36–39  |
| 7   | Medium                               | `GET accounts/{uid}` returns the raw Firebase record, password hash included, and the Worker passes it to the browser unchanged. (From this repository's notes; the backend was not read.)                                                                                    | `docs/PRODUCTION-API.md:139`; `worker/proxy.ts:189-192`                    | 23             |
| 8   | Medium                               | `/api/files` serves a file with a JavaScript type from the panel's own address, which is exactly what `script-src 'self'` trusts. It forwards extra and repeated query parameters, treats `/api/files/x` as an admin call, and follows redirects anywhere. Proof.             | `worker/proxy.ts:90-95`, `:150`, `:156`, `:174-188`                        | 20, 21         |
| 9   | Medium                               | The security headers in `public/_headers` do not apply to anything the Worker answers. No HSTS. The policy stops a script from calling other sites, not from driving `/api` or leaving by navigation.                                                                         | `public/_headers`; `worker/http.ts:8-19`                                   | 26–29          |
| 10  | Medium                               | Enrolling admins is unsafe as documented: `ADMIN_UIDS` as a secret cannot be read back, so nobody can review who is an admin. An attacker can register an admin-to-be's e-mail first. Accepting terms in the app wipes the claim.                                             | `docs/SIGN-IN-SETUP.md:52-53`                                              | 3, 5           |
| 11  | Medium                               | The local launcher puts the keys in the process environment, where any program running as the same user (a coding agent included) can read them, and hands the whole shell environment to the local Worker.                                                                   | `scripts/dev-production.mjs:41`, `:66-69`                                  | 34             |
| 12  | Medium                               | Apple: the identity token arrives through the browser, the attempt cookie is `SameSite=None`, the posted body has no size limit. No bypass found.                                                                                                                             | `worker/auth.ts:262`, `:380`, `:417-427`                                   | 1              |
| 13  | Low                                  | `/x/../api/...` and `/./auth/...` pass the redirect check. Harmless today. Proof.                                                                                                                                                                                             | `worker/http.ts:134`; `src/auth/redirect.ts:14`                            | 19             |
| 14  | Low                                  | One raw key for every cookie, no key identifier, rotation is a hard cut.                                                                                                                                                                                                      | `worker/codec.ts:54-63`                                                    | 12             |
| 15  | Low                                  | A non-`GET` request with neither `Sec-Fetch-Site` nor `Origin` passes on the panel's header alone.                                                                                                                                                                            | `worker/http.ts:99-106`                                                    | 15             |
| 16  | Low                                  | One refresh promise shared between requests may not survive a cancelled request on the real runtime. Request bodies read before they are measured.                                                                                                                            | `worker/session.ts:173-191`; `worker/auth.ts:170-179`                      | 7              |

Statements in the other documents that this review showed to be wrong:

| Document says                                                                       | The facts                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `SECURITY.md`: "no open security issue known in the code as it stands"              | Findings 1, 3, 4, 8 and 13 are in the code as it stands               |
| `SIGN-IN-SETUP.md` §7: with the stopgap key, "keep the panel read-only (it is)"     | Only the page is read-only. The Worker forwards writes                |
| `SIGN-IN-SETUP.md` §1: a removed claim is refused within the hour                   | Not against a saved session cookie (finding 4)                        |
| `SIGN-IN-SETUP.md`: a new session key signs everyone out and nothing else is needed | The Firebase refresh tokens inside old cookies stay valid at Firebase |
| `SIGN-IN-SETUP.md` §7a: switch `workers.dev` off in the dashboard                   | The next deploy switches it back on                                   |
| `SECURITY.md` §5a: files cannot run as the panel                                    | True when opened as a page, false when loaded as a script             |
| `SECURITY.md` §5a: a token never arrives from the browser                           | The Apple identity token does                                         |
| `public/_headers`: "for every page and file the panel serves"                       | Not for anything the Worker answers                                   |

## 4. The approach

Decided direction, 2026-11-13: admins sign in with their Firebase account, as in the app. A new
sign-in every two days is acceptable. Blocking a person is done on the backend by user id.

### 4.1 In one paragraph

An admin signs in with Google through Firebase. The backend, which already has Firebase's admin
tools, checks that the person is on its own list of admin user ids and turns the sign-in into a
**Firebase session cookie** that lasts 48 hours. The Worker keeps that cookie in the browser where
the page cannot read it, and attaches it to every call it forwards, together with the Worker's own
signature. The backend checks both on every call. The Worker decides nothing about who is an
admin; it only refuses what should never be forwarded.

### 4.2 How a sign-in goes

1. The login page sends the browser to `/auth/google/start`. The Worker sends it to Google and
   back, as today (authorization code, PKCE, state, nonce in a sealed ten-minute cookie).
2. The Worker exchanges Google's answer for a Firebase token (`signInWithIdp`). It throws the
   Firebase refresh token away at once.
3. The Worker sends the Firebase token to the backend (`POST panel/session`), signed.
4. The backend checks: the token is valid and not revoked, the user id is on its admin list, the
   sign-in was made with Google, and it happened within the last five minutes. Then it asks
   Firebase for a session cookie that expires in 48 hours.
5. The Worker stores it as one cookie: `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`.
   Someone who is not on the list gets no cookie, and a page that shows their own user id, so they
   can pass it to whoever manages the list.
6. On every later call the Worker forwards the cookie's value and its signature. The backend
   verifies the session with Firebase's own check, with revocation checking on, and looks the user
   id up on its list again.

### 4.3 What this gives

| Need                                         | How it is met                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in with the Firebase account            | Yes, with Google. Password and Apple are not offered to admins (rule 1)                                                                                                                                   |
| New sign-in every two days                   | The 48 hours are inside the session cookie, signed by Google's keys. Nobody can stretch them, with or without the Worker's keys                                                                           |
| Block a person on the backend                | Take the user id off the backend's list: refused on the next call. Nothing to wait for                                                                                                                    |
| Sign-out that really ends the session        | The backend records the sign-out time for that user id and refuses any session that began earlier (rule 9)                                                                                                |
| The Worker cannot be walked around           | The backend refuses any call without the Worker's signature, so a Firebase token taken from the mobile app or from anywhere else opens nothing (rule 24)                                                  |
| A mistake in the Worker is not fatal         | The backend checks the session and the list itself on every call. The Worker holds no master key and no list                                                                                              |
| Less hand-written session code               | The two encrypted cookies, the hourly renewal, the refresh token in the browser, the password route and the Apple route are deleted. Findings 4, 5, 12, 14 and 16 go with them                            |
| A passing script cannot take the session away | The cookie is `HttpOnly`. As today                                                                                                                                                                       |

### 4.4 What it does not give, said plainly

- **A second factor that code can require.** With Google sign-in the second factor is the one on
  each admin's Google account. A Google token does not say whether it was used, so this is a rule
  kept by people (rule 4), not by code. For two to four known people that is workable. The two
  ways to make it enforced are in 4.5.
- **Protection against a hostile script inside the panel's own bundle.** Such a script cannot take
  the cookie, but it can click what the admin can click while the tab is open. What bounds it: the
  Worker's table of allowed calls, limits, the notification on dangerous actions, the record of
  every change, and the dependency rules (rules 16–18, 30, 37). No sign-in design changes this.
- **A hidden panel.** The login page is reachable by anyone who knows the address. They can start
  a Google sign-in and be refused.

### 4.5 Stronger, if wanted later

Each of these adds to the approach without changing it.

| Addition                                              | What it adds                                                                                                                                   | Cost                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase second factor (a code from an authenticator app) | A second factor the backend can require: the session then carries proof that it was used                                                   | The Firebase project must be upgraded to "Authentication with Identity Platform" (a change to the production project, with its own pricing). One more step at sign-in and an enrolment screen to build. About two days |
| Cloudflare Access in front of the panel               | Its own required second factor, sign-in logs, and the panel hidden from everyone not on a list                                                 | A second sign-in before the panel. Believed free for up to 50 users (reviewer's source; Cloudflare's pricing pages read on 2026-11-13 did not state it, so confirm in the dashboard). No code needed for the outer gate |
| A separate Firebase project for admins                | Admin accounts leave the app's open account pool entirely                                                                                      | A second project to run; the backend verifies two kinds of token. About a day                                                                                                                                          |

### 4.6 Considered and not chosen

- **Cloudflare Access as the only sign-in** (the reviewer's first choice). Strongest for the least
  code, but it is not the Firebase account, the actor would be an e-mail and not a user id, and
  the decision was to stay with Firebase.
- **The Firebase SDK in the browser.** Leaves a long-lived token where any script on the page can
  read it. The IETF document ranks this last.
- **The session as built** (refresh token in an encrypted cookie, renewed by the Worker). It
  cannot be ended, and it makes the Worker the judge of who is an admin.
- **Firebase session cookies made by the Worker.** Would need a Firebase service account key in
  the Worker, which can manage every account in the app. The backend already has that key, so the
  backend makes them.
- **Password with Firebase's e-mail link, or password alone.** Both come down to whoever controls
  the mailbox or guesses the password.

## 5. Rules

MUST means the build is not done without it. SHOULD means do it unless there is a written reason
not to.

### 5.1 Who is an admin

1. Admins MUST sign in with Google through Firebase and in no other way. The Worker has no
   password route and no Apple route. *Findings 2 and 12. Two to four people do not need three
   ways in.*
2. The backend MUST accept a session only if it says the sign-in was made with Google
   (`firebase.sign_in_provider` is `google.com`). *A password on the same account, set by a reset
   or by someone else, then opens nothing.*
3. The admin list MUST be one list of Firebase user ids, in a plain, readable backend setting. The
   Worker keeps no list and reads no claim; it asks the backend. The hardcoded user id in the
   backend's `isAdmin` MUST be removed and the `admin` claim MUST NOT be used. *One place to
   review. Claims are shared with the whole app and are replaced when terms are accepted.*
4. Every admin's Google account MUST have 2-Step Verification on, SHOULD use a passkey or security
   key, and whoever adds a person to the list confirms it with them. *The one rule here that code
   cannot check; see 4.4.*
5. Adding an admin MUST go: the person signs in at the panel and is refused; the page shows their
   user id; in the Firebase console their account is checked to have Google as its only sign-in
   method (others removed) and their refresh tokens are revoked; then the user id goes on the
   list. Removing one MUST go: off the list, then revoke their refresh tokens. *Someone else may
   have registered that e-mail with a password first.*
6. Every account that can change the Worker, the backend or the Firebase project MUST have a
   second factor and as few members as possible: Cloudflare, Azure, the Firebase console, and the
   GitHub repository, because a push to `main` deploys. *Whoever can deploy the Worker can act
   inside every admin's session; whoever owns the Firebase project can make any token.*

### 5.2 Session

7. The session MUST be a Firebase session cookie created by the backend, lasting 48 hours, and
   only after the checks of section 6. The Worker MUST discard the Firebase refresh token as soon
   as it has the first token. *Firebase's own mechanism for sessions held by a server. Nothing to
   renew, nothing to mix, no long-lived credential in the browser.*
8. The backend MUST verify the session on every admin call with revocation checking on, and look
   the user id up on its list each time. *This is what makes blocking immediate.*
9. Sign-out MUST clear the cookie and tell the backend, which records the time for that user id
   and from then on refuses any session that began before it. *Without this, Firebase's
   documentation says, a cleared cookie "remains active until its natural expiration". Recording
   the time ends the panel session without signing the person out of the mobile app.* (As built
   since 2026-11-16. For two days the build revoked the user's refresh tokens instead, which also
   signed them out of the app; the owner decided against that.)

### 5.3 Cookies and keys

10. The session cookie MUST be `__Host-`, `Secure`, `HttpOnly`, `Path=/`, without `Domain`,
    `SameSite=Strict`, with a lifetime no longer than the session.
11. The page's code MUST never receive the session or any token. It learns who is signed in from
    `/auth/session`, which the Worker answers by asking the backend.
12. The sign-in attempt cookie (state, PKCE value, nonce; ten minutes) MUST be sealed with a key
    used for nothing else. *It is the last sealed cookie; its key no longer protects any session.*
13. The Worker MUST check Google's token itself before passing it to Firebase: audience, issuer,
    expiry, nonce and a verified e-mail. *Ten lines that remove the dependence on Firebase
    catching a wrong token.*

### 5.4 Requests

14. The Worker MUST refuse (404) any request whose host is not the one in a `PANEL_ORIGIN`
    setting, before anything else. Google's return address MUST be built from `PANEL_ORIGIN`, not
    from the request. *Finding 3.*
15. Every `/api/*` request except a `GET` for a media file MUST carry the panel's header and
    `Sec-Fetch-Site: same-origin`. A non-`GET` without `Sec-Fetch-Site` MUST be refused. `Origin`,
    when present, MUST equal `PANEL_ORIGIN`. *Fail closed; every current browser sends the header.*
16. The Worker MUST hold an explicit table of allowed method and address pairs and refuse
    everything else. It starts with `GET` rows only. A `POST`, `PUT` or `DELETE` row is added when
    a section is opened for writing, one row at a time. *The server decides what is read-only, not
    the page. Finding 1.*
17. The Worker MUST limit, per admin: changes per minute, user look-ups per minute, and a hard cap
    per hour on "send a message" and "change an e-mail". *Bounds what a script inside a session
    can do before someone notices.*
18. "Send to all users" and "change a customer's e-mail" MUST need a second step that the backend
    checks: the dry run returns a one-time value together with what will happen (how many
    recipients; the old and new address), and the real call is accepted only with that value
    within five minutes. All admins MUST be notified when either runs. The backend SHOULD also
    require a sign-in within the last ten minutes for these two. *A confirmation window in the
    page protects against a slip of the hand; the notification and the cap are what protect
    against a script.*
19. A return address taken from a request MUST be resolved the way a browser resolves it and then
    checked, not checked as text. *Finding 13.*

### 5.5 Proxy and backend

20. The Worker MUST forward only to `API_ORIGIN`, only the rows of rule 16, only the listed request
    headers and never the browser's cookies. It MUST NOT follow a redirect, except for a media file
    and then only to the configured storage host.
21. Media MUST be served only with an allowed type (images except SVG, audio, video, PDF); anything
    else is refused. The address sent to the backend MUST be rebuilt from the single checked `path`
    value, with no other parameter. `/api/files/…` MUST be refused. Responses MUST carry
    `Cross-Origin-Resource-Policy: same-origin`. *Finding 8.*
22. The Worker MUST NOT hold the Function App master key, at any stage. *Finding 1. Microsoft
    documents that key as giving administrative access to the whole Function App.* Real data
    therefore cannot be shown before the backend work of section 6: the admin addresses accept
    only that key today.
23. Until the backend returns a small typed account record, the Worker SHOULD cut the answer of
    `GET accounts/{uid}` down to the fields the page shows. *Finding 7.*
24. The Worker MUST sign every call it forwards, and the backend MUST refuse an admin call without
    a valid signature. *Every admin's phone holds a valid Firebase token for the same account,
    because they use the app. Without the signature that token, or one leaked from the app, would
    open the admin addresses. With it, only calls that passed the panel count.*
25. The backend MUST be the final authority and check every call itself (section 6).

### 5.6 Browser

26. Every answer from the Worker MUST carry `X-Content-Type-Options: nosniff`,
    `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`,
    `Cache-Control: no-store` (media excepted) and, for JSON, the policy
    `default-src 'none'; frame-ancestors 'none'`. *`public/_headers` does not reach them.*
27. HSTS MUST be on for the panel's host, two years.
28. `script-src` MUST stay `'self'` with no other host, no `unsafe-inline` and no `unsafe-eval`,
    and nothing served from the panel's address may have a script type except the build output.
29. Trusted Types (`require-trusted-types-for 'script'`) SHOULD be added, report-only first, and a
    place to receive violation reports SHOULD exist. *The first sign of an injected script.*
30. Dependencies MUST be installed with `npm ci` from the lock file, with install scripts off by
    default, and updates SHOULD wait some days after publication. *The bundle runs inside every
    admin's session; this is what keeps hostile code out of it.*

### 5.7 Secrets and environments

31. `wrangler.json` MUST contain `workers_dev: false`, `preview_urls: false` and the custom domain
    as a route. *The file in the repository is then the truth, and a deploy cannot undo it.*
32. Settings that are not secret (`API_ORIGIN`, `PANEL_ORIGIN`, the Firebase web key, the Google
    client id) MUST be plain variables in `wrangler.json`, reviewed like code. The names of the
    required secrets MUST be declared there so a deploy fails when one is missing.
33. The Worker has three secrets: the Google client secret, the Worker-to-backend signing secret,
    and the key for the sign-in attempt cookie. Michał creates or copies each and types it in by
    hidden prompt; the signing secret goes into Cloudflare and Azure and nowhere else. None of them
    alone opens the admin addresses: that also needs a live session of a listed admin.
34. No production secret may exist on a developer's machine in any form.
    `scripts/dev-production.mjs` and `npm run dev:production` MUST be deleted. Local work uses the
    Test environment. *Finding 11.*
35. The Worker MUST NOT log request bodies, cookies, tokens, query text or customers' e-mail
    addresses. *Logs can be read by every member of the Cloudflare account.*

### 5.8 Records and alarms

36. The Worker MUST write one structured log line for every refused request, every non-`GET`
    request and every sign-in outcome: time, admin user id if known, method, address pattern,
    status, Cloudflare's request identifier.
37. The backend MUST write a record for every change: time, admin user id, method, address, the
    identifier of what was changed, result, the Worker's request identifier. Append-only. Never a
    message body or a personal field.
38. Alerts SHOULD exist for: a call refused for a missing or wrong signature (someone is calling
    the backend around the panel), a refused sign-in, any send or e-mail change, a limit being
    hit, a new Worker version.
39. The runbook in section 8 MUST be written into the repository and each row tried once.

## 6. What the backend does (replaces B0.1, B0.2 and B0.5 in BACKEND-SCOPE.md)

As built: the panel has its own routes, `panel/<route>`, registered in the backend's
`functions/panel/index.ts`. They are open at the Functions host and guarded in one place
(`makePanelHandler` and `PanelAccessService`), with a test that fails if a `panel/` route is
registered without the guard. The older `manage…` routes are untouched: the host still asks for
the admin key there, Retool keeps using them, and a panel admin's session opens nothing on them.

A **panel admin** is a narrow kind of admin. Being on `PANEL_ADMIN_UIDS` gives nothing in the
mobile app, nothing with a Firebase token sent to the backend directly, and nothing on Retool's
routes. It only lets that person open a session through the panel, and only the routes listed in
`functions/panel/index.ts` accept that session.

The addresses below are written as first planned; in the code they are `panel/session`,
`panel/signOut` and `panel/me`. Headers: `x-panel-timestamp`, `x-panel-signature` (`v1=<hex>`),
`x-panel-session`. Signed text, joined by newlines: `v1`, the timestamp, the method, the path, the
query in a fixed spelling, the SHA-256 of the body, the SHA-256 of the session (or of the token
when a session is started). Valid for 120 seconds. One example is pinned in both repositories'
tests, so neither side can change how it signs without a test failing.

**Three new addresses**

| Address                | What it does                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST manage/session`  | Takes a Firebase token. Checks rows 1, 3 and 4 below, verifies the token with revocation checking, and requires that its sign-in time (`auth_time`) is within the last five minutes. Then `createSessionCookie` for 48 hours. Anything else: 403, no cookie |
| `POST manage/signOut`  | Records "now" as the earliest allowed sign-in time for this user id (table `PanelSignOuts`). The person's Firebase sessions, the mobile app's included, are not touched |
| `GET manage/me`        | Returns the user id, e-mail and name of the session, after the guard                                                                                                                                                                                      |

**The guard, on every admin call.** All rows must hold.

| #   | Check             | Detail                                                                                                                                                                                                                                                 |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Worker signature  | Headers with a timestamp and an HMAC-SHA256, made with a secret only the Worker and the backend have, over: a version label, the timestamp, the method, the address with its query, and the SHA-256 of the session value. Timestamp within 60 seconds. Constant-time comparison. Two secrets accepted during a rotation |
| 2   | Session           | `verifySessionCookie(value, true)`: Google's signature, this project, not expired, not revoked, account not disabled                                                                                                                                   |
| 3   | Admin list        | The user id is on the backend's own list                                                                                                                                                                                                               |
| 4   | Signed in how     | `firebase.sign_in_provider` is `google.com`                                                                                                                                                                                                            |
| 5   | Not signed out    | The session's `auth_time` is not earlier than the time recorded for this user id by `manage/signOut`. If that record cannot be read, nobody is let in (503 `PANEL_UNAVAILABLE`) and nobody is signed out |
| 6   | Dangerous actions | Rule 18                                                                                                                                                                                                                                                |
| 7   | Record            | Rule 37                                                                                                                                                                                                                                                |

No function key is accepted on these addresses. While Retool is alive it uses a separate key that
is not the master key, on its own guard, deleted together with Retool. The master key is renewed
on the day this goes live.

Why the signature and the session are both needed. The session proves who the person is and that
the backend itself let them in within the last 48 hours; a bug in the Worker cannot make one. The
signature proves that the call passed the panel: its table of allowed calls, its request checks,
its limits. Either alone is a single point of failure.

Cost to know about: revocation checking is one call to Firebase for every admin call. At this
panel's size that is fine.

## 7. Plan

Sizes: S is up to half a day, M is one to two days.

### 7.1 Panel, before any key is set in Cloudflare

| #   | Step                                                                                                                                                             | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `wrangler.json`: `workers_dev`, `preview_urls`, the custom domain route, the non-secret settings                                                                 | S    |
| 2   | Worker: host check; the method and address table with `GET` rows only                                                                                            | S    |
| 3   | Worker: its own response headers; stricter request check (rule 15); return address check (rule 19)                                                               | S    |
| 4   | `/api/files`: allowed types, rebuilt address, redirect host check                                                                                                | S    |
| 5   | Remove the password and Apple routes, the two session cookies, the renewal and the Worker's admin list. Google's token checked in the Worker                     | M    |
| 6   | New session flow against the contract of section 6: `manage/session`, `manage/me`, `manage/signOut`, one session cookie, the Worker's signature on every call    | M    |
| 7   | Login page: Google only; the refusal page that shows the person's own user id                                                                                    | S    |
| 8   | Worker: log lines (rule 36)                                                                                                                                      | S    |
| 9   | Delete the local launcher. Rewrite SIGN-IN-SETUP.md for the three secrets and the new steps                                                                      | S    |
| 10  | The six proofs from the review as tests, and the tests of section 9 that concern the Worker                                                                      | M    |

All of it can be built and tested against fakes without any key. After it the panel can be
deployed, but nobody can sign in until the backend part exists.

### 7.2 Backend, before the first real sign-in

| #   | Step                                                                                                       | Who             | Size |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------- | ---- |
| 11  | The guard and the three addresses of section 6, with tests                                                 | Backend         | M    |
| 12  | Remove the hardcoded user id; renew the master key; move Retool to a key that is not the master key        | Backend, Michał | S    |
| 13  | `accounts/{uid}` returns a small typed record; user search limits enforced by the backend                  | Backend         | S    |
| 14  | Keys set by Michał (SIGN-IN-SETUP.md, rewritten); admins added by rule 5                                   | Michał          | S    |
| 15  | One full run against the real services, reading only                                                       | Michał          | S    |

Reading real data starts here.

### 7.3 Before the first write row is added to the Worker's table

| #   | Step                                                            | Who                 | Size |
| --- | --------------------------------------------------------------- | ------------------- | ---- |
| 16  | Backend record of every change                                  | Backend             | M    |
| 17  | Dangerous actions: one-time value, notification, hard limits    | Backend, panel code | M    |
| 18  | Worker: per-admin limits                                        | Panel code          | S    |
| 19  | Runbook written, each row tried once                            | Michał              | S    |

### 7.4 Can wait

| #   | Step                                                          | Size                |
| --- | ------------------------------------------------------------- | ------------------- |
| 20  | One of the stronger second factors of section 4.5             | S to M              |
| 21  | Trusted Types, report-only then enforced                      | M                   |
| 22  | Dependency install policy; alerts on the log lines            | S                   |
| 23  | Retire Retool's key                                           | S, when Retool goes |

## 8. Runbook

| Situation                                | Steps                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Block one admin now                      | Take the user id off the backend's list. Then revoke their refresh tokens in Firebase                                                                              |
| An admin's device is lost or compromised | The same, and they change their Google password and review their Google account's devices. Read the backend's record for their user id. Add them back by rule 5   |
| Sign everyone out                        | Record "now" as the sign-out time for every user id on the list, or revoke the refresh tokens of each                                                              |
| Change the Worker-to-backend secret      | Add the new value as the second accepted secret on the backend; set it in the Worker; remove the old one from the backend                                          |
| Cloudflare account may be compromised    | Change the Worker-to-backend secret on the Azure side first, which cuts the Worker off; review the deployed versions; sign everyone out; then restore              |
| Google client secret may have leaked     | Make a new one in the Google console, set it in the Worker, delete the old one                                                                                     |
| Master key, while anything still uses it | Renew it in Azure; update Retool                                                                                                                                   |

## 9. Tests that must exist

- Backend guard: one failing case for each row of section 6 (no signature, wrong secret, old
  timestamp, changed address, changed session; expired, revoked or foreign-project session; user id
  not on the list; signed in with a password; session older than the sign-out time), and a test
  that every admin address goes through the guard.
- `manage/session`: refused for a user id not on the list, for a password sign-in, for a sign-in
  older than five minutes, for a revoked token.
- A Firebase token of a listed admin sent straight to an admin address, without the Worker, is
  refused.
- A request for any host other than `PANEL_ORIGIN` is refused.
- Every method and address pair outside the table is refused. One test lists the table, so adding
  a row is a visible change in review.
- A non-`GET` without `Sec-Fetch-Site` is refused.
- `/api/files`: a JavaScript, HTML, SVG or missing type is refused; so are a second `path`, any
  other parameter, a `%` left after decoding, and `/api/files/x`; a redirect to another host is
  not followed.
- A session cookie replayed after sign-out is refused.
- Google's token with a wrong audience, issuer, nonce, an expired one, or an unverified e-mail
  never reaches Firebase.
- Dangerous actions: without the one-time value, with a used one, with an expired one.
- The six proofs from this review, turned into tests that fail while the hole is open.
- One run against the real services before anyone relies on it. The fakes cannot stand in for it.

## 10. Not checked

- Anything only the real Firebase, Google or backend shows. In particular: that a session cookie
  carries `firebase.sign_in_provider` as a token does (Firebase's documentation says it "has the
  same claims" as the token), and how Firebase treats a Google account whose address is not a
  Gmail address when a password account with that address already exists.
- The backend's code. Everything about it here comes from this repository's notes: what
  `/api/files` does, who can upload which file types to the public container, whether user search
  limits results itself, where it could keep the sign-out times.
- Whether the backend's Firebase service account is allowed to create session cookies. It manages
  users and claims today, so it is expected to be.
- Cloudflare: that switching preview addresses off removes the addresses of versions already
  uploaded; what the logs keep.
- Cloudflare Access pricing (section 4.5).
- Whether the panel will sit on a domain whose other hosts are all trusted. A host next to the
  panel's on the same domain counts as the same site to a browser.
- Browser behaviour in finding 8 follows from the specifications; no browser was run.

## 11. Sources

Re-read on 2026-11-13:

- Firebase, Manage Session Cookies (5 minutes to 2 weeks; created by the server from a token;
  check `auth_time` before issuing; `verifySessionCookie` with revocation checking; a cleared
  cookie stays valid until it expires; same claims as the token):
  https://firebase.google.com/docs/auth/admin/manage-cookies
- Firebase, Verify ID Tokens (`auth_time`, audience, issuer):
  https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Firebase Admin SDK, `DecodedIdToken` (`auth_time` is "when the user initially logged in to this
  session"; `firebase.sign_in_provider`, `firebase.sign_in_second_factor`):
  https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.decodedidtoken
- Firebase, TOTP second factor (needs Authentication with Identity Platform; a verified e-mail;
  works with Google sign-in): https://firebase.google.com/docs/auth/web/totp-mfa
- Cloudflare, `workers.dev` (a dashboard switch-off is undone by the next deploy unless
  `workers_dev = false` is in the configuration):
  https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- Cloudflare, static asset headers (`_headers` is not applied to responses made by Worker code):
  https://developers.cloudflare.com/workers/static-assets/headers/
- Cloudflare, Access for Workers and its independent second factor (section 4.5):
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/ and
  https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/

The reviewer's, not re-read:

- IETF, "OAuth 2.0 for Browser-Based Applications":
  https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/
- OWASP Session Management and Cross-Site Request Forgery Prevention cheat sheets:
  https://cheatsheetseries.owasp.org/
- Firebase: managing sessions and revocation, users and trusted providers
  (https://firebase.google.com/docs/auth/).
- Microsoft, Azure Functions access keys:
  https://learn.microsoft.com/en-us/azure/azure-functions/function-keys-how-to
