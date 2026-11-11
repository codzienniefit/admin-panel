# Phase 6 result

2026-11-11. Phase 6 of [PLAN.md §7](PLAN.md): plan types and requirements, preparation status,
training-type styles, folders, and the challenge calendar. Test environment only.

Checked by `npm run check` and by walking the screens in a browser at desktop and phone width.

## What was built

**Settings** at `/settings` (`src/features/settings/`), shared by the whole team

| Tab | What it does |
|---|---|
| Rodzaje planów | Plan types with the rules their weeks must meet: add, edit, delete. Shows how many variants use each. The five defaults come from Patryk's app |
| Typy treningów | Colour and emoji per training type. The types themselves come from the backend configuration. Saving reloads the panel, so the new look is everywhere |
| Foldery | Add, rename, delete. Deleting a folder moves its challenges to "Bez folderu"; the challenges stay |

**Requirements**
- Eight kinds of rule: limit, minimum, range, rest days after, minimum gap, maximum within a
  window of days, minimum rest days, maximum per day. Each can apply to all workouts or to one
  training type; limit and range can count training days instead.
- The planner frames each week green ("✓ Spełnia wymagania") or red ("⚠ N wymagań niespełnionych")
  and lists every rule with pass or fail.
- With no rules: the default "2–3 workouts a week", as in Patryk's app.
- **Per challenge** (`/challenges/C1/requirements`, the new tab "Wymagania"): change the rules of a
  plan type for this challenge only, restore the shared ones, and keep plan types that exist only
  in this challenge.

**Variants**
- "Ustawienia wariantu" now has a "Planowanie" part: plan type, preparation status (Niezaczęty,
  W przygotowaniu, Gotowy) and "Czego brakuje do gotowości".
- The Przegląd tab shows them per variant, with a coloured edge by status.
- A "Planowanie" card on Przegląd: folder, calendar colour, internal note.

**Folders on the list**: a folder filter on `/challenges`, kept in the address.

**Calendar** at `/challenges/calendar` (`src/features/calendar/`)

| Feature | How it works |
|---|---|
| Month | Monday first; weekends shaded; public holidays in red with their name; today marked |
| Bars | Each challenge is a coloured bar across its days and keeps its row across weeks. More than four in a week collapse into "+N więcej" |
| Move by dragging | Drag a bar to another day. A confirmation shows the old and the new date and the new end, and warns when the challenge is published. Only then is it saved |
| Year | Twelve small months; a day takes the colours of the challenges running on it (up to three stripes) |
| Bez daty | Challenges with no date, with "Ustaw datę" |
| Phone | The month as a list; dates are changed in the Treść form |
| Address | View, year and month are in the address |

A challenge sits on its premiere date; without one, on "Widoczne od" (decision 4). Giving an
undated plan a date sets "Widoczne od", never the premiere date, because a premiere date turns a
plan into a live challenge.

## Decisions taken that need a yes

| Decision | What was built | Ask |
|---|---|---|
| 11: "min. N dni między" counted differently inside a week and across a week boundary in Patryk's app | Counted the same way everywhere: the distance in days, so Monday and Tuesday are 1 apart, and so are Sunday and the next Monday | Patryk |
| 4: which date places a challenge on the calendar | Premiere, else "Widoczne od" | Michał |
| 24 December | Treated as a public holiday from 2025 | no one; it is the law |

## Tests

| File | Covers |
|---|---|
| `weekValidation.test.ts` (48) | every kind of rule passing and failing, across week boundaries, a short last week |
| `calendarDates.test.ts` (34) | local days, daylight-saving boundaries, Easter 2025–2027, holidays; passes in several time zones |
| `challengeCalendar.test.ts` (31) | rows for overlapping challenges, clipping at week edges, overflow, year colours |
| `calendarItems.test.ts` | which date places a challenge; moving keeps the time of day |
| `conditions.test.ts`, `planningRules.test.ts` | tidying and checking rules, plan types, folders, colours |
| `workoutSearch.test.ts` (32), `planCsv.test.ts` (34) | ranking and synonyms on 2,000 workouts; CSV format and the formula-injection guard |
| `mock/planning.test.ts` | the planning and settings endpoints: etags, conflicts, unknown fields, persistence |

## Not done, or not verified

- **The bar does not re-flow live while dragging** (Patryk's app re-laid the rows during the drag).
  The target day is highlighted and the confirmation states the result.
- **No day popover in the year view.** A click opens that month.
- **Folders do not group the card list into sections**; they filter it.
- **Colour changes need a reload of the panel**, done automatically after saving.
- **Preparation status is not on the challenge cards of the list**, only on Przegląd.
- **Where planning data lives on the backend** is still open (decision 3). The mock keeps one
  document per challenge and one settings document; that shape is the proposal.
- **Deployment of this phase is unverified.**

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| Training-type colour as any hex | One of the panel's ten tones | The same type must look the same on every screen; tones carry text and background colours that stay readable |
| `/settings/admins` | Not built | Needs backend B0.5 |
