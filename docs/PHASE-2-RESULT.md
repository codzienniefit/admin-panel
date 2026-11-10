# Phase 2 result

2026-11-10. Phase 2 of [PLAN.md §7](PLAN.md): workouts and media, the first complete section. Test
environment only: sample data, no network.

## Done when, and whether it is

The plan's criterion is every item under "Treningi" in the
[parity checklist](research/retool-inventory.md).

| Retool function | In the panel |
|---|---|
| List with all columns | yes, with thumbnails and coloured tags; cards on a phone |
| Filter | yes: search, status, type, level, order, all kept in the address |
| Refresh | not needed; the list is live |
| Create, edit | yes |
| Hide / unhide | yes, as statuses: draft, published, hidden, trash |
| Paid | yes |
| Level, duration, equipment, types | yes |
| Added, live and premiere dates | yes |
| Completion badge | yes (badges are read-only sample data until Phase 7) |
| Pick thumbnail, upload image | yes |
| Pick audio, play audio, upload audio | yes |
| YouTube link | yes, as a field. **No inline preview**: it would load from YouTube, and Test makes no network requests. Comes with Produkcja |
| Description | **not editable yet**: the block editor is Phase 3. The description is shown as a count and passes through saves untouched |

New compared with Retool: drafts that can be saved incomplete, a trash with restore, a real conflict
flow, "used in" on every workout, and delete refused while a challenge uses the workout.

Checked by `npm run check` (typecheck, lint, 94 tests, production build) and by walking the flows in
a browser.

## What was built

**Workouts** (`src/features/workouts/`)
- **List** at `/workouts`. Filters and order are in the address, so a filtered list can be sent to
  someone. Search ignores Polish characters and word order.
- **Editor** opens over the list at `/workouts/W12` or `/workouts/new`; the list stays in place
  behind it. On a phone it is a full-height sheet.
- **One set of rules** (`src/domain/workoutRules.ts`) is used by the form and by the mock server, so
  they cannot disagree. A draft needs only a name. Publishing or hiding needs name, level, type,
  thumbnail and a duration inside the configured range. A film and an audio file together are
  refused at any status.
- **Problems show next to their fields.** Trying to publish an empty form marks four fields at once.
- **Status actions**: Zapisz szkic, Opublikuj, Zapisz zmiany, Ukryj, Cofnij do szkicu, Usuń,
  Przywróć jako szkic. Which ones appear depends on the current status.
- **Delete** asks first, moves the workout to the trash, and is unavailable while a challenge uses
  it. The trash is the status filter "Kosz".
- **Closing with unsaved changes** asks first.

**Conflicts in a form**
- A save sends only the fields that changed. If someone else changed a different field in the
  meantime, both are kept and the toast says so.
- If someone else changed the same field, the save stops and a notice names the field. The form
  keeps what was typed; "Nadpisz moimi zmianami" saves it, "Zostaw wersję z serwera" loads theirs.
- This notice is one shared component, also used by the planner test.

**Media** (`src/features/media/`)
- **Library** at `/media`: five folders (Treningi, Wyzwania, Wiadomości, Odznaki, Audio), search,
  thumbnails for pictures, a play button for audio.
- **Upload** with the Retool limits: webp only for pictures (250 kB for workouts, 300 kB for
  challenges and messages, 50 kB for badges); m4a, m4v, mp3 and wav up to 200 MB for audio. A file
  that breaks a rule is refused before anything is sent, with the reason.
- **Progress bar**, a cleaned-up file name, and no overwriting: a taken name gets a number and the
  toast says which name was used.
- **Picker**: the same library in a dialog, opened from the workout form.

**Sample data**
- 150 workouts, 25 challenges, about 280 media files, generated from a fixed seed.
- **Edits now survive a reload.** They are kept in the browser until reset.
- **Account menu → "Dane testowe…"**: slow server, fail the next save, make the next save meet
  someone else's change, switch to the large dataset, restore the starting data.
- **Large dataset**: 2,000 workouts, 300 challenges, about 3,900 media files.

**Components added**: multi-select, clearable select, date-and-time field, the shared held-edits
notice. All on `/design`.

## Speed at the large dataset

Measured in the development build, in the browser pane:

| | |
|---|---|
| Workouts in the list | 1,940 (60 are in the trash) |
| Search, per keystroke | 2–59 ms |
| Memory | about 90 MB |

Lists render 50 rows (60 media files) at a time with a "Pokaż kolejne" button. That keeps them fast
without virtual scrolling; see below.

## A bug found and fixed on the way

A dialog opened from inside another dialog (the media picker over the workout form, or a
confirmation over it) stayed in the page after closing: invisible, but on top and swallowing clicks.
The shared `Dialog` now removes itself once closed. The preview pane was hidden at the time, which
pauses animations and may be what triggered it; the fix holds either way.

## Not done, or not verified

- **Deployment is still unverified**; nothing has been pushed.
- **Playwright is still not set up.** Its browser download is large and the connection here was
  slow. The flows were walked by script in the preview pane instead; the logic is covered by the 94
  tests.
- **No virtual scrolling.** Long lists page in steps of 50. Fine for search-driven use; a reason to
  revisit if someone needs to scroll through thousands of rows.
- **Screens were checked by reading the page**, not by eye; the pane's screenshots lag. Please look
  at the workouts list, the editor, and the media library yourself, on desktop and phone width.
- **JavaScript is about 356 kB gzipped** in total, up from 290. The form library, the editor and the
  media library are in route chunks that load on demand; the first screen loads about 290 kB.
- **Uploaded pictures over 400 kB and all uploaded audio are not kept across a reload** in Test
  (they are listed, with a placeholder). Browser storage is too small for them.

## Departures from the plan

| Plan | Built | Why |
|---|---|---|
| React Hook Form with a Zod resolver | React Hook Form with the shared rule function | One rule set for form and server; a second schema would duplicate it |
| TanStack Table and Virtual | The existing Table component with paging | Enough for this list; no new dependency until it is needed |
| Stress media: 5,000 files | about 3,900 | One picture per workout plus extras; same order of magnitude |
| Conformance tests in one suite for any adapter | Contract tests against the mock, written against the `ApiClient` interface | The HTTP adapter does not exist yet; the tests move over when it does |
