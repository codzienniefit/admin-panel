# Cloudflare settings that make the panel harder to find and to attack

Written 2026-11-23, to go with [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) Part 5. Everything here is a
dashboard setting; nothing needs code. Do them in this order: the first one alone hides the panel
from everyone who is not on your list.

Below, `PANEL` stands for the panel's hostname (e.g. `studio-x7k2.codzienniefitapp.com`).

**Read this first.** If the panel lives on the same zone as the API
(`api.codzienniefitapp.com`), every **zone-wide** switch also hits the mobile app's traffic. The
app is not a browser: it cannot solve a challenge, so a zone-wide bot or challenge setting can
break the app for everyone. That is why every rule below is limited with `http.host eq "PANEL"`,
and why "Bot Fight Mode" is on the do-not list.

What the code already does (no setting needed): `robots.txt` turns every crawler away and names
the AI ones; every page, file and Worker answer says `noindex, nofollow, noarchive, nosnippet,
noimageindex, noai, noimageai`; the page is titled "Logowanie" and says nothing about what it is
until you are signed in; the Worker answers only on `PANEL_ORIGIN`; every call to the backend is
signed; the backend logs every non-admin attempt as `[SECURITY_ALERT]`.

## 1. Cloudflare Access in front of the whole panel (the big one)

With Access, Cloudflare itself asks for an e-mail on your list before anything of the panel is
served: no page, no JavaScript, no API, not even `robots.txt`. Bots, scanners and AI crawlers see
only Cloudflare's sign-in page. It is a second gate before the panel's own Google sign-in. Free
for up to 50 users (check the plan in the dashboard).

1. Cloudflare dashboard → **Zero Trust** (first time: choose a team name and the Free plan).
2. Settings → **Authentication** → Login methods: keep **One-time PIN** (a code sent to the
   e-mail), and optionally add **Google** (then Access uses the same Google account as the panel).
3. Access → **Applications** → Add an application → **Self-hosted**:
   - Application name: anything neutral, e.g. "Studio".
   - Session duration: **24 hours**.
   - Application domain: `PANEL`, path empty (the whole site).
   - Identity providers: the ones from step 2; tick "Instant Auth" if only one.
4. Policy: name "Owner", Action **Allow**, Include → **Emails** → the Google address of the
   panel admin (the account whose user id is in the backend's `panelAdmins.ts`). One Include line
   per future admin. Nothing else.
5. Application settings → Cookie settings: **HTTP Only** on, **SameSite Lax**, **Binding cookie**
   on.
6. Save. Open `https://PANEL` in a private window: Cloudflare's sign-in comes first; after it, the
   panel's own "Logowanie".

Who tried and was refused: Zero Trust → **Logs → Access**.

## 2. A hostname that does not invite attacks

- Do not use `panel`, `admin`, `cms`, `backoffice` or similar: those are the first names scanners
  try. Use something meaningless, e.g. `studio-x7k2.codzienniefitapp.com`.
- Keep it one level under the zone (`x.codzienniefitapp.com`, not `a.b.codzienniefitapp.com`).
- Do not link to it from anywhere public. Hostnames can still turn up in public certificate logs;
  that is why Access (1) matters more than the name.
- In `wrangler.json` set `"workers_dev": false` and keep `"preview_urls": false` (DEPLOY-RUNBOOK
  5.2), so the Worker has no second, guessable address. Until then its sign-in page is reachable
  at `admin-panel.marta-100.workers.dev` (no data before a real sign-in).
- In the Worker's Git build (Settings → Build), build only `main`: no branch or pull request
  builds.

## 3. AI crawlers and bots

- **Security → Bots → "Block AI bots"** (Cloudflare's AI Scrapers and Crawlers block): **on**,
  for all pages. It only matches known AI crawlers, so it is safe for the app.
- **Do not switch on "Bot Fight Mode"** (or "Super Bot Fight Mode") on a zone shared with the API:
  it cannot be limited to one hostname on the Free plan and can challenge the app's requests. The
  WAF rule 4.1 does the job for the panel only.

## 4. WAF custom rules (Security → WAF → Custom rules)

The Free plan allows 5. Each one starts with the panel's hostname, so the API is untouched. Enter
them with "Edit expression".

**4.1 Block every bot, good or bad** (no search engine or monitor needs the panel). Action
**Block**:

```
(http.host eq "PANEL" and cf.client.bot)
```

**4.2 Block scanners' favourite paths**. Action **Block**:

```
(http.host eq "PANEL" and (http.request.uri.path contains ".php" or http.request.uri.path contains "wp-" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "xmlrpc" or http.request.uri.path contains "phpmyadmin"))
```

**4.3 Only the methods the panel uses**. Action **Block**:

```
(http.host eq "PANEL" and not http.request.method in {"GET" "HEAD" "POST" "PUT" "DELETE"})
```

**4.4 Only from Poland** (optional; skip it if you work abroad, or add the countries you need).
Action **Managed Challenge** (a person passes it; a script does not) or **Block**:

```
(http.host eq "PANEL" and not ip.src.country in {"PL"})
```

**4.5 No scripts pretending to be a browser**. Action **Managed Challenge**:

```
(http.host eq "PANEL" and (http.user_agent eq "" or http.user_agent contains "curl" or http.user_agent contains "python" or http.user_agent contains "Go-http-client" or http.user_agent contains "wget"))
```

Order: 4.1, 4.2, 4.3, 4.4, 4.5. What they blocked: **Security → Events**.

## 5. Rate limiting (Security → WAF → Rate limiting rules)

The Free plan allows one rule. Put it on sign-in, the part worth guessing at:

- If incoming requests match:

  ```
  (http.host eq "PANEL" and starts_with(http.request.uri.path, "/auth/"))
  ```

- Characteristics: IP. **20 requests per 10 seconds**. Action **Block**, for the longest duration
  the plan offers.

(The Worker's own limits per admin, AUTH-HARDENING rules 17 and 18, are still needed before
messages and accounts are opened for writing.)

## 6. TLS and HTTPS

On the panel's zone, **SSL/TLS → Edge Certificates**:

- **Always Use HTTPS**: on.
- **HSTS**: on, max-age 6 months, preload off. Turn "include subdomains" on only if every
  subdomain of the zone already works over https (the API does).
- **Minimum TLS Version**: 1.2. (Zone-wide: the app's phones all support it; if in doubt, check
  Analytics → Traffic for TLS 1.0/1.1 first.)
- **TLS 1.3**: on.

**DNS → Settings → DNSSEC**: enable it, then add the DS record at the domain's registrar.

## 7. The accounts that can change all of this

Whoever controls these controls the panel, whatever the settings above say.

- **Cloudflare**: two-factor sign-in (a security key or an authenticator app), no extra members
  you do not need, API tokens with the least access (the backend's purge token: *Zone → Cache
  Purge* on the API's zone only). My Profile → Authentication → also turn on login
  notifications.
- **Azure**, **Google Cloud / Firebase**, **GitHub**: two-factor sign-in on each. On GitHub,
  protect `main` in both repositories (Settings → Branches: require a pull request), since the
  backend is deployed from `main`.
- **The admin's Google account**: 2-Step Verification on; it is the key to Access (if Google is a
  login method there) and to the panel.

## 8. Watching and reacting

- **Application Insights alert** on `[SECURITY_ALERT]` (DEPLOY-RUNBOOK 2.6): e-mails you when
  anyone who is not an admin reaches an admin route of the backend.
- **Zero Trust → Logs → Access**: every attempt at the outer gate.
- **Security → Events**: what the WAF rules blocked.

If something looks wrong:

1. Zero Trust → Access → the application → policy: remove everyone (nobody gets in, at once).
2. Take the uid out of `panelAdmins.ts` in the backend and deploy, or sign everyone out
   (AUTH-HARDENING §8).
3. Rotate `PANEL_SIGNING_SECRET` (SIGN-IN-SETUP §9).
4. If the panel itself is the problem: `npx wrangler rollback` in the admin-panel repo.
