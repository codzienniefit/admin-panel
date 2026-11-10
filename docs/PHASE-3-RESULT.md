# Phase 3 result

2026-11-10. Phase 3 of [PLAN.md §7](PLAN.md): the content block editor, built from the prototype at
`https://claude.ai/artifact/6sC41uanfuqX9Ntz33mzpW` and wired into the workout form. It is one
component, ready to be reused for challenge descriptions (Phase 4) and message bodies (Phase 7).

Checked by `npm run check` (typecheck, lint, 137 tests, production build) and by walking the flows
in a browser.

## What it is

Workout and challenge descriptions and message bodies are lists of blocks: Title, Text, Image. In
Retool they were typed as raw JSON. Now:

| Part | What it does |
|---|---|
| **Blocks** | Every block is an open editor. Switch a block between Title and Text, reorder (arrows, drag by the handle, or Alt + arrows), duplicate, delete, add under the selected one |
| **Text** | "B" and "Link" wrap the selection in the only two tags the app understands |
| **Image** | Picked from the media library, or uploaded there on the spot. The proportions are measured from the picture, not typed |
| **Paste text** | Ready text becomes blocks: a blank line separates them; a short lone line becomes a title (the length is adjustable); the rest is text. Replace or append |
| **Paste JSON** | The same box accepts the JSON the old panel used and turns it into blocks. Bad JSON is explained, not just refused |
| **Copy as JSON** | Copies the current content in the JSON form |
| **Preview** | A phone-width picture of what the app will draw |
| **Validation** | Lists every problem with a button that jumps to the block; problems also show under their block |

The preview and the problem list use the same parsing rules as the app. Where the app would print
tags as plain text, the preview shows them as plain text too.

## The rules

All in one tested file, `src/domain/contentBlocks.ts`. They merge three sources: the prototype, the
validator in the Retool panel, and what the backend rejects.

**Errors** (shown wrongly in the app, or refused on save):
- empty title or text; a title with tags
- any tag other than `<b>`, `</b>`, `<a href="…">`, `</a>`, or one of those written differently
  (capitals, extra attributes, spaces)
- a tag left open, or formatting that runs across a line break
- an emoji, a symbol or `[` inside bold or a link (the app stops formatting there and prints the tags)
- bold inside a link or a link inside bold; empty bold
- a link whose address is not in double quotes, or where `href` is not the first attribute
- HTML entities such as `&amp;`
- an image block with no file or without measurable proportions
- a block type the app does not have

**Warnings** (a risk, not a fault): `[` anywhere in text, a link not starting with `https://`, a line
break in a title, spaces or Polish letters in an image's file name.

The app's own emoji pattern is copied from the Retool validator character for character, so the
panel reports what a user will really see.

## How it fits the workout form

- The description is a field in the form: a small preview, a one-line excerpt, the number of blocks
  and of problems, and "Edytuj treść".
- The editor opens window-sized over the form and works on a copy. "Gotowe" puts the result back in
  the form; it is saved with the workout. Closing with changes asks first.
- **A workout with errors in its description cannot be published or hidden**; the form says why. A
  draft can be saved with them. Warnings never block. The same rule runs in the form and in the mock
  server.
- Fields the panel does not know on a block survive editing, JSON import and export.

## Reuse

| For | Use |
|---|---|
| A form field with editor | `ContentField` (label, value, onChange, media folder) |
| Read-only display | `ContentPreview` |
| The editor alone | `ContentEditor`, or `ContentEditorDialog` |
| "Is this content publishable?" | `contentErrors(blocks)` |
| A one-line summary for a list | `contentExcerpt(blocks)` |

## Changed on the way

- Counts are now in correct Polish everywhere ("2 bloki", "5 bloków", "22 treningi").
- The Dialog gained a window-sized variant.

## Not done, or not verified

- **Fonts.** The prototype loads the app's stand-in fonts from Google. The Test environment makes no
  network requests, so the preview uses system fonts. Line breaks in the real app may fall
  differently.
- **Drag to reorder does not work on touch screens** (it is the browser's built-in drag). The arrow
  buttons do the same job there. Proper touch dragging comes with the planner's drag library in
  Phase 5.
- **`[` in text** cannot be previewed faithfully (the app draws it in another font); it is a warning
  with an explanation.
- **Challenges and messages are not wired yet**; those screens do not exist. The component and rules
  are ready for them.
- **Deployment is still unverified**, and screens were checked by reading the page; please look at
  the editor yourself, on desktop and phone width.

## Departures from the prototype

| Prototype | Built | Why |
|---|---|---|
| "Wybierz z biblioteki" and "Dodaj nowe zdjęcie" as two buttons | One button opening the media library, which has upload inside | The library already does both |
| Replacing blocks happens at once | Asks first when there is content | It discards work |
| Two validation messages for `<i>…</i>` | One per tag name | Same problem, said once |
| Its own purple colour scheme | The panel's tokens; the phone preview keeps the app's colours | Decided earlier: palette from Patryk's app |
| Standalone page | A window-sized dialog over the form | Content belongs to the thing being edited |
