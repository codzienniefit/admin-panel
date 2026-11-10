# Phase 4 result

2026-11-10. Phase 4 of [PLAN.md §7](PLAN.md): challenges, their content and their variants. Test
environment only: sample data, no network.

Checked by `npm run check` (typecheck, lint, 190 tests, production build) and by walking the flows
in a browser at desktop and phone width.

## Done when, and whether it is

The plan's criterion is every item under "Wyzwania" in the
[parity checklist](research/retool-inventory.md), except the day editor, which Phase 5 replaces.

| Retool function | In the panel |
|---|---|
| List with type tag | yes: cards or a table, the choice is kept in the address |
| Filter | yes: search, status, type, order, all kept in the address |
| Refresh | not needed; the list is live |
| Create | yes: a name and a number of weeks make a draft |
| Edit | yes: a page per challenge with two tabs, Przegląd and Treść |
| Hide / unhide | yes, as statuses: draft, published, hidden, trash |
| Title, subtitle, comment | yes |
| Paid, with entitlement and offering ids | yes; the four fields show only when "Płatne" is on, and are cleared when it is turned off |
| Goals, difficulty levels, category | yes |
| Added, premiere and hide dates, "Widoczne od" | yes; every date except "Data dodania" can be cleared (Retool could not clear "Widoczne od") |
| Length in days | yes; shortening asks first and says how many workouts would be lost |
| Days visible up front | yes |
| Description | yes, with the block editor of Phase 3 |
| Completion and 100% badges | yes |
| Thumbnail pick and upload | yes |
| Add, switch, remove a variant | yes |
| Duplicate a variant | yes: "Skopiuj dni z" when adding one |
| Per variant: workouts per week, min days, description, PRO, difficulty levels | yes |
| Add, remove, move a day; up to three workouts a day; rest days | **interim**: "Otwórz plan" opens the Phase 0 test editor on that variant. The planner of Phase 5 replaces it |
| Conflict detection | yes: silent merge when someone changed something else, a notice with a choice when it is the same field |
| Set and clear the promoted challenge | yes |

New compared with Retool: "Polecane dalej", drafts that can be saved incomplete, a trash with
restore, publishing refused with a list of reasons, a confirmation before publishing and hiding, and
a shareable address for every challenge, tab and variant plan.

## What was built

**List** at `/challenges` (`src/features/challenges/ChallengesPage.tsx`)
- Cards with thumbnail, status, type and one tag per variant level; or a table.
- "Promowane wyzwanie" at the top: only published challenges with a premiere date can be chosen.

**Challenge page** at `/challenges/C1`
- Header with status, type, "Promowane" and "Pro" tags, and the status actions: Opublikuj, Ukryj,
  Cofnij do szkicu, Usuń, Przywróć jako szkic. Which ones appear depends on the status.
- **Publishing and hiding ask first.** They change what app users see.
- **Publishing is refused with reasons**, each naming the variant by its level name, for example:
  "Wariant „Początkujący”: minimalna liczba dni do ukończenia to 8, a dni z treningami jest 5".
- A promoted challenge cannot be deleted or hidden until something else is promoted.
- **Przegląd**: variants with their numbers (days, workouts, rest days), a facts card, and the
  description as the app will draw it.
- **Treść** at `/challenges/C1/content`: every field, in five cards. "Zapisz zmiany" keeps the
  status. While the form has unsaved input the status actions wait, so "Opublikuj" never publishes
  something other than what is on screen. Leaving the tab or the page with unsaved input asks first.
- **Variant plan** at `/challenges/C1/plan/p-hard`.

**New challenge** at `/challenges/new`: creates a draft and opens its Treść tab.

**One set of rules** (`src/domain/challengeRules.ts`), used by the form, the status actions and the
mock server, so they cannot disagree. A draft needs only a name. Publishing or hiding needs a
subtitle, a thumbnail, at least one variant, as many days in each variant as the challenge lasts, a
minimum-days number that fits, and no draft or deleted workouts inside. Paid-access fields are
checked together (an offering needs an entitlement, a discount needs both).

**One way to change a challenge** (`applyChallengeChange` in `challengeActions.ts`): describe the
change, have it checked, save only the fields that differ, get back "saved" or the problems. The
header, the form and the variant dialog all use it.

## Found and fixed on the way

| Problem | Fix |
|---|---|
| Saving the form with an empty name did nothing: the browser's own "required" check blocked the submit, silently in the pane | Forms carry `noValidate`; our messages show next to the fields |
| A variable used in the second half of the rule checks was never declared, and the typecheck passed, because `name` is also a browser global. Six tests caught it | Fixed, and a lint rule now refuses `name`, `status`, `event`, `length` and similar used as globals |
| Problems named variants by internal id ("beginner") | They use the level's name |
| Publish and hide happened on one click | Both ask first, after the rules pass |
| A thumbnail's remove button said "Usuń z treningu" on a challenge | It says "Usuń" |
| Leaving the Treść tab dropped unsaved input without a word | It asks first |

## Security pass

Done after the phase, on the whole code base; the full account is in [SECURITY.md](SECURITY.md).
No open issue. Two things were hardened:

- **Security headers** for the deployed site (`public/_headers`), including a Content Security
  Policy. Checked against the production build locally: the panel works and outside content is
  blocked.
- **Links in content** may only use `https`, `http`, `mailto` or `tel`. A `javascript:` or `data:`
  address is refused, which blocks publishing.

`npm audit` reports 0 vulnerabilities.

## Documents added

[ARCHITECTURE.md](ARCHITECTURE.md) (as built), [CODE-GUIDELINES.md](CODE-GUIDELINES.md),
[DEFINITION-OF-DONE.md](DEFINITION-OF-DONE.md) (ready and done: tests, lint, checks by hand),
[SECURITY.md](SECURITY.md), [RISKS.md](RISKS.md).

## Not done, or not verified

- **Deployment is still unverified**; nothing has been pushed. The new security headers in
  particular have only been seen working locally: on the first deployment, check the browser
  console for "Refused to load".
- **The day editor is the Phase 0 test editor**, not the planner. It adds, removes and moves
  workouts with undo and autosave; it has no drag and drop, notes or totals per week.
- **Folders for challenges are not built.** The plan listed them under this phase's list; they are
  part of Phase 6 together with plan types.
- **Setting the promoted challenge does not ask first.** It is already two steps (pick, then
  "Zapisz"), the same as Retool. Say if it should confirm like publishing does.
- **Entitlement and offering ids are typed by hand**, as in Retool. Nothing checks them against
  RevenueCat.
- **The order of "Polecane dalej"** follows the order of picking; there is no drag to reorder.
- **Playwright is still not set up.** The flows were walked by script in the preview pane; the
  rules and filters are covered by the 190 tests.
- **Screens were checked by reading the page** and one phone-width screenshot of the list. Please
  look at the challenge page and the Treść form yourself, on desktop and phone width.
- **JavaScript is about 390 kB gzipped** in total, up from 365. The challenge pages are in route
  chunks that load on demand.

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| Challenge list with folders | Without folders | They need the backend field from scope B3; moved to Phase 6 |
| New challenge asks for a kind (challenge or plan) | Asks for a name and weeks only | The kind follows from the premiere date and category, set on the Treść tab; one fewer question |
| Home page shows the challenge list | `/` redirects to `/challenges` | Every challenge address then starts the same way |
