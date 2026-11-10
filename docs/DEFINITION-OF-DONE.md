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

| Step | Command | Passes when |
|---|---|---|
| Secrets | `npm run secrets` | no environment or key file, and no text that looks like a key, token or connection string, in anything git would take |
| Types | `npm run typecheck` | `tsc -b` reports nothing; strict mode, no `any`, no `@ts-ignore` |
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
- [ ] No test needs the network, the real clock or the real backend.

## 4. Done: checked in the running app

Tests cover rules. These are checked by hand, in `npm run dev`, in the Test environment:

- [ ] The main flow works from start to end, starting from a fresh page load.
- [ ] **The refusals work too**: empty required field, a save that fails ("Dane testowe…" → fail the
      next save), a save that meets someone else's change.
- [ ] Reload in the middle: the address brings back the same screen, filters and tab.
- [ ] **Phone width (375 px)**: no sideways scroll, every action reachable.
- [ ] Keyboard: every action reachable with Tab and Enter; dialogs close with Esc; focus is visible.
- [ ] Loading shows skeletons; an empty list says what to do next.
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

- **No browser tests.** Playwright is not set up; the hand checks in section 4 stand in for it.
- **No continuous integration.** Nothing runs `npm run check` on push; it is run before pushing.
- **No test coverage number.** Coverage is by rule: everything in `domain/` is tested.
- **No accessibility audit.** Biome's accessibility rules and the keyboard check only.

Each of these is in [RISKS.md](RISKS.md) with what would close it.
