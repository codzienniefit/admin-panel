# Deploying the backend and the admin panel (v1)

Written 2026-11-23. Everything needed to put the backend's panel routes and the panel itself into
production: every setting with its value or how to make it, DNS, Google and Firebase, the
Cloudflare Worker and its build, the Cloudflare security settings, checks and rollback.

Two deploys, in this order:

1. **Backend** (Azure Function App `fitfunctions`, API at `https://api.codzienniefitapp.com`).
2. **Panel** (Cloudflare Worker `admin-panel`, at `https://panel.codzienniefitapp.com`).

Both launch **read-only**: in Produkcja only "Wyczyść cache backendu" writes. Retool keeps working
(Part 2). **v1 does not use Cloudflare Access**; it is in Part 10 for later.

You create and paste every secret yourself. None goes in a file, a commit or a chat.

Time: about 1.5 hours the first time.

---

## Part 0. What you need

| Thing | Check |
| --- | --- |
| Azure CLI signed in to the subscription with `codzienniefitgroup` | `az account show -o table` |
| Cloudflare account with the zone `codzienniefitapp.com` (name servers `naomi`/`tadeo.ns.cloudflare.com`) | `npx wrangler whoami` in the admin-panel repo (`npx wrangler login` first) |
| Node 22, `zip`, `openssl` | `node -v`, `which zip openssl` |
| Google Cloud console for the Firebase project, and the Firebase console | console.cloud.google.com, console.firebase.google.com |
| GitHub: `codzienniefit/backend`, `codzienniefit/admin-panel` | the backend PR "Feat/admin panel backend" |

The panel admin is already in the backend's code: user id `6bt7loE8cCgfvRTeir9pdlXSETN2` in
`src/config/panelAdmins.ts`. In Firebase → Authentication → Users, check that this account signs in
**only with Google** (no password provider), and that 2-Step Verification is on for that Google
account.

## Part 1. Every setting at a glance

### 1.1 Azure: Function App `fitfunctions` → Settings → Environment variables

| Name | What to do | Value |
| --- | --- | --- |
| `PANEL_SIGNING_SECRET` | **Add** (Part 3.3) | generated: `openssl rand -base64 48 \| tr -d '\n' \| pbcopy`. At least 32 characters. **The same value goes into the Worker** (1.3) |
| `PANEL_SIGNING_SECRET_NEXT` | leave unset | only while rotating the secret (Part 9) |
| `CLOUDFLARE_API_TOKEN` | keep, **check** | must have *Zone → Cache Purge → Purge* on `codzienniefitapp.com`: from this deploy on every admin save purges the CDN |
| `CLOUDFLARE_ZONE_ID` | keep | the zone id of `codzienniefitapp.com` (Cloudflare → the zone → Overview, right column) |
| `ADMIN_FUNCTIONS_KEY` | keep | Retool's key; unchanged |
| `FIREBASE_KEY`, `DATA_STORAGE_ACCOUNT_NAME`, `DATA_STORAGE_ACCOUNT_KEY`, `BLOBS_PUBLIC_LINK`, `API_PUBLIC_LINK`, the other existing settings | keep | unchanged |
| `WRAPPED_ENABLED` | **must not be set** (or not `true`) | Wrapped stays closed until you open it |
| `WRAPPED_NOW_UTC` | **must not be set** | tests only |
| `WRAPPED_TESTER_UIDS` | optional | extra Wrapped testers on top of the three in code |
| `WRAPPED_VIDEO_THUMBNAIL_URL`, `WRAPPED_VIDEO_URL`, `WRAPPED_VIDEO_TOP_URL` | optional | the 2026 video assets once they exist (https URLs) |
| `WRAPPED_2025_START_UTC`, `WRAPPED_2025_END_UTC` | **delete** | no longer read |

### 1.2 In the backend's code (already done)

| Where | What |
| --- | --- |
| `src/config/panelAdmins.ts` → `PANEL_ADMIN_UIDS` | the one panel admin (above). Adding or removing someone: Part 9 |
| `src/modules/services/helpers/wrappedSettings.ts` → `WRAPPED_TESTERS` | three Wrapped test accounts; empty it after Wrapped opens |

### 1.3 Cloudflare: Worker `admin-panel` → Settings → Variables and Secrets

Text (type **Text**):

| Name | Value |
| --- | --- |
| `PANEL_ORIGIN` | `https://panel.codzienniefitapp.com` |
| `API_ORIGIN` | `https://api.codzienniefitapp.com` |
| `MEDIA_ORIGINS` | `https://superfitstorage.blob.core.windows.net,https://blobs.codzienniefitapp.com` |
| `FIREBASE_API_KEY` | Firebase console → Project settings → General → **Web API Key** (not a secret; it ships in the app) |
| `GOOGLE_CLIENT_ID` | the OAuth client id from Part 4.2 |

Secrets (type **Secret**, or with Wrangler as in Part 6.3):

| Name | Value |
| --- | --- |
| `PANEL_SIGNING_SECRET` | the same value as in Azure (1.1) |
| `SIGN_IN_COOKIE_KEY` | generated: `openssl rand -base64 32` (exactly 32 bytes, base64) |
| `GOOGLE_CLIENT_SECRET` | the OAuth client secret from Part 4.2 |

Until all eight are valid, the sign-in page says sign-in is not configured and lists the names still
missing; once they are, it shows nothing about the settings.

### 1.4 In the panel's repository (already done)

`wrangler.json`: `"workers_dev": false`, `"preview_urls": false`, `"keep_vars": true` (text variables
set in the dashboard survive deploys), and the custom domain:

```json
"routes": [{ "pattern": "panel.codzienniefitapp.com", "custom_domain": true }]
```

### 1.5 Cloudflare: Worker `admin-panel` → Settings → Build

| Setting | Value |
| --- | --- |
| Git repository | `codzienniefit/admin-panel` |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (`npm run deploy` would build a second time) |
| Builds for other branches / pull requests | off |

### 1.6 Google and Firebase

| Where | Setting |
| --- | --- |
| Google Cloud → APIs & Services → Credentials → OAuth client "Admin panel" (Web application) | Authorised redirect URI: **`https://panel.codzienniefitapp.com/auth/google/callback`** only; no JavaScript origins |
| Firebase → Authentication → Sign-in method → Google | enabled; if refused, the client id under "Safelist client IDs from external projects" |

### 1.7 DNS: zone `codzienniefitapp.com`

| Record | Status |
| --- | --- |
| `api` CNAME → `fitfunctions.azurewebsites.net`, proxied | exists, keep |
| `blobs` CNAME → `superfitstorage.blob.core.windows.net`, proxied | exists, keep |
| `asuid.api` TXT | exists, keep (Azure's proof of the API's domain) |
| `panel` | **created by Cloudflare** when the Worker is deployed with its custom domain. Do not add it by hand |
| null MX, SPF, DMARC, DKIM | add (Part 7.6) once you have checked nothing sends mail as @codzienniefitapp.com |
| DNSSEC | enable (Part 7.5) |

---

## Part 2. Retool and the app: what to know first

Retool calls the backend's `manageX` routes with its functions key. The panel's routes are only
under `panel/…`; **no route, method or key check Retool uses has changed**, and the backend's
tests pin Retool's answers. The mobile app sees no change until Wrapped is opened, except that
plans now recommend the content team's pairs.

## Part 3. Backend

### 3.1 Merge

Merge the PR **"Feat/admin panel backend"** (`main` ← `feat/admin-panel-backend`):

https://github.com/codzienniefit/backend/compare/main...feat/admin-panel-backend?expand=1

The GitHub workflow runs the tests and publishes the DTO package; its Azure deploy job is red
(Kudu) and stays red. Ignore it.

### 3.2 Run all tests on `main`

```bash
cd /Users/mzolnieruk/github/backend && git switch main && git pull --ff-only && npm ci && npx jest --no-coverage --testPathIgnorePatterns /.claude/
```

### 3.3 `PANEL_SIGNING_SECRET` into Azure

Generate it onto the clipboard (nothing is printed):

```bash
openssl rand -base64 48 | tr -d '\n' | pbcopy
```

Azure portal → Function App **fitfunctions** → Settings → **Environment variables** → App settings →
**+ Add** → Name `PANEL_SIGNING_SECRET`, Value: paste → Apply → Apply → Confirm (the app restarts
for a few seconds). **Keep the value on the clipboard** (or in your password manager) for Part 6.3.

On the same page, go through table 1.1: check `CLOUDFLARE_API_TOKEN`, make sure `WRAPPED_ENABLED`
and `WRAPPED_NOW_UTC` are not set, delete `WRAPPED_2025_*`.

### 3.4 Build, dry run, deploy

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
Caching → Configuration → **Purge Everything**.

### 3.5 Check the backend

App up (expect `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.codzienniefitapp.com/api/appConfig
```

Panel routes there, secret set (expect `401` and `BAD_SIGNATURE`; `503` = secret missing, `404` =
routes missing):

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
existing item**: open Treningi, Wyzwania, Wiadomości, Odznaki (lists load), open one form and close
it, open Użytkownicy with your own user id.

What Retool will notice from now on: every save purges the CDN (changes show at once); drafts made
in the panel show as hidden; a message send that fails half-way locks that draft; `.mp4`/`.ogg`
uploads work. Rule: **never edit the same item in Retool and in the panel**.

### 3.6 Alerts and the admin log

Azure portal → the Function App's **Application Insights** → Alerts → Create → Alert rule →
Condition **Custom log search**:

```
traces | where message has "[SECURITY_ALERT]"
```

Table rows, count, greater than 0, every 5 minutes over 5 minutes; action group: e-mail to you.
Name: "Panel security alert". The check in 3.5 (unsigned call) must show up:

```
traces | where timestamp > ago(15m) | where message has "[SECURITY_ALERT]" | project timestamp, message
```

Who did what, any time:

```
traces | where message has "[ADMIN_ACTION]" | project timestamp, message | order by timestamp desc
```

## Part 4. Google sign-in and Firebase

1. Google Cloud console, the project of the Firebase project → APIs & Services → **OAuth consent
   screen**: if not set up yet, Internal (Workspace accounts) or External; app name neutral (e.g.
   "Codziennie Fit"); your e-mail as support and developer contact; default scopes only.
2. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → **Web
   application**, name "Admin panel". Authorised JavaScript origins: none. Authorised redirect URIs:
   exactly `https://panel.codzienniefitapp.com/auth/google/callback`. Create, then copy the **Client
   ID** (→ `GOOGLE_CLIENT_ID`) and the **Client secret** (→ `GOOGLE_CLIENT_SECRET`, Part 6.3; Google
   shows it in this dialog).
3. Firebase console → Authentication → Sign-in method → **Google**: enabled.
4. Firebase console → Project settings → General → **Web API Key** (→ `FIREBASE_API_KEY`).

## Part 5. The panel's code and build

Every push to `main` of `codzienniefit/admin-panel` is built and deployed by Cloudflare (Workers
Builds). Pushing is deploying: run the checks first.

```bash
cd /Users/mzolnieruk/github/admin-panel && npm ci && npm run test:all
```

Set the build as in table 1.5 (Workers & Pages → admin-panel → Settings → Build). The code is on
`main` already, including `wrangler.json` with the custom domain (1.4).

## Part 6. The panel on Cloudflare

### 6.1 Address and DNS

Deploying `main` with `wrangler.json` as in 1.4 makes Cloudflare create the `panel` DNS record and
its certificate, and switches the `workers.dev` address off. Check in Workers & Pages →
admin-panel → Settings → **Domains & Routes** that `panel.codzienniefitapp.com` is listed.

If the build failed with a permission error on the custom domain, add it once by hand there (Add →
Custom domain → `panel.codzienniefitapp.com`) and retry the build. Never add a DNS record for
`panel` yourself.

```bash
curl -s https://panel.codzienniefitapp.com/api/health
```

Expect `{"ok":true}`.

### 6.2 Text variables

Workers & Pages → admin-panel → Settings → Variables and Secrets → **+ Add**, type **Text**, the
five from table 1.3.

### 6.3 Secrets

In the admin-panel repo (each reads stdin; nothing is printed).

`PANEL_SIGNING_SECRET`, the same value as in Azure, from the clipboard (3.3):

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put PANEL_SIGNING_SECRET
```

`SIGN_IN_COOKIE_KEY`, generated straight into Cloudflare:

```bash
cd /Users/mzolnieruk/github/admin-panel && openssl rand -base64 32 | npx wrangler secret put SIGN_IN_COOKIE_KEY
```

`GOOGLE_CLIENT_SECRET`: copy it from the Google dialog (4.2), then:

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Clear the clipboard:

```bash
pbcopy < /dev/null
```

(The same three can be added as type **Secret** in the dashboard instead.) Secrets and text
variables apply at once; no redeploy needed.

### 6.4 Check the panel

1. `https://panel.codzienniefitapp.com/api/health` answers `{"ok":true}`.
2. `https://admin-panel.marta-100.workers.dev` no longer answers.
3. The sign-in page shows only "Zaloguj się przez Google", no environment switch, and no list of
   missing values.
4. A Google account **not** on the list: refused, its user id shown; Application Insights shows
   `[SECURITY_ALERT] … NOT_PANEL_ADMIN … uid=…`.
5. Your Google account (the admin): the panel opens; challenges, workouts, badges, offers,
   messages and users load; pictures show.
6. Any save: refused with "Produkcja jest tylko do odczytu". Ustawienia → Aplikacja → "Wyczyść
   cache backendu": works.
7. The environment switch (top bar) → Test: sample data, only now that you are signed in.
8. Application Insights shows your reads as `[ADMIN_ACTION] panel uid=6bt7… GET …`.
9. Sign out, then the browser's back button: still signed out.

## Part 7. Cloudflare security settings (v1)

All on the zone `codzienniefitapp.com`. **The API shares this zone**: the mobile app is not a
browser and cannot pass a challenge, so every rule below is limited to `panel.codzienniefitapp.com`,
and nothing zone-wide that challenges traffic is switched on.

### 7.1 AI crawlers and bots

- Security → Bots → **Block AI bots**: on, all pages (matches known AI crawlers only; safe for
  the app).
- **Bot Fight Mode / Super Bot Fight Mode: leave off.** It cannot be limited to one hostname on
  the Free plan and can challenge the app's requests. Rule 7.2a covers the panel.

The panel itself already sends `noindex, nofollow, noarchive, nosnippet, noimageindex, noai,
noimageai` on every page and answer, and its `robots.txt` turns every crawler away.

### 7.2 WAF custom rules (Security → WAF → Custom rules)

The Free plan allows 5. Add them in this order with "Edit expression".

a. **Block every bot** (no search engine or monitor needs the panel). Action **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and cf.client.bot)
```

b. **Block scanners' favourite paths**. Action **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and (http.request.uri.path contains ".php" or http.request.uri.path contains "wp-" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "xmlrpc" or http.request.uri.path contains "phpmyadmin"))
```

c. **Only the methods the panel uses**. Action **Block**:

```
(http.host eq "panel.codzienniefitapp.com" and not http.request.method in {"GET" "HEAD" "POST" "PUT" "DELETE"})
```

d. **Only from Poland** (optional; add countries you work from). Action **Managed Challenge** (or
**Block**):

```
(http.host eq "panel.codzienniefitapp.com" and not ip.src.country in {"PL"})
```

e. **Scripts**. Action **Managed Challenge**:

```
(http.host eq "panel.codzienniefitapp.com" and (http.user_agent eq "" or http.user_agent contains "curl" or http.user_agent contains "python" or http.user_agent contains "Go-http-client" or http.user_agent contains "wget"))
```

(Rule e also catches your own `curl` checks in 6.4 step 1; run them before adding it, or use a
browser.)

### 7.3 Rate limiting (Security → WAF → Rate limiting rules)

One rule on the Free plan, on sign-in:

```
(http.host eq "panel.codzienniefitapp.com" and starts_with(http.request.uri.path, "/auth/"))
```

Characteristics: IP; **20 requests per 10 seconds**; Action **Block**, the longest duration offered.

### 7.4 TLS (SSL/TLS → Edge Certificates)

- **Always Use HTTPS**: on.
- **HSTS**: on, max-age 6 months, preload off; "include subdomains" only if every subdomain is
  https (`api` and `blobs` are).
- **Minimum TLS Version**: 1.2 (zone-wide; modern phones are fine; Analytics → Traffic shows TLS
  1.0/1.1 use if in doubt).
- **TLS 1.3**: on.

### 7.5 DNS hardening

- DNS → Settings → **Enable DNSSEC**, then add the DS record it shows at the domain's registrar.
- **No CAA record** for now: the API's own certificate on Azure may come from another authority,
  and a CAA record that leaves it out would stop it renewing.
- No wildcard records; nothing pointing at retired services.

### 7.6 Nobody may send e-mail as @codzienniefitapp.com

The zone has no MX, so the domain receives no mail, but without these records anyone can send mail
that claims to come from it. **First check nothing sends mail as @codzienniefitapp.com** (a
newsletter tool, Firebase's custom e-mail domain, receipts); if something does, use its SPF include
instead of `-all` and skip the null MX. DNS → Records → Add, each **DNS only** (grey cloud):

| Type | Name | Content |
| --- | --- | --- |
| `MX` | `@` | `.` priority `0` (null MX: takes no mail) |
| `TXT` | `@` | `v=spf1 -all` |
| `TXT` | `_dmarc` | `v=DMARC1; p=reject; adkim=s; aspf=s` |
| `TXT` | `*._domainkey` | `v=DKIM1; p=` |

### 7.7 The accounts that control all this

Two-factor sign-in (a security key or an authenticator app) on Cloudflare, Azure, Google Cloud /
Firebase, GitHub and the admin's Google account. Cloudflare: no members you do not need; login
notifications on; API tokens with the least access. GitHub: protect `main` in both repositories
(require a pull request): pushing to the panel's `main` deploys it.

### 7.8 Where to look

- Application Insights: `[SECURITY_ALERT]` (alert from 3.6) and `[ADMIN_ACTION]`.
- Cloudflare → Security → **Events**: what the WAF rules and the rate limit blocked.
- Workers & Pages → admin-panel → **Logs** (observability is on): the Worker's own refusals.

## Part 8. Rollback

**Backend** (safe right after this deploy; no drafts or deleted items exist yet):

```bash
az functionapp config appsettings set -g codzienniefitgroup -n fitfunctions --settings WEBSITE_RUN_FROM_PACKAGE=1 -o none && az functionapp restart -g codzienniefitgroup -n fitfunctions
```

**Panel**:

```bash
cd /Users/mzolnieruk/github/admin-panel && npx wrangler rollback
```

(or Workers & Pages → admin-panel → Deployments → previous → Rollback). The next push to `main`
deploys again, so also `git revert` the bad commit and push. Rolling the panel back never affects
the app or Retool.

**In an emergency**: remove the admin's line from `panelAdmins.ts` and deploy the backend, or sign
everyone out (AUTH-HARDENING.md §8); rotate `PANEL_SIGNING_SECRET` (Part 9); remove the panel's
custom domain in Workers & Pages → admin-panel → Domains & Routes (the panel disappears at once).

## Part 9. After launch

- **Opening a section for writing**: its line in `src/data/api/capabilities.ts` (`"test-only"`
  first: only items whose stored internal comment starts with `[TEST]`) and its name in
  `OPEN_FOR_WRITING` in `worker/proxy.ts`, together; push to `main`. `"on"` only once accepted.
- **Messages and accounts** (`sendMessage`, `messages`, `users`): first build the rate limit and
  the second confirmation step (AUTH-HARDENING.md rules 17 and 18) in the backend.
- **Adding an admin**: they sign in and are refused (the page shows their user id); check their
  Firebase account signs in only with Google; add the id to `src/config/panelAdmins.ts` with a
  comment saying who it is; deploy the backend. **Removing one**: take the line out and deploy.
- **Rotating `PANEL_SIGNING_SECRET`** without downtime: new value in Azure as
  `PANEL_SIGNING_SECRET_NEXT`; the same value in the Worker as `PANEL_SIGNING_SECRET`; in Azure move
  it to `PANEL_SIGNING_SECRET` and delete `…_NEXT`.
- **Not part of this deploy**: the mobile app's Wrapped wiring and switching Wrapped on
  (`WRAPPED_ENABLED=true`).

## Part 10. Later (not in v1): Cloudflare Access

A second gate in front of the whole panel: Cloudflare asks for an e-mail on a list before any page,
code or API of the panel is served, so scanners and bots see only Cloudflare's sign-in. Free for up
to 50 users. Steps: Zero Trust → Access → Applications → Self-hosted → domain
`panel.codzienniefitapp.com` → policy Allow, Include → Emails → the admin's address; session 24
hours; One-time PIN or Google as login method. Details and reasoning: CLOUDFLARE-SECURITY.md §1.
