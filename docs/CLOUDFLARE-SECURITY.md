# Cloudflare settings that make the panel harder to find and to attack

Written 2026-11-23: the reasoning behind the Cloudflare settings. **The steps for v1 are in
[DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) Part 6**; this file explains them and keeps what comes
later. **v1 does not use Cloudflare Access** (§1 is for later); everything from §2 on is part of v1.

Below, `PANEL` stands for the panel's hostname, **`panel.codzienniefitapp.com`**: paste the rules
exactly as written, with that name in place of `PANEL`.

**Read this first.** If the panel lives on the same zone as the API
(`api.codzienniefitapp.com`), every **zone-wide** switch also hits the mobile app's traffic. The
app is not a browser: it cannot solve a challenge, so a zone-wide bot or challenge setting can
break the app for everyone. That is why every rule below is limited with `http.host eq "PANEL"`,
and why "Bot Fight Mode" is on the do-not list.

What the code already does (no setting needed): `robots.txt` turns every crawler away and names
the AI ones; every page, file and Worker answer says `noindex, nofollow, noarchive, nosnippet,
noimageindex, noai, noimageai`; the page is titled "Logowanie" and says nothing about what it is
until you are signed in; before sign-in nothing of the panel's code is downloadable at all, only
the Worker's own sign-in page (no JavaScript), `robots.txt` and the icons; every `/assets/…` file
answers 404 ([ACCESS-MODES.md](ACCESS-MODES.md)); the Worker answers only on `PANEL_ORIGIN`; every
call to the backend is signed; the backend logs every non-admin attempt as `[SECURITY_ALERT]`.

## 1. Later (not in v1): Cloudflare Access in front of the whole panel

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

- `panel.codzienniefitapp.com` was chosen (2026-11-23). It is among the first names scanners try,
  so in v1 the WAF rules (§4) and the rate limit (§5) are what keep it quiet; Access (§1) is the
  next step when wanted.
- Keep it one level under the zone (`x.codzienniefitapp.com`, not `a.b.codzienniefitapp.com`).
- Do not link to it from anywhere public. Hostnames turn up in public certificate logs anyway, so
  the name hides little; the WAF rules, the panel's own sign-in and (later) Access do the work.
- `wrangler.json` has `"workers_dev": false` and `"preview_urls": false` (DEPLOY-RUNBOOK 1.4), so
  the Worker has no second, guessable address; `admin-panel.marta-100.workers.dev` is off.
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

## 6a. DNS (the zone `codzienniefitapp.com`)

What is there (export of 2026-11-23): `api` → `fitfunctions.azurewebsites.net` and `blobs` →
`superfitstorage.blob.core.windows.net`, both proxied; the `asuid.api` TXT record Azure uses to
prove the API's domain. The panel's record is created by Cloudflare from `wrangler.json`
(DEPLOY-RUNBOOK 5.1); never add one by hand.

- **DNSSEC**: DNS → Settings → **Enable DNSSEC**, then add the DS record it shows at the domain's
  registrar. It stops anyone answering for `codzienniefitapp.com` in Cloudflare's place.
- **Nobody may send e-mail as @codzienniefitapp.com.** The zone has no MX record, so the domain
  receives no mail; without the records below, anyone can still *send* mail that claims to come
  from it (phishing your users "from Codziennie Fit"). **First check that nothing sends mail as
  @codzienniefitapp.com** (a newsletter tool, Firebase's custom e-mail domain, receipts): if
  something does, use its SPF include instead of `-all` and do not add the null MX. Then DNS →
  Records → Add, each **DNS only** (grey cloud):

  | Type | Name | Content | Why |
  | --- | --- | --- | --- |
  | `MX` | `@` | `.` with priority `0` | "This domain takes no mail" (null MX) |
  | `TXT` | `@` | `v=spf1 -all` | No server may send mail as it |
  | `TXT` | `_dmarc` | `v=DMARC1; p=reject; adkim=s; aspf=s` | Receivers reject mail claiming to be from it |
  | `TXT` | `*._domainkey` | `v=DKIM1; p=` | No DKIM key is valid |

- **No CAA record for now.** The API's own certificate on Azure (`asuid.api`) may come from a
  certificate authority other than Cloudflare's; a CAA record that leaves it out would stop that
  certificate from renewing. Add CAA only after checking which authority issued it (Azure portal
  → the Function App → Certificates).
- **No wildcard records**, and nothing else pointing at retired services (a CNAME to a deleted
  Azure app can be taken over by whoever recreates that name).

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

1. Workers & Pages → admin-panel → Domains & Routes: remove `panel.codzienniefitapp.com` (the panel
   disappears at once). Once Access is set up: remove everyone from its policy instead.
2. Take the uid out of `panelAdmins.ts` in the backend and deploy, or sign everyone out
   (AUTH-HARDENING §8).
3. Rotate `PANEL_SIGNING_SECRET` (SIGN-IN-SETUP §9).
4. If the panel itself is the problem: `npx wrangler rollback` in the admin-panel repo.
