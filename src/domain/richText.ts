import { linkAddressIn } from "./contentBlocks";

// The one place a Text block's stored string becomes the document a rich-text
// editor works on, and that document becomes the string again. Pure: no
// React, no editor library. The document is plain JSON in the shape
// ProseMirror reads and writes, so the editor takes it as it is.
//
// What is stored does not change: one string, "\n" for a line break, and the
// two tags the app understands, <b>…</b> and <a href="…">…</a>. Nothing is
// escaped in that string and nothing is escaped here: a "<" or an "&amp;" is
// the character sequence itself, and a tag that is not one of the two (or has
// no partner on its line) is ordinary text, exactly as the app prints it.
//
// Reading is more forgiving than the app (`textSegments` in contentBlocks.ts
// is the app's own view, and the preview uses it): bold inside bold, a link
// inside bold and bold inside a link all become marks, so no tag shows in the
// editor. Writing is stricter: one <b> per bold run, never two nested, closed
// before every line break. So content the app already shows correctly comes
// back character for character, and the oddities are tidied only when
// someone edits the block.

export type RichMark =
	| { type: "bold" }
	| {
			type: "link";
			attrs: {
				href: string;
				/**
				 * The opening tag as it was stored, when it is not the plain
				 * `<a href="…">` (extra attributes, another order). Written back
				 * unchanged so that an untouched link stays as it was.
				 */
				source: string | null;
			};
	  };

export type RichInline =
	| { type: "text"; text: string; marks?: RichMark[] }
	| { type: "hardBreak" };

/** A Text block as a document: always one paragraph, lines parted by breaks. */
export interface RichDoc {
	type: "doc";
	content: [{ type: "paragraph"; content?: RichInline[] }];
}

/**
 * Any document handed back by an editor. Looser than `RichDoc` on purpose:
 * the editor's own JSON type is, and nothing here trusts its shape.
 */
export interface EditorNode {
	type?: string;
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
	content?: EditorNode[];
}

// ---------------------------------------------------------------------------
// Stored string → document

/** The two tags, in the only spellings the app's parser takes. */
const TAG = /<b>|<\/b>|<\/a>|<a\s[^<>]*>/g;

type Piece =
	| { kind: "text"; raw: string }
	| {
			kind: "boldOpen" | "boldClose" | "linkOpen" | "linkClose";
			raw: string;
			/** Where the tag starts and ends in its line. */
			from: number;
			to: number;
			/** False when the tag has no partner: it is then text. */
			paired: boolean;
	  };

function piecesOf(line: string): Piece[] {
	const pieces: Piece[] = [];
	let last = 0;
	for (const match of line.matchAll(TAG)) {
		const raw = match[0];
		const from = match.index ?? 0;
		if (from > last) pieces.push({ kind: "text", raw: line.slice(last, from) });
		pieces.push({
			kind:
				raw === "<b>"
					? "boldOpen"
					: raw === "</b>"
						? "boldClose"
						: raw === "</a>"
							? "linkClose"
							: "linkOpen",
			raw,
			from,
			to: from + raw.length,
			paired: false,
		});
		last = from + raw.length;
	}
	if (last < line.length) pieces.push({ kind: "text", raw: line.slice(last) });
	return pieces;
}

/**
 * Marks each tag that has a partner on the same line. Bold and links are
 * matched separately, so tags that overlap instead of nesting still work.
 */
function pair(line: string, pieces: Piece[]): void {
	const openBold: Piece[] = [];
	const openLinks: Piece[] = [];
	for (const piece of pieces) {
		if (piece.kind === "text") continue;
		if (piece.kind === "boldOpen") openBold.push(piece);
		if (piece.kind === "linkOpen") openLinks.push(piece);
		if (piece.kind !== "boldClose" && piece.kind !== "linkClose") continue;

		const open = (piece.kind === "boldClose" ? openBold : openLinks).pop();
		if (!open || open.kind === "text") continue;
		const between = line.slice(open.to, piece.from);
		// Tags around nothing stay on screen: the rules call them a mistake
		// ("Puste pogrubienie"), and a mistake nobody can see cannot be removed.
		const empty =
			piece.kind === "boldClose" ? between.trim() === "" : between === "";
		if (empty) continue;
		open.paired = true;
		piece.paired = true;
	}
}

const sameMarks = (a: readonly RichMark[], b: readonly RichMark[]) =>
	JSON.stringify(a) === JSON.stringify(b);

function lineToInline(line: string): RichInline[] {
	const pieces = piecesOf(line);
	pair(line, pieces);

	const out: RichInline[] = [];
	const push = (text: string, marks: RichMark[]) => {
		const previous = out.at(-1);
		if (previous?.type === "text" && sameMarks(previous.marks ?? [], marks)) {
			previous.text += text;
			return;
		}
		out.push(
			marks.length > 0 ? { type: "text", text, marks } : { type: "text", text },
		);
	};

	// What is open at this point, outermost first: that order is the nesting
	// the string had, and writing uses it to give the same string back.
	let open: Array<{ mark: RichMark; depth: number }> = [];
	const links: RichMark[] = [];

	for (const piece of pieces) {
		if (piece.kind === "text" || !piece.paired) {
			push(
				piece.raw,
				open.map((entry) => entry.mark),
			);
			continue;
		}
		if (piece.kind === "boldOpen") {
			const bold = open.find((entry) => entry.mark.type === "bold");
			// Bold inside bold is still just bold.
			if (bold) bold.depth += 1;
			else open.push({ mark: { type: "bold" }, depth: 1 });
		} else if (piece.kind === "boldClose") {
			const bold = open.find((entry) => entry.mark.type === "bold");
			if (bold) bold.depth -= 1;
			open = open.filter((entry) => entry.depth > 0);
		} else if (piece.kind === "linkOpen") {
			const href = linkAddressIn(piece.raw);
			const mark: RichMark = {
				type: "link",
				attrs: {
					href,
					source: piece.raw === `<a href="${href}">` ? null : piece.raw,
				},
			};
			links.push(mark);
			// A link inside a link: the inner one is what the text points to.
			open = [
				...open.filter((entry) => entry.mark.type !== "link"),
				{ mark, depth: 1 },
			];
		} else {
			links.pop();
			const outer = links.at(-1);
			open = open.filter((entry) => entry.mark.type !== "link");
			if (outer) open.push({ mark: outer, depth: 1 });
		}
	}
	return out;
}

/**
 * The inline content for a stored string: text, marks and line breaks.
 * Windows line endings become plain ones, as they did in the text box this
 * replaces: a stray carriage return would otherwise sit unseen in the text.
 */
export function contentToInline(content: string): RichInline[] {
	return content
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.flatMap((line, index): RichInline[] => [
			...(index > 0 ? [{ type: "hardBreak" } as const] : []),
			...lineToInline(line),
		]);
}

/** A stored Text block as the document the editor opens. */
export function contentToDoc(content: string): RichDoc {
	const inline = contentToInline(content);
	return {
		type: "doc",
		content: [
			inline.length > 0
				? { type: "paragraph", content: inline }
				: { type: "paragraph" },
		],
	};
}

// ---------------------------------------------------------------------------
// Document → stored string

interface Run {
	text: string;
	bold: boolean;
	/** The opening tag to write, or null for no link. */
	link: string | null;
	/** Which of the two was outside when both began together. */
	boldOutside: boolean;
}

/**
 * The opening tag for a link mark, or null when it cannot be written: the
 * address sits between double quotes with nothing escaped, so an empty one or
 * one with a quote or an angle bracket would produce a broken tag.
 */
function openingTag(attrs: Record<string, unknown> | undefined): string | null {
	const href = typeof attrs?.href === "string" ? attrs.href : "";
	const source = attrs?.source;
	// A remembered spelling is used only while it still says the same address.
	if (
		typeof source === "string" &&
		/^<a\s[^<>]*>$/.test(source) &&
		linkAddressIn(source) === href
	) {
		return source;
	}
	if (!href || /["<>\n]/.test(href)) return null;
	return `<a href="${href}">`;
}

/** The document as lines of runs; a line break ends a line. */
function linesOf(doc: EditorNode): Run[][] {
	const lines: Run[][] = [];
	// More than one paragraph should not happen; if it does, each is a line.
	for (const paragraph of doc.content ?? []) {
		let line: Run[] = [];
		lines.push(line);
		for (const node of paragraph.content ?? []) {
			if (node.type === "hardBreak") {
				line = [];
				lines.push(line);
				continue;
			}
			const marks = node.marks ?? [];
			const boldAt = marks.findIndex((mark) => mark.type === "bold");
			const linkAt = marks.findIndex((mark) => mark.type === "link");
			const link = linkAt >= 0 ? openingTag(marks[linkAt]?.attrs) : null;
			// A line break typed into a text node is a line break all the same.
			for (const [index, text] of (node.text ?? "").split("\n").entries()) {
				if (index > 0) {
					line = [];
					lines.push(line);
				}
				if (!text) continue;
				line.push({
					text,
					bold: boldAt >= 0,
					link,
					boldOutside: linkAt < 0 || (boldAt >= 0 && boldAt < linkAt),
				});
			}
		}
	}
	return lines;
}

function merged(runs: Run[]): Run[] {
	const out: Run[] = [];
	for (const run of runs) {
		const previous = out.at(-1);
		if (
			previous &&
			previous.bold === run.bold &&
			previous.link === run.link &&
			// Only a run that is both can differ in nesting.
			(!(run.bold && run.link) || previous.boldOutside === run.boldOutside)
		) {
			previous.text += run.text;
		} else {
			out.push({ ...run });
		}
	}
	return out;
}

/**
 * Bold on nothing but spaces cannot be seen in the editor and is a mistake in
 * the rules ("Puste pogrubienie"), so it is not written.
 */
function withoutBlankBold(runs: Run[]): Run[] {
	const out = runs.map((run) => ({ ...run }));
	let start = 0;
	while (start < out.length) {
		if (!out[start]?.bold) {
			start += 1;
			continue;
		}
		let end = start;
		while (out[end]?.bold) end += 1;
		const stretch = out.slice(start, end);
		if (stretch.every((run) => run.text.trim() === "")) {
			for (const run of stretch) run.bold = false;
		}
		start = end;
	}
	return out;
}

type Open = { kind: "bold" } | { kind: "link"; tag: string };

function lineToContent(line: Run[]): string {
	const runs = merged(withoutBlankBold(merged(line)));
	let out = "";
	const stack: Open[] = [];
	const close = () => {
		out += stack.pop()?.kind === "bold" ? "</b>" : "</a>";
	};
	/** How many runs from `from` on keep this formatting without a gap. */
	const reach = (from: number, has: (run: Run) => boolean) => {
		let to = from;
		while (to < runs.length && has(runs[to] as Run)) to += 1;
		return to - from;
	};

	for (const [index, run] of runs.entries()) {
		const wanted = (entry: Open) =>
			entry.kind === "bold" ? run.bold : entry.tag === run.link;
		// Tags nest, so everything opened after the first one that ends here
		// closes with it, and what still applies is opened again.
		const firstEnded = stack.findIndex((entry) => !wanted(entry));
		if (firstEnded >= 0) while (stack.length > firstEnded) close();

		const needsBold = run.bold && !stack.some((entry) => entry.kind === "bold");
		const link = run.link;
		const needsLink =
			link !== null && !stack.some((entry) => entry.kind === "link");
		const openBold = () => {
			stack.push({ kind: "bold" });
			out += "<b>";
		};
		const openLink = () => {
			if (link === null) return;
			stack.push({ kind: "link", tag: link });
			out += link;
		};
		if (needsBold && needsLink) {
			// The one that lasts longer goes outside, so neither has to be
			// closed and opened again; when they end together, as they were.
			const boldReach = reach(index, (next) => next.bold);
			const linkReach = reach(index, (next) => next.link === link);
			if (
				boldReach > linkReach ||
				(boldReach === linkReach && run.boldOutside)
			) {
				openBold();
				openLink();
			} else {
				openLink();
				openBold();
			}
		} else if (needsBold) {
			openBold();
		} else if (needsLink) {
			openLink();
		}
		out += run.text;
	}
	while (stack.length > 0) close();
	return out;
}

/**
 * The editor's document as the string to store. Formatting never crosses a
 * line break (the app would print the tags), so it is closed at the end of a
 * line and opened again on the next.
 */
export function docToContent(doc: EditorNode): string {
	return linesOf(doc).map(lineToContent).join("\n");
}
