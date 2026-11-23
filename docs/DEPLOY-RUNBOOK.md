# Deploying the backend and the admin panel (v1)

Everything needed to put the backend's panel routes and the panel itself into production, with
what is done already. Marks: ✅ done (checked), ⬜ to do, ❓ done by hand, cannot be checked from
outside (confirm it yourself).

**Where we are (2026-11-23, evening):** the panel is live at `https://panel.codzienniefitapp.com`,
fully configured, and its code is served only after sign-in. **Sign-in does not work yet because
the backend's panel routes are not deployed** (`/api/panel/…` answers 404; the PR is not merged).
Production runs the backend's `main` (`31cc84c`); the backend deploy adds only the panel work.

Both launch **read-only**: in Produkcja only "Wyczyść cache backendu" writes. Retool keeps working.
**v1 does not use Cloudflare Access** (Part 10, later).

**Before changing the panel's Worker, read [ACCESS-MODES.md](ACCESS-MODES.md)**: what a signed-out
visitor may download, the pass, and the rules (with their tests) that keep the panel's code and data
from leaking.

You create and paste every secret yourself. None goes in a file, a commit or a chat.

---

## A. Done ✅

1. ✅ Panel admin `6bt7loE8cCgfvRTeir9pdlXSETN2` in the backend's code; three Wrapped testers in
   code (1.2).
2. ✅ The panel's code on `admin-panel` `main`; Cloudflare deploys every push (Part 4).
3. ✅ `wrangler.json`: custom domain, `workers_dev` off, `keep_vars`, logs and traces at 100%, the
   `ASSETS` binding and `run_worker_first: true` (1.4).
4. ✅ DNS record and certificate for `panel.codzienniefitapp.com`, made by Cloudflare (5.1).
5. ✅ `admin-panel.marta-100.workers.dev` switched off (404).
6. ✅ Google OAuth client with the redirect `https://panel.codzienniefitapp.com/auth/google/callback`
   (Part 3); sign-in reaches Google and comes back.
7. ✅ The Worker's eight values set and valid (5.2).
8. ✅ Search engines and AI crawlers turned away (`robots.txt`, `noindex`/`noai` everywhere); the
   sign-in page says nothing about what is behind it.
9. ✅ **The panel's code only after sign-in**: without a pass, every page is the Worker's own
   sign-in page and every file of the panel answers 404; a deployed Worker with a setting missing
   stays closed (ACCESS-MODES.md). Live once its push is deployed.
10. ✅ Readable logs: `[ADMIN_ACTION]` and `[SECURITY_ALERT]` in the Worker (Cloudflare Observability)
    and in the backend (Application Insights, after the backend deploy).

**Confirm yourself** (cannot be checked from outside) ❓

- ❓ `PANEL_SIGNING_SECRET` and `SIGN_IN_COOKIE_KEY` show as type **Secret** in the Worker, and were
  regenerated after being plain Variables at first (5.2).
- ❓ Worker build settings: production branch `main`, deploy command `npx wrangler deploy`, no
  branch builds (1.5).
- ❓ Your admin account signs in to Firebase **only with Google**, 2-Step Verification on (Part 3).
- ❓ Two-factor sign-in on Cloudflare, Azure, Google Cloud / Firebase and GitHub; branch protection
  on `main` in both repositories (6.7).

## B. To do now, in this order ⬜

1. ⬜ **Merge** the backend PR "Feat/admin panel backend" (2.1).
2. ⬜ **Run all backend tests** on `main` (2.2).
3. ⬜ **Azure**: `PANEL_SIGNING_SECRET` = the same value as in the Worker; go through table 1.1 (2.3).
4. ⬜ **Deploy the backend** at a quiet hour: build, dry run, deploy, purge Cloudflare (2.4).
5. ⬜ **Check the backend and Retool** (2.5): panel route `401`, app `200`, Wrapped `401`,
   recommendations; the mobile app; Retool's lists without saving anything.
6. ⬜ **First sign-in** and the panel checks (5.3). Everyone signs in once more after the gate's
   deploy (sessions from before have no pass).
7. ⬜ **Alert** on `[SECURITY_ALERT]` in Application Insights (2.6).
8. ⬜ **Cloudflare security**: Block AI bots, five WAF rules, the sign-in rate limit (6.1–6.3).
9. ⬜ **HSTS and TLS** settings (6.4). No HSTS header yet.
10. ⬜ **DNSSEC** (6.5). No DS record yet.
11. ⬜ **E-mail anti-spoofing records** after checking nothing sends mail as the domain (6.6).

## C. Later

- **Opening sections for writing**, one at a time, `[TEST]` items first (Part 8).
- **Before opening messages and accounts**: the rate limit and second confirmation step in the
  backend (Part 8).
- **After Retool is retired**: the numbered steps in Part 9.
- **Cloudflare Access** in front of the panel, if wanted (Part 10).

---

## Why it is built this way

**Why the panel does not reuse Retool's endpoints.** Retool's `manageX` routes are
`authLevel: 'admin'`: the Azure host lets through only calls carrying the Function App's **master
key**, which unlocks every function and the host's management API, never expires and says nothing
about who is calling. The panel must never hold it. So the panel calls **the same handlers** on
`panel/<same route>`: open to the host, guarded by our code on every call (the Worker's signature,
a Firebase session of someone on `PANEL_ADMIN_UIDS`, Google sign-in only, 48 hours at most,
sign-out honoured at once). The two doors also behave differently: the panel gets versions
(409/428), statuses, strict Polish validation (422) and saves that keep what they do not send;
Retool keeps its old behaviour, which you chose not to change. Only the 32 routes in
`PANEL_ROUTES` exist for the panel; Retool-only operations (regenerating milestone badges, usage,
YouTube sync, Retool's upload) stay out of a panel session's reach. Every panel call is logged with
the admin's user id; a Retool call can only be logged as "the functions key".

**Why 32 registrations.** One per panel route: an explicit allow-list (anything else is the host's
404 before our code runs), a test that every one is guarded, and per-route names in the audit and
in Application Insights. They live in the same Function App and process; they cost nothing at cold
start or in billing.

**What the deploy creates.**

| Where | What | Created by | Why |
| --- | --- | --- | --- |
| Azure, the existing general data storage account | Table `PanelAudit` | the code, on first write | Permanent, append-only record of who changed what through the panel (logs expire and can be sampled) |
| same | Table `PanelSignOuts` | the code, on first sign-out | Firebase cannot end one session without signing the person out of the mobile app; the sign-out time is kept and older panel sessions are refused. Also the emergency cut-off |
| same | Table `PanelDocs` | the code, on first save | The planner's documents and settings, which the app must never see; kept out of `Challenges` |
| Azure Function App | Setting `PANEL_SIGNING_SECRET` | you | Proves a call came from the panel's Worker |
| Cloudflare | Worker `admin-panel`, custom domain and DNS, eight values, Git build | done | The panel and its gate to the backend |
| Google / Firebase | OAuth client; Google provider; the existing `FIREBASE_KEY` creates session cookies | done / existing | Sign-in and sessions |

Not needed: a new storage account, database, migration, queue, blob container or Function App.
The Worker has no KV, D1 or R2: the session is a Firebase session cookie in an encrypted HttpOnly
cookie in the browser, checked by the backend on every call.

**What changes for app users and Retool when the backend is deployed.** App users: practically
nothing. Public endpoints refuse drafts and deleted items (none exist; no production row has a
`Status` column, so status still comes from `Hidden`); challenge progress updates make one extra
table read; **every admin save now really purges the CDN** (the old purge never worked), so after a
save the app's requests reach Functions until the cache refills. Nothing is migrated or deleted.
Retool: same routes, key and rules; it writes `Status`/`WasPublic` next to `Hidden`; a workout's
equipment or duration change also updates the challenges using it; a message send claims the draft
for 10 minutes and a half-failed send locks it; `.mp4`/`.ogg` uploads work; account reads no longer
include the password hash; every call is logged as `[ADMIN_ACTION] functions-key (Retool)`. Retool
still saves without versions: **never edit the same item in Retool and in the panel**.

---

## Part 1. Every setting

### 1.1 Azure: Function App `fitfunctions` → Settings → Environment variables

| Name | What to do | Value | Status |
| --- | --- | --- | --- |
| `PANEL_SIGNING_SECRET` | **Add** (2.3) | the same value as in the Worker (5.2); at least 32 characters | ⬜ |
| `PANEL_SIGNING_SECRET_NEXT` | leave unset | only while rotating (Part 8) | — |
| `CLOUDFLARE_API_TOKEN` | keep, **check** | needs *Zone → Cache Purge → Purge* on `codzienniefitapp.com` | ❓ |
| `CLOUDFLARE_ZONE_ID` | keep | the zone id of `codzienniefitapp.com` | — |
| `ADMIN_FUNCTIONS_KEY`, `FIREBASE_KEY`, `DATA_STORAGE_ACCOUNT_*`, `BLOBS_PUBLIC_LINK`, `API_PUBLIC_LINK`, the rest | keep | unchanged | — |
| `WRAPPED_ENABLED` | **must not be set** (or not `true`) | Wrapped stays closed | ❓ |
| `WRAPPED_NOW_UTC` | **must not be set** | tests only | ❓ |
| `WRAPPED_TESTER_UIDS`, `WRAPPED_VIDEO_*` | optional | extra testers; 2026 video assets | — |
| `WRAPPED_2025_START_UTC`, `WRAPPED_2025_END_UTC` | **delete** | no longer read | ❓ |

### 1.2 In the backend's code ✅

| Where | What |
| --- | --- |
| `src/config/panelAdmins.ts` → `PANEL_ADMIN_UIDS` | the one panel admin, `6bt7loE8cCgfvRTeir9pdlXSETN2`. Adding or removing someone: Part 8 |
| `src/modules/services/helpers/wrappedSettings.ts` → `WRAPPED_TESTERS` | three Wrapped test accounts; empty it after Wrapped opens |

### 1.3 Cloudflare: Worker `admin-panel` → Settings → Variables and Secrets ✅

| Name | Type | Value |
| --- | --- | --- |
| `PANEL_ORIGIN` | Text | `https://panel.codzienniefitapp.com` |
| `API_ORIGIN` | Text | `https://api.codzienniefitapp.com` |
| `MEDIA_ORIGINS` | Text | `https://superfitstorage.blob.core.windows.net,https://blobs.codzienniefitapp.com` |
| `FIREBASE_API_KEY` | Text | Firebase → Project settings → General → Web API Key (not a secret) |
| `GOOGLE_CLIENT_ID` | Text | the OAuth client id |
| `GOOGLE_CLIENT_SECRET` | **Secret** | the OAuth client secret |
| `PANEL_SIGNING_SECRET` | **Secret** | the same value as in Azure |
| `SIGN_IN_COOKIE_KEY` | **Secret** | exactly 32 random bytes, base64 (44 characters) |

While any value is missing or invalid, the sign-in page lists the names; once all are valid it
shows nothing about the settings. Secrets and text variables survive deploys (`keep_vars`). Never
copy these into `wrangler.json`, even when Cloudflare's banner suggests it.

### 1.4 In the panel's repository ✅

`wrangler.json`: `"workers_dev": false`, `"preview_urls": false`, `"keep_vars": true`,
`"routes": [{ "pattern": "panel.codzienniefitapp.com", "custom_domain": true }]`, observability
with logs (including request logs) and traces at 100%, and `assets` with `"binding": "ASSETS"` and
`"run_worker_first": true`, so the panel's code is served only after sign-in
([ACCESS-MODES.md](ACCESS-MODES.md)).

### 1.5 Cloudflare: Worker `admin-panel` → Settings → Build ❓

| Setting | Value |
| --- | --- |
| Git repository / production branch | `codzienniefit/admin-panel` / `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (`npm run deploy` builds a second time) |
| Builds for other branches / pull requests | off |

### 1.6 DNS: zone `codzienniefitapp.com`

| Record | Status |
| --- | --- |
| `api` CNAME → `fitfunctions.azurewebsites.net`, proxied | ✅ keep |
| `blobs` CNAME → `superfitstorage.blob.core.windows.net`, proxied | ✅ keep |
| `asuid.api` TXT (Azure's proof of the API's domain) | ✅ keep |
| `panel` (Worker custom domain, made by Cloudflare; never add it by hand) | ✅ |
| DNSSEC | ⬜ 6.5 |
| null MX, SPF, DMARC, DKIM | ⬜ 6.6 |

---

## Part 2. Backend ⬜

### 2.1 Merge

Merge **"Feat/admin panel backend"** (`main` ← `feat/admin-panel-backend`, 6 commits, 150 files):

https://github.com/codzienniefit/backend/compare/main...feat/admin-panel-backend?expand=1

The workflow's Azure deploy job stays red (Kudu); ignore it.

### 2.2 Run all tests on `main`

```bash
cd /Users/mzolnieruk/github/backend && git switch main && git pull --ff-only && npm ci && npx jest --no-coverage --testPathIgnorePatterns /.claude/
```

### 2.3 `PANEL_SIGNING_SECRET` in Azure

It must be the value that is in the Worker now. If you do not have it any more, make a new one and
set it in **both** places:

```bash
openssl rand -base64 48 | tr -d '\n' | pbcopy
```

Azure portal → Function App **fitfunctions** → Settings → Environment variables → App settings →
`PANEL_SIGNING_SECRET` (add or edit) → paste → Apply → Apply → Confirm. If it is a new value, also:

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put PANEL_SIGNING_SECRET
```

```bash
pbcopy < /dev/null
```

Then go through table 1.1 on the same page.

### 2.4 Build, dry run, deploy

```bash
cd /Users/mzolnieruk/github/backend && scripts/build-package.sh main
```

```bash
cd /Users/mzolnieruk/github/backend && scripts/deploy-run-from-package-blob.sh /tmp/fitfunctions.zip
```

```bash
cd /Users/mzolnieruk/github/backend && scripts/deploy-run-from-package-blob.sh /tmp/fitfunctions.zip --apply
```

Answer `y` at each prompt; expect "Deploy looks healthy". Then Cloudflare → `codzienniefitapp.com` →
Caching → Configuration → **Purge Everything**. Deploy at a quiet hour.

### 2.5 Check the backend and Retool

App up (expect `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.codzienniefitapp.com/api/appConfig
```

Panel routes there and the secret set (expect `401` and `BAD_SIGNATURE`; `503` = secret missing,
`404` = not deployed):

```bash
curl -s -w '\n%{http_code}\n' https://api.codzienniefitapp.com/api/panel/manageChallenges
```

Wrapped closed (expect `401`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.codzienniefitapp.com/api/user/wrapped/2026
```

Plan recommendations (expect `C53 → ['C62', 'C34']`):

```bash
curl -s "https://api.codzienniefitapp.com/api/workoutPlans" | python3 -c "import json,sys; d={p['id']: p for p in json.load(sys.stdin)}; print('C53 →', [r['id'] for r in d['C53'].get('recommendedNext', [])])"
```

Open the mobile app (plans, a workout, profile and badges). In Retool, **without saving any
existing item**: open Treningi, Wyzwania, Wiadomości, Odznaki, one form (close it), Użytkownicy with
your own user id. For the first hour, watch Functions load after admin saves (CDN refills).

### 2.6 Alert and admin log

Application Insights → Alerts → Create → Alert rule → Custom log search:

```
traces | where message has "[SECURITY_ALERT]"
```

Count of rows, **greater than 20** over 5 minutes (bots probing the API's admin routes each log
one; look at the volume for a day and adjust), action group: e-mail to you. The unsigned check in
2.5 must appear:

```
traces | where timestamp > ago(15m) | where message has "[SECURITY_ALERT]" | project timestamp, message
```

Who did what:

```
traces | where message has "[ADMIN_ACTION]" | project timestamp, message | order by timestamp desc
```

---

## Part 3. Google sign-in and Firebase ✅

Done: OAuth client "Admin panel" (Web application) with exactly
`https://panel.codzienniefitapp.com/auth/google/callback` as redirect and no JavaScript origins;
Google provider enabled in Firebase. Confirmed for good by the first sign-in (5.3). If Firebase
refuses it ("Logowanie nie jest poprawnie skonfigurowane"), add the client id under Firebase →
Authentication → Sign-in method → Google → "Safelist client IDs from external projects".

Your admin account: in Firebase → Authentication → Users it must sign in **only with Google** (no
password provider), with 2-Step Verification on for the Google account. ❓

## Part 4. The panel's code and build ✅

Every push to `admin-panel` `main` is built and deployed by Cloudflare; pushing is deploying. Before
every push:

```bash
cd /Users/mzolnieruk/github/admin-panel && npm ci && npm run test:all
```

## Part 5. The panel on Cloudflare

### 5.1 Address and DNS ✅

`panel.codzienniefitapp.com` is the Worker's custom domain; Cloudflare made the DNS record and the
certificate; `workers.dev` is off. Check any time (expect `{"ok":true}`):

```bash
curl -s https://panel.codzienniefitapp.com/api/health
```

### 5.2 Values and secrets ✅ / ❓

All eight are set and valid. **Check** that `PANEL_SIGNING_SECRET` and `SIGN_IN_COOKIE_KEY` show as
type **Secret** ("Value encrypted"). They were added as plain Variables at first, so their values
were visible; if they still are, delete the two Variables and set new values as secrets:

```bash
openssl rand -base64 48 | tr -d '\n' | pbcopy
```

(paste into Azure's `PANEL_SIGNING_SECRET` too, 2.3), then:

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put PANEL_SIGNING_SECRET
```

```bash
cd /Users/mzolnieruk/github/admin-panel && openssl rand -base64 32 | npx wrangler secret put SIGN_IN_COOKIE_KEY
```

```bash
pbcopy < /dev/null
```

### 5.3 First sign-in and checks ⬜ (after Part 2)

0. Before signing in, only the sign-in page, `robots.txt` and the icons can be downloaded
   ([ACCESS-MODES.md](ACCESS-MODES.md)). In a private window, View Source of
   `https://panel.codzienniefitapp.com/challenges`: a short page with no `<script>`. From a terminal
   (expect `404`, `200`, `200`):

   ```bash
   for p in /assets/index.js /favicon.ico /robots.txt; do curl -s -o /dev/null -w "%{http_code} $p\n" -A "Mozilla/5.0" "https://panel.codzienniefitapp.com$p"; done
   ```

   Once rule 6.2e is on, plain `curl` (its own user agent) is challenged (403) instead; `-A` above
   avoids that. Any `/assets/…js` address answers 404 until you sign in.
   If you were signed in before this version, you see the sign-in page once and sign in again.
1. The sign-in page shows only "Zaloguj się przez Google", no environment switch, no missing list.
2. A Google account **not** on the list: refused, its user id shown; Application Insights:
   `[SECURITY_ALERT] … NOT_PANEL_ADMIN … uid=…`.
3. Your admin account: the panel opens; challenges, workouts, badges, offers, messages and users
   load; pictures show.
4. Any save: refused with "Produkcja jest tylko do odczytu". Ustawienia → Aplikacja → "Wyczyść
   cache backendu" works.
5. The environment switch (top bar) → Test: sample data, only now that you are signed in.
6. Application Insights: `[ADMIN_ACTION] panel uid=6bt7… GET …`; Cloudflare → admin-panel →
   Observability: `[ADMIN_ACTION] Signed in: uid=…`.
7. Sign out, then the browser's back button: still signed out.

If sign-in fails: the page says why ("Logowanie jest chwilowo niedostępne" = the backend has no
panel routes or cannot be reached); Cloudflare Observability shows the error, e.g. the backend
refusing the Worker (then `PANEL_SIGNING_SECRET` differs between Azure and the Worker).

---

## Part 6. Cloudflare security settings (v1) ⬜

On the zone `codzienniefitapp.com`. **The API shares this zone**: the app cannot pass a challenge,
so every rule is limited to `panel.codzienniefitapp.com` and nothing zone-wide challenges traffic.

### 6.1 AI crawlers and bots ⬜

- Security → Bots → **Block AI bots**: on, all pages (known AI crawlers only; safe for the app).
- **Bot Fight Mode / Super Bot Fight Mode: leave off** (cannot be limited to one hostname on the Free
  plan; could challenge the app). Rule 6.2a covers the panel.

The panel already sends `noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai`
everywhere and its `robots.txt` turns every crawler away ✅.

### 6.2 WAF custom rules (Security → WAF → Custom rules) ⬜

Five on the Free plan, in this order, with "Edit expression".

a. Block every bot. **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and cf.client.bot)
```

b. Block scanners' favourite paths. **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and (http.request.uri.path contains ".php" or http.request.uri.path contains "wp-" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "xmlrpc" or http.request.uri.path contains "phpmyadmin"))
```

c. Only the panel's methods. **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and not http.request.method in {"GET" "HEAD" "POST" "PUT" "DELETE"})
```

d. Only from Poland (optional; add countries you work from). **Managed Challenge** (or Block):

```
(http.host eq "panel.codzienniefitapp.com" and not ip.src.country in {"PL"})
```

e. Scripts. **Managed Challenge** (it also catches your own `curl` checks; use a browser after):

```
(http.host eq "panel.codzienniefitapp.com" and (http.user_agent eq "" or http.user_agent contains "curl" or http.user_agent contains "python" or http.user_agent contains "Go-http-client" or http.user_agent contains "wget"))
```

### 6.3 Rate limiting (Security → WAF → Rate limiting rules) ⬜

```
(http.host eq "panel.codzienniefitapp.com" and starts_with(http.request.uri.path, "/auth/"))
```

Characteristics: IP; 20 requests per 10 seconds; **Block**, the longest duration offered.

### 6.4 TLS (SSL/TLS → Edge Certificates) ⬜

Always Use HTTPS on; **HSTS** on (6 months, no preload; include subdomains only if every subdomain
is https, which `api` and `blobs` are); Minimum TLS 1.2; TLS 1.3 on.

### 6.5 DNSSEC ⬜

DNS → Settings → **Enable DNSSEC**, then add the DS record it shows at the domain's registrar. No
CAA record for now (the API's Azure certificate may come from another authority); no wildcard
records; nothing pointing at retired services.

### 6.6 Nobody may send e-mail as @codzienniefitapp.com ⬜

**First check nothing sends mail as @codzienniefitapp.com** (newsletter, Firebase's custom e-mail
domain, receipts); if something does, use its SPF include instead of `-all` and skip the null MX.
DNS → Records → Add, each **DNS only**:

| Type | Name | Content |
| --- | --- | --- |
| `MX` | `@` | `.` priority `0` |
| `TXT` | `@` | `v=spf1 -all` |
| `TXT` | `_dmarc` | `v=DMARC1; p=reject; adkim=s; aspf=s` |
| `TXT` | `*._domainkey` | `v=DKIM1; p=` |

### 6.7 Accounts ❓

Two-factor sign-in on Cloudflare, Azure, Google Cloud / Firebase, GitHub and the admin's Google
account; no Cloudflare members you do not need; login notifications on; least-privilege API tokens.
GitHub: protect `main` in both repositories (pushing to the panel's `main` deploys it).

### 6.8 Where to look

- Application Insights: `[SECURITY_ALERT]` (alert 2.6), `[ADMIN_ACTION]`.
- Cloudflare → admin-panel → **Observability**: every request (with its address; a user search's
  query is part of it) and the Worker's lines with a readable message and level; filter by
  `[SECURITY_ALERT]` or `[ADMIN_ACTION]`.
- Cloudflare → Security → **Events**: what the WAF rules and the rate limit blocked.

---

## Part 7. Rollback

**Backend** (safe right after the deploy: no drafts or deleted items exist yet; once the panel
writes, empty the bin and publish or remove drafts first):

```bash
az functionapp config appsettings set -g codzienniefitgroup -n fitfunctions --settings WEBSITE_RUN_FROM_PACKAGE=1 -o none && az functionapp restart -g codzienniefitgroup -n fitfunctions
```

**Panel** (then `git revert` the bad commit and push, or the next push deploys it again):

```bash
cd /Users/mzolnieruk/github/admin-panel && npx wrangler rollback
```

**Emergency**: remove the panel's custom domain (Workers & Pages → admin-panel → Domains & Routes;
the panel disappears at once); remove the admin's line from `panelAdmins.ts` and deploy the
backend, or sign everyone out (AUTH-HARDENING.md §8); rotate `PANEL_SIGNING_SECRET` (Part 8).

## Part 8. After launch

- **Opening a section for writing**: its line in `src/data/api/capabilities.ts` (`"test-only"`
  first: only items whose stored internal comment starts with `[TEST]`) and its name in
  `OPEN_FOR_WRITING` in `worker/proxy.ts`, together; push to `main`. `"on"` once accepted.
- **Messages and accounts** (`sendMessage`, `messages`, `users`): first the rate limit and the second
  confirmation step (AUTH-HARDENING.md rules 17 and 18) in the backend.
- **Adding an admin**: they sign in and are refused (the page shows their user id); check they sign
  in only with Google; add the id to `src/config/panelAdmins.ts` with a comment; deploy the backend.
  **Removing**: take the line out and deploy.
- **Rotating `PANEL_SIGNING_SECRET`** without downtime: new value in Azure as
  `PANEL_SIGNING_SECRET_NEXT`; the same in the Worker as `PANEL_SIGNING_SECRET`; in Azure move it to
  `PANEL_SIGNING_SECRET` and delete `…_NEXT`.
- **Not part of this deploy**: the mobile app's Wrapped wiring and switching Wrapped on.

## Part 9. After Retool is retired (only the panel is used)

Start only when every job Retool did is done in the panel and those sections are open for writing
(`"on"`). Until then Retool's routes must stay exactly as they are. Do the steps in order; each
backend change is a normal deploy (Part 2) with all tests passing.

1. ⬜ **Check nothing is lost.** Message "unsend" has no panel equivalent yet: build it in the panel
   first if it is still needed. Check whether anything besides Retool calls `usage/*` or
   `youTubeSync/{action}` (a script, a schedule).
2. ⬜ **Export the Retool app** for the archive, then delete it and its resource "Fit Azure HTTP".
3. ⬜ **Renew the Function App's master key** (Azure portal → Function App → App keys → `_master` →
   Renew). Retool's routes are `authLevel: 'admin'`, so Retool has held the master key.
4. ⬜ **Remove the app setting `ADMIN_FUNCTIONS_KEY`** (Retool's second way in, `x-functions-key`).
5. ⬜ **Remove `createRepeatBadges`** first (it hard-deletes milestone badges; the panel never had
   it). Deploy.
6. ⬜ **Remove the rest of Retool's routes** and deploy:

   | Folder in `functions/` | Routes |
   | --- | --- |
   | `manageChallenges` | `manageChallenges`, `manageChallenges/{id}`, `manageChallenges/promotedChallenge` |
   | `manageWorkouts` (and the `manageWorkouts` base registration) | `manageWorkouts`, `manageWorkouts/{id}` |
   | `manageBadges` | base, `grantManual`, `revokeManual` |
   | `manageMessageDrafts` | `list`, `upsert`, `publish`, `archive`, `unsend` |
   | `manageMedia` | `manageMedia/files` (Retool's upload: any folder, no checks) |
   | `adminUserBadges`, `adminUserProgress`, `adminUsers`, `adminOffers` | user badges and grants, progress, search, offers |
   | `users` | `accounts/{userId}` (GET, PUT) |
   | `wrapped` | `manage/wrapped` (Retool's Wrapped preview) |
   | `usage`, `youTubeSync` | only if step 1 found nothing else calling them |

7. ⬜ **Remove the code that exists only for Retool** and deploy: every branch for a call without a
   panel admin (`panelAdminOf(request) == null`) in the handlers and `contentEditing.ts` (old error
   texts, forgiving trims, saves without versions, "keep the stored status when `hidden` is not
   sent", `overrideAlreadySent`, Retool's own validation paths); `requestedEtag`'s "null for
   non-panel callers", so every save requires a version; in `AccountService.isAdmin` the
   functions-key branch, `LEGACY_ADMIN_UID` and the custom-claims branch.
8. ⬜ **Remove the tests that pin Retool's behaviour** and the rule in the backend's `CLAUDE.md` that
   Retool's routes keep today's rules; drop the "never edit in Retool and the panel" rule here
   (Part 2).
9. ⬜ Optional, in the panel: the `etag: false` fallback in `src/data/api/capabilities.ts`.

**Keep:** the `Hidden` column next to `Status` (old mobile builds read it); every public endpoint the
app uses; the panel's `panel/…` routes, its guard, the audit and the logs.

## Part 10. Later (not in v1): Cloudflare Access

A second gate in front of the whole panel: Cloudflare asks for an e-mail on a list before any page,
code or API is served. Free for up to 50 users. Zero Trust → Access → Applications → Self-hosted →
domain `panel.codzienniefitapp.com` → policy Allow, Include → Emails → the admin's address; session
24 hours; One-time PIN or Google. Reasoning: CLOUDFLARE-SECURITY.md §1.
