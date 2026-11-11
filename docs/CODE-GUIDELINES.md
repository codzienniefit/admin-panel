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
| A collection of an entity saved with an etag | `src/data/collections/`, built with `createVersionedCollection` | wire its own saver |
| A call to the server | `src/data/api/` | be reached except through `ApiClient` |
| An area of the mock server | its own module in `src/data/api/mock/`, built on `kernel.ts` | keep its own clock, etags or storage |

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

**Keep `try` out of new components.** The compiler leaves a component with `try/finally`
uncompiled: it still works, it just re-renders more. Use `attempt` and `whileBusy` from
`ui/tasks.ts`; in forms use `useWatch`, not `form.watch()`. No component contains a `try`, and a
test keeps it that way.

**Do not check rules or save before the lists the rules read have loaded.** A live query gives an
empty list while it loads, so a rule that asks "does this workout exist?" answers no for all of
them. Use the hook's `ready` (`useChallengeRules`, `useBadgeAssignments`) or `isLoading`, and show
the loading mark (`<Loading />`) or disable the action until then.

## 4. Changing an entity

- Describe the change: `collection.update(id, draft => { draft.title = … })`.
- A button that saves with no form around it wraps the save in `saveOrToast`; a screen with its own
  place for problems uses `settleChange`. Both leave a conflict or a failed save to
  `HeldEditsNotice`. Do not write `try`/`catch` around a save.
- For a save that is a deliberate click, use `applyChange` (`features/saving/applyChange.ts`) or
  the entity's wrapper around it (`applyChallengeChange`, `applyPlanningChange`,
  `applySettingsChange`): it checks the rules, saves only the fields that differ and returns either
  "saved" or the problems. Do not write that sequence again in a screen.
- In the planner, a change is a **step**: a list of reversible operations from
  `domain/plannerOps.ts`, handed to `dispatchStep`. That gives it undo, autosave or staging, and
  the refusal message, for free. A new kind of planner edit is a new operation with its inverse and
  a test that the inverse undoes it.
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
  `/design` in the same change. What exists, by job:

  | Job | Use |
  |---|---|
  | A list screen: heading, main button, filters, count | `ListPage`, `SearchInput` |
  | "This part is still loading" | `Loading` (`ui/Loading.tsx`): draws nothing itself, the page shows one spinner |
  | One file from the media library: pick, upload from the computer, or drop | `MediaField` in a form, `MediaSlot` elsewhere |
  | A picture from the media library | `MediaImage` |
  | A preview of what the app shows | `ContentPreview` inside `PhoneFrame` (a 375-point screen, so text wraps as it will there) |
  | Rows that become cards on a phone | `Table` |
  | Problems from the rules: next to fields, or in a notice | `placeIssues`, `IssuesNotice` (`formIssues.tsx`) |
  | Tabs, an either-or switch | `Tabs`, `Segmented` |
  | Read-only label and value pairs | `Facts` |
  | Editor frame pieces: placeholder, "discard changes?", "Więcej" menu | `EditorParts.tsx` |
  | A small panel next to a button | `Popover` |
  | The twelve planner colours | `ColorPalette` |
  | A workout as a card | `WorkoutCard` |
  | Picking and uploading a picture or audio | `MediaField` |
  | Content blocks with the phone preview | `ContentField`, `ContentPreview` |
  | "Someone else changed this" and failed saves | `HeldEditsNotice` |
  | "Leave without saving?" on Back, a link or closing the tab | `useUnsavedGuard` |
  | An async handler in a component ("save", "send") | `attempt`, `whileBusy` (`ui/tasks.ts`) |
  | Something kept across reloads on this device | `readStored`, `writeStored` (`lib/storage.ts`) |
  | Copying a text | `copyText` (`lib/clipboard.ts`) |
  | The text of a failure | `errorMessage` (`data/api/errors.ts`) |
  | A dialog that is rendered only while open | `Dialog` with `onClose` |
  | A date, or a date and time | `DateField`, `DateTimeField` (`ui/DateField.tsx`) |
  | JSON on screen | `JsonView` (`ui/JsonView.tsx`) |
  | "What will be sent?": before, after, differences | `useJsonPreview`, `previewChange` (`features/saving`) |
  | The brand | `Logo`, `LogoMark` (`ui/Logo.tsx`) |
- **One dropdown**: `Select` and `MultiSelect`. No native `<select>`, no second popup component.
- **One date field.** No `type="date"`, `datetime-local` or `time` inputs: the browser draws them in
  its own language and style. `DateField` shows and accepts "DD.MM.RRRR GG:MM" and opens the
  panel's calendar (react-day-picker, styled in that one file). Parsing what is typed lives in
  `domain/calendarDates.ts`.
- **Every editor of a saved entity offers "Podgląd JSON…"** in its "Więcej" menu, built with
  `useJsonPreview` from the same change the save applies (`previewChange`), so the preview cannot
  drift from what is sent. The differences come from `domain/jsonDiff.ts`.
- **A list shows everything its filters match.** No "show more", no pages: the catalogue is
  hundreds of items, and a row that is not on screen reads as a row that does not exist. (The user
  search is the exception, on purpose: personal data, at most 20 results.)
- **Editing happens in the form, not in a window on top of it.** A second dialog over an editor is
  for a short question or a picker, never for a part of the form: people lose track of where they
  are and close the wrong thing.
- **Colour comes from meaning.** Statuses, training types, levels and preparation statuses get
  their label and tone from `ui/enums.ts`. An enum only one section shows (message status, badge
  type) is decided the same way in that section's `…Meta.ts` file. Never pick a tone for an enum
  value at the call site.
- Use tokens (`bg-surface`, `text-muted`, `border-line`, `rounded-card`), not hex values or
  arbitrary Tailwind colours.
- Every screen must work at 375 px wide with no sideways scroll. Tables become cards on a phone;
  dialogs become bottom sheets.
- Loading is `<Loading />`, never grey placeholder blocks: one spinner in the middle of the page
  for everything that is loading. An empty list shows an `EmptyState` that says what to do next.
- Blocks of content ("fancy content") are edited with `ContentField`, in the form itself: block
  list, "Wklej gotowy tekst…" behind a button, preview with a JSON view. One component for
  workouts, challenges and messages; give it the full width of its card. Text in a block is
  edited as rich text (bold, links), never as visible tags; what is stored stays one string with
  `<b>` and `<a href>`, converted by `domain/richText.ts` without going through HTML.
- Every call to the backend goes through the register in `data/api/callLog.ts` (developer mode,
  the `</>` button in the top bar). A new `ApiClient` method is logged without any extra code.
- No raw error text on screen. Throw; the router shows `ErrorScreen`. For a failed action, a toast
  or a `Notice` in plain Polish.
- **Anything that can be dragged can also be done from a menu.** Dragging is a shortcut, never the
  only way: touch screens, keyboards and screen readers use the menu. Start drags with
  `useDragSensors`, so a click stays a click and a swipe still scrolls.
- A colour that comes from data goes into a `style` attribute only after `isHexColor`.

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
- The basic things a person does are covered by UI tests in `e2e/` (Playwright, Test environment
  only). They find elements by role and visible name, never by class or test id; how to write one
  is in [e2e/README.md](../e2e/README.md).
- `src/conventions.test.ts` checks the rules of this document that can be checked by reading the
  source. When it fails, fix the code, not the guard.
- Anything about dates is tested with local days (`domain/calendarDates.ts`), never with
  `new Date("YYYY-MM-DD")`, and should pass in another time zone
  (`TZ=America/Los_Angeles npx vitest run`).

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
- **After every big set of changes, run `npm run test:all` locally** (the checks plus the browser
  tests) and report the result. There is no continuous integration, by decision, so nothing else
  runs the tests. What counts as big: [DEFINITION-OF-DONE.md §2](DEFINITION-OF-DONE.md).
- Generated files are not edited by hand: `src/routeTree.gen.ts`, `worker-configuration.d.ts`.
