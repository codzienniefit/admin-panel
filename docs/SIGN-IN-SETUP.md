# Sign-in setup: the keys, where they come from, where they go

How to switch on the panel's Produkcja environment. Rewritten 2026-11-13 for the sign-in defined
in [AUTH-HARDENING.md](AUTH-HARDENING.md) section 4: Google through Firebase, the session created
and checked by the backend, every call signed by the panel's Worker.

The code for both halves exists (panel: `worker/`; backend:
`src/modules/services/panelAccessService.ts`, `functions/panel/`). Nothing below has been done
yet, and none of it can be done by Claude: every value is created or copied by Michał and typed
straight into Cloudflare or Azure. Neither half has run against the real Firebase, Google or each
other's deployed copy.

**Rule for the whole document: no value is ever pasted into a chat, a file in a repository, a
commit, or a terminal command line.** Where a command is given, the value never appears on screen.
Run these commands in a terminal of your own, not one an AI agent is attached to.

There is no local setup any more. Production keys do not exist on a developer's machine; local
work uses the Test environment (`npm run dev`), which needs no key.

## 1. How sign-in works

1. The login page sends the browser to the Worker (`/auth/google/start`), which sends it to Google
   and gets it back.
2. The Worker exchanges Google's answer for a Firebase token of the same person and hands it to
   the backend, signed.
3. The backend checks that the person is on its list (`PANEL_ADMIN_UIDS`), signed in with Google,
   just now. Then it asks Firebase for a session that lasts 48 hours.
4. The Worker stores that session in one cookie the page cannot read (`__Host-cf_session`:
   `HttpOnly`, `Secure`, `SameSite=Strict`).
5. Every request the panel makes goes to its own address (`/api/...`). The Worker forwards only the
   calls on its list, with the session and its own signature. The backend checks both, and the
   list again, on every call.

Someone who is not on the list gets no session. The login page shows them their own user id, which
is what you need to add them.

## 2. The values

**In Cloudflare** (Workers & Pages → admin-panel → Settings → Variables and Secrets):

| Name                   | Kind       | What it is                                                                             | Where it comes from |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------- | ------------------- |
| `PANEL_ORIGIN`         | Text       | The one address the panel is used at, e.g. `https://panel.example.com`                 | Section 3           |
| `API_ORIGIN`           | Text       | The backend's address, without `/api`                                                  | You know it         |
| `MEDIA_ORIGINS`        | Text       | Where the backend stores media (the host `files?path=…` redirects to). Several: commas | Section 4           |
| `FIREBASE_API_KEY`     | Text       | The Firebase project's Web API key. Not a secret: it ships in the mobile app           | Firebase console    |
| `GOOGLE_CLIENT_ID`     | Text       | Google OAuth client id                                                                 | Section 5           |
| `GOOGLE_CLIENT_SECRET` | **Secret** | Its secret                                                                             | Section 5           |
| `SIGN_IN_COOKIE_KEY`   | **Secret** | 32 random bytes. Protects a sign-in on its way to Google and back, and nothing else    | Section 6           |
| `PANEL_SIGNING_SECRET` | **Secret** | Shared with the backend. Signs every forwarded call                                    | Section 6           |

Add the "Text" ones as type Text so they can be read back and reviewed; only the three marked
Secret are secrets. Until all eight are set, Produkcja stays switched off and the login page says
so.

**In Azure** (the Function App → Settings → Environment variables):

| Name                   | What it is                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| `PANEL_SIGNING_SECRET` | The same value as in Cloudflare. Without it every `panel/…` route answers 503 |

**In the backend's code** (`src/config/panelAdmins.ts`): `PANEL_ADMIN_UIDS`, the list of admins.
Section 7.

What none of these can do alone: the signing secret without a live session of a listed admin
opens nothing; a session without the signature opens nothing; the cookie key protects no session.

## 3. One address

The Worker serves the panel at one address only and refuses `/auth/*` and `/api/*` on any other
host, including its `workers.dev` address and the addresses of old versions.

1. Give the Worker a custom domain (Workers & Pages → admin-panel → Settings → Domains & Routes).
2. Set `PANEL_ORIGIN` to it, with `https://` and nothing after the host.
3. In `wrangler.json` add `"workers_dev": false` and the domain under `routes` with
   `"custom_domain": true`, and commit that. Switching `workers.dev` off only in the dashboard does
   not last: the next deploy switches it back on. (`"preview_urls": false` is already in the file.)
4. Turn on "Always Use HTTPS" and HSTS for the domain (Cloudflare → SSL/TLS → Edge Certificates).

Step 3 is not done in the repository yet because the domain is not known there. Until it is, the
Test environment stays reachable on `workers.dev`, and Produkcja does not answer there.

## 4. Media

Pictures and recordings are shown through the panel's own address. The Worker asks the backend
where a file is and fetches it only from an address listed in `MEDIA_ORIGINS`. Set it to the
storage address the backend redirects to (open one `…/api/files?path=…` link from the app in a
browser and look at the host you end up on). Without it no picture loads in Produkcja.

## 5. Google

1. Google Cloud console, **the project that belongs to the Firebase project** → APIs & Services →
   Credentials → Create credentials → OAuth client ID → Web application.
2. Authorised redirect URI: `<PANEL_ORIGIN>/auth/google/callback`. Nothing else: no JavaScript
   origins, no other redirect.
3. Copy the client id into `GOOGLE_CLIENT_ID` (Text).
4. The client secret: in the Cloudflare dashboard add `GOOGLE_CLIENT_SECRET` as a Secret and paste
   it there, straight from the Google page.
5. Firebase console → Authentication → Sign-in method → Google: it must be enabled, and the new
   client id must be accepted. If Firebase refuses the sign-in ("Logowanie nie jest poprawnie
   skonfigurowane"), add the client id under "Safelist client IDs from external projects" there.
   This step has not been tried against the real Firebase.

## 6. The two random secrets

You create both. Neither is ever shown.

`SIGN_IN_COOKIE_KEY`, in a terminal in this repository (Wrangler reads the value from the pipe):

```bash
openssl rand -base64 32 | npx wrangler secret put SIGN_IN_COOKIE_KEY
```

`PANEL_SIGNING_SECRET` has to be the same in Cloudflare and in Azure. Put it on the clipboard,
paste it into both dashboards as a secret, then clear the clipboard:

```bash
openssl rand -base64 48 | tr -d '\n' | pbcopy
```

```bash
pbcopy < /dev/null
```

Both must be at least 32 characters; these are longer.

## 7. Admins

The list is `PANEL_ADMIN_UIDS` in the backend's `src/config/panelAdmins.ts`: Firebase user ids,
one per line, with a comment saying who each is. A change takes effect when the backend is
deployed.

Being on the list gives nothing in the mobile app, nothing with a Firebase token sent to the
backend directly, and nothing on the routes Retool uses. It only lets that person open a session
through the panel.

**Adding someone**

1. They open the panel and sign in with Google. They are refused, and the page shows their user id.
2. In the Firebase console (Authentication → Users) find that user id. Check that Google is its
   only sign-in method; if it also has a password, remove the password provider or ask them to.
   Someone else may have registered that e-mail with a password first.
3. Confirm with the person that 2-Step Verification is on for their Google account. Code cannot
   check this.
4. Add the user id to the list, commit, deploy the backend.

**Removing someone**: take the line out and deploy. They are refused on their next call. If their
device is lost or you need them out before a deploy, see the runbook in
[AUTH-HARDENING.md](AUTH-HARDENING.md) section 8.

**Signing out** of the panel ends that person's panel sessions everywhere, from that moment: the
backend records the time (table `PanelSignOuts`) and refuses any panel session that began before
it, so a copy of the panel's cookie stops working at once. The mobile app on their phone stays
signed in.

## 8. Checks after setting up

1. Open `<PANEL_ORIGIN>/api/health`: `{"ok":true}`.
2. Open the panel's `workers.dev` address, pick Produkcja: the login page says sign-in could not be
   checked. That is the host check working.
3. At `PANEL_ORIGIN`, pick Produkcja and sign in with a Google account that is not on the list:
   refused, with a user id.
4. Sign in with one that is on the list: the panel opens; lists load.
5. Try to save anything: refused with "Produkcja jest tylko do odczytu". Writing is switched on per
   section, in the Worker (`OPEN_FOR_WRITING` in `worker/proxy.ts`) and in the page
   (`src/data/api/capabilities.ts`), one at a time. The one exception is Ustawienia → Aplikacja →
   "Wyczyść cache backendu": it changes no data, so it works while Produkcja is read-only.
6. Sign out, then use the browser's back button: signed out.

## 9. Changing a value later

| Value                  | How                                                                                                                                                  | Effect                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `PANEL_SIGNING_SECRET` | Azure: add the new value as `PANEL_SIGNING_SECRET_NEXT`. Cloudflare: set the new value. Azure: move it to `PANEL_SIGNING_SECRET` and delete `…_NEXT` | No interruption                               |
| `SIGN_IN_COOKIE_KEY`   | Set a new one                                                                                                                                        | A sign-in under way at that moment fails once |
| `GOOGLE_CLIENT_SECRET` | New secret in the Google console, set it in Cloudflare, delete the old one in Google                                                                 | None                                          |
| Sign everyone out      | [AUTH-HARDENING.md](AUTH-HARDENING.md) section 8                                                                                                     |                                               |
