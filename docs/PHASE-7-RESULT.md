# Phase 7 result

2026-11-11. Phase 7 of [PLAN.md §7](PLAN.md): messages, badges and users, the last sections of the
Retool panel. Test environment only: sample data, no network. With this phase every tab of the old
panel has its replacement.

This phase was built by a parallel worker to a written brief, in the same working tree, while the
planner and calendar were being built. Its code was then reviewed, walked in the browser at desktop
and phone width, and brought onto the same shared pieces as the rest.

Checked by `npm run check` (secrets scan, typecheck, lint, 560 tests, production build).

## Done when, and whether it is

The plan's criterion: the whole parity checklist passes on the mock.

| Retool function | In the panel |
|---|---|
| **Messages**: list | yes, with status, recipients, sender and dates; search and filters in the address; the archive is hidden unless asked for |
| create draft, edit draft | yes; a draft needs only a description |
| open read-only | sent and archived messages open read-only. A draft opens ready to edit, without Retool's extra "Edytuj" step |
| content with live preview and validation | yes: the block editor of Phase 3 with the phone preview and the list of problems |
| upload image and insert it as a block | yes, from the editor, into the "Wiadomości" folder |
| publish (send) | yes; see "Sending" below |
| archive | yes, and bring back from the archive |
| **Badges**: list with technical info | yes: picture, type, section, visibility, how it is earned |
| create `normal` or `manual`, edit | yes; system badges (repeats, 100%) can be edited but not created |
| hide / unhide | yes; refused while a workout or challenge still awards the badge, with the list of where |
| name, description, image, visible from / to | yes |
| see assignments | yes: "Przypisana do", worked out from workouts and challenges, with links |
| manual: claim code, active switch, copy claim link | yes |
| image library and upload | yes, the "Odznaki" folder, 50 kB limit |
| **Users**: look up | yes, and by e-mail or name too, not only by id |
| badges by subsection | yes |
| progress | yes: summary, challenge attempts, recent workouts |
| e-mail view and change | yes, validated, with a confirmation that shows the old and the new address |

New compared with Retool: duplicate a message as a new draft, grant and revoke a manual badge on a
user, search users by e-mail or name, delete a badge that nothing uses.

## Sending a message

It reaches real people and cannot be taken back, so it is the most guarded action in the panel.

1. What is on screen is checked against the sending rules; problems show at their fields.
2. Unsaved edits are saved first. If that save was combined with someone else's change, sending
   stops and asks for another look.
3. A confirmation names who will receive it.
4. One request is made, for exactly the version that was confirmed. It is never retried silently.

A second click cannot send twice: the button, the request and the server each refuse a repeat.
In Test, sending only changes the message's status.

## Users and personal data

- There is no list of all users. A search needs at least 3 characters, runs when "Szukaj" is
  clicked, and returns at most 20 people, with a note when there were more.
- Results are kept in memory for a few minutes after leaving the screen, never in browser storage.
- The sample people are invented and use `example.test` addresses.

## What the worker added that everything now uses

| Shared piece (`src/ui`) | Job | Also adopted in |
|---|---|---|
| `ListPage`, `SearchInput` | the frame of a list screen | workouts, challenges, media |
| `EditorParts` | loading / not-found dialog, "discard changes?", "Więcej" menu | workout editor |
| `formIssues` (`placeIssues`, `IssuesNotice`) | problems next to fields, or in a notice | workout editor, challenge page and form, planner, settings |
| `Tabs`, `Facts` | tabs, label-value pairs | challenge page, settings |
| `tasks` (`attempt`, `whileBusy`) | async handlers without `try` in components, so the React Compiler compiles forms | workout editor, challenge form |

## Found and fixed during the review

| Problem | Fix |
|---|---|
| Leaving an editor with the browser's Back button dropped unsaved input (also in the older workout editor) | One shared guard (`useUnsavedGuard`) on every editor; the editor's own buttons do not ask twice |
| Table rows could not be opened from the keyboard | Rows take focus and open with Enter |
| The workout editor and the challenge form were skipped by the React Compiler | Both converted; checked in the browser that errors, dirty state and saving still work |
| Three editors each read the saver to learn "merged with someone else's change" | `applyChange` returns it |
| Sample badges pointed at sections the sample configuration did not list | Added |

## Tests

| File | Tests | Covers |
|---|---|---|
| `mock/people.test.ts` | 42 | list, create, save, refusals, conflicts, unknown fields, search limits, send-twice refusal, no personal data in storage |
| `userRules.test.ts` | 19 | search limits, e-mail validation, progress summaries |
| `badgeRules.test.ts` | 18 | what a badge needs by type; hide and delete refusals |
| `messageRules.test.ts` | 16 | draft versus sendable; which actions each status allows |
| `messageFilters`, `badgeFilters` | 10 | list filters and order |

## Not done, or not verified

- **Section and subsection of a badge are shown, not edited.** The backend derives them and refuses
  them on save.
- **Not built** (optional extras of decision 6): message unsend, generating repeat badges, special
  offers.
- **The mock is ahead of the real backend here**: message ids and etags on save, drafts without a
  sender or recipients, bringing a message back from the archive, deleting a badge, etags on
  badges, one flat list of a user's badges. Each is a line for the backend scope before slice L3.
- **What happens to "e-mail verified" after an e-mail change** on the real backend is unknown; the
  mock clears it.
- **No "refresh" buttons**: lists are live.
- **Deployment of this phase is unverified.**

## Review point

This is the point the plan names for going through the whole panel with Patryk and the team,
before any real data is involved. What to bring to it: the open decisions in
[PHASE-6-RESULT.md](PHASE-6-RESULT.md), and [RISKS.md](RISKS.md) §1.
