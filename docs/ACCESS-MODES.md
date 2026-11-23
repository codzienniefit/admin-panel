# Two modes of access: signed out and signed in

Written 2026-11-23, when the panel's code was put behind sign-in. This is the one place that says
what a visitor can download before and after signing in, and the rules that keep it so. Read it
before changing `worker/gate.ts`, `worker/loginPage.ts`, `worker/auth.ts` (the cookies),
`wrangler.json` (`assets`) or anything in `public/`.

Related: [SECURITY.md](SECURITY.md), [ARCHITECTURE.md §13](ARCHITECTURE.md),
[AUTH-HARDENING.md](AUTH-HARDENING.md), [CODE-GUIDELINES.md §12](CODE-GUIDELINES.md).

## 1. Signed out

On a deployed Worker (`PANEL_ORIGIN` set), every request reaches the Worker first (`wrangler.json`:
`"run_worker_first": true`). A browser without a valid pass can download exactly this, and nothing
else:

| What | Answered by |
|---|---|
| The sign-in page, for any page address (`/`, `/challenges/…`, `/login?…`), GET or HEAD | the Worker itself, `worker/loginPage.ts` |
| `/robots.txt`, `/favicon.ico`, `/favicon-32.png`, `/favicon-192.png`, `/apple-touch-icon.png` | the static files (`PUBLIC_FILES` in `worker/gate.ts`) |
| `/api/health` | the Worker: `{"ok":true}` |
| `/auth/*` | the Worker's sign-in code, `worker/auth.ts`, with its own checks |

Every other address answers 404 for a file (anything under `/assets/` or ending in an extension,
`/index.html` included) and for any other method. `/api/*` answers what it always did: without
the session, nothing.

The sign-in page is plain HTML with inline CSS and no JavaScript; its policy is
`default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self';
frame-ancestors 'none'; base-uri 'none'`, it is never stored (`no-store`) and never indexed. It
holds the logotype (inline SVG), one link to `/auth/google/start?redirect=…`, and after a refused
sign-in the reason and the refused person's own user id. Nothing on it says what is behind it.

So before sign-in nobody sees the panel's screens, route names or API calls (about 2.3 MB of
code that used to be downloadable by anyone with the address).

## 2. The pass

| | |
|---|---|
| Name | `__Host-cf_pass` (`PASS_COOKIE` in `worker/auth.ts`) |
| Set | only when a sign-in succeeds (`finishGoogle`), next to the session cookie |
| Content | `{ v: 1, uid, exp }`, sealed with AES-GCM under `SIGN_IN_COOKIE_KEY`, the cookie's name bound in as the purpose (the same `seal`/`open` as the sign-in attempt and refusal cookies). The browser cannot read or change it; a value sealed for another cookie, or with another key, does not open |
| Valid | when it opens with the key, has the pass's purpose and shape, and `exp` is in the future |
| Attributes | `HttpOnly; Secure; Path=/; SameSite=Lax`, `Max-Age` = the session's |
| Why Lax | the first page after sign-in is the end of Google's chain of redirects, a navigation another site started. A Strict cookie is not sent on it, so the browser would get the sign-in page again. (The refusal note `__Host-cf_refused` is Lax for the same reason: the sign-in page shows its user id on that same navigation.) The session cookie stays Strict |
| Ends | with the session: same lifetime, and cleared wherever the session is cleared (sign-out, `clearSession()`, a session the backend no longer accepts at `/auth/session` or `/api/*`). A new `SIGN_IN_COOKIE_KEY` ends every pass |
| Authorises | **only downloading the panel's code.** No data. The Worker cannot check a Firebase session itself, so the pass is not proof of one; it is a sealed note that this browser signed in |

## 3. Data is protected by the backend, not by the pass

Every `/api/*` call needs the real session cookie, which the backend checks on every call along
with its list of admins and the Worker's signature ([SECURITY.md §5a](SECURITY.md)). A pass alone
gets `401 SIGNED_OUT`; a stolen pass gets someone the panel's code and nothing more. The code is
not a secret either: it holds no key, no configuration and no data. Gating it removes a map of the
panel from strangers; it is not what keeps data safe.

## 4. Signed in

With a valid pass the Worker hands every request (other than `/api/*` and `/auth/*`) to the
static files unchanged: the single-page fallback and `public/_headers` apply as before. It then
sets `cache-control: private, no-store` on HTML and `private, no-cache` on everything else, so no
shared cache keeps something that the same address answers differently to someone without a pass.

## 5. Two states without a full setup: open only on this computer, closed when deployed

- **No `PANEL_ORIGIN`** (`npm run dev`, the UI tests in `npm run test:ui`): every file and page goes
  to the static files exactly as before the gate existed. Such a Worker has no address of its own
  and no way in; it is a developer's machine.
- **`PANEL_ORIGIN` set, anything else missing or invalid** (a deployed Worker whose setting was
  deleted, mistyped or not yet added): **closed** (fail-closed). No file of the panel is served to
  anyone, pass or not; every page is the sign-in page saying sign-in is not configured and naming
  the missing values, with no sign-in button. A broken setting must never open the panel's code.

The gate depends on `PANEL_ORIGIN` alone (`worker/index.ts`), never on the full setup.

## 6. After this was deployed

Anyone signed in before the pass existed has a session but no pass: they see the sign-in page once
and sign in again. Nothing else changes for them.

## 7. Rules for changes

- **A new file in `public/` is gated.** It becomes public only if added to `PUBLIC_FILES` in
  `worker/gate.ts` on purpose, with a reason, and the list in `src/accessModes.test.ts` updated.
- **The sign-in page stays JavaScript-free and loads nothing from `/assets/`**: inline CSS, inline
  SVG, no script, no stylesheet link, no module preload. Keep its policy as strict as it is.
- **Never put configuration, secrets, private sample data or admin-only texts** into the sign-in
  page or the always-public files. They are what strangers see.
- **Gated answers stay `private`** (`no-store` for HTML). Never let a public cache header through
  for anything served with a pass.
- **Never add exclusions to `run_worker_first` or entries to `PUBLIC_FILES` without a review.** An
  exclusion is an address the Worker never sees.
- **Never let a pass stand in for the session on `/api/*`**, and never let `/api/*` or `/auth/*`
  decide anything from it.
- **The panel's `index.html` is served only with a pass.** It names the build's files; the sign-in
  page is the Worker's own and is not built from it.
- **Clear the pass wherever the session is cleared.** Add new places to `clearSession()`, not
  beside it.
- **Escape every value put into the sign-in page** (`escapeHtml`), and send a redirect only through
  `safeRedirect`.
- **Keep the gate fail-closed.** What opens the static files without a pass is only "no
  `PANEL_ORIGIN`" (this computer). Never make it depend on the rest of the setup (`canSignIn`), or
  a deleted setting would open the panel's code to everyone.

The tests that guard these, which must stay green:

| Rule | Tests |
|---|---|
| Nothing of the panel without a pass, whatever the address, method or headers | `worker/accessModes.test.ts` |
| The sign-in page: headers, no script, link, notices, escaping | `worker/gate.test.ts` |
| The pass: attributes, sealing, lifetime, forgeries, clearing | `worker/gate.test.ts`, `worker/auth.test.ts` |
| A pass opens no data | `worker/accessModes.test.ts`, `worker/gate.test.ts` |
| `public/` equals the allow-list; `wrangler.json` keeps the binding and `run_worker_first: true` | `src/accessModes.test.ts` |
| The sign-in page's texts equal the panel's own | `src/features/auth/returnProblems.test.ts` |
| No `PANEL_ORIGIN` (this computer): everything as before | `worker/accessModes.test.ts`, `worker/gate.test.ts`, `npm run test:ui` |
| Deployed but incomplete: closed, pass or not; missing values named | `worker/accessModes.test.ts` |
