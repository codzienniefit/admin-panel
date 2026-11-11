# Testing

How the panel is tested, what each kind of test is for, and what the tests have found.

Related: [DEFINITION-OF-DONE.md](DEFINITION-OF-DONE.md), [CODE-GUIDELINES.md §9](CODE-GUIDELINES.md),
[e2e/README.md](../e2e/README.md).

## 1. Three kinds

| Kind | Command | Where | Count (2026-11-11) | For |
|---|---|---|---|---|
| Unit tests | `npm run test` | `src/**/*.test.ts`, next to the code | 1216 in 47 files, about a second | rules, merging, the saver, planner operations, dates, the pretend server |
| Guideline guard | part of `npm run test` | `src/conventions.test.ts` | 8 | keeps the written guidelines true by reading the source |
| UI tests | `npm run test:ui` | `e2e/*.spec.ts` | 72 in 16 files, about 30 seconds | the basic things a person does, in a real browser |

`npm run check` runs the secrets scan, both type checks, lint, the unit tests and the production
build. `npm run test:all` adds the UI tests. Neither needs the network or any backend.

**When:** `npm run check` before any change is called done; `npm run test:all` after every big set
of changes and before handing work over for a push. Always locally: nothing runs them on push.

## 2. No test can touch real data

There is no staging backend; the one backend is production. So:

- Unit tests run in Node against the in-process pretend server, with injected clocks.
- UI tests run in the panel's **Test** environment only: every browser is started with it selected,
  and any request that would leave the machine is refused and fails the test. This is set once, in
  `e2e/support/`, not in each spec.
- Nothing in the repository holds a credential for the real backend, and `npm run secrets` checks it.

## 3. What the guideline guard refuses

`src/conventions.test.ts` fails, naming the files, when:

- a component (`.tsx`) contains `try` (use `attempt`, `whileBusy`);
- a file in `src/domain/` has no test next to it;
- `localStorage` is used outside `src/lib/storage.ts`;
- a schema uses `z.object(` or `.strict(`;
- anything uses `dangerouslySetInnerHTML`, `innerHTML`, `eval(` or `new Function(`;
- a screen imports the API client directly instead of going through a collection.

## 4. What the UI tests found the day they were written

Each is fixed, and each has a test that fails without the fix.

| Found | Cause | Fix |
|---|---|---|
| Saving a challenge's content right after opening its page was refused, with every workout of the plan listed as "Nieznany workoutId" | the rules ran before the workout list had loaded; the "lists are loaded" flag was always true | the flag now follows the real loading state, and a challenge's tabs wait for it (`useChallengeRules`, `ChallengeLayout`) |
| "Ukryj", "Cofnij do szkicu" and "Usuń" on a challenge could be refused the same way | only "Opublikuj" waited for the lists | all status actions wait |
| A day note added in the first moment after the planner opened disappeared without a word | the planning document had not loaded; the step was dropped | the tabs wait for it, and the planner refuses such a step with a reason instead of dropping it (`plannerSession`) |
| The calendar was wider than a phone screen | a long title in the "Bez daty" list stretched the page | the page's single column may shrink |
| The refusal for a missing workout showed a field name | "Nieznany workoutId: W1" | "Wariant „…”, dzień 2: trening W1 nie istnieje" |

The same cause was fixed in the workout editor before it was seen: a workout's badge is not
checked in the browser until the badge list has arrived (the server checks it either way).

## 5. Not covered

- **Touch.** Dragging is tested with a mouse. A real phone has not been tried (RISKS R43).
- **Browsers other than Chromium.** Add a project in `playwright.config.ts` when it matters.
- **The real API and real sign-in.** They do not exist yet. The mock's contract tests are written
  against `ApiClient` and move to the HTTP adapter unchanged.
- The content block editor in depth (reordering, links, pasted JSON), dropping a file onto a field,
  the calendar's drag.
- **Nothing runs these on push.** There is no continuous integration, by decision (2026-11-11).
  The rule instead: run `npm run test:all` locally after every big set of changes
  ([DEFINITION-OF-DONE.md §2](DEFINITION-OF-DONE.md)).
