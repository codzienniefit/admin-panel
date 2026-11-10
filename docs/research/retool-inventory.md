# Retool panel inventory

Source: `Panel - odznaki-2.json` (Retool export saved 2026-10-01, app-state 4.68.0, 283 plugins). It is
newer than `backend/Panel.json` (2026-08-14); same screens and queries, the only functional
difference is challenge entitlements (one id became two id lists).

Everything here was read from the export; nothing was run. Runtime consequences in §6 are inferred
from configuration. Raw extractions sit next to this file:

- [retool/code-extract.txt](retool/code-extract.txt): every JS query, REST template, event script and
  the global JS (fancy-content validator and preview), verbatim
- [retool/tables.txt](retool/tables.txt): the four tables with every column property
- [retool/widgets.txt](retool/widgets.txt): every other widget with its non-default props and events

## 1. Structure

One page, one tabbed container, five tabs. No URL state, no environments switch, no bulk operations,
no delete of anything. It always opens on Treningi.

| # | Tab | Purpose |
|---|---|---|
| 1 | Treningi | workouts table; modal with details form, image library ("Grafiki"), audio library ("Audio") |
| 2 | Wyzwania | challenges and plans in one table; "Promowane wyzwanie" select in the header; full-width modal with details on the left and the paths/schedule editor on the right, plus "Grafiki" |
| 3 | Wiadomości | message drafts; modal with preview and edit modes, raw JSON content, live preview with validation |
| 4 | Odznaki | badge definitions; modal with form and badge image library |
| 5 | Użytkownicy | paste a user id; badges, raw progress JSON, e-mail (editable) |

**Not in Retool, although the backend has endpoints:** offers, user search, granting or revoking a
badge for a user, message unsend, repeat-badge generation. Covering them is new scope, not parity.

The challenge schedule is edited with structured controls. Raw JSON is used only for "fancy content"
(workout and challenge descriptions, message bodies).

## 2. Endpoints used

All relative to the Retool resource "Fit Azure HTTP". The export holds no credential and no auth
header; they live in the Retool resource (a shared function key, per the backend docs).

| Method + path | Used by |
|---|---|
| GET `api/internalConfig` | badge types, message target groups, promoted challenge id; refetched on every tab change |
| GET `api/workoutsConfig` | all select options (levels, equipment, training types, goals, categories, challenge levels, duration range) |
| GET, POST `api/manageWorkouts` | workouts list and save |
| GET, POST `api/manageChallenges` | challenges list and save |
| GET `api/manageChallenges/{id}` | conflict check before saving a challenge |
| POST `api/manageChallenges/promotedChallenge` | promoted challenge |
| GET `api/manageMessageDrafts/list`; POST `…/upsert`, `…/publish`, `…/archive` | messages |
| GET, POST `api/manageBadges` | badges |
| GET `api/manageMedia/files`; POST `api/manageMedia/files?relativePath=<folder>%2F<file>` (binary body) | image and audio libraries |
| GET `api/manageUserBadges/{userId}`, GET `api/manageUserProgress/{userId}` | user tab |
| GET, PUT `api/accounts/{userId}` | user e-mail |
| GET `https://blobs.codzienniefitapp.com/public/{path}` | media reads (public) |

Defaults: 10 s timeout (publish: 500 s), success and failure toasts, no caching except the user tab
(300 s). Lists are sorted with `data.sort(x => x.addedAtUtc).reverse()`, which is not a real sort.

## 3. Screens and fields

All date-time fields: `dd.MM.yyyy` + time, stored UTC, shown local, week starts Monday.
"req" = required in the form.

### 3.1 Treningi

**Table.** Toolbar: "Szukaj" (filter builder), "Odśwież", "Stwórz nowy trening". Row action "Edytuj";
double-click edits. Empty text "Ładowanie...". No pagination.

| Column | Field | Notes |
|---|---|---|
| Grafika | `imageRelativePath` | image |
| Nazwa | `title` | |
| Komentarz | `internalTitle` | |
| Poziom | `levelId` | title from `trainingLevels` |
| Sprzęt | `equipmentIds` | tags from `equipmentTypes` |
| Typ | `trainingTypeIds` | tags from `trainingTypes` |
| Link | `videoUrl` | text "Youtube" (the click target is broken, §6) |
| Pro | `pro` | boolean |
| Ukryty | `hidden` | boolean |
| Data dodania | `addedAtUtc` | |
| Data aktualizacji | `updatedAtUtc` | |
| Czas | `durationMinutes` | "N min" |
| LIVE | `liveAtUtc` | tag when set |
| PREMIERA | `availableAtUtc` | tag when set |

**Form.** Title "Nowy trening" or "<title> (id: <id>)". Submit "Stwórz nowy" / "Zapisz zmiany",
disabled while saving or while the description JSON is invalid. Toast "Trening zapisany".

| Label | Field | Widget and rules |
|---|---|---|
| ID | `id` | read-only |
| Poziom | `levelId` | select, **req** |
| Nazwa | `title` | text, **req**, min 4 |
| Czas (min) | `durationMinutes` | number, **req**; min and max from `workoutsConfig.duration` (defaults 10 and 90) |
| Ukryj | `hidden` | switch |
| Komentarz (niewidoczny w apce) | `internalTitle` | text |
| Data dodania | `addedAtUtc` | date-time, default now |
| Data live | `liveAtUtc` | date-time, clearable, 15-minute step |
| Data premiery | `availableAtUtc` | date-time, 15-minute step |
| Płatny | `pro` | switch |
| Opis | `descriptionFancyContent` | JSON editor; link "Skopiuj przykład z tytułem i treścią" |
| Sprzęt | `equipmentIds` | multiselect |
| Typ | `trainingTypeIds` | multiselect |
| Link (YouTube) | `videoUrl` | URL, with inline video preview; link "YouTube Codziennie Fit" opens the channel |
| Odznaka za wykonanie | `badgeId` | select with images; `normal` badges, hidden ones excluded; placeholder "Wybierz odznakę" |
| Audio | `audioRelativePath` | text; "Wybierz plik audio" opens the audio library; speaker button plays |
| Grafika | `imageRelativePath` | text, min 4; "Wybierz miniaturkę" opens the image library; preview |

**Grafiki.** Link "Narzędzie do kompresji" (compress-or-die.com/webp); "Dodaj zdjęcie" (webp only, max
250 kB); "Wyślij"; "Odśwież"; 5-column grid of all images; click picks the image.
**Audio.** "Dodaj audio" (m4a, m4v, mp3, wav; max 200 MB); "Wyślij"; "Odśwież"; grid with "Wybierz" and
"Odtwórz".

Upload folders by context: `workouts/`, `challenges/`, `messages/`, `badges/`, `audio/`.

### 3.2 Wyzwania

**Header.** "Promowane wyzwanie" select (live challenges that are not hidden; placeholder "Wybierz lub
zostaw puste"; clearable) and "Zapisz".

**Table.** Toolbar: "Szukaj", "Odśwież", "Stwórz nowe wyzwanie". "Edytuj"; double-click edits.

| Column | Field | Notes |
|---|---|---|
| Grafika | `imageRelativePath` | |
| Nazwa | `title` | |
| Subtitle | `subtitle` | |
| Typ | computed | `liveAtUtc` set → "Wyzwanie"; else by `categoryId`: `main` "Plan główny", `supplementary` "Plan uzupełniający", `archived` "Archiwalne", none "Plan" |
| Data dodania, Data aktualizacji | `addedAtUtc`, `updatedAtUtc` | |
| Dni | `lengthDays` | |
| Ukryte | `hidden` | |
| Pro | `pro` | |

**Form, left column.** Header button "Stwórz nowe" / "Zapisz zmiany". Toast "Wyzwanie zapisane".

| Label | Field | Widget and rules |
|---|---|---|
| ID | `id` | read-only |
| Ukryj | `hidden` | switch |
| Nazwa | `title` | text, **req**, min 4 |
| Podtytuł | `subtitle` | text, **req**, min 4 |
| Komentarz (niewidoczny w apce) | `internalTitle` | text |
| Płatne | `pro` | switch; the four fields below show only when on, with the hint "Wypełnij pola poniżej jeżeli dostęp do wyzwania wymaga wykupienia osobnego produktu" |
| Lista id entitlementow odblokowujacych, np. "id1,id2" | `unlockedByEntitlementIds` | text, comma-separated → string[] |
| Offering id w najwyzszej cenie | `offeringId` | text; null unless paid |
| Lista id entitlementow zeby widziec przeceniony offering | `discountedForEntitlementIds` | text, comma-separated → string[] |
| Offering id przeceniony | `offeringDiscountedId` | text; null unless paid |
| Cele | `goalsIds` | multiselect |
| Poziomy trudności | `difficultyLevelsIds` | multiselect |
| Data dodania | `addedAtUtc` | date-time, default now |
| Widoczne od | `availableAtUtc` | hidden widget, default now, still sent |
| Data aktualizacji | `updatedAtUtc` | read-only; used as the conflict token |
| Kategoria | `categoryId` | select, clearable |
| Data premiery | `liveAtUtc` | date-time, clearable. Note under it: set 13:00 on the premiere day to avoid the "joined on day 2" bug; the challenge is available from midnight anyway |
| Data ukrycia | `endsAtUtc` | date-time, clearable |
| Czas trwania (dni) | `lengthDays` | number, min 1 |
| Liczba widocznych dni do przodu | `visibleDaysUpFront` | number, default 100 |
| Opis | `descriptionFancyContent` | JSON editor; "Skopiuj przykład z tytułem i treścią" |
| Odznaka za wykonanie | `badgeId` | select |
| Odznaka za wykonanie w 100% | `perfectCompletionBadgeId` | select |
| Grafika | `imageRelativePath` | text, min 4; "Wybierz miniaturkę"; upload webp max 300 kB |

`recommendedNext` has no UI in Retool; the backend keeps the stored list when the field is omitted.

**Form, right column: paths.** "Ścieżki (N)"; "Dodaj ścieżkę" opens a modal with "Nowa ścieżka" (levels
not used yet) and "Duplikuj z (opcjonalne)..." (levels in use); a select switches between paths.

Per path: "Treningi na tydzień" (`frequency`, min 1), "Min. dni" (`minimumDaysToComplete`, min 0),
"Opis" (`description`), "PRO" (`pro`), "Poziomy trudności" (`difficultyLevelsIds`), "Usuń ścieżkę"
(confirm "Na pewno chcesz usunąć ścieżkę?"), "Dodaj dzień".

Per day: "Dzień N", marked "(rest day)" when empty; three selects "Trening 1/2/3" over all workouts
(label "<title> (<id>)", searchable, clearable); "Do góry", "W dół", "Usuń" (no confirm; days are
renumbered 1..N). At most three workouts per day.

New path defaults: `frequency 1`, `minimumDaysToComplete 1`, no equipment, no description, one empty day.

**Conflict check.** Before saving, the panel re-reads the challenge and compares `updatedAtUtc`; on a
difference it shows "Uwaga - ktoś inny zapisał to wyzwanie w międzyczasie" / "Czy na pewno chcesz
nadpisać zmiany?" with "Tak, chcę nadpisać zmiany".

### 3.3 Wiadomości

**Table.** "Odswiez", "Nowa wiadomosc". Columns: ID, Opis (`title`), Nadawca (`from`), Status (`draft`
Robocza, `sent` Wysłana, `archived` Zarchiwizowana), Odbiorcy (`targetGroup`, label from
`internalConfig`), Data utworzenia, Data wyslania. Empty text "Brak wiadomości".

**Modal.** Title by state: "Nowa wiadomosc", "Edycja wiadomosci", "Podgląd roboczej wiadomości",
"Wyslana wiadomosc", "Zarchiwizowana wiadomosc". A new message opens in edit mode; an existing one
opens read-only.

| Label | Field | Rules |
|---|---|---|
| Opis (niewidoczny w apce) | `title` | **req**, min 3 |
| Nadawca | `from` | **req**, min 3 |
| Data utworzenia | `createdAtUtc` | read-only, default now. It is the message identity (§6) |
| Odbiorcy | `targetGroup` | **req**; Wszyscy / Pro / Darmowi |
| Treść | `fancyContent` | JSON editor, edit mode only; "Skopiuj przykład" |
| Podgląd | | rendered preview with a validation banner |

Editorial note shown in the modal: do not write about buying a subscription through the store (Apple
may ban the app); supported tags are `<b>` and `<a href>`.

Buttons: "Zapisz" (draft or new, editing), "Edytuj", "Wyslij" (confirm "Na pewno chcesz WYSLAC
wiadomość?"; toast "Rozpoczeto wysylanie wiadomosci"), "Archiwizuj" (confirm "Na pewno chcesz
ZARCHIWIZOWAC wiadomość?"). Sent and archived messages are view-only.

Grafiki (edit mode only): upload webp max 300 kB; per image "Przygotuj" then "Skopiuj", which measures
the image and copies an `Image` block (`imageRelativePath`, `heightToWidthRatio`) to the clipboard.

### 3.4 Odznaki

**Table.** "Stwórz odznakę"; double-click edits. Columns: Nazwa, Grafika, Typ (label from
`internalConfig.badgeTypes`), Opis (`comment`), Info techniczne (milestone: "<count>x (<category>)";
normal: "Przypisana do N treningów i M wyzwań" or "Nieprzypisana").

**Modal.** "Nowa odznaka" / "Edycja odznaki"; "Stwórz odznakę" / "Zapisz zmiany". Toast "Odznaka zapisana".

| Label | Field | Rules |
|---|---|---|
| ID | `id` | read-only |
| Typ | `type` | `normal` or `manual` (`milestone` and `perfections` are disabled); locked when editing; default `normal` |
| Ukryj | `isHidden` | switch |
| Nazwa | `name` | min 3 |
| Grafika | `imageRelativePath` | must contain `badges/` |
| Opis (opcjonalny) | `comment` | |
| Widoczna od | `activeFromUtc` | clearable |
| Widoczna do | `activeTillUtc` | clearable (saving it is broken, §6) |
| Przypisana do | | read-only list: "Wyzwanie '<name>'", "Trening '<name>'" |
| Kod do zdobycia odznaki (zmiana popsuje stare linki/kody QR) | `claimToken` | `manual` only, min 6 |
| Skopiuj link do zdobycia odznaki | | copies `codzienniefit://badge?code=<claimToken>` |
| Zdobywanie aktywne | `isClaimLinkActive` | `manual` only |

Grafiki: upload webp max 50 kB; grid filtered to `badges/`.

### 3.5 Użytkownicy

"ID użytkownika" text field (no search). Tabs: "Odznaki" (sections → subsections → badges with
tooltip), "Wykonania" (raw JSON of progress), "Dane ogólne" (e-mail; "Zmień adres email" with confirm
"Czy na pewno chcesz zmienić adres email z <old> na <new>?").

## 4. Fancy content

An array of blocks used for workout and challenge descriptions and message bodies:

```json
[{ "type": "Title", "content": "…" },
 { "type": "Text", "content": "… <b>bold</b> … <a href=\"https://…\">link</a>" },
 { "type": "Image", "content": "", "metadata": { "imageRelativePath": "challenges/x.webp", "heightToWidthRatio": 0.64 } }]
```

The global JS (`convertAdminFancyContentToMarkdown`, first section of
[retool/code-extract.txt](retool/code-extract.txt)) renders a preview and reports problems. Its rules,
to be ported into the block editor:

- unknown block type; empty Text
- emoji, symbols or `[` inside `<b>` or `<a>`; any `[` in Text (the mobile app's parser splits on them)
- unsupported tags; unpaired tags; a tag spanning a line break; nested `<b>`/`<a>`; empty `<b></b>`
- link without a double-quoted address, `href` not the first attribute, non-http address
- HTML entities
- Title with tags or a line break
- Image without metadata or path, path with spaces or non-ASCII characters, ratio missing, ≤ 0 or ≥ 5

The backend repeats a subset on save (types, empty content, tags in Title, `<br>`, `<u>`, `<i>`,
image metadata, ratio between 0 and 5).

## 5. Payload rules worth keeping

Full payload builders are in the code extract. The non-obvious parts:

- New entities are sent with an empty or null `id`; the server allocates it.
- Workout: empty `addedAtUtc` → now; empty `liveAtUtc` and `availableAtUtc` → null; blank image and
  audio paths → null.
- Challenge: empty `liveAtUtc`, `endsAtUtc`, `availableAtUtc` → the property is omitted; offering ids
  are null unless "Płatne"; day `workoutIds` are stripped of empty entries; unknown path fields from
  the server are passed back untouched.
- Message: no `id` in the payload.
- Badge: the existing badge is spread into the payload first, then form fields overwrite it.

## 6. Bugs and half-built parts (do not port)

1. **The overwrite guard defeats itself.** Opening the conflict dialog triggers the save again without
   `force`, which skips the check and saves. The new panel needs a real conflict flow.
2. The "is editing" flag for challenges is never written, so the conflict read also runs for new
   challenges and on page load with no id.
3. The conflict check compares a server string with a date widget value; format differences can raise
   false conflicts.
4. The challenge save button is a plain click and bypasses form validation.
5. New challenge defaults set "Data premiery", "Data ukrycia" and the hidden "Widoczne od" to now, so a
   new row is a "Wyzwanie" unless the dates are cleared; "Widoczne od" cannot be cleared at all.
6. **Badge "Widoczna do" is saved as `activeToUtc`**; the backend field is `activeTillUtc`. Editing the
   end date has no effect.
7. **Badge save nulls `sectionId` and `subsectionId` and forces `specialCategory` to `event`** for
   manual badges; the backend also supports `specialTraining`.
8. **Message identity is its creation date**, and the field is date-only; two drafts created on the
   same day may collide. Confirm before porting.
9. The message "Wyzwanie" target select is permanently hidden; the backend cannot publish to that
   group either.
10. Workout table link opens an undefined URL (wrong field case). The per-day "YouTube" link never shows.
11. "Duplikuj ścieżkę" assigns the same object to both levels, so editing one edits the other until save.
12. Path `equipmentIds` has no UI (the backend recomputes it anyway).
13. Uploads: the folder depends on which modal is open; 200 MB audio with a 10 s timeout; only the
    badge library is filtered by folder.
14. `_.startCase` changes how message titles, senders and badge names are displayed.
15. User tab: a hard-coded default user id; the e-mail button is disabled when the address is **not**
    verified (confirm the intent).

## 7. Parity checklist

**Treningi.** List with all columns · filter · refresh · create · edit · hide/unhide · paid · level,
duration, equipment, types · added, live and premiere dates · description · YouTube link with preview ·
completion badge · pick thumbnail · upload image · pick audio · play audio · upload audio.

**Wyzwania.** List with type tag · filter · refresh · create · edit · hide/unhide · title, subtitle,
comment · paid with entitlement and offering ids · goals, difficulty levels, category · added, premiere
and hide dates · length in days · days visible up front · description · completion and 100% badges ·
thumbnail pick and upload · add, duplicate, switch and remove path · per path: workouts per week, min
days, description, PRO, difficulty levels · add, remove, move day · up to three workouts per day ·
rest-day marker · conflict detection · set and clear promoted challenge.

**Wiadomości.** List · refresh · create draft · open read-only · edit draft · content with live preview
and validation · upload image and insert it as a block · publish · archive.

**Odznaki.** List with technical info · create `normal` or `manual` · edit · hide/unhide · name,
description, image, visible from/to · see assignments · manual: claim code, active switch, copy claim
link · image library and upload.

**Użytkownicy.** Look up by id · badges by subsection · progress · e-mail view and change.
