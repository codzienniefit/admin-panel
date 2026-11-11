# Security

What was checked, what was found, what protects the panel today, and what must be true before it
is connected to real data. Reviewed 2026-11-10, after Phase 4, and again 2026-11-11, after Phase 7, on the code in the working
tree.

Related: [RISKS.md](RISKS.md), [BACKEND-SCOPE.md](BACKEND-SCOPE.md) (B0 is the backend's side of
sign-in), [research/backend-audit.md](research/backend-audit.md).

## 1. Where things stand

The panel today is a **demo with sample data**. It has no real sign-in, holds no secret and makes
no request to any backend. Anyone who can open the deployed address can use it, and all they can
reach is made-up data stored in their own browser.

So today's exposure is small. Most of this document is about keeping it small when the real backend
is connected in stage 2, which is where the real risk is: the panel will then be able to change
what every app user sees.

**Result of this review: no open security issue in the code as it stands.** Two things were
hardened during it (section 3). The list of what stage 2 must add is in section 5.

## 2. What was checked

| Area | How | Result |
|---|---|---|
| Dependencies | `npm audit`, production and development | 0 vulnerabilities |
| HTML injection | search for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, `srcdoc` | none in the code |
| Links and addresses built from data | every `href`, `src`, `window.open`, `location` use read | images only, through `mediaUrl`; one fixed outside link with `rel="noreferrer"`; content links are shown as text, not as clickable links |
| Redirect after sign-in | `auth/redirect.ts` and its tests | only paths inside the panel are accepted; `//host`, backslashes and control characters are refused |
| Secrets | search of code, config and documents for keys, tokens, passwords, private keys | none. The "token" the mock hands out is the fixed text `demo-token:<id>` |
| Personal data | search for e-mail addresses and user ids in code, fixtures and documents | none real. Demo people use `example.test`. An admin user id found in the backend source during research was left out of the copied notes |
| Network | search for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` | none in the client. The Worker answers `/api/health` only |
| Browser storage | every `localStorage` use read | environment choice, which demo person, sample data. No token, no real data |
| Uploads | `domain/mediaRules.ts` and its tests | type by extension per folder, size limits, and the stored name is rebuilt from letters and digits, so a file name cannot choose its own path |
| Pasted JSON | `parseContentJson` | parsed with Zod; bad input is explained, never executed or trusted |
| Source maps | build output | none published with the client files. Worker source maps are uploaded to Cloudflare, not served |
| Search engines | `index.html`, headers | `noindex, nofollow` in both |
| Ignored files | `.gitignore` | `.env*`, `.dev.vars*`, `.wrangler/`, `dist`, local Claude settings |
| Before the first commit (2026-11-11) | every file git would take, and the one existing commit, scanned for keys, tokens, connection strings and environment files; deploy dry run | nothing found. No environment file exists in the folder; the Worker has no variables or bindings; the client reads no environment variable. The scan is now `npm run secrets`, part of `npm run check` |

## 3. Found and fixed in this review

| Finding | Risk | Fix |
|---|---|---|
| **No security headers** on the deployed site | The panel could be framed by another site (clickjacking), and nothing limited what an injected script could load or where it could send data | `public/_headers`: Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies. Checked against the production build locally: the panel works, own images load, an image from another site is blocked |
| **A link in content could use any scheme.** `<a href="javascript:…">` in a description only got a warning | Content is shown in the mobile app. A `javascript:`, `data:` or `file:` address must never be sent there | `contentIssues` now refuses every scheme except `https`, `http`, `mailto`, `tel`. Publishing content with such a link is blocked. 10 tests |
| **An undeclared variable passed the typecheck** because `name` is a browser global | Not a security hole, but the same mistake with `status` or `origin` in security-relevant code would be | Lint rule refusing these globals |
| **Publish and hide acted on one click** | An accidental click changes what app users see | Both ask for confirmation |

## 3a. Second review, after Phases 5 to 7 (2026-11-11)

The same searches as in section 2 were run again over the new code (planner, calendar, settings,
messages, badges, users): no raw HTML, no `eval`, no links or addresses built from data, no network
calls, no secrets, `npm audit` clean. The new screens were walked on a local production build with
the security headers on: no policy violations.

What is new and how it is handled:

| Area | Concern | Handling |
|---|---|---|
| **Users** | Personal data (names, e-mail addresses) | There is no "all users" list. A search needs at least 3 characters, runs only on "Szukaj", and returns at most 20 people. Results live in memory for a few minutes after the screen is left, never in browser storage. The sample people are invented, with `example.test` addresses |
| **Users** | The search text is in the address (`?q=`), so a link can be shared | Accepted: it is what the admin typed, not a result. Do not paste such links outside the team. Reconsider before stage 2 if e-mail addresses are searched often |
| **Users** | Changing someone's e-mail address | A confirmation shows the old and the new address; the address is validated; nothing is sent in Test |
| **Messages** | A sent message reaches real people and cannot be taken back | Sending is refused while the content has errors; a confirmation names the recipients; a second click cannot send twice; the request carries the version that was confirmed, so a message changed in the meantime is not sent |
| **Call register (developer mode)** | It keeps every backend call with its parameters and answer, and answers can hold personal data (the user search, an account) | In memory only: never stored, never sent, at most 300 calls, emptied by a reload and by signing out (which reloads). Files are recorded as name, type and size, not content. It shows nothing the signed-in admin could not already see. Before real sign-in (L1): make sure no token is ever passed as a call argument, or mask it in `snapshot` |
| **Dates** | New dependency `react-day-picker` (with `date-fns`) | No install scripts, no network use, its stylesheet is not loaded; `npm audit` clean |
| **Logo and tab icon** | Files brought in from outside: the logotype SVG (from Michał) and the site's own icon from codzienniefit.pl | The SVG holds only paths and fills (no script, no link, no embedded image) and is shown through `<img>`, where an SVG cannot run code. The icon was converted to PNG and ICO locally. Both are served from the panel's own origin |
| **Rich text in content** | New dependency Tiptap (ProseMirror) for bold and links in text blocks | Content never passes through an HTML string: the stored text is converted to and from the editor's document by pure functions (`domain/richText.ts`). Pasting takes plain text only. A link in the editor has no `href`, so a click cannot navigate; "Otwórz w nowej karcie" opens only `http(s)`, `mailto` and `tel` addresses, with `noopener,noreferrer`. The library writes no style tag (`injectCSS: false`). `npm audit` clean |
| **Browser storage** | New key `cf.devMode` | "on" or "off" only |
| **Colours from data** | A stored colour is put into a `style` attribute | Only values that are exactly `#rrggbb` get there (`isHexColor`); the mock server refuses others on save |
| **Notes and names** | Free text typed by admins is shown to other admins | Rendered as text by React, never as HTML |
| **Browser storage** | New key `cf.recentPlans` | Ids of recently opened plans only |
| **Drag and drop library** | New dependency `@dnd-kit/core` | No install scripts, no network use; `npm audit` clean |

## 4. What protects the panel today

**Content Security Policy** (`public/_headers`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'
```

- Scripts only from the panel itself: no inline script, no `eval`, nothing from another site.
- Requests only to the panel's own address.
- `'unsafe-inline'` is allowed **for styles only**. React sets style attributes and the component
  library injects small style blocks. It does not allow script.
- `data:` and `blob:` for images and audio are what the sample data uses (generated pictures,
  uploaded files kept in the browser).

**No raw HTML.** Text with `<b>` and `<a>` is parsed by `textSegments` into pieces and rendered as
React elements. Anything the parser does not recognise is shown as plain text.

**Loose reading, strict writing.** Data from outside is parsed with Zod before use. Rules are
checked before a save, and again by the server.

**Destructive actions ask first**: delete, shorten a challenge, remove a variant, publish, hide,
close with unsaved input.

## 5. Before connecting real data (stage 2)

These are requirements, not suggestions. Each belongs to a slice in [ROADMAP.md §5](ROADMAP.md).

### Sign-in and access (L1)

1. **The backend decides who is an admin, on every request.** It verifies the Firebase ID token and
   the `admin` claim server-side. The panel's route guard only decides what to show; it can be
   bypassed by anyone with browser developer tools and must never be the protection.
2. **The shared master key goes away** for panel traffic. Today the whole admin API is protected by
   one shared secret that is also the Function App master key
   ([backend-audit.md](research/backend-audit.md)). The panel must never hold it: not in code, not
   in a `VITE_*` variable, not in the Worker's public config.
3. **Firebase web config is public by design** and may be in the bundle. Restrict the API key to
   the panel's domains in the Google Cloud console, and limit sign-in to the chosen methods.
4. **Tokens stay in memory or in the Firebase SDK's own storage.** Never in an address, a log, an
   error report or our own `localStorage` keys. A token is asked for per request.
5. **Sign-out clears** the collections and the query cache, so the next person on that computer
   sees nothing.
6. **A 401 refreshes the token once, then signs out. A 403 shows "no access".** Neither retries in
   a loop.
7. **Admins are added and removed by a script or endpoint that only existing admins can use**
   (B0.5), and the change is logged.

### The Worker

8. **Any Worker endpoint that holds a secret verifies the token and the admin claim itself** (AI
   descriptions, YouTube lookups). A Worker endpoint without that check is an open proxy to a paid
   API.
9. **If the Worker forwards to the backend, it forwards to one fixed host**, never to a host taken
   from the request.
10. **Secrets are Wrangler secrets** (`wrangler secret put`), never values in `wrangler.json`.
11. **CORS**: the backend allows the panel's address only, not `*`, once the panel calls it from
    the browser.

### Content Security Policy

12. Each new origin is added to `public/_headers` by name, never as a wildcard:

    | Needed for | Directive |
    |---|---|
    | Backend API | `connect-src` + the API host |
    | Firebase sign-in | `connect-src` + `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`; `frame-src` for the auth domain if pop-up or redirect sign-in is used |
    | Media files | `img-src`, `media-src` + the storage or CDN host |
    | YouTube preview | `frame-src` + `www.youtube-nocookie.com`; `img-src` + `i.ytimg.com` |

13. `script-src` stays `'self'`. If something appears to need more, the answer is to load it
    differently, not to loosen the policy.

### Data

14. **Media paths from the server are joined to a fixed base address.** The HTTP adapter's `urlFor`
    must refuse a path that is itself a full address or starts with `/` or contains `..`.
15. **Uploads are checked again on the server**: type by content, not only by extension; size; the
    path. The panel's check is for a quick, clear message.
16. **User data** (the Users section) is shown only as far as the task needs, never written to the
    address or to logs, and not cached beyond the session.
17. **Writes to real data follow [ROADMAP.md §4](ROADMAP.md)**: `[TEST]` items only until a section
    is accepted, enforced by the panel.
18. **Every admin change is recorded with who made it** (B0.8, B4.3).

17a. **User search stays limited on the server too**: a minimum query length, a result cap, and no
    endpoint that lists everyone. The panel's limits are a courtesy, not the protection.
17b. **Sending a message is its own request**, tied to the version the admin confirmed (etag), and
    safe to repeat (an idempotency key), so a retry after a timeout cannot send twice.

### Process

19. `npm audit` clean before each push; dependency updates reviewed, not automatic.
20. A second look at this document, and a rerun of section 2, when L1 is built and again before the
    first write slice (L3).

## 6. Checklist for every change

The short list used by [DEFINITION-OF-DONE.md §5](DEFINITION-OF-DONE.md).

- [ ] No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`.
- [ ] No address or link built from data without a scheme check; no redirect without
      `sanitizeRedirect`.
- [ ] No secret in client code or `VITE_*`. No token or personal data in storage, addresses or logs.
- [ ] No new origin without a line in `public/_headers` and in section 5.12 above.
- [ ] No new dependency without a reason; `npm audit` clean.
- [ ] No request to the real backend from a test, a script or a seed.
- [ ] Anything that changes what app users see, or discards input, asks first.
- [ ] Data from outside (server, paste, file, address, storage) is parsed before use.
- [ ] Personal data is held in memory only, shown only as far as the task needs, and never logged.
- [ ] A value from data goes into a `style` attribute only after it is checked (`isHexColor`).

## 7. Known and accepted

| Item | Why it is acceptable now | Revisit |
|---|---|---|
| The demo is open to anyone with the address | Sample data only, kept in the visitor's own browser; `noindex` | Before Produkcja is enabled in the environment selector: the selector itself must not be how production is protected, the backend is |
| `style-src 'unsafe-inline'` | Needed by React style attributes and the component library; does not permit script | If the libraries gain nonce support |
| Entitlement and offering ids are typed by hand and not checked against RevenueCat | Same as Retool; a wrong id means a purchase unlocks nothing, which is visible, not a leak | Phase 6 or stage 2 |
| The sample-data mock trusts the browser | It is not a security boundary; it exists to be manipulated for testing | Never: it is removed from the path when Produkcja is selected |
| No automated security scan in a pipeline | There is no pipeline; `npm audit` and this checklist are run by hand | With continuous integration ([RISKS.md](RISKS.md)) |

## 8. Reporting

If something here looks wrong or a secret is found in the repository: tell Michał directly, do not
open a public issue, and rotate the secret before removing it from history.
