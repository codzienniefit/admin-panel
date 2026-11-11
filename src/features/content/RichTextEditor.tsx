import { Popover as BasePopover } from "@base-ui/react/popover";
import { Extension, Mark as MarkExtension, posToDOMRect } from "@tiptap/core";
import { Bold } from "@tiptap/extension-bold";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import {
	type Node as DocumentNode,
	Fragment,
	type Mark,
	Slice,
} from "@tiptap/pm/model";
import { type EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { linkAddressProblem } from "@/domain/contentBlocks";
import { contentToDoc, contentToInline, docToContent } from "@/domain/richText";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/Field";
import { blockField } from "./blockField";

// The field of a Text block: bold looks bold and a link looks like a link,
// with no tags to read or to break. What is stored stays what it was, one
// string with <b> and <a href>; `domain/richText.ts` turns it into the
// editor's document and back, and nothing here builds or reads markup.
//
// The editor is Tiptap (ProseMirror) with only what a text block can hold:
// one paragraph, text, line breaks, bold, links, undo. Two things differ from
// its defaults, both because of what the app can show:
//
//   - Enter is a line break inside the block, never a second paragraph;
//   - whatever is pasted arrives as plain text. Formatting from a web page or
//     from Word is dropped; our own two tags, typed out in the pasted text,
//     are understood (they would be on the next opening anyway).

/** One paragraph is the whole document; lines are parted by breaks. */
const OneParagraph = Document.extend({ content: "paragraph" });

const LineBreakOnEnter = Extension.create({
	name: "lineBreakOnEnter",
	// Ahead of the built-in Enter, which splits the paragraph.
	priority: 1000,
	addKeyboardShortcuts() {
		return { Enter: () => this.editor.commands.setHardBreak() };
	},
});

/**
 * A link as the stored text has it: an address, and the opening tag as it
 * was written when that is not the plain one (see `RichMark`).
 *
 * Written here rather than taken from Tiptap's link extension: that one is
 * mostly automatic linking of typed and pasted addresses (and the address
 * recogniser it ships, about 13 kB compressed), none of which a text block
 * wants. What a link needs here is these few lines.
 */
const StoredLink = MarkExtension.create({
	name: "link",
	// Outside bold when both apply, so a link is one piece on screen.
	priority: 1000,
	// Typing at the end of a link, or on a new line after one, is not a link.
	inclusive: false,
	keepOnSplit: false,
	addAttributes() {
		return { href: { default: "" }, source: { default: null } };
	},
	// Drawn without an address to follow, so no click, middle click or
	// keyboard shortcut can take the browser anywhere. Opening a link is the
	// panel's button, after the address has been checked.
	renderHTML({ mark }) {
		return [
			"a",
			{
				class: "cursor-pointer text-primary underline",
				title: typeof mark.attrs.href === "string" ? mark.attrs.href : "",
			},
			0,
		];
	},
});

const EXTENSIONS = [
	OneParagraph,
	Paragraph,
	Text,
	HardBreak,
	Bold.configure({ HTMLAttributes: { class: "font-bold" } }),
	StoredLink,
	UndoRedo,
	LineBreakOnEnter,
];

/** Puts plain text in place of the selection, with the formatting at the caret. */
function insertPlainText(view: EditorView, text: string): void {
	const { state } = view;
	const atCaret = state.storedMarks ?? state.selection.$from.marks();
	const nodes = contentToInline(text).map((json) => {
		const node = state.schema.nodeFromJSON(json);
		return node.isText
			? node.mark(node.marks.reduce((set, mark) => mark.addToSet(set), atCaret))
			: node;
	});
	if (nodes.length === 0) return;
	view.dispatch(
		state.tr
			.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
			.scrollIntoView(),
	);
}

/** The link whose text starts at or runs over a position, with its whole range. */
function linkAround(
	state: EditorState,
	position: number,
): { from: number; to: number; mark: Mark } | null {
	const type = state.schema.marks.link;
	if (!type) return null;
	const $position = state.doc.resolve(position);
	const parent = $position.parent;
	const found = parent.childAfter($position.parentOffset);
	const mark = found.node?.marks.find((item) => item.type === type);
	if (!found.node || !mark) return null;
	let from = $position.start() + found.offset;
	let to = from + found.node.nodeSize;
	// The same link can be cut into several pieces, e.g. by a bold word.
	for (let i = found.index - 1; i >= 0; i -= 1) {
		const before = parent.child(i);
		if (!mark.isInSet(before.marks)) break;
		from -= before.nodeSize;
	}
	for (let i = found.index + 1; i < parent.childCount; i += 1) {
		const after = parent.child(i);
		if (!mark.isInSet(after.marks)) break;
		to += after.nodeSize;
	}
	return { from, to, mark };
}

/** What the link panel is working on. Nothing in the text changes until "Zapisz". */
interface LinkDraft {
	from: number;
	to: number;
	/** The document the range was measured in: a later one makes it stale. */
	doc: DocumentNode;
	/** The link being edited, or null for one that does not exist yet. */
	mark: Mark | null;
	originalText: string;
	text: string;
	address: string;
	/** Problems show from the first try to save; at once for an existing link. */
	checked: boolean;
	/** Where on screen the panel belongs: the text it is about. */
	anchor: { getBoundingClientRect: () => DOMRect; contextElement: Element };
}

function linkDraft(
	view: EditorView,
	range: { from: number; to: number },
	mark: Mark | null,
): LinkDraft {
	// A line break inside the range reads as a space in the one-line field.
	const text = view.state.doc.textBetween(range.from, range.to, " ", " ");
	return {
		...range,
		doc: view.state.doc,
		mark,
		originalText: text,
		text,
		address: typeof mark?.attrs.href === "string" ? mark.attrs.href : "",
		checked: mark !== null,
		anchor: {
			getBoundingClientRect: () => posToDOMRect(view, range.from, range.to),
			contextElement: view.dom,
		},
	};
}

const toolButton =
	"rounded-chip border border-line-input px-2.5 py-0.5 text-xs hover:border-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-input aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-white";

interface RichTextEditorProps {
	/** Position of the block: part of every accessible name here. */
	index: number;
	/** The stored text of the block. */
	value: string;
	/** Called with the text to store, only when it differs from the last one. */
	onChange: (content: string) => void;
	/** Read-only. A locked fieldset around it does not stop typing by itself. */
	disabled?: boolean;
}

export function RichTextEditor({
	index,
	value,
	onChange,
	disabled = false,
}: RichTextEditorProps) {
	// Read once: the editor is made a single time and keeps its own document.
	const [opening] = useState(() => contentToDoc(value));
	// The text the editor and the block last agreed on. A `value` that differs
	// did not come from here (the form was reset, or took someone's change).
	const agreed = useRef(value);
	const [panel, setPanel] = useState<{
		draft: LinkDraft;
		open: boolean;
	} | null>(null);

	const editor = useEditor({
		extensions: EXTENSIONS,
		content: opening,
		editable: !disabled,
		// The library's stylesheet is written into the page at run time; the
		// few rules of it that matter here are classes on the element below.
		injectCSS: false,
		// No "**bold**" or pasted-address magic: what is typed stays as typed.
		enableInputRules: false,
		enablePasteRules: false,
		editorProps: {
			attributes: {
				"aria-multiline": "true",
				"aria-label": `Tekst, blok ${index + 1}`,
				"aria-placeholder": "Wpisz tekst",
				...(disabled ? { "aria-disabled": "true" } : {}),
				class: `${blockField} min-h-28 py-2 leading-normal whitespace-break-spaces [overflow-wrap:anywhere] [font-variant-ligatures:none] aria-disabled:cursor-not-allowed aria-disabled:text-muted aria-disabled:hover:border-transparent`,
			},
			handleDOMEvents: {
				// Before the editor reads the clipboard itself: only the plain
				// text is ever looked at.
				paste: (view, event) => {
					event.preventDefault();
					const text = event.clipboardData?.getData("text/plain") ?? "";
					if (view.editable && text) insertPlainText(view, text);
					return true;
				},
				// Moving a selection inside the field is the editor's own work.
				// Anything dragged in from outside is refused: it could be
				// formatted, and a block being dragged to a new place carries
				// its own data that must not land in the text.
				drop: (view, event) => {
					if (view.dragging) return false;
					event.preventDefault();
					return true;
				},
			},
			handleClick: (view, _position, event) => {
				const target = event.target instanceof Element ? event.target : null;
				const anchor = target?.closest("a");
				if (!anchor || !view.dom.contains(anchor) || !view.editable) {
					return false;
				}
				const link = linkAround(view.state, view.posAtDOM(anchor, 0));
				if (!link) return false;
				setPanel({ draft: linkDraft(view, link, link.mark), open: true });
				return true;
			},
		},
		onUpdate: ({ editor: current }) => {
			const content = docToContent(current.getJSON());
			// Formatting a space, or undoing back to the start, changes the
			// document and not the text: nothing to report.
			if (content === agreed.current) return;
			agreed.current = content;
			onChange(content);
		},
	});

	// The hook keeps whatever "editable" the editor already has.
	useEffect(() => {
		editor.setEditable(!disabled, false);
	}, [editor, disabled]);

	useEffect(() => {
		if (value === agreed.current) return;
		agreed.current = value;
		editor
			.chain()
			// Not a step someone made: undo must not bring the old text back.
			.setMeta("addToHistory", false)
			.setContent(contentToDoc(value), { emitUpdate: false })
			.run();
	}, [editor, value]);

	// Read through the library's hook: the editor object stays the same while
	// its state changes, so nothing read from it during render would update.
	const { bold, empty } = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			bold: current.isActive("bold"),
			empty: current.isEmpty,
		}),
	});

	const startLink = () => {
		const { state, view } = editor;
		const { from, to } = state.selection;
		const link = linkAround(state, from);
		setPanel({
			draft: link
				? linkDraft(view, link, link.mark)
				: linkDraft(view, { from, to }, null),
			open: true,
		});
	};

	const closePanel = () => {
		if (panel) setPanel({ ...panel, open: false });
	};

	/** True while the text the panel was opened on is still the text. */
	const upToDate = (draft: LinkDraft) => editor.state.doc === draft.doc;

	const saveLink = () => {
		if (!panel) return;
		const { draft } = panel;
		const address = draft.address.trim();
		if (linkAddressProblem(address) || !draft.text.trim()) {
			setPanel({ draft: { ...draft, checked: true }, open: true });
			return;
		}
		closePanel();
		if (!upToDate(draft)) return;
		editor
			.chain()
			.focus()
			.command(({ tr, state }) => {
				const type = state.schema.marks.link;
				if (!type) return false;
				// An untouched address keeps the link exactly as it was stored.
				const mark =
					draft.mark && draft.mark.attrs.href === address
						? draft.mark
						: type.create({ href: address, source: null });
				const selected = draft.from < draft.to;
				let end = draft.to;
				if (selected && draft.text === draft.originalText) {
					tr.removeMark(draft.from, draft.to, type);
					tr.addMark(draft.from, draft.to, mark);
				} else {
					// New words take the other formatting of the place they go to.
					const around = selected
						? (state.doc.nodeAt(draft.from)?.marks ?? [])
						: (state.storedMarks ?? state.selection.$from.marks());
					const others = around.filter((item) => item.type !== type);
					tr.replaceWith(
						draft.from,
						draft.to,
						state.schema.text(draft.text, mark.addToSet(others)),
					);
					end = draft.from + draft.text.length;
				}
				// Typing goes on after the link, not inside it.
				tr.setSelection(TextSelection.create(tr.doc, end));
				tr.removeStoredMark(type);
				return true;
			})
			.run();
	};

	const removeLink = () => {
		if (!panel) return;
		const { draft } = panel;
		closePanel();
		if (!upToDate(draft)) return;
		editor
			.chain()
			.focus()
			.command(({ tr, state }) => {
				const type = state.schema.marks.link;
				if (!type) return false;
				tr.removeMark(draft.from, draft.to, type);
				return true;
			})
			.run();
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-1.5">
				<button
					type="button"
					title="Pogrubienie (Ctrl+B)"
					aria-label={`Pogrubienie, blok ${index + 1}`}
					aria-pressed={bold}
					disabled={disabled}
					// The selection in the text must survive the press.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleBold().run()}
					className={`${toolButton} font-bold`}
				>
					B
				</button>
				<button
					type="button"
					title="Zamień zaznaczenie w link albo wstaw nowy"
					aria-label={`Link, blok ${index + 1}`}
					disabled={disabled}
					onMouseDown={(event) => event.preventDefault()}
					onClick={startLink}
					className={toolButton}
				>
					Link
				</button>
			</div>
			<div className="relative">
				<EditorContent editor={editor} />
				{empty && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute top-[calc(0.5rem+1px)] left-[calc(0.75rem+1px)] text-sm leading-normal text-muted any-pointer-coarse:text-base"
					>
						Wpisz tekst
					</span>
				)}
			</div>
			{panel && (
				<LinkPanel
					draft={panel.draft}
					open={panel.open}
					onChange={(draft) => setPanel({ draft, open: true })}
					onClose={closePanel}
					onSave={saveLink}
					onRemove={removeLink}
					returnFocusTo={() => editor.view.dom}
				/>
			)}
		</div>
	);
}

interface LinkPanelProps {
	draft: LinkDraft;
	open: boolean;
	onChange: (draft: LinkDraft) => void;
	onClose: () => void;
	onSave: () => void;
	onRemove: () => void;
	/** Where the keyboard goes when the panel closes: back into the text. */
	returnFocusTo: () => HTMLElement;
}

/**
 * The small panel next to a link: its text, its address, and the way to try
 * the address out. The same look as `ui/Popover`, but placed against a piece
 * of text instead of under a button, which that component cannot do.
 */
function LinkPanel({
	draft,
	open,
	onChange,
	onClose,
	onSave,
	onRemove,
	returnFocusTo,
}: LinkPanelProps) {
	const fields = useRef<HTMLDivElement>(null);
	const address = draft.address.trim();
	const addressProblem = linkAddressProblem(address);
	const textProblem = draft.text.trim() ? null : "Wpisz tekst linku";

	return (
		<BasePopover.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<BasePopover.Portal>
				<BasePopover.Positioner
					anchor={draft.anchor}
					side="bottom"
					align="start"
					sideOffset={8}
					collisionPadding={8}
					className="z-50"
				>
					<BasePopover.Popup
						// With the words already chosen, the address is what is missing.
						initialFocus={() =>
							(draft.mark === null && draft.originalText
								? fields.current?.querySelector<HTMLElement>(
										"input[name='address']",
									)
								: null) ?? true
						}
						finalFocus={returnFocusTo}
						className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) overflow-y-auto rounded-cell border border-line bg-surface p-3 text-sm shadow-menu outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
					>
						<BasePopover.Title className="mb-2 text-sm font-semibold">
							Link
						</BasePopover.Title>
						{/* Not a form: this sits inside the entity's form in React's
						    eyes, and a submit here would save the whole thing. */}
						{/* biome-ignore lint/a11y/noStaticElementInteractions: Enter in either field saves the link; the fields and buttons inside are the controls */}
						<div
							ref={fields}
							className="flex flex-col gap-3"
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									event.target instanceof HTMLInputElement
								) {
									event.preventDefault();
									onSave();
								}
							}}
						>
							<TextField
								label="Tekst"
								name="text"
								autoComplete="off"
								value={draft.text}
								onChange={(event) =>
									onChange({ ...draft, text: event.target.value })
								}
								error={(draft.checked && textProblem) || undefined}
							/>
							<TextField
								label="Adres"
								name="address"
								inputMode="url"
								autoComplete="off"
								autoCapitalize="none"
								spellCheck={false}
								placeholder="https://"
								value={draft.address}
								onChange={(event) =>
									onChange({ ...draft, address: event.target.value })
								}
								error={(draft.checked && addressProblem) || undefined}
							/>
							<div className="flex flex-wrap gap-2">
								<Button variant="primary" onClick={onSave}>
									Zapisz
								</Button>
								{draft.mark && <Button onClick={onRemove}>Usuń link</Button>}
								<Button
									variant="ghost"
									disabled={addressProblem !== null}
									onClick={() =>
										window.open(address, "_blank", "noopener,noreferrer")
									}
								>
									Otwórz w nowej karcie
								</Button>
							</div>
						</div>
					</BasePopover.Popup>
				</BasePopover.Positioner>
			</BasePopover.Portal>
		</BasePopover.Root>
	);
}
