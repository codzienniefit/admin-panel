# Deploying the backend and the admin panel

Written 2026-11-23. Two deploys, in this order:

1. **Backend** (Azure Function App `fitfunctions`): the panel's routes, its rules and logging,
   plus everything already on `main` (Wrapped, plan recommendations, your Wrapped and audio
   commits).
2. **Panel** (Cloudflare Worker `admin-panel`): the screens and the Worker that signs every call
   to the backend.

Both launch **read-only**: in Produkcja the only thing that writes is "Wyczyść cache backendu".
Retool keeps working throughout (Part 4).

You create and paste every secret yourself. None goes in a file, a commit or a chat.

Time: about 1.5 hours the first time, most of it Google and Cloudflare setup.

---

## Part 0. What you need

| Thing | Check |
| --- | --- |
| Azure CLI signed in to the subscription with `codzienniefitgroup` | `az account show -o table` |
| Cloudflare: the account with the zone the panel's address will live on | `npx wrangler login`, then `npx wrangler whoami` (in the admin-panel repo) |
| Node 22, `zip`, `openssl` | `node -v`, `which zip openssl` |
| Google Cloud console for the Firebase project | console.cloud.google.com |
| Firebase console | console.firebase.google.com |
| The panel's address: a meaningless name, not `panel` or `admin`, e.g. `https://studio-x7k2.codzienniefitapp.com` ([CLOUDFLARE-SECURITY.md](CLOUDFLARE-SECURITY.md) §2) | a hostname on that Cloudflare zone, not in use |

Your user id `6bt7loE8cCgfvRTeir9pdlXSETN2` (gierekg@gmail.com) is already the one panel admin
in the backend's code. In Firebase → Authentication → Users, check that this account signs in
**only** with Google (no password provider), and that 2-Step Verification is on for that Google
account.

## Part 1. The secrets: what, how, where

| Name | Generate with | Put in | Notes |
| --- | --- | --- | --- |
| `PANEL_SIGNING_SECRET` | `openssl rand -base64 48 \| tr -d '\n' \| pbcopy` | **Azure** Function App setting **and** **Cloudflare** Worker secret, the **same value** in both | At least 32 characters. Signs every call from the Worker to the backend |
| `SIGN_IN_COOKIE_KEY` | `openssl rand -base64 32` (piped straight into Wrangler, below) | **Cloudflare** Worker secret only | Must be exactly 32 bytes, base64. Protects a sign-in on its way to Google and back |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console (Part 3) | **Cloudflare** Worker secret only | Pasted straight from Google |

Values that are **not** secret (Cloudflare text variables, Part 5): `PANEL_ORIGIN`, `API_ORIGIN`,
`MEDIA_ORIGINS`, `FIREBASE_API_KEY`, `GOOGLE_CLIENT_ID`.

Already set on the Function App, nothing to change: `ADMIN_FUNCTIONS_KEY` (Retool's key),
`FIREBASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, storage settings.

## Part 2. Backend

### 2.1 Merge the panel branch

Open the PR (or refresh it) and merge `feat/admin-panel-backend` into `main`. It is level with
`main` (merged 2026-11-23); all 4,355 tests passed on it.

https://github.com/codzienniefit/backend/compare/main...feat/admin-panel-backend?expand=1

The GitHub workflow runs the tests and publishes the DTO package; its Azure deploy job is red
(Kudu is dead) and stays red. Ignore it.

### 2.2 Run all tests locally on `main`

```bash
cd /Users/mzolnieruk/github/backend && git switch main && git pull --ff-only && npm ci && npx jest --no-coverage --testPathIgnorePatterns /.claude/
```

Expect every suite to pass.

### 2.3 Create `PANEL_SIGNING_SECRET` and put it in Azure

Generate it onto the clipboard (nothing is printed):

```bash
openssl rand -base64 48 | tr -d '\n' | pbcopy
```

Azure portal → Function App **fitfunctions** → Settings → **Environment variables** → App
settings → **+ Add** → Name `PANEL_SIGNING_SECRET`, Value: paste → Apply → Apply → Confirm.
The app restarts (a few seconds).

**Keep the value on the clipboard** for Part 5.3 (or store it in your password manager now).
If you lose it before 5.3, generate a new one and set it in both places.

While you are on that page:

- **`CLOUDFLARE_API_TOKEN`**: from this deploy on, every admin save (panel and Retool) really
  purges the whole CDN (the old purge address never worked). In Cloudflare → My Profile → API
  Tokens, check that this token has **Zone → Cache Purge → Purge** on the API's zone. If not,
  saves still work and Application Insights logs `Failed to clear cache`.
- **Not set**: `WRAPPED_ENABLED`, `WRAPPED_NOW_UTC`. You can delete `WRAPPED_2025_START_UTC` and
  `WRAPPED_2025_END_UTC`.

### 2.4 Build, dry run, deploy

```bash
cd /Users/mzolnieruk/github/backend && scripts/build-package.sh main
```

Expect the last lines to name the merge commit, about 16 MB, 40+ entry points.

```bash
cd /Users/mzolnieruk/github/backend && scripts/deploy-run-from-package-blob.sh /tmp/fitfunctions.zip
```

```bash
cd /Users/mzolnieruk/github/backend && scripts/deploy-run-from-package-blob.sh /tmp/fitfunctions.zip --apply
```

Answer `y` at each prompt. Expect "Deploy looks healthy". Then Cloudflare → the API's zone →
Caching → Configuration → **Purge Everything**.

### 2.5 Check the backend

App up (expect `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.codzienniefitapp.com/api/appConfig
```

Panel routes deployed and the secret set (expect `401` and `BAD_SIGNATURE`; `503` means
`PANEL_SIGNING_SECRET` is missing, `404` that the routes did not deploy):

```bash
curl -s -w '\n%{http_code}\n' https://api.codzienniefitapp.com/api/panel/manageChallenges
```

This call is itself a non-admin attempt, so it must appear in Application Insights → Logs:

```
traces | where timestamp > ago(15m) | where message has "[SECURITY_ALERT]" | project timestamp, message
```

Wrapped closed to the public (expect `401`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.codzienniefitapp.com/api/user/wrapped/2026
```

Plan recommendations from the content sheet (expect `C53 → ['C62', 'C34']`):

```bash
curl -s "https://api.codzienniefitapp.com/api/workoutPlans" | python3 -c "import json,sys; d={p['id']: p for p in json.load(sys.stdin)}; print('C53 →', [r['id'] for r in d['C53'].get('recommendedNext', [])])"
```

Open the mobile app: plans, a workout, the profile and badges. Then Part 4 (Retool).

### 2.6 Alert on security events

Azure portal → the Function App's **Application Insights** → Monitoring → **Alerts** → Create →
Alert rule → Condition: **Custom log search**:

```
traces | where message has "[SECURITY_ALERT]"
```

Measure: table rows, count; threshold **greater than 0**; every 5 minutes over the last 5
minutes. Action: an action group that e-mails you. Name it "Panel security alert".

Every admin call is logged as `[ADMIN_ACTION]` (who, what, status), so you can look up who did
what with:

```
traces | where message has "[ADMIN_ACTION]" | project timestamp, message | order by timestamp desc
```

### 2.7 Backend rollback (if needed)

Safe right after this deploy: no drafts or deleted items exist yet (the panel is read-only).

```bash
az functionapp config appsettings set -g codzienniefitgroup -n fitfunctions --settings WEBSITE_RUN_FROM_PACKAGE=1 -o none && az functionapp restart -g codzienniefitgroup -n fitfunctions
```

## Part 3. Google sign-in and Firebase

1. **Google Cloud console**, the project that belongs to the Firebase project → APIs & Services →
   **OAuth consent screen**: if it has never been set up, choose Internal (if the Google accounts
   are in your Workspace) or External, app name "Codziennie Fit panel", your e-mail as support
   and developer contact. No scopes beyond the defaults (openid, email, profile).
2. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → Application
   type **Web application** → name "Admin panel".
   - Authorised JavaScript origins: **none**.
   - Authorised redirect URIs: exactly `https://<panel address>/auth/google/callback`, nothing else.
3. Create. Copy the **Client ID** (for `GOOGLE_CLIENT_ID`, Part 5.2). Leave the dialog open for
   the **Client secret** (Part 5.3).
4. **Firebase console** → Authentication → Sign-in method → **Google**: enabled. If the panel later
   says "Logowanie nie jest poprawnie skonfigurowane", add the client id under "Safelist client
   IDs from external projects" there.
5. Firebase console → Project settings → General → **Web API Key** (for `FIREBASE_API_KEY`). It is
   not a secret: it ships in the mobile app.

## Part 4. Retool keeps working

Retool calls the backend's `manageX` routes with its shared functions key. The panel branch adds
its own routes only under `panel/…`; **no route, method or key check Retool uses has changed**,
and the backend's tests pin Retool's answers.

What Retool will notice:

- **Every save purges the CDN** (Part 2.3): the app sees changes at once.
- Lists show drafts made in the panel as hidden, and leave out deleted rows (none exist until the
  panel can write).
- A save without `hidden` keeps the stored status; a stored draft stays a draft; saving a deleted
  row is refused.
- Changing a workout's equipment or duration also updates the challenges that use it.
- Sending a message puts a 10-minute claim on it; a send that failed half-way locks that draft
  (it cannot be edited or archived any more).
- `.mp4` and `.ogg` uploads now work. `GET accounts/{id}` no longer returns the password hash.
- Every Retool admin call is logged as `[ADMIN_ACTION] functions-key (Retool) …`.

Check after Part 2, **without saving any existing item**: in Retool open Treningi, Wyzwania,
Wiadomości, Odznaki (the lists load), open one item's form and close it without saving, and open
Użytkownicy with your own user id. If a list fails, the Logs query in 2.6 with
`message has "functions-key"` shows what Retool sent.

Rule from now on: **do not edit the same item in Retool and in the panel**. Retool saves without
versions and can overwrite a panel edit made after it loaded the item.

## Part 5. Panel (Cloudflare Worker)

The panel is a **Cloudflare Worker with static assets** (not a Pages project): `wrangler deploy`
uploads the built screens and the Worker together. It is in the dashboard under
**Workers & Pages → admin-panel**.

**Every push to `main` of `codzienniefit/admin-panel` is deployed by Cloudflare itself**
(Workers Builds, connected to the GitHub repository). Pushing is deploying: run the checks before
every push. `npm run deploy` by hand is only for when the build is broken or switched off.

### 5.1 The Git build: check its settings once

Already done on 2026-11-23: the panel's code is on `main` (`defe6a0`, `5448bb9`) and Cloudflare
deployed it to `https://admin-panel.marta-100.workers.dev`.

Workers & Pages → admin-panel → **Settings → Build**:

- Git repository: `codzienniefit/admin-panel`, production branch **`main`**.
- Build command: `npm run build`.
- Deploy command: **`npx wrangler deploy`**. (`npm run deploy` builds a second time; the build
  command has already built.)
- Builds for other branches / pull requests: **off**. A branch build would publish a preview
  version; `"preview_urls": false` keeps it off the internet, but there is no reason to build it.
- Build watch paths: leave as is (everything).

Before every push:

```bash
cd /Users/mzolnieruk/github/admin-panel && npm ci && npm run test:all
```

On the deployed panel the sign-in page shows only the real Google sign-in, with no environment
switch. Until Part 5.3 is done, it says sign-in is not configured and **lists the Worker values
still missing** (names only; once sign-in works, nothing about the settings is shown). The Test
environment (sample data) opens only after a real sign-in, from the environment switch in the top
bar; on your computer (`npm run dev`) it works as before. Until Part 5.2 is done the page is also
reachable at the `workers.dev` address, which only shows that sign-in page; do 5.2 (or put
Cloudflare Access in front, CLOUDFLARE-SECURITY.md §1) soon.

### 5.2 The panel's address (and the end of `workers.dev`)

1. Cloudflare dashboard → **Workers & Pages → admin-panel → Settings → Domains & Routes → Add →
   Custom domain** → the panel's hostname (e.g. `studio-x7k2.codzienniefitapp.com`). Cloudflare creates
   the DNS record and the certificate.
2. Make it last across deploys and switch the `workers.dev` address off: in `wrangler.json`, add

   ```json
   "workers_dev": false,
   "routes": [{ "pattern": "studio-x7k2.codzienniefitapp.com", "custom_domain": true }],
   ```

   (with your hostname), commit, push. (Switching `workers.dev` off only in the dashboard does not
   last: the next deploy turns it back on.)
3. Cloudflare → that zone → **SSL/TLS → Edge Certificates**: **Always Use HTTPS** on; **HSTS** on
   (max-age 6 months, include subdomains only if every subdomain is https).

### 5.3 Variables and secrets

**Text variables**: Workers & Pages → admin-panel → **Settings → Variables and Secrets → + Add** →
Type **Text**:

| Name | Value |
| --- | --- |
| `PANEL_ORIGIN` | `https://<panel hostname>`, nothing after the host |
| `API_ORIGIN` | `https://api.codzienniefitapp.com` (no `/api`) |
| `MEDIA_ORIGINS` | where the backend's file links lead. Open `https://api.codzienniefitapp.com/api/files?path=badges/<any badge image>` in a browser and copy the address you land on up to the host (`https://<account>.blob.core.windows.net`). Add `https://blobs.codzienniefitapp.com` after a comma |
| `FIREBASE_API_KEY` | the Web API Key from Part 3.5 |
| `GOOGLE_CLIENT_ID` | the Client ID from Part 3.3 |

**Secrets**, from the admin-panel repo (each prompts or reads stdin; nothing is printed):

`PANEL_SIGNING_SECRET`, the same value as in Azure, from the clipboard (Part 2.3):

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put PANEL_SIGNING_SECRET
```

`SIGN_IN_COOKIE_KEY`, generated straight into Cloudflare:

```bash
cd /Users/mzolnieruk/github/admin-panel && openssl rand -base64 32 | npx wrangler secret put SIGN_IN_COOKIE_KEY
```

`GOOGLE_CLIENT_SECRET`: copy it from the Google dialog (Part 3.3), then:

```bash
cd /Users/mzolnieruk/github/admin-panel && pbpaste | npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Clear the clipboard:

```bash
pbcopy < /dev/null
```

(Instead of Wrangler you can add the three as **Secret** in the same dashboard page.) A secret
change takes effect at once; text variables from the dashboard survive deploys thanks to
`keep_vars`.

### 5.4 Deploy with the address

Pushing the `wrangler.json` change from 5.2 deploys it: Cloudflare builds `main`, adds the custom
domain and switches `workers.dev` off. Check the build in Workers & Pages → admin-panel →
**Deployments** (or the build log), then open `https://admin-panel.marta-100.workers.dev`: it must
no longer answer.

### 5.5 Check the panel

1. `https://<panel>/api/health` answers `{"ok":true}`.
2. The old `workers.dev` address does not answer (or, if still on, refuses sign-in for Produkcja).
3. Sign in with a Google account **not** on the list: refused, with its user id shown. In
   Application Insights this appears as `[SECURITY_ALERT] … NOT_PANEL_ADMIN … uid=…`.
4. Sign in with gierekg@gmail.com: the panel opens; challenges, workouts, badges, offers,
   messages and users load; pictures show.
5. Try to save anything: refused with "Produkcja jest tylko do odczytu".
6. Ustawienia → Aplikacja → "Wyczyść cache backendu": works.
7. Application Insights shows your reads as `[ADMIN_ACTION] panel uid=6bt7… (gierekg@gmail.com) GET …`.
8. Sign out, then the browser's back button: still signed out.

### 5.6 Hide it and harden it

Follow [CLOUDFLARE-SECURITY.md](CLOUDFLARE-SECURITY.md): Cloudflare Access in front of the panel
(only your e-mail gets as far as the page), AI crawlers blocked, WAF rules and a rate limit scoped
to the panel's hostname (never zone-wide: the app's API shares the zone), TLS settings, and
two-factor sign-in on every account that controls it. About 30 minutes.

### 5.7 Panel rollback (if needed)

```bash
cd /Users/mzolnieruk/github/admin-panel && npx wrangler rollback
```

(or Workers & Pages → admin-panel → Deployments → the previous one → Rollback). The next push to
`main` deploys again, so also revert the bad commit (`git revert <commit>` and push) before
anything else is pushed. The backend does not depend on the panel; rolling the panel back never
affects the app or Retool.

## Part 6. After launch

- **Opening a section for writing** takes two changes shipped together: its line in
  `src/data/api/capabilities.ts` (`"test-only"` first: only items whose stored internal comment
  starts with `[TEST]`) and its name in `OPEN_FOR_WRITING` in `worker/proxy.ts`; then push to
  `main` (Cloudflare deploys it). Move it to `"on"` only once you have accepted it.
- **Messages and accounts** (`sendMessage`, `messages`, `users`): build the rate limit and the
  second confirmation step (`AUTH-HARDENING.md` rules 17 and 18) in the backend first.
- **Adding an admin**: they sign in and are refused (the page shows their user id); check their
  Firebase account signs in only with Google; add the id to `src/config/panelAdmins.ts` in the
  backend with a comment saying who it is; deploy the backend. **Removing one**: take the line
  out and deploy; for an immediate cut-off see `AUTH-HARDENING.md` §8.
- **Rotating `PANEL_SIGNING_SECRET`** without downtime: set the new value in Azure as
  `PANEL_SIGNING_SECRET_NEXT`, then in Cloudflare as `PANEL_SIGNING_SECRET`, then in Azure move it
  to `PANEL_SIGNING_SECRET` and delete `…_NEXT`.
- **Not part of this deploy**: the mobile app's Wrapped wiring (it still shows sample data and
  `WRAPPED_ALWAYS_VISIBLE` is true) and switching Wrapped on (`WRAPPED_ENABLED=true`).
