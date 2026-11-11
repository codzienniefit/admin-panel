# Definition of ready and done

When a piece of work may start, and when it may be called finished. Applies to every change,
whoever or whatever writes it.

Related: [CODE-GUIDELINES.md](CODE-GUIDELINES.md), [SECURITY.md](SECURITY.md),
[ROADMAP.md](ROADMAP.md).

## 1. Ready: before starting

A piece of work is ready when all of these can be answered. If one cannot, ask first.

- [ ] **What the person using the panel will be able to do** afterwards, in one or two sentences.
- [ ] **How it will be checked**: the steps someone can walk through, or the parity items it covers
      in [research/retool-inventory.md](research/retool-inventory.md).
- [ ] **Which data it touches**: sample data only, or the real backend. If the real backend:
      read-only or writing, and on which `[TEST]` items ([ROADMAP.md §4](ROADMAP.md)).
- [ ] **What it needs from the backend**, and whether that exists
      ([BACKEND-SCOPE.md](BACKEND-SCOPE.md)). If it does not, the work is built on the mock and says so.
- [ ] **What is out of scope**, so it is not built by accident.
- [ ] **Whether app users could see a difference.** If yes, Michał has said so explicitly.

## 2. Done: the automatic gate

One command, and it must pass with no warnings waved through:

```bash
npm run check
```

**After every big set of changes, run everything, locally:**

```bash
npm run test:all
```

That is `npm run check` plus the browser tests (72 of them; about a minute in all). There is no continuous
integration and none is planned for now (decided 2026-11-11), so this local run is the only thing
that runs the tests. "Big" means: a phase or a feature, a refactor across several files, anything
that touches saving, the planner or a shared component, a dependency update, and always the last
thing before handing work over for a push. A one-line fix needs `npm run check` only.

| Step | Command | Passes when |
|---|---|---|
| Secrets | `npm run secrets` | no environment or key file, and no text that looks like a key, token or connection string, in anything git would take |
| Types | `npm run typecheck` | `tsc -b` and the UI tests' own type check report nothing; strict mode, no `any`, no `@ts-ignore` |
| Lint and format | `npm run lint` | Biome reports nothing: recommended rules, unused imports and variables are errors, browser globals such as `name` are refused |
| Tests | `npm run test` | every Vitest test passes; none skipped or marked `.only` |
| Build | `npm run build` | the production build succeeds |

And one more, run when dependencies change and before every push:

```bash
npm audit
```

Passes when it reports 0 vulnerabilities. A finding is fixed, or written down in
[SECURITY.md](SECURITY.md) with the reason it does not apply.

## 3. Done: tests

- [ ] New or changed logic in `src/domain/` has tests next to it.
- [ ] A bug fix has the test that would have caught it.
- [ ] A change to saving, merging or a schema has a test that **an unknown field survives**.
- [ ] A new rule is tested for the draft case (allowed incomplete) and the published case (refused).
- [ ] A change to the mock's behaviour is covered in `data/api/mock/mock.test.ts`.
- [ ] A new planner operation has a test that its inverse undoes it.
- [ ] Date logic passes in another time zone too: `TZ=America/Los_Angeles npx vitest run src/domain`.
- [ ] No test needs the network, the real clock or the real backend.
- [ ] A change to a screen passes the UI tests: `npm run test:ui` (72 tests, about 30 seconds, Test
      environment only; see [TESTING.md](TESTING.md)).
- [ ] A new screen, or a new thing a person must be able to rely on, has a UI test
      ([e2e/README.md](../e2e/README.md) says how to write one).
- [ ] A screen that checks rules or saves waits until the lists it reads have loaded. Three bugs of
      exactly this kind were found on 2026-11-11.

## 4. Done: checked in the running app

Tests cover rules. These are checked by hand, in `npm run dev`, in the Test environment:

- [ ] The main flow works from start to end, starting from a fresh page load.
- [ ] **The refusals work too**: empty required field, a save that fails ("Dane testowe…" → fail the
      next save), a save that meets someone else's change.
- [ ] Reload in the middle: the address brings back the same screen, filters and tab.
- [ ] **Phone width (375 px)**: no sideways scroll, every action reachable.
- [ ] Keyboard: every action reachable with Tab and Enter; dialogs close with Esc; focus is visible.
- [ ] Anything that can be dragged can also be done from its "⋯" menu, and both give the same result.
- [ ] On a published item, a change that app users would see waits for an explicit save and asks
      first; nothing of that kind saves by itself.
- [ ] Loading shows the page spinner (`<Loading />`); an empty list says what to do next.
- [ ] No errors in the browser console.
- [ ] New or changed shared components appear on `/design`.
- [ ] With the large dataset ("Dane testowe…" → large): lists and search still feel instant.

## 5. Done: security and data safety

- [ ] Nothing from the checklist in [SECURITY.md §6](SECURITY.md) is violated.
- [ ] No secret, token, real e-mail address or real user id in code, tests, fixtures or documents.
- [ ] The change makes **no request to the real backend** unless that was the stated purpose, and
      then only as agreed under "Ready".
- [ ] Anything that changes what app users see asks for confirmation first.
- [ ] Anything that discards the user's input asks first, or can be undone.
- [ ] Personal data (the Users section) is not added to browser storage, logs or exports.
- [ ] If the change adds a place the panel loads something from (API host, image host, video
      embed), `public/_headers` is updated and the reason is in [SECURITY.md](SECURITY.md).

## 6. Done: written down

- [ ] The interface text is plain Polish, with no ids or field names in messages.
- [ ] If the change finishes a phase: a `PHASE-N-RESULT.md` with what was built, what was **not**
      done or not verified, and departures from the plan.
- [ ] If the change makes a document wrong ([ARCHITECTURE.md](ARCHITECTURE.md),
      [PLAN.md](PLAN.md), the README), the document is corrected in the same change.
- [ ] A new risk or an accepted shortcut is added to [RISKS.md](RISKS.md).

## 7. Done: handed over

- [ ] The work is left in the working tree. **No commit, no push, no deploy** by an assistant.
- [ ] The hand-over says: what changed, what to look at, and plainly what was not checked.

## 8. After a push (Michał)

A push deploys. The check for every deployment is the five in [ROADMAP.md §2](ROADMAP.md): looks,
speed, scale, correctness, rollback. On the first deployment, and after any change to hosting
files (`wrangler.json`, `public/_headers`, `worker/`), also:

- [ ] `/api/health` answers `{"ok":true}`.
- [ ] A deep link (for example `/challenges/C1/content`) opens directly, not only from the list.
- [ ] The response headers include `Content-Security-Policy` (browser developer tools → Network).
- [ ] The browser console shows no "Refused to load" messages while walking the panel.

## 9. What "done" does not mean yet

Stated so that nobody assumes more than is true:

- **Browser tests cover the basic paths only**: 72 tests in Chromium with a mouse. Not touch, not
  other browsers, not every screen in depth; the hand checks in section 4 still apply.
- **No continuous integration, on purpose.** Nothing runs the tests on push. They are run locally,
  with `npm run test:all`, after every big set of changes (section 2).
- **No test coverage number.** Coverage is by rule: everything in `domain/` is tested.
- **No accessibility audit.** Biome's accessibility rules and the keyboard check only.

Each of these is in [RISKS.md](RISKS.md) with what would close it.
