# UI tests

A real browser clicking through the panel as a person would, with [Playwright](https://playwright.dev).
They answer one question: do the basic things still work? Rules and edge cases are covered by the
unit tests next to the code (`npm run test`).

```bash
npm run test:ui        # all of them, headless, about 30 seconds
npm run test:ui:show   # Playwright's window: watch, step, pick one test
npx playwright test e2e/planner.spec.ts     # one file
npx playwright show-report e2e/.report      # the last run, with traces of failures
```

The first time on a machine: `npx playwright install chromium`.

Run them locally after every big set of changes (`npm run test:all` runs them after the other
checks). Nothing runs them on push.

## They run in the Test environment, and only there

This is decided once, for every test, and a spec cannot change it:

- [`support/environment.ts`](support/environment.ts) starts every browser with the panel's **Test**
  environment selected (sample data that lives in the browser) and the demo administrator signed in.
  It refuses to load if the panel's default environment is ever something else.
- [`support/test.ts`](support/test.ts) refuses every request that would leave this machine and
  fails the test that made it. No UI test can reach the real backend.
- The tests run against the **production build** served locally (`vite preview`), so the security
  headers are the deployed ones.

Each test gets a fresh browser profile: it starts from the same sample data, and nothing one test
does is seen by another. They run in parallel.

## What every test also checks

Without a line in the spec, from `support/test.ts`:

- no request left this machine;
- no error in the browser console (a Content Security Policy refusal is one);
- "today" is fixed at 2026-11-12, so the calendar gives the same result on any day.

## Writing one

```ts
import { dialog, expect, open, test, toast } from "./support/test";

test("an edited workout is saved", async ({ page }) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	await editor.getByRole("textbox", { name: "Komentarz" }).fill("sprawdzone");
	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();
});
```

- Import `test` and `expect` from `./support/test`, never from `@playwright/test`.
- **Find things the way a person does**: by role and visible name (`getByRole("button", { name: "Zapisz zmiany" })`).
  No CSS classes, no test ids. If something cannot be found that way, it is usually missing a label,
  and a screen reader cannot find it either: fix the screen.
- **Name the test after what the person can rely on**, not after the clicks.
- **Wait for what the person would see** (a toast, a row, a heading). Never `waitForTimeout`.
- **Persistence means a reload**: after a save, `page.reload()` and look again.
- Data a test creates is named `[TEST] …`.
- Helpers in `support/test.ts`: `open`, `toast`, `dialog`, `confirm`, `choose` (a dropdown),
  `pick` (a "⋯" or "Więcej" menu), `dragTo`.
- To force a failed save or someone else's change, use the panel's own "Dane testowe" dialog, as
  `saving.spec.ts` does.

## What is covered

| File                 | What must keep working                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.spec.ts`       | Test environment and no production; sign-in returns to the page asked for; an account without rights is refused; sign-out                                                                                                                                                                                                            |
| `shell.spec.ts`      | every section opens; an unknown address says so; eight screens fit a 375 px phone                                                                                                                                                                                                                                                    |
| `workouts.spec.ts`   | search without Polish letters, kept in the address; create; edit and reload; "close without saving?"                                                                                                                                                                                                                                 |
| `challenges.spec.ts` | list filters; create a draft and its first variant; publishing an unfinished draft is refused with reasons; edit content; save at once after opening; hide only after a confirmation                                                                                                                                                 |
| `planner.spec.ts`    | add, undo, redo; autosave of a draft; move from the menu; drag and drop; day notes; a published plan changes only on a confirmed save; discard                                                                                                                                                                                       |
| `calendar.spec.ts`   | month and year views; giving an undated challenge a date                                                                                                                                                                                                                                                                             |
| `settings.spec.ts`   | a folder from settings to the list filter; add and remove a plan type                                                                                                                                                                                                                                                                |
| `messages.spec.ts`   | save a draft; send once, after the question; no recipients means no send                                                                                                                                                                                                                                                             |
| `badges.spec.ts`     | create with a picture from the library; a badge in use cannot be hidden                                                                                                                                                                                                                                                              |
| `users.spec.ts`      | nobody listed without a search of three characters; an account's tabs                                                                                                                                                                                                                                                                |
| `saving.spec.ts`     | someone else's change to another field is merged; a clash stops and asks; sample data survives a reload until reset                                                                                                                                                                                                                  |
| `dates.spec.ts`      | a date picked from the panel's calendar with its time; month navigation and "Dziś"; a typed date, and a date that does not exist refused; clearing; the calendar inside an editor window                                                                                                                                             |
| `json.spec.ts`       | "Podgląd JSON…": no differences when nothing changed; only the changed properties for unsaved content, a staged plan change, a workout and a badge; everything for something new                                                                                                                                                     |
| `media.spec.ts`      | a picture uploaded from the computer straight into a form field and into an image block; a file of the wrong type refused                                                                                                                                                                                                            |
| `content.spec.ts`    | content edited in the form: add a block, preview, JSON of what is saved; bold on and off, a link made, edited and opened in a new tab, an unsafe address refused, Enter as a line break, pasted text arriving plain; "Wklej gotowy tekst…" behind its button; an unedited block is not a change; unsaved content asks before closing |
| `devlog.spec.ts`     | developer mode: every backend call listed with parameters, answer and status; a failed call turns the button red until looked at; switching the mode off                                                                                                                                                                             |

## When one fails

Read the first lines of the failure: Playwright prints what it was waiting for. The folder named in
"Error Context" holds a screenshot and the page as a screen reader sees it. A test that fails only
sometimes is a finding, not noise: three such failures while this suite was written were real bugs
(see [docs/TESTING.md](../docs/TESTING.md)).
