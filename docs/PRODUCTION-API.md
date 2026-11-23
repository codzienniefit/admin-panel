# Produkcja: every call the panel makes

What the panel asks of the real backend, call by call, and what happens where the backend cannot
do the thing or the panel may not do it yet. First written 2026-11-11 with the HTTP client
(`src/data/api/http/`), against the backend as read at `fede559`
([research/backend-audit.md](research/backend-audit.md)). Brought up to date 2026-11-13 with the
backend's editing contract: versions, statuses, the planning store, badge delete and un-archive.
That contract was read from the backend's code and its own tests (handlers under
`src/handlers/admin/`, `src/common/handlers/panelContract.ts`, `tests/handlers/*PanelContract*`,
`manage*Editing*`, `panelDocsHandler`), and once more the same day after the backend was made
strict: outside a draft it no longer trims, defaults, sorts or coerces anything, and refuses
instead (§3, "Sent exactly as it is to be stored"). **Nothing here has been run against the
backend.**

Related: [SIGN-IN-SETUP.md](SIGN-IN-SETUP.md), [BACKEND-SCOPE.md](BACKEND-SCOPE.md),
[ROADMAP.md](ROADMAP.md) §4 (rules for real data).

## 1. The path of a request

```
screen → collection → ApiClient (src/data/api/http) → /api/… on the panel's own address
       → Worker (worker/proxy.ts): session cookie → signature → fixed backend host
       → backend, on its routes for the panel: /api/panel/…
```

- The browser only ever talks to the panel's own address. The backend's address is a Worker
  setting (`API_ORIGIN`), not in the page.
- The client's paths have no `panel/` in them (`/api/manageChallenges`). The Worker adds it. The
  backend answers the panel's routes with the editing contract and keeps Retool's routes (the
  same names without `panel/`) exactly as they were.
- The Worker forwards only for a signed-in admin, only the calls in its table (`ROUTES` in
  `worker/proxy.ts`; anything else is 404 without reaching the backend), and only the headers
  `accept`, `content-type`, `if-match`, `if-none-match`. A call that changes something is refused
  there too (403 `READ_ONLY`) until its section is in `OPEN_FOR_WRITING`.
- Both environments run the same screens. Which client is behind them is decided once, at load
  (`src/data/api/index.ts`); switching environment reloads the page.

## 2. What is switched on

One file decides what Produkcja may do: `PRODUCTION_CAPABILITIES` in
[`src/data/api/capabilities.ts`](../src/data/api/capabilities.ts). It has two kinds of line.

**What the panel may change.** A feature being on opens none of these.

| Line | Today | Meaning |
|---|---|---|
| `writes.<section>` | **all `off`** except `cache` | `off`: read-only. `test-only`: only items marked `[TEST]` can be created or changed. `on`: normal |

The sections: `workouts`, `challenges`, `badges`, `messages`, `media`, `sendMessage`,
`promotedChallenge`, `users`, `userBadges`, `offers` (new on 2026-11-16, special offers; no
test form: an offer has no comment to carry `[TEST]`, so it is `off` or `on`), and (new on
2026-11-13) `planning`: planning
documents and the planner's settings. Until then the `planning` feature switch was also the
leave to save; with the store there and writes still closed, that had to become two lines.
`cache` (new on 2026-11-16, clearing the app's CDN cache) is `on`: it changes no data, so it is
open while everything else is read-only, here and in the Worker's `OPEN_FOR_WRITING`, and
`isReadOnly` (the read-only bar) does not count it.

**What the backend can do.** These decide how the client talks to it, also when it only reads.

| Switch | Today | On | Off (the way back) |
|---|---|---|---|
| `etag` | **on** | The editing contract. Every entity comes with a version; a save names it (`If-Match`) and the backend refuses a stale one with 409 and the stored entity; a save is answered with the saved entity; a field left out of a save keeps its stored value and `null` clears it; a create that would land on an existing item is refused by the backend. The client also writes every value the way the backend stores it (§3, "Sent exactly as it is to be stored") | The panel reads the stored item just before a save and compares, reads again after it, checks before a create, and names no version. **Against the backend as it is this stops every save** (428, see §4): it is a way to stop writing, not a second way to write |
| `status` | **on** | Draft and deleted exist. Lists ask for the bin (`?includeDeleted=true`). A delete, and a change of status alone, use `POST …/{id}/status` | Only `hidden`: a draft is stored as hidden, comes back as Ukryte, and nothing can be deleted. The bin is not asked for |
| `planning` | **on** | The planning store is read. A variant without an id of its own gets one the backend can adopt (§3, Challenges) | No request: blank documents, default settings, saves refused |
| `badgeDelete` | **on** | `DELETE manageBadges/{id}` | Refused by the panel |
| `messageUnarchive` | **on** | `POST manageMessageDrafts/unarchive` | Refused by the panel |

**Today Produkcja is read-only.** Every save is refused before any request is made, with a
message that says so, and a bar under the top bar says it on every screen. The features above
change what is read (versions, statuses, the bin, planning documents) and nothing else.

To open a section, change its line to `"test-only"`, and add its name to `OPEN_FOR_WRITING` in
`worker/proxy.ts`: a section is open only when both say so. Then, and only then:

- a new item can be created only with `[TEST]` at the start of its internal comment
  (`internalTitle` for workouts and challenges, `comment` for badges, the internal description for
  messages; for a file, a name starting with `test-` or a `test/` folder, which the backend takes
  only inside one of its five folders: `workouts/test/…`)
- an existing item can be changed only if the **stored** version carries the mark too: the client
  reads it from the backend first, so adding `[TEST]` to a real item does not make it editable
- a planning document can be saved only for a challenge whose stored `internalTitle` carries the
  mark; the planner's settings stay closed
- sending a message, changing the promoted challenge, changing a user's e-mail, giving or taking a
  badge, special offers and the planner's settings have no test form; they stay refused until
  their line is `"on"`

A section moves to `"on"` only when Michał says it is accepted.

## 3. Calls

"Refused" means refused by the panel itself, without a request, with the reason shown next to the
form. Sections are those in `ApiClient` (`src/data/api/types.ts`). Paths are as the client writes
them; the backend sees them under `panel/`.

### Configuration

| Call | Request | Notes |
|---|---|---|
| `config.workouts` | `GET workoutsConfig` | Public on the backend |
| `config.internal` | `GET internalConfig` | Public; served from a cache at the edge |
| `config.setPromotedChallenge` | `POST manageChallenges/promotedChallenge` `{ promotedChallengeId }` | No test form: refused unless `on`. The id is sent without spaces around it, `null` for "none". The answer's value is used, because `internalConfig` can still be the cached old one. Refused by the backend (422 at `promotedChallengeId`) for a challenge that does not exist or is not published |

### Challenges

| Call | Request | Notes |
|---|---|---|
| `challenges.list` | `GET manageChallenges?includeDeleted=true` | Every challenge with every variant and day, the bin included: screens filter. Without the parameter the backend leaves deleted ones out |
| `challenges.create` | `POST manageChallenges` with `id: null` | Answered with the new challenge: its id, its version, its `warnings`. No version is sent |
| `challenges.save` | `POST manageChallenges` with `If-Match` | Answered with the saved challenge. One request: no read before, none after |
| `challenges.save`, status only | `POST manageChallenges/{id}/status` `{ status }` with `If-Match` | See "Status alone" below |

Mapping, both ways (`challenges.ts`):

- **Version.** The backend's `etag` (Table Storage's, `W/"datetime'…'"`), sent back as it came in
  `If-Match`. A change to an existing challenge without one is refused by the backend (428). A row
  that came without an etag gets a version worked out here (`t:` + its `updatedAtUtc`); that one
  is compared with a fresh read before the save and cannot be sent, so such a save is refused
  with the 428 text. The backend sends an etag with every stored row.
- **Status.** `status` is sent in words, `hidden` beside it (`status !== "published"`). The four:
  Robocze (`draft`), Opublikowane, Ukryte, W koszu (`deleted`). The backend holds a draft only to
  what makes it storable and reports the rest as `warnings`. Publishing holds the challenge to
  every rule, and so does a draft becoming hidden (hidden content is served to anyone who has
  its id). Saving a challenge as hidden when it was published or hidden needs only a structurally
  sound one, and hiding a published one with the status call needs nothing: taking something
  down does not wait for old content to meet newer rules. The panel checks nothing of this
  before it asks. A deleted challenge can only be restored, and comes
  back as a draft.
- **The promoted challenge stays published.** Hiding it, moving it back to a draft or deleting
  it is refused by every route, the status call included (422 `PROMOTED` at `status`), with the
  backend's message naming the way out: promote another challenge, or none, first.
- **Status alone.** The `ApiClient` has one `save` for an edit and for a status button. The client
  tells them apart itself: it remembers each challenge as the backend last sent it, and when a
  save is that version with another status and nothing else changed, it sends
  `POST …/{id}/status` instead of the whole challenge. A **delete** always goes that way, whatever
  else the save carries, because the backend changes the status and nothing else on a delete (the
  answer is the challenge as it was stored, in the bin; an edit typed together with the delete is
  not saved). Anything the client cannot show to be untouched is sent whole, which is always
  right. One exception: a challenge that still has a made-up variant id (next point) is sent whole
  even for a status alone, so that the id is adopted. And one exception to that: hiding a
  published challenge always goes through the status call, made-up ids or not, because a whole
  save that ends hidden is held to every rule and old content must not stand in the way of
  taking it down.
- **Variant id.** The planner's address, the recent plans and the planning documents name a
  variant by `pathId`. The backend has such ids now (`p_` + 12 hex digits for the ones it makes
  up), but a variant stored before 2026-11-13 has `pathId: null` until its challenge is saved
  again. For those the client makes one up from the level, in a form the backend accepts as a
  proposed id: `level-<levelId>` (`level-<levelId>-2` for a second variant at one level). A save
  sends it and the backend stores it as that variant's id, so **the id a person had open before
  the save is the id after it**. Where that cannot work the id changes to the backend's own: when
  the challenge is saved from Retool, or goes through the status call (which this client uses for
  such a challenge only to delete it), before the panel saved it once; and for a level whose id
  has characters the backend does not take in a path id (then the old form `level:<levelId>` is
  shown and never sent). For those cases the planning list moves what was planned to the new id when it is read
  (§3, Planning). An id the panel gives a new variant (`p-…`) is sent and kept.
- **Warnings.** The answer to a save carries `warnings: [{ path, code, message }]`: what publishing
  would refuse, and what was dropped on a restore (`BADGE_DROPPED`). They are kept on the
  challenge that `save` and `create` return (`challenge.warnings`, only when there are some),
  never sent back, and gone with the next read of the list. No screen shows them yet (§6).
- **Problems by variant.** The backend names a variant in a problem by its place in the request
  (`paths.0.days.2.workoutIds`). The panel's forms and its own rules name it by id, so the place
  becomes the id and the rest stays: `paths.<pathId>.days.2.workoutIds`. The same is done to
  the paths of warnings.
- **Clearing a field.** A field left out of a save keeps its stored value; `null` clears it. The
  client always sends every field it knows, an emptied one as `null`, the three dates
  (`liveAtUtc`, `endsAtUtc`, `availableAtUtc`) included. `subtitle` and `imageRelativePath` are
  sent as `""` when empty.
- **Sent exactly as it is to be stored.** Outside a draft the backend corrects nothing on the
  way in: a value it would once have tidied is a 422 at its field. So the client writes each
  value the way it is stored, where that cannot change what was meant (`fromChallenge`,
  `fromPath`, and the helpers in `shared.ts`):
  - `title` and `subtitle` without spaces around them and without the characters nobody can see
    (a zero-width space, a byte order mark, control characters: what comes along when a text is
    pasted from a document). A line break or a tab inside a title is sent as it is and refused:
    joining two lines would be writing the title for the person
  - ids (`categoryId`, the two badges, the two
    offerings) the same, `null` when blank; `imageRelativePath` the same, `""` when blank; a
    variant's `description` the same, `null` when blank
  - lists of ids (`goalsIds`, `difficultyLevelsIds` of the challenge and of each variant, the two
    entitlement lists, `recommendedNext`) without blank entries and without repeats, the first
    time an id appears kept
  - the days of a variant in the order of their `dayIndex`
  - dates (`addedAtUtc`, `liveAtUtc`, `endsAtUtc`, `availableAtUtc`) as a full ISO 8601 instant
    with a zone, or `null`; never `""`. A moment that names its zone in another spelling
    (`2026-01-31T00:00Z`, or with more than three digits after the second) is written out in
    full. A date without a time or without a zone, and a day that does not exist (31 February),
    are sent as they are and refused by the backend at the field (`INVALID_DATE`): which moment
    was meant would be a guess
  - a new challenge gets `addedAtUtc` (now) when it has none; a stored one that has none is sent
    without the field, which keeps the stored date
  - a new challenge has `id: null` (a save that names an id nobody stored is a 404), and always
    a `status`, with `hidden` saying the same thing
  - `pro` of the challenge and of every variant, and a variant's `minimumDaysToComplete`, are
    always said (the backend requires them outside a draft): "no" and 0 for a stored one that
    never said, which is what the form shows for it
  What is wrong in substance is sent as it is and comes back as the backend's refusal at its
  field: dates that do not fit together (an end without a premiere, an end before it, available
  after the premiere), a number that is not whole, a day index twice, a workout twice in a day,
  two variants of one level, a recommended challenge that is a draft or in the bin, a picture
  that is not in the storage or not in a folder pictures are uploaded to, a text over its
  maximum (`TOO_LONG`, §5).
- **Frequency** is text in the backend and a number in the planner. `"3"` becomes 3. Anything
  else (`"3-4"`) keeps its text beside the number and is sent back unchanged, unless the number
  was changed in the panel. The backend takes only a text of at most 40 characters that starts
  with a number of at least one (`"3"`, `"3-4"`, `"3,5"`). A stored text that is none (empty,
  `"codziennie"`) shows as 1 in the planner, and what the planner shows is what is sent: the
  kept text would be refused whatever the person chose (`isFrequencyText` in `challenges.ts`).
- **Fields the panel does not know** come back and are sent again as they were, at every level:
  among them what the backend works out per variant (`workoutsCount`, `workoutsLength`,
  `difficultyLevelsLabels`, a day's `type`), which it ignores on the way in. Never sent back:
  `etag`, `warnings`, `deletedAtUtc`, `deletedBy`.
- **No field of the panel's own.** The backend refuses a body with a field it neither takes nor
  returns for that item (422 `UNKNOWN_FIELD`, at the top, in a variant, a day, a recommendation,
  a description block). The client sends what the backend returned plus the fields of the
  panel's schema, all of which the backend knows; its own bookkeeping (`frequencyText`, an id it
  made up in the old form) is taken off first. A test per entity holds the body to the backend's
  list of names. A screen that puts a field of its own on an item would be refused at that
  field.
- `updatedAtUtc` is ignored by the backend but held to its rule for dates, so it is sent back
  only as a full instant and left out otherwise.

Not used: `?view=summary` (slim rows without schedule or description) and `?status=…`. The
`ApiClient` has one list, and the planner needs every day of every variant from it (§6).

### Workouts

| Call | Request | Notes |
|---|---|---|
| `workouts.list` | `GET manageWorkouts?includeDeleted=true` | |
| `workouts.create` | `POST manageWorkouts` with `id: null` | Answered with the new workout. A new workout from a YouTube address gets the video's id; when a workout has it already (also one in the bin) the backend answers 409 `WORKOUT_EXISTS`, shown as its message. The panel no longer looks first |
| `workouts.save` | `POST manageWorkouts` with `If-Match` | Answered with the saved workout |
| `workouts.save`, status only | `POST manageWorkouts/{id}/status` `{ status }` with `If-Match` | As for challenges. A delete is refused (409 `IN_USE`) while a challenge that is not itself deleted uses the workout; the way back to a draft, while a challenge the app can see does. The backend's message names the challenges |

`videoUrl` and `imageRelativePath` are sent as `""` when empty. `blurHash` is sent back as loaded.
`recordingStatus` and `format` (the planner's production fields) have no place in the panel's
schema yet: they are kept on the workout as they came and sent back as they were, so a save keeps
them, and no screen can change them (§6). Version, status, warnings, clearing, dates, the new
item's `id: null` and "no field of the panel's own" as for challenges.

Sent exactly as it is to be stored (`fromWorkout`): `title` as a challenge's title; `levelId`,
`badgeId`, `audioRelativePath`, `videoUrl` and `imageRelativePath` without spaces around them;
`trainingTypeIds` and `equipmentIds` without blank entries or repeats; the dates as for
challenges. Left to the backend's refusal: a film address that is not `http(s)://`, the same
film in two workouts (a workout in the bin does not count; the panel's Test environment has the
same rule), a picture or a recording that is not in the storage or not in its folder, a
`blurHash` that is none.

The length of a workout is a whole number of minutes from 1 to 600, in the backend and in the
panel's own rule (`src/domain/workoutRules.ts`). It is no longer the range of the
configuration's `duration`, which is only what the app's filter by length offers.

### Badges

| Call | Request | Notes |
|---|---|---|
| `badges.list` | `GET manageBadges` | Deleted badges are not listed |
| `badges.create`, `badges.save` | `POST manageBadges`, a save with `If-Match` | Answered with the badge itself, as the list shows it (section, dates, what it is assigned to): the list is not read again |
| `badges.remove` | `GET manageBadges`, then `DELETE manageBadges/{id}` with `If-Match` | The list is read first for the stored `[TEST]` mark and to compare versions before asking. Refused by the backend (409 `BADGE_IN_USE`) while anything uses the badge; the refusal says what, one line each: workouts and challenges that award it, how many times it was handed out, that people earn it by progress (hide it first), that its claim link is live (switch it off first) |

A field that belongs to another type of badge is sent as `null`. Left out it would keep its stored
value, and the backend refuses a badge that carries a field of another type (`NOT_ALLOWED`).
Never sent: `sectionId`, `subsectionId` (worked out by the backend), the two dates of its own,
what it is assigned to. An empty `claimToken` of an event badge is left out, so the backend keeps
the stored code or makes a new one. A date can be cleared now (`null`).

A badge has no draft, so every save is held to every rule and nothing is corrected on the way
in. The client (`fromBadge`) sends `name` and `imageRelativePath` without spaces around them,
the two dates as a full ISO instant or `null`, and a claim code without spaces and in capitals
(`normalizeClaimToken` in `src/domain/badgeRules.ts`: the backend stores codes in capitals and
refuses any other spelling; the form may still show what was typed). `isClaimLinkActive` of an
event badge and `milestoneCount` of a milestone badge are left out when the panel has no value,
which keeps the stored one; a new event badge without the first is refused at that field. What
the backend refuses is shown as it words it (§5): the type of a stored badge cannot change
(`IMMUTABLE`), only normal and manual badges can be created, a code another badge has, a badge
that is assigned cannot be hidden, and the picture: it has to be a file in `badges/`, stored
under a clean path, of a kind the app draws, and there (`PATH_NOT_CLEAN`, `NOT_A_FILE`,
`NOT_AN_IMAGE`, `FILE_NOT_FOUND`).

`GET manageBadges/{id}` exists and is not used: the list is small and costs the backend the same
reads.

### Messages

| Call | Request | Notes |
|---|---|---|
| `messages.list` | `GET manageMessageDrafts/list` | Each message with its version. A draft may be unfinished: no title, no sender, no group (`null`), no content |
| `messages.create` | `POST …/upsert` with `If-None-Match: *` | No `id` in the body. The backend refuses (409 `ALREADY_EXISTS`) when a message with that `createdAtUtc` exists, so the list is not read first |
| `messages.save` | `POST …/upsert` with `If-Match` | `id` names the draft. An emptied group value is sent as `null` (left out it would keep the stored one). The description and the sender go without spaces around them, `createdAtUtc` as a full ISO instant |
| `messages.send` | `POST …/publish` `{ id, dryRun: false }` with `If-Match` | Reaches real people. No test form: refused unless `sendMessage` is `on`. Refused by the backend with every reason at its field when the draft cannot be sent. While a send of the same message is under way a second one, an edit and an archive are refused (409 `SENDING_IN_PROGRESS`); the message stays a draft until delivery has finished |
| `messages.archive` | `POST …/archive` `{ id, dryRun: false }` with `If-Match` | Drafts only. For a sent message the backend answers 422 at `status` |
| `messages.unarchive` | `POST …/unarchive` `{ id, dryRun: false }` with `If-Match` | Back to a draft |

The three actions no longer read the list first: the backend checks the version itself. The list
is still read before them in `test-only` mode, to see the stored `[TEST]` mark.

A message that is being sent carries `sendingStartedAtUtc` (kept on the message as it came, never
sent back; no screen reads it yet). The claim lapses by itself ten minutes after it was made,
should the send have died; the refusal says to wait and is not taken for a change by someone else.

`publish` takes `dryRun: true` (everything checked, nothing sent). The `ApiClient` has no call
for it; the client always sends `false` (§6), and always says it: the backend refuses a publish
that does not. An action names the message by its id without spaces around it and carries
nothing else (`{ id, dryRun }`): a field of the message itself in an action is refused.

Sending holds a draft to what the panel's own form holds it to (`src/domain/messageRules.ts`,
`src/domain/contentBlocks.ts`), each problem with a code of its own and at its path (a problem of
the content at `fancyContent.<index>`), shown as the backend words it. Three of them a form has
to know about: a group that can be stored but not sent to yet (`NOT_SENDABLE`, today
`challenge`), a value left on a group that takes none (`NOT_ALLOWED` at `targetGroupValue`; the
panel's rule refuses it too now), and a draft stored with a space around its description or
sender (`UNTRIMMED`: only a save from the panel puts that right).

### Users

| Call | Request | Notes |
|---|---|---|
| `users.search` | `GET manageUsers?query=&limit=20` | The backend wants every word to have 2 characters and one of them 3, takes a `limit` of at most 20 and no `refresh` from the panel, and refuses anything else instead of cutting it down. The rule is the panel's own now (`searchQueryProblem` in `src/domain/userRules.ts`): a query that would be refused is refused there, in Polish, and the client makes no request for it. Only `query` and `limit=20` are ever sent. If nothing matches and the text looks like a user id, `GET accounts/{id}` is tried. The answer says when the list of accounts behind it was read (`indexedAtUtc`: the backend keeps it for up to half an hour) |
| `users.get` | `GET accounts/{uid}` | `{ hasProSubscription, account }` with exactly the fields the panel shows. Built field by field here all the same. 404 for an unknown id |
| `users.badges` | `GET manageUserBadges/{uid}` and `…/grants` | Merged: a badge given by hand or claimed has a date and can be taken back; an earned one has no date |
| `users.progress` | `GET manageUserProgress/{uid}` | Flattened into two histories, newest first |
| `users.changeEmail` | `PUT accounts/{uid}` `{ email }` | No test form: refused unless `users` is `on`. The address without spaces around it, and nothing else in the body. Answered with the account as `GET` gives it, so it is not read again. An address another account has, one that is not an address, or the one the account already has is a 422 at `email`, shown in Polish |
| `users.grantBadge` | `POST manageBadges/grantManual` `{ userId, badgeId }`, then the two GETs | Refused unless `userBadges` is `on`. A badge the user already has, or one that is not manual, is a 422 at `badgeId`, shown in Polish |
| `users.revokeBadge` | `POST manageBadges/revokeManual` `{ userId, badgeId, grantedAtUtc }`, then the two GETs | Same. The grant's date goes back as the backend gave it (a full ISO instant) |

### Media

| Call | Request | Notes |
|---|---|---|
| `media.list` | `GET manageMedia/files` | The whole container, newest first, each file with its size where the storage says it |
| `media.upload` | `POST manageMedia/files?relativePath=…`, the file as the body | Progress is reported. Up to 5 minutes. The stored path is taken from the answer. The backend refuses, each with a code and its own message: a file over its folder's limit (413, with the limit), a kind of file the folder does not take (422, with the list), a folder that is none of the five, a path that is not clean, a file whose content is not what its name says, an empty file, a path that names no file |
| `media.urlFor` | `/api/files?path=…` | The Worker follows the backend's redirect to the file, so the picture loads from the panel's own address and the page's policy stays `img-src 'self'` |

Not used: `?prefix=`, `?pageSize=`, `?pageToken=`. The `ApiClient` lists everything in one call
(§6).

**Folders and limits** are the same list on both sides (`src/domain/mediaRules.ts` here,
`src/config/mediaUpload.ts` there): `workouts` (webp, 250 kB), `challenges` and `messages`
(webp, 300 kB), `badges` (webp, 50 kB), `audio` (m4a, mp3, wav; 32 MB). The panel's list lost
`m4v` (the backend never stored one) and its audio limit came down from 200 MB to 32 MB, which
is what the Worker forwards (`MAX_BODY_BYTES` in `worker/proxy.ts`); a longer recording needs
an upload straight to storage, which is not built. A file goes into one of the five folders or
is refused: there is no `test/` folder of its own, so a test file is told by its name (`test-…`)
or by a `test/` folder inside one of the five (`workouts/test/…`).

**The path.** The backend stores a file only under a path that is already clean (lower-case
ASCII letters, digits, `.`, `_`, `-`; no spaces, no Polish letters) and refuses any other with
`PATH_NOT_CLEAN` and the path it would have been (`cleanPath`). The client produces that form
itself and does not retry: `cleanUploadPath` in `src/domain/mediaRules.ts` is the backend's
`sanitizeRelativePath` step for step, the panel's `uploadPath` is built on it, and the client
applies it once more to whatever path a screen hands it. Should the two ever disagree, the
refusal is shown with the backend's `cleanPath` in it.

### Planning and settings

Stored by the backend since 2026-11-13, as documents it does not look inside
(`manage/panelDocs/{kind}/{id}`; the contract is at the top of
`src/data/api/http/panelDocs.ts`).

| Call | Request | Notes |
|---|---|---|
| `planning.list` | `GET manage/panelDocs/challengePlanning?bodies=true` | One document per challenge; a challenge without one gets a blank one. Shares the challenge list with `challenges.list` when both are asked for together |
| `planning.save` | `PUT manage/panelDocs/challengePlanning/{challengeId}` with `If-Match`, or `If-None-Match: *` for the first save | Refused unless `writes.planning` is open. 201 when created |
| `settings.planner` | `GET manage/panelDocs/settings/planner` | 404 means "nobody saved them yet": the built-in defaults |
| `settings.savePlanner` | `PUT manage/panelDocs/settings/planner` | No test form: refused unless `writes.planning` is `on` |

- **A document follows its variants.** Planning is keyed by `pathId`. When the list is read, what
  was planned under an id the client had made up is moved to the id the backend has given that
  variant since (see "Variant id" above), and stored that way with the next save. It is moved
  only when nothing can be lost or mixed up: no variant still has the old id, and nothing is
  planned under the new one.
- **The bin.** The backend puts a challenge's planning document in the bin with the challenge and
  brings it back with it. While it is there the list shows a blank document for that challenge,
  and a save of it is refused by the panel: the backend would store the blank one in place of the
  one in the bin, for good.
- **A document that is gone.** A save that names a version of a document that is no longer there
  is answered 404. The panel reports that as it is ("the document is gone, refresh"), and does not
  create the document again from what was on screen.

### Special offers

Panel only besides the list: `panel/manageOffers` of the backend (`adminOffersHandler.ts`,
rules in `offerPanelRules.ts`), the same rules in the panel (`src/domain/offerRules.ts`, same
paths and codes). Screen: Oferty.

| Call | Request | Notes |
|---|---|---|
| `offers.list` | `GET manageOffers` | Every offer with its version and its count of attributed purchases |
| `offers.create` | `POST manageOffers`, `id: null`, no version | Always created switched off (the panel's draft). The server assigns `o_N`, inserting, never replacing: a create that lands on an id taken a moment earlier takes the next one |
| `offers.save` | `POST manageOffers` with `If-Match` | The whole offer, stored exactly as sent: the client puts the code in capitals, trims ids and sends an empty text as `null` first; the backend corrects nothing. `etag`, `purchases`, `createdAtUtc`, `updatedAtUtc` are never sent. 409 with the offer as stored; 428 without a version |
| `offers.setActive` | `POST manageOffers/{id}/status`, `{ active }`, `If-Match` | Switching on is publishing: the stored offer must pass everything a save with `active: true` would, and RevenueCat must know its offering (and entitlement, if named). Switching off accepts no data and is never held up, not even by RevenueCat being down |
| `offers.choices` | `GET manageOfferChoices` | The offering and entitlement ids RevenueCat knows, for the form's selects; a list is `null` when RevenueCat could not be asked, and the form then takes a typed id |

What an offer is held to: a switched-off offer may lack its title, subtitle and store ids, but
what it has must be right (a code of 3 to 32 capitals, digits, `-`, `_`, used by no other offer;
ids without spaces around them; full ISO dates; no unknown fields). A live offer needs all of it,
its end must not have passed (a live offer may keep an end that has passed: the app then says
"expired"), and its offering must be on no other live offer (the webhook would count each
purchase twice). Length and format rules for copy and store ids apply only to a value that is new
or changed, so an offer saved before them can still be edited or switched off.

### The app's cache

| Call | Request | Notes |
|---|---|---|
| `cache.purge` | `POST manageCache/purge`, no body | Asks Cloudflare to drop its whole copy of the app's catalogue (the backend does the same after every admin save). Changes no data, so it works in Produkcja. 200 `{ purgedAtUtc }`. Refusals, shown as the backend words them: 502 `CDN_PURGE_FAILED` and 503 `CDN_NOT_CONFIGURED` (`server`), 429 `CDN_PURGE_TOO_SOON` (`validation`). The Test environment has no CDN: it answers after the usual delay with `simulated: true`, and the screen says nothing was purged. Screen: Ustawienia → Aplikacja |

### The record of changes

`GET manageAudit` (who changed what through the panel, newest first, with filters and a cursor)
exists on the backend and in the Worker's table. The `ApiClient` has no call for it and no screen
shows it (§6).

## 4. Versions and conflicts

Every entity has a version when read: the backend's `etag`, sent back unchanged.

- A save names the version it is based on (`If-Match`). The backend compares, atomically, and
  answers **409 `CONFLICT`** with the entity as stored now (`current`) when someone saved in
  between. The panel then starts its "changed meanwhile" flow with that version, exactly as in
  Test. Where the 409 comes without `current`, the entity is read again.
- **A version is required.** A change to something that exists, sent to the panel's routes
  without a version (or with `If-Match: *`), is answered **428 `VERSION_REQUIRED`**: challenges
  and workouts (save and the status call), messages (save, publish, archive, un-archive), badges
  (save, delete). Creating needs none. The client sends the version on every one of those calls.
  A 428 therefore means a fault in the panel; it is shown as a refusal that says so, is not merged
  like a conflict and is not tried again.
- Planning documents work the same way with their own codes (`PANEL_DOC_CONFLICT`,
  428 `PANEL_DOC_VERSION_REQUIRED`).
- With `etag` switched off the client goes back to reading the stored item before a save and
  comparing, and names no version, which the backend as it is refuses (428). That switch is
  therefore a way to stop saving while something is looked into, not a second way to save.
- `test-only` mode reads the stored item before a save in any case, for its `[TEST]` mark, and
  compares versions while it is there.

## 5. Failures

Whatever the backend answers becomes one `ApiError` with a `kind`; screens never look at status
codes (`failures.ts`). Every panel route answers a failure in one shape, `{ error, errorCode }`
plus `issues: [{ path, code, message }]` on a 422 and `current` on a 409, with the messages in
Polish. **The panel shows them as they are**: `error` is the message, each issue goes to the field
its `path` names. The panel's own Polish texts are only for an answer without `error`.

| Backend answer | Kind | Shown as |
|---|---|---|
| 401 | `unauthorized` | Back to sign-in (the page reloads there) |
| 403 | `forbidden` | "To konto nie ma dostępu do panelu." |
| 403 `READ_ONLY` (the Worker: the section is not open there) | `validation` | The Worker's message |
| 404 | `notFound` | `error` |
| 409 `CONFLICT`, `PANEL_DOC_CONFLICT`, or without a code; 412 | `conflict` | The "changed meanwhile" flow, with `current` (or the entity read again) |
| 409 with any other code (`IN_USE`, `BADGE_IN_USE`, `WORKOUT_EXISTS`, `ALREADY_EXISTS`, `SENDING_IN_PROGRESS`, …) | `validation`, status 409 | `error`. Never merged, never tried again |
| 400, 422 | `validation` | `error` (or the issues joined), each issue at its `path` |
| 413, 428, 429 with `error` | `validation` | `error` |
| 500 | `server` | "Backend napotkał błąd. Spróbuj ponownie za chwilę." |
| 429, 502, 503, 504 without `error` | `server` | "Backend jest chwilowo niedostępny." (`error` when there is one, for 502–504) |
| No answer, or 30 seconds without one | `network` | "Brak połączenia…" / "…nie odpowiedział na czas" |
| 200 that does not fit the schema, or is not JSON at all | `server` | "Backend odpowiedział w nieoczekiwany sposób", naming the item and the field. Never taken for a successful save |

A refusal without `issues` is listed as one issue at path `""` (next to the form as a whole).
The only change the client makes to an answer is the path of a challenge's variant:
`paths.0.…` becomes `paths.<pathId>.…`, so the problem stays with its variant.

A row that does not fit is not skipped: the whole list fails, naming the row. A list that quietly
left an item out would hide real content.

The developer register (top bar) shows each call with the status the backend really sent.

## 6. Not built, and not verified

- **Nothing here has met the real backend.** The first run on real data will find rows the schemas
  refuse. That is what slice L2 is for.
- **Writes are closed**, here (`writes`, all `off` but `cache`) and in the Worker
  (`OPEN_FOR_WRITING`, only `cache`, which changes no data).
  Everything in this document about saving describes what the client will do when a section is
  opened; it is tested against answers copied from the backend's tests, not against the backend.
- **Screens do not show what the backend now says.** Warnings of a saved draft
  (`challenge.warnings`, `workout.warnings`), the list of what uses a workout or a badge (the
  lines are in the error; a screen shows them as plain text at best), when and by whom something
  was deleted (`deletedAtUtc`, `deletedBy`), the size of a file, how fresh a user search is.
- **Screens do not hide what is closed.** A draft button, the planning tabs, "Usuń": they are all
  there in Produkcja and answer with the refusal. Hiding them section by section is the panel half
  of slices L3 to L7.
- **No call for a status alone.** The client works out by itself when a save is only a change of
  status. A `setStatus` on the `ApiClient` would say it outright.
- **Lists load whole.** `GET manageChallenges` is every challenge with every day;
  `GET manageMedia/files` is every file. The backend has slim rows (`?view=summary`) and pages
  (`?pageSize=`), the `ApiClient` has no call that takes either.
- **No history.** `GET manageAudit` has no call in the `ApiClient` and no screen.
- **No dry run of a send**, and the workout's `recordingStatus` and `format` have no field in the
  panel's schema.
- **Forms still check by their own lists.** The client makes a value valid where that is safe
  and words the refusal where it is not, but a form that would stop the person earlier does not
  exist for the backend's newer rules: the maximum lengths, dates that have to fit together, a
  recommended challenge that is a draft, a file that is not in the storage, the promoted
  challenge, a group that cannot be sent to. The workout editor still offers the configuration's
  range for the length (`src/features/workouts/WorkoutEditor.tsx`) where the rule is 1 to 600.
- **A refusal with a code the client has no words for is shown in English**, as the backend
  words it (messages, badges, accounts, media). Every code read in the backend on 2026-11-13 has
  words.
- Repeat-badge generation and message unsend have no screens and no calls. Special offers have
  both (2026-11-16) but have not been tried against the real backend or RevenueCat.
