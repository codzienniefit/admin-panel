# Code guidelines

Rules for writing code in this repository, for people and for AI assistants. Each rule has its
reason, because a rule without one gets dropped the first time it is inconvenient.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [DEFINITION-OF-DONE.md](DEFINITION-OF-DONE.md),
[SECURITY.md](SECURITY.md).

## 1. The five that matter most

1. **An entity lives in its collection and nowhere else.** Never copy a challenge or workout into
   `useState`, a context or a module variable. Read with `useLiveQuery`. _Why:_ two copies drift,
   and that is the "state did not update" bug this design exists to prevent.
2. **Every save goes through the saver.** Never call `api.*.save` from a screen. _Why:_ the saver is
   what keeps unknown backend fields, merges with colleagues' changes and holds edits on failure.
3. **A rule is written once, in `domain/`.** Forms, status actions and the mock all call the same
   `…Issues` function. _Why:_ a second copy of a rule will disagree with the first.
4. **Schemas are loose.** `z.looseObject` at every level, never `z.object` or `.strict()` on data
   from the server. _Why:_ a strict schema drops fields a newer backend added, and the next save
   deletes them for real.
5. **Nothing in this repository writes to the real backend on its own.** No test, script or seed.
   _Why:_ there is no staging; the one backend is production ([ROADMAP.md §4](ROADMAP.md)).

## 2. Where code goes

| You are writing | It goes in | It may not |
|---|---|---|
| A rule, a filter, a transformation | `src/domain/`, with a test next to it | import React, collections or the API |
| A component with no knowledge of entities | `src/ui/`, with an entry on `/design` | read a collection |
| A screen or part of one | `src/features/<area>/` | call the API directly |
| An address | `src/routes/` | hold logic: read params and search, render a feature |
| A shape of server data | `src/data/schemas/` | be strict |
| A call to the server | `src/data/api/` | be reached except through `ApiClient` |

A route file is thin on purpose: features take plain props (`filters`, `onChange`, `onOpen`), so
they can be shown on `/design` and tested without a router.

## 3. State

Decide where state lives in this order, and stop at the first that fits:

1. Server data → the collection.
2. Something worth sending to a colleague (filter, tab, open item) → the address.
3. What is being typed in a form → React Hook Form.
4. Local to one component (open, hover) → `useState`.
5. Shared and not server data (toasts, confirm) → a store from `lib/store.ts`.

**Derive, do not store.** If a value can be computed from props and collections during render,
compute it. Do not `useEffect` it into state.

**`useEffect` is for the outside world only**: subscriptions, focus, timers, the document title.
Never to copy props into state or to react to a state change with another state change.

**No `useMemo`, `useCallback` or `React.memo`.** The React Compiler does this. Hand-written
memoisation hides stale-closure bugs and the compiler skips components it cannot prove safe.

## 4. Changing an entity

- Describe the change: `collection.update(id, draft => { draft.title = … })`.
- For challenges use `applyChallengeChange` (`features/challenges/challengeActions.ts`): it checks
  the rules, saves only the fields that differ and returns either "saved" or the problems.
- Send only what changed. A form that writes every field back overwrites a colleague's work.
- Keep unknown data when rebuilding a list:
  `values.map(id => existing.find(item => item.id === id) ?? { id })`, not `values.map(id => ({ id }))`.
- Never build an entity from scratch out of form values for an update. Change the draft.

## 5. Forms

- React Hook Form holds the input; validation is the shared `…Issues` function, not a second schema.
- Map each issue to its field with `form.setError`; issues with no field go in a `Notice` at the top.
- Put `noValidate` on the `<form>`. _Why:_ the browser's own "required" check blocks the submit
  silently and our messages never show (this happened in Phase 4).
- Read form state through `formState`, `watch`, `Controller` in the component body, as the existing
  forms do.
- Anything that discards input asks first (`confirm`). Closing with unsaved input asks first.
- Anything that changes what app users see (publish, hide, delete) asks first, **after** the rules
  pass, so the question only appears when the action can go through.

## 6. Components and styling

- Use what is in `src/ui/` before writing something new. A new shared component gets an entry on
  `/design` in the same change.
- **One dropdown**: `Select` and `MultiSelect`. No native `<select>`, no second popup component.
- **Colour comes from meaning.** Statuses, training types and levels get their label and tone from
  `ui/enums.ts`. Never pick a tone for one of these at the call site.
- Use tokens (`bg-surface`, `text-muted`, `border-line`, `rounded-card`), not hex values or
  arbitrary Tailwind colours.
- Every screen must work at 375 px wide with no sideways scroll. Tables become cards on a phone;
  dialogs become bottom sheets.
- Loading shows a `Skeleton`. An empty list shows an `EmptyState` that says what to do next.
- No raw error text on screen. Throw; the router shows `ErrorScreen`. For a failed action, a toast
  or a `Notice` in plain Polish.

## 7. Text in the interface

- Polish, plain, addressed to a non-technical person. No ids, field names or status codes in
  messages: "Wariant „Początkujący”", not "level beginner".
- Say what happened and what to do: "Nie można opublikować" plus the list of reasons.
- Button labels are verbs: "Zapisz zmiany", "Opublikuj", "Usuń wariant".
- Code, comments, commit messages and documents are in English.

## 8. TypeScript

- Strict. No `any`. No `as` to silence an error; `as` only to narrow after a check, or at a parsed
  boundary.
- Entity types come from schemas: `z.infer<typeof schema>`. Do not write a parallel interface.
- Derive variants with `.omit()` / `.pick()` on the schema, not `Omit<>` on the type. _Why:_ loose
  objects have an index signature, and `Omit` collapses their keys to `string`.
- Parse at the boundary (API responses, pasted JSON, search parameters, `localStorage`). Inside,
  trust the types.
- **Do not name a variable after a browser global** (`name`, `status`, `event`, `length`, `origin`,
  `parent`, `top`, `closed`) and rely on it being declared elsewhere. _Why:_ an undeclared `name`
  typechecks, because `window.name` exists. Lint refuses these.
- A function with more than two parameters of the same type takes an object.

## 9. Tests

- Every file in `domain/` has a test file next to it. Rules and transformations are where the bugs
  that cost money are.
- Test behaviour through the public function, with realistic Polish data.
- The mock has contract tests written against `ApiClient`. They move to the HTTP adapter unchanged
  when it exists.
- Any change to saving or merging adds a test that an unknown field survives.
- Tests run in Node, with no network and no real clock where time matters (inject `now`, `sleep`).
- A bug fix comes with the test that would have caught it.

## 10. Comments and names

- A comment says **why**, or what cannot be seen from the code. Not what the next line does.
- A file that is the one place for something says so at the top ("The one path every save takes").
- Names are whole words. Components are nouns (`ChallengeCard`), actions are verbs
  (`applyChallengeChange`), rule functions end in `Issues`, hooks start with `use`. A function that
  is not a hook must not start with `use`.

## 11. Dependencies

- Adding one needs a reason a reviewer would accept, and a look at its size and maintenance.
- Prefer what is installed. The stack list is in [ARCHITECTURE.md §3](ARCHITECTURE.md).
- `npm audit` must stay clean ([DEFINITION-OF-DONE.md](DEFINITION-OF-DONE.md)).
- No analytics, fonts, scripts or images from other sites. The Content Security Policy blocks them
  anyway ([SECURITY.md](SECURITY.md)).

## 12. Security rules for code

Short form; the reasons are in [SECURITY.md](SECURITY.md).

- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. Content with tags is parsed
  into segments (`domain/contentBlocks.ts`) and rendered as React elements.
- A link built from data must be `http:` or `https:`. A redirect target goes through
  `sanitizeRedirect`.
- No secret in the client: not in code, not in `VITE_*` variables. Anything in the bundle is public.
- No token or personal data in `localStorage`, in an address, or in a log.
- File uploads are checked by `uploadProblem` and named by `uploadPath`. Never use a file's own
  name as a path.

## 13. Git and deployment

- Michał commits and pushes. A push deploys. Assistants leave changes in the working tree and never
  run `git commit`, `git push` or `wrangler deploy`.
- `npm run check` must pass before a change is called done.
- Generated files are not edited by hand: `src/routeTree.gen.ts`, `worker-configuration.d.ts`.
