# Phase 5 result

2026-11-11. Phase 5 of [PLAN.md §7](PLAN.md): the planner. Test environment only: sample data, no
network.

Checked by `npm run check` and by walking the flows in a browser at desktop and phone width,
including real drag and drop.

## Done when, and whether it is

The plan's criterion: a four-week plan with two variants can be built from scratch on desktop,
corrected on a phone, and survives a forced conflict without losing edits.

| Part of the criterion | State |
|---|---|
| Build a plan from scratch on desktop | yes: add from the catalogue or as a draft workout, drag between days, notes, colours, scratchpad |
| Two variants | yes: switch variants in the toolbar; copying a variant copies its day notes and colours |
| Correct it on a phone | yes: one week at a time with a week switcher; every drag action is also in the "⋯" menu |
| Survive a forced conflict | yes, for both documents: the schedule and the planning notes. Covered by tests and by "Dane testowe…" |

## What was built

**The plan of a variant** at `/challenges/C1/plan/p-easy` (`src/features/planner/`)

| Feature | How it works |
|---|---|
| Weeks | Stacked, seven days each; the last week may be shorter. Totals per week and per day |
| Dates | Each day shows its calendar date when the challenge has a premiere date; public holidays in red |
| Workout cards | Title, training types with emoji, duration, format (Wideo, Audio, Rozpiska). A workout that is not published shows its status, because it blocks publishing |
| Add a workout | A dialog with search (word order and Polish letters ignored, synonyms such as "brzuch" → "core"), type filter, optional duration range. It stays open, so several can be added |
| Draft workout | "Utwórz szkic treningu" in the same dialog: name, minutes, types. It lands in the workout catalogue as a draft |
| Drag and drop | Between days; day → scratchpad moves; scratchpad → day copies; a day's note can be dragged to another day. Mouse, touch (press and hold) and keyboard |
| Without dragging | Every card has "⋯": Przenieś do…, Kopiuj, Do brudnopisu, Wyżej, Niżej, Usuń z dnia. Every day has "⋯": Dodaj, Wklej, Notatka i kolor, Wyczyść dzień |
| Notes and colours | A note and a tint per day; a note and a colour per placed workout. They travel with the workout when it moves |
| Scratchpad | Shared by all variants of the challenge |
| Notes to the plan | Free text per variant, saved as you type |
| Undo and redo | 50 steps; one user action is one step even when it touches several things (a move to the scratchpad undoes as one). Ctrl/⌘+Z, Ctrl/⌘+Shift+Z. Inside a text field the keys undo typing, not the plan |
| Requirements | Each week is framed green or red by the rules of the variant's plan type, with the list of rules on click (Phase 6) |
| CSV | "Eksportuj CSV" for a variant; for all variants from the challenge's Przegląd tab |
| Recently opened | A menu of the last six plans, remembered on this device |
| Limit | Three workouts a day, as in Retool, until the app team confirms more (open decision 10) |

**Saving** follows who can see the change (decision 2):

| What changed | Saved |
|---|---|
| Notes, colours, scratchpad | by itself, 1.2 s after the last change |
| Days of a **draft** challenge | by itself, the same way |
| Days of a **published or hidden** challenge | only on "Zapisz zmiany", after a confirmation, because app users see it at once. "Odrzuć zmiany" puts the plan back. Leaving the page asks first. The challenge's status buttons wait until then. If the server refuses the save, the changes stay staged and its reasons are shown |

A plan in the trash is read-only.

**Under it**
- `src/domain/plannerOps.ts`: every change is a small reversible operation; a user action is a
  list of them. 13 tests.
- `src/features/planner/plannerSession.ts`: applies steps, keeps undo and redo, autosaves or stages.
  18 end-to-end tests against the mock, including the eight from the Phase 0 trial.
- The Phase 0 test editor and its page (`/spike`) are gone; the planner replaced them.

## Reuse added on the way

| New shared piece | Used by |
|---|---|
| `createVersionedCollection` (`data/collections/versioned.ts`) | challenges, workouts, planning, settings; Phase 7 entities |
| Mock server core (`data/api/mock/kernel.ts`): latency, forced failure and conflict, etags, persistence | every area of the mock |
| `applyChange` (`features/saving/applyChange.ts`): check, save what differs, return problems | challenges, planning, settings |
| `WorkoutCard`, `Popover`, `ColorPalette` in `src/ui` | planner, add dialog, calendar, settings; on `/design` |
| `useDragSensors` | planner and calendar |

## Not done, or not verified

- **No thumbnails on the cards in a day.** They are in the add dialog. Seven columns leave little
  room; say if they should be there as in Patryk's app.
- **A workout cannot be dragged to a position inside a day.** A drop appends; "Wyżej" and "Niżej"
  reorder.
- **Edits within 600 ms are not merged into one undo step** (the plan mentioned it). Each action is
  one step.
- **Recording status and format (premiere, live, running)** are not fields of a workout yet: they
  need the backend (scope B3.4).
- **Closing the browser tab within 1.2 s of an edit loses that edit** in Test. The real adapter will
  flush with a keep-alive request.
- **Touch dragging was not tried on a real phone**, only mouse events in the preview pane.
- **Deployment of this phase is unverified**; nothing has been pushed.

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| Card colours and day tints as separate menu entries | One "Notatka i kolor…" dialog per day and per card | Fewer menu entries; note and colour are usually set together |
| Planner tab bar of open variants | A "recently opened" menu | The address decides what is shown (PLAN §4) |
