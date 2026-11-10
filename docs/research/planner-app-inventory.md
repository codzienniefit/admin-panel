# Plan Treningowy — inventory for the web rewrite

Source app: `/Users/mzolnieruk/Downloads/plan-treningowy-app` (Electron 27 + React 18 + Vite 5, plain JS/JSX, version `1.1.260913`).
All paths below are relative to that root. Research was read-only: nothing was run, `.env` was not read.
Runtime deps are only `react`, `react-dom`, `fuse.js`, `date-fns` (the last one is declared but never imported).

Things stated as "inferred from code" were not reproduced in a running app.

Corrections to the brief, up front:

- The scratchpad ("Brudnopis") is **not a side panel**. It is a full-width panel rendered **below** the week list in the plan calendar.
- fuse.js search + synonyms exists **only** for the workout (YouTube) library. There is no search, sort or filter for challenges or plans.
- "YouTube search" never hits the YouTube search API any more. The library is synced into local storage and searched in memory. `src/utils/youtubeSearch.js#searchYouTubeVideos` (live search + mock data) is dead code; only its `formatDuration` is used.
- README advertises PDF export / jsPDF. It does not exist in the code. Export is CSV and `.ptchallenge.json` only.
- There is no "saved" indicator. `SaveStatusBanner` shows only errors and storage-corruption notices; the only positive feedback is the `Zapisywanie…` label on the Back/Save buttons.

---

## 1. Views and navigation

### 1.1 What decides the screen

There is no router. `src/App.jsx` holds three pieces of state and picks one main view (lines 448–479):

```js
const [currentChallenge, setCurrentChallenge] = useState(null);
const [openTabs, setOpenTabs] = useState([]);          // [{ plan, challenge }]  (full object snapshots)
const [activeTabIndex, setActiveTabIndex] = useState(-1);

if (activeTab)              -> <CalendarView key={plan.id} .../>   // plan week editor
else if (currentChallenge)  -> <ChallengeView .../>                // plan list of one challenge
else                        -> <MainView .../>                     // challenge list / challenge calendar
```

Rendered around it, always: `Loader` (splash), `.drag-region` (frameless window bar), `SaveStatusBanner`, and `PlanTabBar` whenever `openTabs.length > 0` (on **all three** views).

`MainView` has an inner tab kept in a module-level object so it survives unmount (`src/components/MainView.jsx:32`):

```js
const mainViewUiState = { tab: 'challenges', mode: 'month', year: null, month: null };
// tab: 'challenges' | 'calendar'; mode: 'month' | 'year' (ChallengeCalendarView)
```

### 1.2 Transitions

| From | Action | To |
|---|---|---|
| MainView | click challenge card / calendar bar / day-popover item | ChallengeView (`setCurrentChallenge`) |
| MainView | segmented control `Wyzwania` / `Kalendarz` | list vs. `ChallengeCalendarView` |
| ChallengeCalendarView | click month title, or `Rok` | year grid; click mini-month title / empty day → month grid |
| ChallengeView | `← Wstecz` | MainView (`setCurrentChallenge(null)`) |
| ChallengeView | click plan card / context menu `Otwórz w zakładce` | CalendarView (adds a tab, or activates the existing tab for that plan) |
| CalendarView | `← Wstecz` | ChallengeView of the tab's challenge. Flushes save first. **Tab stays open.** |
| CalendarView | Plan settings → "Przełącz na inny wariant" | saves current plan, opens the other plan as a tab |
| any | click a tab | CalendarView for that plan |
| any | tab `×` | flush pending saves, remove tab. If it was active: activate the tab to the left; if no tabs remain → ChallengeView of that challenge |
| any | tab bar `+` | picker of not-yet-open plans from the challenges of the open tabs |
| MainView | delete challenge | closes all tabs of that challenge |

There is no direct CalendarView → MainView path (Back twice). Tabs are not persisted across restarts. Limit: `MAX_OPEN_TABS = 6` (`window.alert` on the 7th).

### 1.3 Dialogs and popovers (all are local `useState` flags in the parent)

| Dialog | Opened from | File |
|---|---|---|
| CreateChallengeDialog | MainView `Nowe wyzwanie` | `src/components/CreateChallengeDialog.jsx` |
| Create/rename folder (inline dialogs) | MainView `Nowy folder`, folder `⋮` menu | `MainView.jsx` |
| Import conflict (inline) | MainView `Importuj wyzwanie` when ID exists | `MainView.jsx` |
| SettingsDialog (5 sections) | MainView gear icon only | `SettingsDialog.jsx` |
| SetChallengeStartDateDialog | calendar aside "Bez daty startu" | `SetChallengeStartDateDialog.jsx` |
| Day popover ("+N więcej", year day) | ChallengeCalendarView | `ChallengeCalendarView.jsx` |
| EditChallengeDialog | ChallengeView `Edytuj` | `EditChallengeDialog.jsx` |
| CreatePlanDialog | ChallengeView `Dodaj plan` | `CreatePlanDialog.jsx` |
| EditPlanDialog | ChallengeView plan card pencil / context menu; CalendarView `Ustawienia` | `EditPlanDialog.jsx` |
| ChallengeConditionsDialog | EditPlanDialog (only when opened from CalendarView) | `ChallengeConditionsDialog.jsx` |
| EditPlanTypeDialog | Settings, EditChallengeDialog, ChallengeConditionsDialog | `EditPlanTypeDialog.jsx` |
| EditTrainingTypeDialog | Settings | `EditTrainingTypeDialog.jsx` |
| Copy-plan-to-challenge popover | ChallengeView plan context menu | `ChallengeView.jsx` |
| AddTrainingChooser → TrainingSearchDialog / ManualTrainingDialog | click a day cell, or scratchpad `Dodaj trening` | `AddTrainingChooser.jsx`, `TrainingSearchDialog.jsx`, `ManualTrainingDialog.jsx` |
| EditTrainingDialog (→ TrainingSearchDialog for "Zamień na inny") | click a training card (day or scratchpad) | `EditTrainingDialog.jsx` |
| NoteDialog | day note icon / note preview | `NoteDialog.jsx` |
| Week conditions popover | week ✓/⚠ badge | `CalendarView.jsx` |
| Context menus | right-click: challenge card, plan card, training card, day cell | `MainView`, `ChallengeView`, `DayCell` |

### 1.4 Suggested URL routes

```
/                                   MainView, tab=challenges
/calendar?view=month&y=2026&m=11    MainView, tab=calendar (ChallengeCalendarView); view=year&y=2026
/challenges/:challengeId            ChallengeView
/challenges/:challengeId/plans/:planId     CalendarView
/settings/:section                  plan-types | training-types | workouts-db | youtube | ai
```

Optional modal routes: `/challenges/new`, `/challenges/:id/edit`, `/challenges/:id/plans/new`, `.../plans/:planId/settings`, `.../plans/:planId/conditions`.
Open tabs become client state (e.g. persisted list of `{challengeId, planId}`), independent of the URL; the active tab is whichever matches the current plan route.

---

## 2. Feature inventory (flat checklist)

### App shell — `src/App.jsx`
- [ ] Splash loader: logo + title + 3 bouncing dots, shown a fixed 2800 ms then 1200 ms fade, unrelated to data loading — `components/Loader.jsx`, `Loader.css`
- [ ] Error banner stack, fixed top-centre: save failure (message + time) and "data file corrupted / restored from backup"; dismissible — `components/SaveStatusBanner.jsx`
- [ ] Plan tab bar: tab = plan name + challenge name (2 lines, ellipsis), `×` closes (flushes save first), `+` opens a picker grouped by challenge; max 6; one tab per plan — `components/PlanTabBar.jsx`
- [ ] Startup: storage corruption check after 1.5 s; silent incremental YouTube library sync after 2 s
- [ ] Before window close: run all registered flushers, wait for save queues, then confirm close — `utils/pendingSaves.js`, `utils/challengeStorage.js#flushPendingChallengeSaves`

### MainView — `src/components/MainView.jsx`
- [ ] Title "Plan Treningowy", gear → Settings
- [ ] Buttons: `Nowe wyzwanie`, `Nowy folder`, `Importuj wyzwanie`
- [ ] Segmented control `Wyzwania | Kalendarz` (remembered while app runs)
- [ ] Challenge grid: unfoldered challenges first (no heading), then one section per folder (heading + `⋮` menu); storage order, no sorting
- [ ] Challenge card: thumbnail (160 px, optional), name, "`N planów • M tygodni`", `×` delete with confirm; click opens
- [ ] Challenge context menu (right-click): move to folder ("Bez folderu" + each folder), `Eksportuj projekt`, `Usuń wyzwanie`
- [ ] Folders: create (default name "Archiwum"), rename, delete (challenges fall back to no folder); empty-folder hint
- [ ] Import `.ptchallenge.json`: validate schema; if ID exists → conflict dialog `Pomiń / Utwórz kopię / Nadpisz` with "newer/older by ~X min/h" message — `utils/challengeProjectTransfer.js`
- [ ] Export project from context menu (same as ChallengeView)
- [ ] Empty state

### Challenge calendar — `ChallengeCalendarView.jsx`, `ChallengeMonthGrid.jsx`, `ChallengeYearGrid.jsx`, `utils/challengeCalendar.js`
- [ ] Toolbar: prev / `Dziś` / next, title ("Wrzesień 2026" or year), `Miesiąc | Rok` switch
- [ ] Month grid, Monday first: weekend shading, Polish holidays (grey bold number, tooltip "Dzień wolny od pracy"), today = red filled circle, outside-month days greyed
- [ ] Challenges as continuous coloured bars across days; stable lanes across weeks; max 4 lanes per week then "`+N więcej`" → day popover listing challenges with date ranges
- [ ] Click bar → open challenge; bar tooltip "name · DD.MM–DD.MM · N tyg."
- [ ] Drag a bar to move the whole challenge (changes `startDate` only; live preview with re-laned bars and new range label; Esc cancels; 4 px threshold)
- [ ] Year grid: 12 mini-months, days filled with challenge colours (1 colour solid, 2–3 as vertical stripes), today ring; click coloured day → popover; click other day/title → that month
- [ ] Aside "Bez daty startu": undated challenges (sorted by name, `pl` collation) → click → start-date dialog (defaults to today, shows computed end date)
- [ ] Empty state

### ChallengeView — `src/components/ChallengeView.jsx`
- [ ] Header: Back, thumbnail (80 px), name, "`N tygodni`"; buttons `Edytuj`, `Eksportuj CSV` (all plans), `Eksportuj projekt`, `Dodaj plan`
- [ ] Plan grid; card border colour = status (ready green / in_progress yellow / not_started red); shows name, "Biegowy" tag for running plans, plan-type name, status label or the "what's missing" note (truncated at 110 chars)
- [ ] Card actions: duplicate ("(kopia)" suffix, new ID), edit, delete (confirm)
- [ ] Plan context menu: `Otwórz w zakładce`, `Duplikuj w tym wyzwaniu`, `Kopiuj do innego wyzwania…` (popover list of other challenges), `Edytuj`, `Usuń`
- [ ] Changing `weeksCount` resizes every plan: appends empty weeks or truncates (confirm if trainings would be lost)
- [ ] Optimistic update with rollback + alert on failed save (`persistChallenge`)
- Note: challenge `description`, `note`, `startDate`, `color` are **not displayed** here; only in the edit dialog.

### CalendarView (plan editor) — `src/components/CalendarView.jsx`
- [ ] Header: Back (disabled while saving), plan name + plan-type name, `Ustawienia` (plan settings), undo, redo, `Zapisz plan`, `Eksportuj CSV` (this plan)
- [ ] Planning notes panel above the calendar: free-text textarea; label/placeholder differ for running plans; 450 ms debounce — `RunningPlanningNotesPanel.jsx`
- [ ] Weeks stacked vertically, each a card with "Tydzień N", 7 day cells, ✓/⚠ badge → popover listing each condition with pass/fail
- [ ] Week card turns green (all conditions pass) or red (any fails)
- [ ] Autosave 1200 ms after any change; manual save; flush on back / tab close / unmount / app close
- [ ] Undo/redo: up to 50 snapshots, edits within 600 ms coalesced; covers plan content only (not the scratchpad)
- [ ] Shortcuts: Cmd/Ctrl+S save, Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo, Esc closes the top popover/dialog
- [ ] Copy training (context menu) → paste into any day (context menu)
- [ ] Scratchpad panel below the weeks (see below)

### DayCell / TrainingCard — `DayCell.jsx`, `TrainingCard.jsx`
- [ ] Header: "Dzień N" (continuous across weeks), calendar date if challenge has `startDate` (red if Polish holiday), "Łącznie: X min / Xh Ym" total duration, note icon, training count badge
- [ ] Empty cell: "+ Dodaj trening"; click anywhere on a cell → add-training flow
- [ ] Training card: 16:9 thumbnail (or placeholder `▶` / `PREMIERA` / `LIVE` / `BIEG`), title (2-line clamp), type badges (colour + emoji), meta badges (`Wideo/Audio/Rozpiska`, recording status), optional full-card background colour with auto-contrast text
- [ ] Drag & drop training between days (move, appended at end of target day; no reordering within a day)
- [ ] Day note: pinned preview (80 chars) under header; click to edit; **drag the note to another day** (confirm before overwriting)
- [ ] Training context menu: `Kopiuj trening`, `Usuń trening` (no confirm)
- [ ] Day context menu: `Wklej trening`, 12-colour palette for the cell tint, `Resetuj kolor kratki`
- [ ] Day tint rendered as background at 16 % alpha, border at 55 % alpha

### Scratchpad ("Brudnopis") — `ScratchpadPanel.jsx`, handlers in `CalendarView.jsx`
- [ ] Belongs to the **challenge**, shared by all its plans; count badge; hint text; empty state
- [ ] `Dodaj trening` → same chooser/search/manual flow, target = scratchpad (duplicates by `videoId`, or by title for manual, are silently skipped)
- [ ] Drag scratchpad card → day = **copy** (card stays, copy gets a new ID)
- [ ] Drag day training → scratchpad = **move** (removed from the day; skipped if duplicate)
- [ ] Click card → EditTrainingDialog; hover `×` removes; no reordering
- [ ] Saved through its own path that patches only `challenge.scratchpad` — `challengeStorage.js#updateChallengeScratchpad`

### Add / edit training
- [ ] AddTrainingChooser: "Wyszukaj na YouTube" vs "Dodaj z palca" — `AddTrainingChooser.jsx`
- [ ] TrainingSearchDialog: query (≥2 chars, runs on Enter/button, not as-you-type); dual-thumb duration filter 5–70 min, **on by default**, with "Wyłącz filtrowanie po czasie"; results = 3-column thumbnail grid with duration badge; click → floating tooltip (title, duration, channel, 120-char description, `Dodaj do planu treningowego`, `Zobacz trening na YouTube`); then pick ≥1 training type → `Potwierdź wybór`; empty-library notice pointing to Settings — `TrainingSearchDialog.jsx`
- [ ] Search engine: Fuse.js (threshold 0.35, title and description indexes) + 9-tier ranking + synonym expansion + diacritic-insensitive — `utils/youtubeLibrary.js#createLocalSearcher`, `constants/searchSynonyms.js`
- [ ] ManualTrainingDialog: name*, format `Premiera/Live/Bieganie`, form `Wideo/Audio/Rozpiska`, recording status (5), cell colour, running description (only for Bieganie; exported to the CSV "Link" column), ≥1 type*, optional image — `ManualTrainingDialog.jsx`
- [ ] EditTrainingDialog: preview; editable title/format for manual trainings; form, recording status, colour, types (multi), note. **Edits apply live** (180–300 ms debounce); `×`/backdrop = accept, `Anuluj` = roll back to the snapshot taken on open; `Usuń trening` (confirm); `Zamień na inny` (opens search, replaces the training) — `EditTrainingDialog.jsx`

### Plan and challenge dialogs
- [ ] CreateChallengeDialog: name*, weeks 1–52 (default 4), optional start date, calendar colour (12 swatches or `Auto`), thumbnail drop zone
- [ ] EditChallengeDialog: all of the above + **description with `Napisz z AI`**, internal note, challenge-only plan types (add/edit/delete), per-plan-type condition overrides (`Dostosuj warunki…`, `Przywróć z rodzaju planu`, `Usuń nadpis`, add/remove rows)
- [ ] CreatePlanDialog: plan type (global + challenge custom types), name; double-submit guard
- [ ] EditPlanDialog: status (`Niezaczęty / W przygotowaniu / Gotowy`), plan type, name, "Notatka ogólna", "Czego brakuje do gotowości" (only when in progress), switch-to-other-variant list, link to ChallengeConditionsDialog
- [ ] ChallengeConditionsDialog: same custom-types + overrides editor as in EditChallengeDialog, reachable from inside a plan
- [ ] EditPlanTypeDialog: name, description, list of conditions (type / scope / values)
- [ ] NoteDialog: textarea, save, delete (confirm)
- [ ] `useDirtyClose`: no close on backdrop click, "unsaved changes?" confirm on `×`/Esc, Esc only closes the top-most modal — `hooks/useDirtyClose.js`

### Settings — `src/components/SettingsDialog.jsx`
- [ ] Rodzaje planów: list, add, edit, delete (global plan types with week conditions)
- [ ] Typy treningów: list, add, edit (name, colour picker + hex, emoji ≤4 chars), delete
- [ ] Baza treningów: upload `Workouts.csv` (columns `PartitionKey`, `VideoUrl`) → map videoId → external ID used in the CSV export "ID" column; status line — `utils/workoutsStorage.js`
- [ ] YouTube: API key override; library status (count, last sync); `Synchronizuj (nowe filmy)` and `Pełna synchronizacja` with progress messages — `utils/youtubeLibrary.js#syncYouTubeLibrary`
- [ ] AI: OpenRouter key, model id, example descriptions (add with optional title / delete), free-text style notes (auto-appended lessons, editable) — `utils/aiConfigStorage.js`, `utils/descriptionProfileStorage.js`
- [ ] Footer: app version

### AI description generation — `utils/challengeDescriptionAI.js`, `utils/openRouter.js`
- [ ] `Napisz z AI` sends: system prompt (copywriter for the "Codziennie Fit" trainer), style section (examples + notes), a text summary of every plan (counts, types, durations, weekday distribution, up to 25 titles), and the current description field as the brief. `temperature 0.7`, `max_tokens 3000`, abortable.
- [ ] After saving the challenge, if the trainer edited the AI text, a second call (`temperature 0.3`, `max_tokens 500`) extracts 1–4 style lessons (or `BRAK`) and appends them to the profile notes as `[date – wnioski z poprawek]`.

---

## 3. Data model

### 3.1 Storage keys and files

Electron: `~/Library/Application Support/<app>/data/<file>` (`electron/main.js` `KEY_TO_FILE`). Each write is atomic (tmp → rename) with the previous content kept as `<file>.bak`. Browser fallback: `localStorage` with the same key, except four legacy names.

| Key | File | Shape | localStorage key |
|---|---|---|---|
| `challenges` | `challenges.json` | `Challenge[]` — **every challenge with all plans in one file** | `training_challenges` |
| `challenge_folders` | `challenge_folders.json` | `Folder[]` | `challenge_folders` |
| `plan_types` | `plan_types.json` | `PlanType[]` | `plan_types` |
| `training_types` | `training_types.json` | `TrainingType[]` | `training_types` |
| `workouts_database` | `workouts_database.json` | `{ urlToId, count, rowsTotal, uniqueCount }` | same |
| `youtube_config` | `youtube_config.json` | `{ apiKey, channelId: '' }` | same |
| `youtube_library` | `youtube_library.json` | `{ channelId, lastSyncAt, videos[] }` | same |
| `ai_config` | `ai_config.json` | `{ apiKey, model }` | same |
| `ai_description_profile` | `ai_description_profile.json` | `{ examples[], notes }` | same |

Exchange file: `<name>.ptchallenge.json`.

### 3.2 ID rules

- Challenge and Plan IDs **must be JS numbers**: `Date.now() * 1000 + counter` (`src/utils/id.js`). About 1.7e15, so 64-bit integer in a DB, still a safe integer in JSON.
- Folder: `` `folder_${Date.now()}` ``. Global plan type: slug of the name (`toLowerCase`, spaces → `-`, strip everything outside `[a-z0-9-]`, so Polish letters are dropped: "Siłowy" → `siowy`). Challenge-only plan type: `` `custom-${Date.now()}` ``. Training type: `` `type-${Date.now()}` `` (defaults use plain slugs). AI example: numeric ID.
- Training IDs are **not reliable**: numeric when added through the add flow, the YouTube `videoId` string when a training is replaced via "Zamień na inny", duplicated when pasted (paste keeps the copied ID). Trainings, days and weeks are always addressed **by array index**.

### 3.3 Challenge

Created in `MainView.handleCreateChallenge` from `CreateChallengeDialog`:

```js
{ id: generateNumericId(),
  name: trimmedName, thumbnail: thumbnail /* data URL | null */, weeksCount: parsedWeeks,
  startDate: startDate?.trim() ? startDate.trim() : undefined, color: color || undefined,
  plans: [],
  createdAt: new Date().toISOString() }
```

Full shape after `EditChallengeDialog` and the storage normaliser (`challengeStorage.js#normalizeChallenge`, `withChallengeTimestamps`):

| Field | Type | Req. | Default / notes |
|---|---|---|---|
| `id` | number | yes | validated `typeof === 'number'` on save |
| `name` | string | yes | non-empty after trim |
| `weeksCount` | number 1–52 | yes | UI default 4 |
| `thumbnail` | string (JPEG/PNG data URL) \| null | no | compressed to ≤1280 px, JPEG q 0.82; input ≤ 2 MB |
| `startDate` | `'YYYY-MM-DD'` | no | absent = "undated". No end date: `end = start + weeksCount*7 − 1` |
| `color` | `#rrggbb` | no | absent = auto colour `palette[abs(id) % 12]` |
| `description` | string | no | public description (AI-assisted) |
| `note` | string | no | internal note |
| `plans` | `Plan[]` | yes | `[]` |
| `scratchpad` | `Training[]` | — | normaliser forces `[]` |
| `folderId` | string \| null | no | unknown/missing folder = unfoldered |
| `customPlanTypes` | `PlanType[]` | no | key deleted when empty |
| `planTypeConditions` | `{ [planTypeId]: Condition[] }` | no | per-challenge override, replaces the plan type's list wholesale; key deleted when empty |
| `isRunningChallenge` | boolean | — | normaliser forces `false`; never set by the UI (vestigial) |
| `runningPlanningNotes` | string | — | normaliser forces `''`; unused at challenge level (vestigial) |
| `createdAt`, `updatedAt` | ISO string | — | set by the storage layer on every write |
| `importedAt`, `importSourceId` | ISO string, number | no | only on "Utwórz kopię" imports |

Save-time validation (`saveChallenge`): numeric `id`, non-empty `name`, `1 ≤ weeksCount ≤ 52`.

### 3.4 Plan, Week, Day

Created in `ChallengeView.handleCreatePlan`:

```js
const plan = {
  id: generateNumericId(),
  ...planData,          // { type, name, status: 'not_started', isRunningPlan, runningPlanningNotes: '' }
  status: normalizedStatus,
  statusNote: normalizedStatus === 'in_progress' ? (planData?.statusNote || undefined) : undefined,
  weeks: Array.from({ length: updatedChallenge.weeksCount }, (_, i) => ({
    weekNumber: i + 1,
    days: Array.from({ length: 7 }, (_, dayIndex) => ({ dayOfWeek: dayIndex, trainings: [] }))
  }))
};
```

| Plan field | Type | Notes |
|---|---|---|
| `id` | number | required |
| `name` | string | required |
| `type` | string | plan-type ID (global or `custom-…`); may dangle if the type is deleted |
| `status` | `'not_started' \| 'in_progress' \| 'ready'` | default `not_started` |
| `statusNote` | string? | only kept when `in_progress` |
| `isRunningPlan` | boolean | set from regex `/bieg|run/` over the plan type's id+name+description |
| `runningPlanningNotes` | string | the planning-notes panel text (used for **all** plans, despite the name) |
| `note` | string? | legacy "Notatka ogólna"; CalendarView migrates it into `runningPlanningNotes` and clears it |
| `weeks` | `Week[]` | length should equal `challenge.weeksCount` |

`Week = { weekNumber: 1..N, days: Day[7] }`

`Day = { dayOfWeek: 0..6, trainings: Training[], note?: string, calendarColor?: '#rrggbb' | null }`

`dayOfWeek` is just the index within the week (day 0 = the challenge's start weekday, not necessarily Monday). Displayed number: `weekIndex*7 + dayIndex + 1`. Date: `startDate + (dayNumber − 1)`.

### 3.5 Training

From the library (`youtubeLibrary.js#toResult`), then `CalendarView.handleTrainingSelect` adds `id`, `types` and meta defaults:

```js
// library result
{ id: v.videoId, videoId: v.videoId, title, channelTitle, description, thumbnail /* URL */, duration /* 'MM:SS' | 'H:MM:SS' | 'N/A' */ }
// on add
const newTraining = normalizeTrainingMeta({ ...training, id: generateNumericId(), types });
```

Manual (`ManualTrainingDialog.handleSubmit`; the `manual-…` id is immediately replaced by a numeric one):

```js
{ id: `manual-${Date.now()}`, videoId: null, title: t, channelTitle: 'Własny', duration: '-',
  thumbnail: thumbnail || null, isManual: true, format, contentMode, recordingStatus,
  calendarColor: calendarColor || null,
  ...(format === MANUAL_FORMATS.RUNNING ? { manualDescription: desc || undefined } : {}) }
```

| Field | Type | Notes |
|---|---|---|
| `id` | number \| string | see ID rules |
| `videoId` | string \| null | YouTube ID; null for manual |
| `title` | string | |
| `channelTitle` | string | `'Własny'` for manual |
| `description` | string? | YouTube description (library trainings) |
| `thumbnail` | string \| null | remote URL (YouTube) or data URL (manual) |
| `duration` | string | `'MM:SS'`, `'H:MM:SS'`, `'N/A'`, `'-'` |
| `types` | string[] | training-type IDs; ≥1 enforced on add. Legacy single `type` still read everywhere |
| `isManual` | true? | |
| `format` | `'premiere' \| 'live' \| 'running'`? | manual only |
| `manualDescription` | string? | running only; legacy `link` also read |
| `contentMode` | `'video' \| 'audio' \| 'text'` | UI labels Wideo / Audio / Rozpiska |
| `recordingStatus` | `'not_recorded' \| 'recorded' \| 'in_editing' \| 'published' \| 'live'` | |
| `calendarColor` | `#rrggbb` \| null | full-card background |
| `note` | string? | |

Two normalisers with **different defaults** exist; pick one in the rewrite:
- `CalendarView.normalizeTrainingMeta`: YouTube training → `contentMode 'video'`, `recordingStatus 'published'`; otherwise `'text'` if running/has description else `'audio'`, and `'not_recorded'`.
- `challengeStorage.normalizeTrainingMeta` (on read/write): missing `contentMode` → `'text'` if running/has description else `'audio'`; missing status → `'not_recorded'`.

Scratchpad item = a `Training`, same shape.

### 3.6 Conditions, plan types, training types, folders

```js
// EditPlanTypeDialog.emptyCondition (editor state; trimmed on save)
{ type: 'limit', scope: 'all', value: 2, valueMin: 0, valueMax: 4, valueDays: 2 }
```

Persisted `Condition` (only the relevant keys are written):

| `type` | Label | Keys written |
|---|---|---|
| `limit` | Limit (max) | `scope`, `countMode: 'trainings' \| 'days'`, `value` |
| `minimum` | Minimum | `scope`, `value` |
| `zakres` | Zakres (min–max) | `scope`, `countMode`, `valueMin`, `valueMax` (≥ min) |
| `odstep` | Odstęp (dni po) | `scope`, `value` |
| `min_odstep` | Min. odstęp między (dni) | `scope`, `value` |
| `max_w_ciagu` | Max w ciągu X dni | `scope`, `value`, `valueDays` (≥1) |
| `min_dni_odpoczynku` | Min. dni odpoczynku | `value` (no scope) |
| `max_w_dniu` | Max w jednym dniu | `value` (no scope) |
| `max_dni_treningowych` | legacy, no label | `scope`, `value`; editors convert to `limit` + `countMode: 'days'` |

`scope` = `'all'` or a training-type ID. In the editors "Dni treningowe" is a pseudo-scope `'__days__|all'` that is saved as `scope: 'all', countMode: 'days'`. Input maxima: 14 by default; 7 for day-based, `odstep`, `min_odstep`, `min_dni_odpoczynku`, `valueDays`; 5 for `max_w_dniu`.

`PlanType = { id: string, name: string, description: string, conditions: Condition[] }`
`TrainingType = { id: string, name: string, color: '#hex', emoticon: string }`
`Folder = { id: string, name: string }`

Defaults — `utils/planTypesStorage.js` (`running` is always re-added if missing):

```js
[ { id:'running',     name:'Biegowy',      description:'Plan ukierunkowany na bieganie i jednostki biegowe',
    conditions:[ {type:'minimum',scope:'all',value:3}, {type:'minimum',scope:'cardio',value:2} ] },
  { id:'balanced',    name:'Zbalansowany', description:'Mieszanka treningów siłowych, cardio i rozciągania',
    conditions:[ {type:'minimum',scope:'all',value:2}, {type:'limit',scope:'all',value:4},
                 {type:'minimum',scope:'cardio',value:1}, {type:'limit',scope:'cardio',value:3} ] },
  { id:'strength',    name:'Siłowy',       description:'Skupiony na treningach siłowych',
    conditions:[ {type:'minimum',scope:'all',value:4}, {type:'limit',scope:'all',value:6},
                 {type:'minimum',scope:'cardio',value:1}, {type:'limit',scope:'cardio',value:2} ] },
  { id:'cardio',      name:'Cardio',       description:'Skupiony na treningach cardio',
    conditions:[ {type:'minimum',scope:'all',value:4}, {type:'limit',scope:'all',value:6},
                 {type:'minimum',scope:'cardio',value:3}, {type:'limit',scope:'cardio',value:5} ] },
  { id:'flexibility', name:'Rozciąganie',  description:'Skupiony na rozciąganiu i mobilności',
    conditions:[ {type:'minimum',scope:'all',value:4}, {type:'limit',scope:'all',value:6},
                 {type:'minimum',scope:'stretching',value:2}, {type:'limit',scope:'cardio',value:2} ] } ]
```

Defaults — `utils/trainingTypesStorage.js` (written to storage on first read):

```js
[ { id:'strength',   name:'Siłowy',      color:'#0071e3', emoticon:'💪' },
  { id:'cardio',     name:'Cardio',      color:'#ff3b30', emoticon:'🏃' },
  { id:'stretching', name:'Rozciąganie', color:'#34c759', emoticon:'🧘' },
  { id:'yoga',       name:'Joga',        color:'#af52de', emoticon:'🧘‍♀️' },
  { id:'pilates',    name:'Pilates',     color:'#ff9500', emoticon:'🤸' },
  { id:'hiit',       name:'HIIT',        color:'#ff2d55', emoticon:'⚡' } ]
```
New training type default colour: `#6b7280`.

`src/constants/planTypes.js` also exports an older `PLAN_TYPES` (with `requirements: { strength/cardio/stretching: {min,max} }`). It is only a last-resort fallback for the plan-type **name**; it has no `conditions`, so such a plan gets the default rule. Other constants there: `MANUAL_FORMATS` (`premiere`, `live`, `running` → Premiera, Live, Bieganie), `CONDITION_TYPES`, `CONDITION_TYPE_LABELS`, `SCOPE_LABELS` (all → "Wszystkie treningi", strength → "Siłowe", cardio, stretching → "Rozciąganie", yoga → "Joga", pilates, hiit).

### 3.7 Library, workouts DB, settings

```js
// youtube_library
{ channelId: string|null, lastSyncAt: number /* ms */|null,
  videos: [{ videoId, title, channelTitle, description, thumbnail /* medium|high|default URL */,
             duration /* formatted or 'N/A' */, publishedAt /* ISO|null */ }] }   // newest first

// workouts_database  (key = YouTube videoId, value = PartitionKey from Workouts.csv)
{ urlToId: { [videoId]: string }, count: number, rowsTotal?: number, uniqueCount: number }

// youtube_config            // channelId comes from VITE_YOUTUBE_CHANNEL_ID at build time
{ apiKey: string, channelId: '' }

// ai_config                 // fallbacks: VITE_OPENROUTER_API_KEY, VITE_OPENROUTER_MODEL, 'google/gemini-2.5-flash'
{ apiKey: string, model: string }

// ai_description_profile
{ examples: [{ id: number, title?: string, text: string, addedAt: ISO|null }], notes: string }

// .ptchallenge.json
{ schemaVersion: 1, exportedAt: ISO, appVersion: string,
  metadata: { sourceChallengeId, sourceChallengeCreatedAt, sourceChallengeUpdatedAt },
  challenge: Challenge }
```

Import validity (`isValidChallengeShape`): numeric finite `id`, non-empty `name`, numeric `weeksCount` 1–52, `plans` is an array. Overwrite keeps the local `id` and `createdAt`. Copy gets a new ID and " (import)" suffix.

---

## 4. Business rules to port

`utils/weekValidation.js`, `utils/challengeCalendar.js`, `utils/dateUtils.js` and `constants/*` are pure (no React, no storage). They can be copied as files.

### 4.1 Week validation — `src/utils/weekValidation.js`

Resolution order for the condition list (`resolveConditions`): `challenge.planTypeConditions[plan.type]` if non-empty, else `planType.conditions` if non-empty, else none. `planType` itself is resolved in `CalendarView` as challenge `customPlanTypes` → global `plan_types` → legacy constants.

```js
// no conditions at all -> built-in default
const pass = total >= 2 && total < 4;
return { count: total, cardioCount, isValid: pass, isWarning: total >= 4,
         conditionResults: [{ label: 'Domyślnie: 2–3 treningi w tygodniu', pass }] };

// with conditions
const conditionResults = conditions.map((c) => ({ label: formatConditionLabel(c),
                                                  pass: checkCondition(week, c, counts, nextWeek, prevWeek) }));
const allPass = conditionResults.every((r) => r.pass);
return { count: total, cardioCount, isValid: allPass, isWarning: !allPass, conditionResults };
```

UI: `isValid` → green week + ✓; `isWarning` → red week + ⚠; neither (default rule with <2 trainings) → neutral, no badge.

```js
function matchesScope(training, scope) {
  if (scope === 'all') return true;
  const types = training?.types
    ? (Array.isArray(training.types) ? training.types : [training.types])
    : (training?.type ? [training.type] : []);
  return types.includes(scope);
}
// counts.total = all trainings in the week; counts.byScope[type] = trainings having that type
// (a training with two types counts once for each)

function checkCondition(week, cond, counts, nextWeek = null, prevWeek = null) {
  const scope = cond.scope || 'all';
  const count = scope === 'all' ? counts.total : (counts.byScope[scope] ?? 0);
  switch (cond.type) {
    case CONDITION_TYPES.LIMIT: {
      const max = Math.max(0, parseInt(cond.value, 10) || 0);
      if (cond.countMode === 'days') return getDaysWithScopeTraining(week, scope).length <= max;
      return count <= max;
    }
    case CONDITION_TYPES.MINIMUM: {
      const min = Math.max(0, parseInt(cond.value, 10) || 0);
      return count >= min;
    }
    case CONDITION_TYPES.ZAKRES: {
      const a = Math.max(0, parseInt(cond.valueMin, 10) || 0);
      const b = Math.max(a, parseInt(cond.valueMax, 10) || 0);
      if (cond.countMode === 'days') { const n = getDaysWithScopeTraining(week, scope).length; return n >= a && n <= b; }
      return count >= a && count <= b;
    }
    case CONDITION_TYPES.ODSTEP:               return checkOdstep(week, scope, cond.value, nextWeek);
    case CONDITION_TYPES.MIN_ODSTEP:           return checkMinOdstep(week, scope, cond.value, nextWeek, prevWeek);
    case CONDITION_TYPES.MAX_W_CIAGU:          return checkMaxWciagu(week, scope, cond.value, cond.valueDays || 2, nextWeek, prevWeek);
    case CONDITION_TYPES.MIN_DNI_ODPOCZYNKU:   return checkMinDniOdpoczynku(week, cond.value);
    case CONDITION_TYPES.MAX_W_DNIU:           return checkMaxWDniu(week, cond.value);
    case CONDITION_TYPES.MAX_DNI_TRENINGOWYCH: return checkMaxDniTreningowych(week, scope, cond.value);
    default: return true;
  }
}
```

```js
// ODSTEP: after every day containing a scope training, the next `value` days must have NO trainings at all
function checkOdstep(week, scope, value, nextWeek = null) {
  const requiredRest = Math.max(0, parseInt(value, 10) || 0);
  if (requiredRest === 0) return true;
  const dayIndices = getDaysWithScopeTraining(week, scope);
  const numDays = week?.days?.length ?? 7;
  const nextNumDays = nextWeek?.days?.length ?? 0;
  for (const idx of dayIndices) {
    for (let k = 1; k <= requiredRest; k++) {
      const next = idx + k;
      if (next < numDays) { if (week.days[next]?.trainings?.length) return false; }
      else if (nextWeek && next - numDays < nextNumDays) { if (nextWeek.days[next - numDays]?.trainings?.length) return false; }
    }
  }
  return true;
}

// MIN_ODSTEP: min distance between days that contain a scope training
function checkMinOdstep(week, scope, value, nextWeek = null, prevWeek = null) {
  const minDays = Math.max(1, parseInt(value, 10) || 1);
  const dayIndices = getDaysWithScopeTraining(week, scope);
  const numDays = week?.days?.length ?? 7;
  const prevNumDays = prevWeek?.days?.length ?? 0;
  if (dayIndices.length >= 2) {
    for (let i = 0; i < dayIndices.length - 1; i++) {
      const daysBetween = dayIndices[i + 1] - dayIndices[i];            // index difference
      if (daysBetween < minDays) return false;
    }
  }
  if (nextWeek?.days?.length && dayIndices.length > 0) {
    const nextIndices = getDaysWithScopeTraining(nextWeek, scope);
    if (nextIndices.length > 0) {
      const daysBetween = (numDays + nextIndices[0]) - dayIndices[dayIndices.length - 1] - 1;   // gap days
      if (daysBetween < minDays) return false;
    }
  }
  if (prevNumDays > 0 && dayIndices.length > 0) {
    const prevIndices = getDaysWithScopeTraining(prevWeek, scope);
    if (prevIndices.length > 0) {
      const daysBetween = (prevNumDays + dayIndices[0]) - prevIndices[prevIndices.length - 1] - 1;
      if (daysBetween < minDays) return false;
    }
  }
  return true;
}

// MAX_W_CIAGU: at most `value` scope trainings in any window of `valueDays` consecutive days,
// windows inside the week, windows spilling into nextWeek, windows starting in prevWeek
function checkMaxWciagu(week, scope, value, valueDays, nextWeek = null, prevWeek = null) {
  const maxCount = Math.max(1, parseInt(value, 10) || 1);
  const daysWindow = Math.max(1, parseInt(valueDays, 10) || 1);
  const numDays = week?.days?.length ?? 7;
  const nextNumDays = nextWeek?.days?.length ?? 0;
  const prevNumDays = prevWeek?.days?.length ?? 0;
  for (let start = 0; start <= numDays - daysWindow; start++) {
    let count = 0;
    for (let d = start; d < start + daysWindow && d < numDays; d++) count += countTrainingsInDay(week.days[d], scope);
    if (count > maxCount) return false;
  }
  if (nextNumDays > 0) {
    const spanStart = Math.max(0, numDays - daysWindow + 1);
    for (let start = spanStart; start < numDays; start++) {
      if (start + daysWindow <= numDays) continue;
      const inNext = (start + daysWindow) - numDays;
      if (inNext > nextNumDays) continue;
      let count = 0;
      for (let d = start; d < numDays; d++) count += countTrainingsInDay(week.days[d], scope);
      for (let d = 0; d < inNext; d++) count += countTrainingsInDay(nextWeek.days[d], scope);
      if (count > maxCount) return false;
    }
  }
  if (prevNumDays > 0) {
    const fromPrevMin = Math.max(1, daysWindow - numDays);
    const fromPrevMax = Math.min(daysWindow - 1, prevNumDays);
    for (let fromPrev = fromPrevMin; fromPrev <= fromPrevMax; fromPrev++) {
      const fromCurrent = daysWindow - fromPrev;
      let count = 0;
      for (let d = prevNumDays - fromPrev; d < prevNumDays; d++) count += countTrainingsInDay(prevWeek.days[d], scope);
      for (let d = 0; d < fromCurrent; d++) count += countTrainingsInDay(week.days[d], scope);
      if (count > maxCount) return false;
    }
  }
  return true;
}

// MIN_DNI_ODPOCZYNKU: days with zero trainings >= max(0, value)        (false if week has no days)
// MAX_W_DNIU:         every day has <= max(1, value) trainings of ANY type
// MAX_DNI_TRENINGOWYCH (legacy): days containing a scope training <= max(0, value)
```

Labels (`formatConditionLabel`, `sc` = scope label): `Max N (sc)` / `Max N dni treningowych (sc)`; `Min. N (sc)`; `Od A do B (sc)` / `Od A do B dni treningowych (sc)`; `Odstęp N dni po (sc)`; `Min. N dni między (sc)`; `Max N w ciągu D dni (sc)`; `Min. N dni odpoczynku`; `Max N w jednym dniu`. Note `sc` uses the static `SCOPE_LABELS`, so custom training types show their raw ID (e.g. `type-1712…`).

Quirks to decide on rather than copy blindly:
- `MIN_ODSTEP` measures differently inside a week (index difference: adjacent days = 1) and across a week boundary (gap days: adjacent days = 0). "Min. 1 dni między" therefore passes Mon+Tue but fails Sun+Mon.
- `ODSTEP` and `MAX_W_DNIU` look at trainings of any type for the "blocked" side, regardless of scope.
- Cross-week checks use neighbouring weeks, so editing week 3 can flip weeks 2 and 4. `CalendarView` caches results per week object in a `WeakMap` keyed on prev/next/planType/challenge identity.

### 4.2 Challenge calendar — `src/utils/challengeCalendar.js`

- `getChallengeColor`: valid `#rrggbb` in `challenge.color`, else `CALENDAR_COLOR_PALETTE[abs(trunc(id)) % 12].hex`.
- `getWeeksCount`: `parseInt`, clamped 1–52, default 1.
- `getChallengeRange`: `{ start: parseDateFromInput(startDate), end: addDays(start, weeks*7 − 1) }` or `null`.
- `splitChallenges` → `dated` (sorted: earlier start, then longer, then smaller ID) and `undated` (sorted by name, `localeCompare(…, 'pl')`).
- `assignLanes`: greedy interval colouring over the whole timeline, so a challenge keeps its row across weeks and months:
  ```js
  dated.forEach(({ challenge, range }) => {
    let lane = laneEnds.findIndex((end) => end < range.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(range.end); } else { laneEnds[lane] = range.end; }
    laneById.set(challenge.id, lane);
  });
  ```
- `buildWeekSegments(weekDays, dated, laneById, maxLanes)`: keeps challenges overlapping the week, compacts global lane numbers to `0..k` within the week, `startCol = max(0, diffInDays(weekStart, start))`, `endCol = min(6, diffInDays(weekStart, end))`, flags `continuesLeft/Right`; lanes `>= maxLanes` go into `hiddenByDay[col]` ("+N więcej"). Month grid uses `MAX_LANES = 4`.
- `buildYearColorIndex(dated, year)`: `Map<'YYYY-MM-DD', color[]>`; year view shows up to 3 colours per day as equal vertical stripes.
- `shiftDatedChallenge`: drag preview, shifts start and end by the same delta (never resizes), re-sorts; lanes are recomputed for the preview.
- Drag commit (`MainView.handleMoveChallengeStartDate`): re-read the challenge fresh, save `{ ...fresh, startDate }`.

### 4.3 Dates — `src/utils/dateUtils.js`

- Convention: dates are always **local midnight**. Parse with `` new Date(`${yyyyMmDd}T00:00:00`) ``, never `new Date('YYYY-MM-DD')` (UTC, shifts the day in Poland). Format back from local components (`getYyyyMmDd`).
- `addDays` uses `setDate` (DST-safe); `diffInDays = Math.round((startOfDay(b) − startOfDay(a)) / 86400000)`.
- Week starts on Monday: `mondayOfWeek` offset `(getDay() + 6) % 7`; `buildMonthGrid(year, month0)` returns weeks of 7 dates including padding days.
- `isHolidayPL`: fixed `01-01, 01-06, 05-01, 05-03, 08-15, 11-01, 11-11, 12-25, 12-26`; movable = Easter Sunday (Meeus/Jones/Butcher), Easter Monday (+1), Pentecost (+49), Corpus Christi (+60). (24 December, a public holiday in Poland since 2025, is not in the list.)
- Formatting via `Intl.DateTimeFormat('pl-PL')`: `DD.MM`, `DD.MM.RRRR`, month names nominative capitalised. `WEEKDAY_SHORT_PL = ['Pon','Wt','Śr','Czw','Pt','Sob','Nie']`, `WEEKDAY_LETTER_PL = ['P','W','Ś','C','P','S','N']`.

### 4.4 Recording statuses — `src/constants/recordingStatuses.js` (display order)

| id | Label | Colour |
|---|---|---|
| `not_recorded` | Nienagrany | `#86868b` |
| `recorded` | Nagrany | `#0071e3` |
| `in_editing` | W montażu | `#f59e0b` |
| `published` | Opublikowany | `#22c55e` |
| `live` | Na żywo | `#ef4444` |

Unknown value falls back to `not_recorded`.

### 4.5 Calendar colour palette — `src/constants/calendarColors.js`

Used for challenge colour, day tint and training card colour.

| id | Label | Hex | | id | Label | Hex |
|---|---|---|---|---|---|---|
| red | Czerwony | `#ef4444` | | teal | Morski | `#14b8a6` |
| orange | Pomarańczowy | `#f97316` | | cyan | Cyjan | `#22d3ee` |
| amber | Bursztyn | `#f59e0b` | | blue | Niebieski | `#3b82f6` |
| yellow | Żółty | `#facc15` | | indigo | Indygo | `#6366f1` |
| lime | Limonkowy | `#84cc16` | | violet | Fioletowy | `#a855f7` |
| green | Zielony | `#22c55e` | | pink | Różowy | `#ec4899` |

Training card text on a coloured card: luminance `(0.299r + 0.587g + 0.114b)/255 > 0.65` → `#1d1d1f`, else `#ffffff`.

### 4.6 CSV export — `src/utils/csvExport.js`

- UTF-8 with BOM, `\n` line endings, comma separator. A value is quoted (with `"` doubled) only if it contains `,`, `"` or `\n`.
- Plan export: header `Dzień,Tytuł,Link,ID`, then **one row per day** for every day of every week: `DZIEŃ n` (n continuous from 1). Several trainings in a day are joined inside each cell with `" | "`. Empty day → `DZIEŃ n,,,`.
- Title: `t.title || 'Bez nazwy'`.
- Link: `https://www.youtube.com/watch?v=<videoId>`; manual running → `manualDescription || link || 'BIEGANIE'`; other manual → `link || 'LIVE' | 'PREMIERA'`; else `''`.
- ID: `lookupWorkoutId(videoId, urlToId) ?? 'Brak ID'` (exact, then case-insensitive, then substring match on the video ID). If the workouts DB is empty an alert explains how to load it and export continues.
- File name: plan/challenge name with Polish letters transliterated, non `[a-z0-9_-]` → `_`, collapsed; fallback `plan_treningowy.csv` / `wyzwanie.csv`.
- Challenge export: for each plan a line `PLAN i: <name>`, the header, the rows (or `Brak treningów`), then a blank line; `Brak planów w wyzwaniu.` when there are none.
- Workouts.csv import (`parseWorkoutsCSV`): needs header columns `PartitionKey` and `VideoUrl` (case/space-insensitive); extracts the video ID from `?v=`, `youtu.be/`, `/embed|v|live/` forms (10–30 chars `[A-Za-z0-9_-]`).

### 4.7 Search — `src/utils/youtubeLibrary.js`, `src/constants/searchSynonyms.js`

`normalizeText`: lower-case, NFD strip diacritics, `ł → l`, trim. Ranking tiers (lower is better): 0 title equals query; 1 title starts with it; 2 title contains phrase (earlier position first); 3 all words as whole words in title; 4 all words as substrings in title; 5 Fuse hit in title; 6 description contains phrase/all words; 7 Fuse hit in description; 8 Fuse hit for a synonym. Ties: Fuse score, shorter title, newer `publishedAt`. Fuse options: `threshold 0.35, ignoreLocation false, minMatchCharLength 2, includeScore true`.

`expandQuery`: a group matches when the normalised query contains a term or a term contains the query; then all terms of the group are added. Groups:

```js
['brzuch','brzucha','core','abs','mięśnie brzucha','sześciopak','płaski brzuch','talia'],
['nogi','uda','pośladki','dół ciała','przysiady','łydki'],
['rozciąganie','stretching','mobilność','joga','yoga','relaks','relaksacja','elastyczność','rozciągnij'],
['cardio','aerobik','spalanie','hiit','interwały','wytrzymałość','kondycja','tabata'],
['siła','siłowy','wzmacnianie','hantle','ciężary','trening siłowy','wzmacniający'],
['plecy','kręgosłup','postawa','prostowanie pleców'],
['ręce','ramiona','biceps','triceps','barki','góra ciała'],
['klatka','klatka piersiowa','pompki'],
['całe ciało','full body','total body','ogólnorozwojowy'],
['rozgrzewka','warm up','warmup','rozruszanie'],
['początkujący','dla początkujących','beginner','łatwy','delikatny','na start'],
['zaawansowany','trudny','intensywny','advanced','mocny'],
['odchudzanie','schudnąć','spalanie tłuszczu','redukcja','waga','na płaski brzuch'],
['schłodzenie','cool down','wyciszenie','oddech','medytacja'],
```

Library sync: uploads playlist = channel ID with `UC` → `UU`; `playlistItems.list` 50 per page (incremental stops at the first known video; full caps at 200 pages), then `videos.list?part=contentDetails` in batches of 50 for durations; skips "Private video"/"Deleted video"; merges by `videoId`, sorts newest first.

### 4.8 Save semantics worth keeping (in spirit)

- Plan autosave replaces **one plan** inside a freshly read challenge; scratchpad save replaces only `scratchpad`; neither resurrects a deleted challenge/plan (skip silently).
- Whole-challenge saves (metadata, plan add/delete/duplicate, start date) replace the entire record.
- All of this is serialised through one global promise chain because everything lives in one JSON file. A web backend should replace it with per-resource endpoints (`PATCH plan`, `PUT scratchpad`, `PATCH challenge meta`) and a version/`updatedAt` check.

---

## 5. Design tokens

**No design tokens exist.** Every colour, size and radius is hard-coded per component CSS file (19 component files plus `index.css` and `App.css`, about 5,700 lines); `var(--…)` is used only for layout maths (`--col`, `--lane`, `--start`, `--end`, `--lanes`, `--min`, `--max`). Global styles: `src/index.css` (reset, font stack, body colours) and `src/App.css` (app background, drag region). Class names such as `.dialog-overlay`, `.dialog-content`, `.form-group`, `.cancel-button`, `.empty-state`, `.back-button`, `.export-button`, `.type-button` are redefined in several files with slightly different values; because all CSS is global, the effective value depends on import order. The look is deliberately Apple-like (macOS system greys, SF font, system blue).

### 5.1 Colours (count = occurrences across CSS)

| Token | Value | Used for |
|---|---|---|
| bg/app | `#f5f5f7` (64) | page background, empty day cell, list rows, secondary buttons, sidebar |
| bg/surface | `#ffffff` | cards, modals, inputs, filled day cell, week container |
| bg/surface-alt | `#fbfbfd`, `#fafafa` | weekday header, scratchpad card, weekend column, settings footer |
| bg/hover | `#e8e8ed` (14), `#ececef`, `#f0f0f2` | hover of grey surfaces, hairline grid lines |
| text/primary | `#1d1d1f` (110) | headings, body |
| text/secondary | `#86868b` (75) | captions, hints, icons, placeholders |
| text/tertiary | `#6e6e73`, `#6b7280`, `#515154`, `#a1a1a6`, `#c7c7cc` | small meta, weekend labels, outside-month days |
| border/default | `#e5e5e7` (56) | cards, dividers, menus |
| border/input | `#d2d2d7` (43) | inputs, outline buttons, dashed drop zones |
| border/strong | `#c9c9ce` | hover of list items |
| primary | `#0071e3` (111) | primary buttons, links, focus, active states, counters |
| primary/hover | `#0077ed` | primary button hover (`#0062c4` on the scratchpad add button) |
| primary/tint | `rgba(0,113,227,0.10)` focus ring, `0.12` active chip bg, `#f0f7ff`, `#e8f4fd` light fills | |
| accent-2 (tabs) | `#4a90e2`, fill `#f0f4ff` | active plan tab, tab picker, info hint border |
| info box | bg `#f0f4f8`, text `#4a5568`, left border `#4a90e2`; switcher: gradient `#eef4fb → #f7faff`, border `#c8dcf2`, text `#1f4e8a` | hints |
| success | `#34c759`, hover `#30d158`, bg `#f0fdf4` | valid week, save button, "ready" plan, CSV export button (ChallengeView) |
| danger | `#ff3b30`, hover `#ff2d20`, strong `#d70015`, text `#d0021b`, bg `#fff5f5` / `#ffebee` | invalid week, delete, holidays, today marker, "not started" plan |
| warning | `#ffd60a` | "in progress" plan border |
| banner error | bg `#ffe8e8`, border `#f5a3a3`, text `#5b1010` | save error |
| banner warn | bg `#fff3d6`, border `#f0c674`, text `#5a3d00` | restored-from-backup notice |
| AI accent | text `#6d28d9`, bg `#f3efff`, border `#ddd3ff`, hover `#e9e1ff` / `#c4b5fd` | "Napisz z AI" button |
| meta badge | text `#0b2a6f`, bg `rgba(255,255,255,0.88)`, border `rgba(11,42,111,0.22)` | Wideo/Audio/Rozpiska + status badges on training cards |
| YouTube | `#ff0000` | chooser icon |
| overlay | `rgba(0,0,0,0.4)` + `backdrop-filter: blur(8px)`; light backdrop `rgba(0,0,0,0.25)` | modals |
| training types | `#0071e3`, `#ff3b30`, `#34c759`, `#af52de`, `#ff9500`, `#ff2d55` (user-editable) | type badges |
| calendar palette / statuses | see 4.5, 4.4 | |
| Electron window bg | `#ffffff`; meta theme-color `#000000` | |

Plan status borders (2 px): ready `#34c759`, in_progress `#ffd60a`, not_started `#ff3b30`.

### 5.2 Typography

Font stack (`index.css`), antialiased:
`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif`. Monospace only for the hex-colour input and `code`.

| Role | Size / weight |
|---|---|
| App title (MainView) | 48 px / 600, letter-spacing −0.5 px |
| View title (challenge, plan) | 32 px / 600 |
| Modal title | 28 px (challenge, search), 24 px (plan, manual, settings), 22 px (small dialogs) / 600 |
| Section title | 24 px / 600; calendar title 22 px / 600 (−0.3 px) |
| Week heading, dialog h3 | 20 px / 600; 18 px / 600 card names; 17 px / 600 sub-sections |
| Body / buttons | 15 px / 500 (most buttons, labels); 17 px for large inputs and modal buttons; 16 px compact dialog inputs |
| Secondary text | 14 px; 13 px hints |
| Small | 12 px training title, calendar bar; 11 px badges, dates, uppercase labels; 10–10.5 px mini calendar, tab subtitle |
| Weights | 600 (60 uses) and 500 (52) dominate; 700 for badges/counters |
| Uppercase micro-labels | 11–12 px / 600–700, letter-spacing 0.04em–0.5px |
| Line heights | 1.4 body hints, 1.35 compact, 1.3 titles, 1.5 long text |

### 5.3 Radii, shadows, spacing

Radii: `6px` chips, training cards, small icon buttons · `8px` small buttons, condition inputs, tooltips items · `9px` tabs, segmented options · `10px` (55 uses) buttons, inputs, menu items · `12px` cards-in-lists, context menus, day cells, thumbnails · `14px` panels (notes, scratchpad, chooser buttons) · `16px` cards, week container, calendar card · `20px` modals · `50%` swatches, badges, dots.

Shadows:
- focus ring `0 0 0 4px rgba(0,113,227,0.1)` with border `#0071e3`
- card hover `0 4px 12px rgba(0,0,0,0.1)` + `translateY(-2px)`
- primary button `0 2px 8px rgba(0,113,227,0.2)`, hover `0 4px 12px rgba(0,113,227,0.3)`
- popover/menu `0 16px 40px rgba(0,0,0,0.18)`; dropdown `0 8px 24px rgba(0,0,0,0.12)`
- modal `0 20px 60px rgba(0,0,0,0.3)`
- segmented active `0 1px 3px rgba(0,0,0,0.12)`
- selected swatch `0 0 0 2px rgba(0,113,227,0.25)` + border `#1d1d1f`

Spacing rhythm: 4 / 6 / 8 / 12 / 16 / 20 / 24 px (gaps mostly 12, 6, 8); page padding 24 px (40 px 20 px on MainView); card padding 20 px; modal padding 20–24 px; section gap 24–32 px.

z-index ladder: tab bar 50 · popovers 100–200 · modal 1000 · chooser/search 1001 · manual 1002 · settings 1050 · nested type editors 1100 · tooltip 1200 · banner and menus 2000 · copy backdrop 9999 · portalled menus, loader, drag region 10000.

### 5.4 Components

- **Primary button**: bg `#0071e3`, white, no border, radius 10 (12 on MainView), padding `10px 20px` (`12px 24px` large), 15 px / 500, hover `#0077ed`.
- **Secondary (outline)**: white, `1px solid #0071e3`, text `#0071e3`, hover bg `#f5f5f7`.
- **Neutral outline** (Back, undo/redo, Settings): white, `1px solid #d2d2d7`, text `#1d1d1f`; hover bg `#f5f5f7`, border and text `#0071e3`. Undo/redo are 40×40.
- **Grey (Cancel)**: bg `#f5f5f7`, hover `#e8e8ed`. Modal action buttons are `flex: 1` (equal width).
- **Success** (Save, CSV export on ChallengeView): `#34c759` → `#30d158`. **Danger**: `#ff3b30` → `#ff2d20`.
- **Soft blue** (add condition): text `#0071e3`, bg `#f0f7ff`, `1px solid #0071e3`, radius 10, `8px 14px`, 14 px.
- **Icon button**: transparent, `#86868b`, padding 6, radius 6–8, hover bg `#f5f5f7`/`#e8e8ed` and text `#1d1d1f`.
- **Toggle chips** (types, formats, statuses): `2px solid #d2d2d7`, radius 10, `8px 14px`, 14 px / 500; active = border `#0071e3`, bg `rgba(0,113,227,0.12)`, text `#0071e3` (training types use their own colour: border, text, bg = colour + `20` alpha). Format buttons in the manual dialog go solid blue when active.
- **Segmented control**: track `#e5e5e7`, padding 3, radius 12; option radius 9, `7px 22px`, 14 px / 500; active white, 600, shadow.
- **Inputs**: `1px solid #d2d2d7`, radius 10, padding `12px 16px` + 17 px (large) or `10px 12px` + 16 px (compact); focus border `#0071e3` + ring. Note textareas use a 2 px border and no ring. Search input: bg `#f5f5f7`, radius 12, `14px 18px`.
- **Modal**: overlay as above; panel white, radius 20, width 90 %, max-width 500 (challenge, note) / 640 (plan, training, manual) / 580 (plan type) / 420 (training type) / 440 (chooser) / 800 (search) / 820 (edit challenge) / 900 (settings) / 380 (small folder-style dialog, radius 16); max-height 90–94 vh, header + scrolling body, actions separated by `1px solid #f5f5f7`. Close `×` 32 px glyph in a 32×32 hover square.
- **Card** (challenge, plan): white, `1px solid #e5e5e7` (plan: 2 px status colour), radius 16, padding 20; hover border `#0071e3`, shadow, lift 2 px; footer actions row above a `#f5f5f7` divider.
- **Context menu**: `rgba(255,255,255,0.98)`, border `#e5e5e7`, radius 12, menu shadow, items `10px 12px` 14 px / 500, hover `#f5f5f7`, danger `#ff3b30` on `#ffebee`.
- **Day cell**: bg `#f5f5f7` (white when it has trainings), `1px solid #e5e5e7`, radius 12, padding 12, min-height 180; hover `#e8e8ed` + blue border + lift; drag-over bg `#e8f4fd`, `2px dashed #0071e3`.
- **Week container**: white, radius 16, padding 20, `2px solid transparent`; valid = border `#34c759`, bg `#f0fdf4`; invalid = border `#ff3b30`, bg `#fff5f5`.
- **Tab bar**: sticky, bg `rgba(255,255,255,0.85)` + blur 10 px, bottom border `#e5e5e7`; tab bg `#f5f5f7`, radius 9; active white with `#4a90e2` border and a 2 px underline.

### 5.5 Loader — `src/components/Loader.css`

Full-screen `linear-gradient(135deg, #f5f5f7 0%, #ffffff 100%)`, z-index 10000. Centred column, gap 24: logo 120×120 (`public/logo.png`, 1025×1024 source, radius 30, `drop-shadow(0 4px 12px rgba(0,0,0,0.1))`), title 28 px / 600 `#1d1d1f` (−0.5 px), three 10 px dots `#0071e3` with gap 8.
Animations: logo `fadeInScale 1.6s ease-out` (opacity 0→1, scale 0.8→1) then `gentlePulse 4s ease-in-out infinite` (scale 1→1.02); title `fadeInTitle 1.6s ease-out 0.6s both` (translateY 10→0); dots container fades in at 1.2 s; each dot `bounce 2.8s ease-in-out infinite both` (scale 0 / opacity 0.5 at 0, 80, 100 %; scale 1 at 40 %) with delays −0.64 s, −0.32 s, 0 s. Exit: `fadeOut 1.2s ease forwards`.

### 5.6 Motion

- Default `transition: all 0.2s ease` (47 uses); quick hovers 0.15 s; swatches 0.12 s; week validity colour 0.3 s.
- Modal entrance is slow: overlay `fadeIn 0.8s`, panel `slideUp 1.2s` (translateY 20 px → 0). Worth shortening in the rewrite.
- Popovers: `conditionsPopoverIn 0.2s` (−4 px), `floatingTooltipIn 0.18s` (+6 px). Search spinner `spin 3.2s linear infinite`.
- Hover lifts: cards and day cells `translateY(-2px)`, primary button `-1px`, swatches/badges `scale(1.08–1.1)`.

### 5.7 Starter theme

```css
:root {
  --bg: #f5f5f7;            --surface: #ffffff;        --surface-alt: #fbfbfd;   --hover: #e8e8ed;
  --text: #1d1d1f;          --text-muted: #86868b;     --text-subtle: #6e6e73;
  --border: #e5e5e7;        --border-input: #d2d2d7;   --hairline: #f0f0f2;
  --primary: #0071e3;       --primary-hover: #0077ed;  --primary-tint: rgba(0,113,227,.12);
  --primary-soft: #f0f7ff;  --focus-ring: 0 0 0 4px rgba(0,113,227,.1);
  --accent-tab: #4a90e2;
  --success: #34c759;       --success-hover: #30d158;  --success-bg: #f0fdf4;
  --danger: #ff3b30;        --danger-hover: #ff2d20;   --danger-bg: #fff5f5;     --danger-soft: #ffebee;
  --warning: #ffd60a;       --ai: #6d28d9;             --ai-bg: #f3efff;         --ai-border: #ddd3ff;
  --overlay: rgba(0,0,0,.4);
  --radius-xs: 6px; --radius-sm: 8px; --radius-md: 10px; --radius-lg: 12px; --radius-xl: 16px; --radius-modal: 20px;
  --shadow-card: 0 4px 12px rgba(0,0,0,.1);
  --shadow-menu: 0 16px 40px rgba(0,0,0,.18);
  --shadow-modal: 0 20px 60px rgba(0,0,0,.3);
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
}
```

---

## 6. Layout and responsiveness

The Electron window is 1400×900 with **min 1000×700** (`electron/main.js`), so nothing was designed below 1000 px wide. Existing media queries are few:

| File | Query | Effect |
|---|---|---|
| `CalendarView.css` | `max-width: 768px` | week grid 7 → 2 columns; header stacks; title left-aligned |
| `ChallengeCalendarView.css` | `max-width: 1000px` | year grid 4 → 3 columns |
| `ChallengeCalendarView.css` | `max-width: 900px` | undated aside moves below the calendar, full width |
| `TrainingSearchDialog.css` | `max-width: 900px` / `520px` | results grid 3 → 2 → 1 columns |
| `EditTrainingDialog.css`, `ManualTrainingDialog.css` | `max-height: 760px` | smaller preview / drop zone |

Layouts:

- **MainView**: `padding: 40px 20px`, content `max-width: 1200px` centred; centred 48 px title with the gear absolutely positioned right; centred wrapping button row; cards `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, gap 16. Same grid for plans in ChallengeView.
- **ChallengeView header**: one flex row: Back · thumbnail 80 px + title · four buttons. No wrapping rules.
- **CalendarView**: `padding: 24px`; header flex row (Back · centred title with `min-width: 0` · five actions); notes panel and `.calendar-container` both `max-width: 1400px` centred, weeks stacked with gap 24. Each week: `.week-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; }`. Day cell `min-height: 180px`, flex column; training cards stack vertically, each with a 16:9 thumbnail. The page scrolls as a whole (no internal scroll areas, no sticky header besides the tab bar).
- **Scratchpad**: block after the weeks, `margin: 16px 24px 24px` (not constrained to 1400 px, unlike the weeks); cards `flex-wrap` with gap 12, each fixed `width: 168px`.
- **Tab bar**: `position: sticky; top: 30px; margin-top: 30px` (clears the drag region), flex-wrap; tab `max-width: 280px`.
- **Challenge calendar**: `.cc-body` flex, gap 20: main `flex: 1; min-width: 0` + aside fixed `width: 260px`. Month week row = CSS grid `repeat(7, minmax(0, 1fr))`, first row 30 px (day numbers), `grid-auto-rows: 22px` for bar lanes, `min-height: 116px`; bars placed with `grid-column: var(--start) / var(--end)` and `grid-row: calc(var(--lane) + 2)`; weekend shading and vertical lines drawn with pseudo-elements. Year: `repeat(4, minmax(0, 1fr))`, gap 16.
- **Settings**: 900 px modal, 85 vh, fixed 220 px sidebar + scrolling main.
- **Conditions rows**: flex-wrap with `flex: 0 0 140px` type select and `min-width: 165px` scope select.
- Fixed/sticky: drag region (30 px, top, z 10000), banner stack (`top: 36px`), menus and tooltips positioned from mouse coordinates (`utils/positionPopup.js`).

What will be hard at phone width:

1. **HTML5 drag & drop** (`draggable`, `dataTransfer`) for trainings, notes and scratchpad ↔ day does not fire on touch. Needs a pointer-based DnD library or a "move to…" action.
2. **Right-click context menus are the only entry point** for: copy/paste training, quick delete, day colour, move challenge to folder, export project (from the list), copy plan to another challenge, open in tab. Each needs a visible/long-press alternative.
3. **Hover-only affordances**: scratchpad remove button (`opacity: 0` until hover), drag handle, tooltips, card lift.
4. **7-column week grid** with thumbnail cards: at 375 px a column is about 40 px. The existing 2-column fallback at 768 px is the only attempt; a per-day list or horizontally scrolling week is needed.
5. **Month calendar**: 7 columns of ~50 px; bar labels (12 px) become unreadable; bars are 20 px tall drag targets; drag-to-move competes with page scroll (`touch-action: none` is set on bars). Year view: 3 columns of mini-months with 10.5 px digits.
6. **Headers** with 4–5 text buttons in one non-wrapping row (CalendarView, ChallengeView).
7. **Tab bar** with up to 6 two-line tabs wraps into several sticky rows.
8. **Fixed widths**: 260 px calendar aside (handled at 900 px), 220 px settings sidebar (not handled), 360 px search tooltip, 168 px scratchpad cards, condition row min-widths (~360 px before values).
9. **Modals**: `width: 90%` works, but the edit-challenge dialog is very long (description, colour, thumbnail, custom types, condition editor) and the search dialog stacks search + range slider + grid + type picker + actions in 90 vh.
10. **Dual range slider** with 16 px thumbs; 24–28 px colour swatches; 24 px week badge; 10–11 px text throughout.
11. Native `window.confirm` / `alert` are used ~70 times for confirmations, validation and errors.
12. Keyboard-only features (Cmd+S/Z, Esc) need on-screen equivalents (undo/redo buttons exist; fine).

---

## 7. Desktop/local-only parts needing a web replacement

| Today | Where | Web replacement |
|---|---|---|
| IPC storage `storage-get/set`, one JSON file per key, atomic write + `.bak`, corruption side channel | `electron/main.js`, `electron/preload.js`, `src/utils/storageAdapter.js` | HTTP API on Workers + D1 (or KV/Durable Object); per-resource endpoints; optimistic concurrency via `updatedAt`/version |
| All challenges in one file, rewritten on every autosave | `challengeStorage.js` | rows per challenge / plan (plan weeks as a JSON column is fine); `PATCH` one plan |
| Global promise-chain mutex + three coalescing queues | `challengeStorage.js`, `storageAdapter.js` | server-side transactions; client mutation queue (e.g. TanStack Query) with debounce |
| localStorage fallback and one-time migration | `storageAdapter.js`, `index.jsx` | drop; optionally a one-off import of existing JSON files |
| Frameless window: 30 px `-webkit-app-region: drag` strip, tab bar offset 30 px, banner at 36 px | `App.css`, `PlanTabBar.css`, `SaveStatusBanner.css` | remove the strip and offsets; normal top bar |
| Flush-on-close handshake (`app-before-close` → flushers → `app-ready-to-close`, 4 s timeout) | `App.jsx`, `pendingSaves.js`, `main.js` | `visibilitychange` / `pagehide` flush with `fetch(..., { keepalive: true })` or `sendBeacon`, plus `beforeunload` warning while dirty |
| Native file dialogs: export/import `.ptchallenge.json`, pick `Workouts.csv` | `main.js` IPC `dialog-*` | Blob download (already used for CSV) and `<input type="file">` (already the fallback for Workouts.csv); import/export currently refuse to run outside Electron |
| `openExternal` for YouTube links | `preload.js` | `window.open(url, '_blank', 'noopener')` (fallback already present) |
| Native macOS colour picker IPC (`dialog-pick-native-color`) | `main.js`, `preload.js` | unused by the renderer; drop |
| `app://` protocol, CSP meta tag (`img-src 'self' data: https:; connect-src 'self' https:`) | `main.js`, `index.html` | normal hosting; set CSP headers; allow `i.ytimg.com` |
| Thumbnails as base64 data URLs inside challenge/training JSON (duplicated in every copy of a manual training) | `utils/imageUpload.js`, dialogs | upload to R2 / Cloudflare Images, store a URL; keep client-side resize (1280 px, JPEG 0.82, 2 MB input cap) |
| YouTube API key and channel ID baked into the bundle (`VITE_YOUTUBE_*`) with a user override stored in plain JSON; sync runs in the browser | `youtubeConfigStorage.js`, `youtubeLibrary.js` | Worker secret; sync on the server (cron trigger or on-demand endpoint); library stored once, shared; client only searches |
| OpenRouter key and model in the bundle / plain JSON; chat calls from the browser | `aiConfigStorage.js`, `openRouter.js` | Worker secret + proxy endpoint (`/api/ai/describe`, `/api/ai/learn`); prompts can stay as they are |
| Single local user, no auth, no multi-device conflicts | everywhere | authentication and per-user/tenant scoping; decide whether plan types, training types, library, AI profile are global or per user |
| `__APP_VERSION__` from `package.json`, DMG build scripts | `vite.config.mjs`, `scripts/` | build/commit hash; drop packaging |
| In-app search runs over the whole library in memory with Fuse | `youtubeLibrary.js` | still fine client-side for a few thousand videos (ship the library as one cached JSON); otherwise server search |

---

## 8. Code-quality pain points to avoid

- **Global state by prop drilling in `App.jsx`**: `openTabs` holds full `{plan, challenge}` snapshots that must be manually re-synced by four near-identical handlers (`handleUpdatePlan`, `handleUpdateChallenge`, `handleChallengeUpdated`, `handleUpdateScratchpad`). Use a normalised store / query cache keyed by ID and keep only IDs in tabs.
- **Refs everywhere to dodge stale closures**: `CalendarView.jsx` has 23 `useRef`s (plan, challenge, dirty flag, save chain, sequence numbers, history, live notes, timers). Undo/redo button `disabled` state is read from refs during render.
- **Hand-rolled persistence**: debounce + save chain + sequence counters in the component, a flusher registry, three coalescing queues and a global mutex in storage, a write chain in the adapter and another queue in the main process.
- **Two-step saves that can diverge** (inferred from code): `EditChallengeDialog` saves the challenge itself, then `ChallengeView.handleChallengeSave` asks for confirmation about truncating weeks and saves again. Declining leaves `weeksCount` already reduced on disk while plans keep the extra weeks and the screen shows the old value.
- **Planning notes can be wiped** (inferred from code): `EditPlanDialog` saves `runningPlanningNotes: isRunningType ? plan.runningPlanningNotes : ''`, and its "Notatka ogólna" field reads the legacy `plan.note`, which `CalendarView` has already migrated away. Saving plan settings on a non-running plan therefore clears the notes panel. Model one notes field.
- **Duplicated logic**: the conditions editor (state, migration, normalisation, JSX) is copy-pasted in `EditChallengeDialog`, `ChallengeConditionsDialog` and `EditPlanTypeDialog`; `normalizeTrainingMeta` exists twice with different defaults; `CONTENT_MODE`, `RECORDING_STATUS`, `parseDurationToSeconds`, `hexToRgba`, running-type regex are redefined per file.
- **Index-based identity**: trainings/days/weeks addressed by array index; training IDs inconsistent or duplicated (paste). Give every training instance a stable unique ID.
- **Heuristics instead of data**: "running plan" detected by `/bieg|run/` on type id/name/description; plan-type IDs derived from names (Polish letters dropped, a new type with the same slug silently replaces the existing one; a name with only non-ASCII letters yields an empty ID).
- **Legacy shapes handled inline** all over: `training.type` vs `types`, `plan.note` vs `runningPlanningNotes`, `link` vs `manualDescription`, `max_dni_treningowych`, `requirements` vs `conditions`, vestigial `isRunningChallenge`. Migrate once at import time.
- **Global CSS with colliding class names** and no tokens; inline styles for whole sections in the dialogs.
- **Native `alert`/`confirm`** for all feedback; "live-edit with rollback on Cancel" in `EditTrainingDialog` mixed with "edit then Save" dialogs elsewhere; `SettingsDialog` closes on backdrop click with no dirty check while other modals guard it.
- **Global keyboard handler** in `CalendarView` calls `preventDefault` on Cmd/Ctrl+Z even while typing in a textarea, so text undo is replaced by plan undo. The scratchpad is outside the undo history, so undoing a "day → scratchpad" move restores the day but leaves the scratchpad copy.
- **UX defaults that hide data**: the 5–70 min duration filter is on by default; search needs Enter; no way to browse the whole library.
- **Dead code**: `youtubeSearch.js#searchYouTubeVideos` + mock data, `colorPicker` IPC, `date-fns` dependency, `searchLocalVideos`, `normalizeVideoUrl`, NoteDialog `type: 'plan'` branch, CSS for `.saving-indicator`, `.plan-note-preview`, `.add-type-btn`, `.training-color-swatch-button`.
- No TypeScript, tests, ESLint or Prettier.
