import { type ContentBlock, contentBlockSchema } from "@/data/schemas/workout";

/**
 * An address with a scheme other than the few a link in the app may use.
 * "x.pl" has no scheme and only gets a warning; "javascript:…" is refused.
 */
const UNSAFE_SCHEME = /^\s*(?!(?:https?|mailto|tel):)[a-z][a-z0-9+.-]*:/i;

// The two things said about a link's address, worded once: the list of
// problems under a block and the link panel of the text editor both use them.
const unsafeAddress = (href: string) =>
	`Adres linku „${href}” jest niedozwolony. Link musi zaczynać się od https://`;
const notHttpsAddress = (href: string) =>
	`Adres linku „${href}” nie zaczyna się od https://`;

/**
 * What is wrong with an address typed for a new or edited link, or null.
 * Stricter than the check of stored content on purpose: what is already
 * saved without a scheme ("x.pl") only earns a warning there, but an address
 * being typed now has to be one the app can open: http, https, mailto or tel.
 */
export function linkAddressProblem(address: string): string | null {
	const href = address.trim();
	if (!href) return "Wpisz adres linku";
	// The address is stored between double quotes inside a tag, with nothing
	// escaped: these characters would end it early.
	if (/["<>\s]/.test(href)) {
		return "Adres nie może zawierać spacji, cudzysłowu ani znaków < i >";
	}
	if (UNSAFE_SCHEME.test(href)) return unsafeAddress(href);
	const scheme = /^(?:https?:\/\/|mailto:|tel:)/i.exec(href)?.[0];
	if (!scheme) return notHttpsAddress(href);
	if (scheme.length === href.length) return "Adres linku jest niepełny";
	return null;
}

/**
 * The address the app takes from an opening <a …> tag: whatever comes first
 * in double quotes, wherever it stands.
 */
export const linkAddressIn = (openingTag: string): string =>
	/"(.+?)"/.exec(openingTag)?.[1] ?? "";

// Rules for "fancy content": the blocks that make up a workout or challenge
// description and a message body. Pure: no React, no storage.
//
// The app renders three block types (Title, Text, Image) and, inside Text,
// exactly two tags: <b>…</b> and <a href="…">…</a>. Everything here exists to
// tell an editor, before saving, what the app will actually show.

export type BlockType = "Title" | "Text" | "Image";
export const BLOCK_TYPES: readonly BlockType[] = ["Title", "Text", "Image"];
export const BLOCK_LABELS: Record<BlockType, string> = {
	Title: "Tytuł",
	Text: "Tekst",
	Image: "Obraz",
};

export interface ContentIssue {
	/** Position of the block in the list. */
	index: number;
	/** An error shows wrongly in the app or is refused; a warning is a risk. */
	severity: "error" | "warning";
	message: string;
}

// The characters at which the mobile app's text parser cuts a run of text:
// emoji, symbols and "[". Formatting that contains one is printed literally.
// This is the app's own pattern, copied as it is (odd brackets included), so
// that the panel reports what a user will really see.
const APP_SPLIT_PATTERN =
	"(?:[\\u2700-\\u27bf]|(?:\\ud83c[\\udde6-\\uddff]){2}|[\\ud800-\\udbff][\\udc00-\\udfff]|[\\u0023-\\u0039]\\ufe0f?\\u20e3|\\u3299|\\u3297|\\u303d|\\u3030|\\u24c2|\\ud83c[\\udd70-\\udd71]|\\ud83c[\\udd7e-\\udd7f]|\\ud83c\\udd8e|\\ud83c[\\udd91-\\udd9a]|\\ud83c[\\udde6-\\uddff]|[\\ud83c[\\ude01-\\ude02]|\\ud83c\\ude1a|\\ud83c\\ude2f|[\\ud83c[\\ude32-\\ude3a]|[\\ud83c[\\ude50-\\ude51]|\\u203c|\\u2049|[\\u25aa-\\u25ab]|\\u25b6|\\u25c0|[\\u25fb-\\u25fe]|\\u00a9|\\u00ae|\\u2122|\\u2139|\\ud83c\\udc04|[\\u2600-\\u26FF]|\\u2b05|\\u2b06|\\u2b07|\\u2b1b|\\u2b1c|\\u2b50|\\u2b55|\\u231a|\\u231b|\\u2328|\\u23cf|[\\u23e9-\\u23f3]|[\\u23f8-\\u23fa]|\\ud83c\\udccf|\\u2934|\\u2935|[\\u2190-\\u21ff])";

export function splittingCharacters(text: string): string[] {
	const found = text.match(new RegExp(APP_SPLIT_PATTERN, "g")) ?? [];
	return [...new Set(found)];
}

// A tag is a "<" followed by a letter (or by "/" and a letter) and closed by
// a ">". A "<" followed by anything else is a sign in a sentence ("tempo < 5
// min, puls > 120"), not a tag, however far away the next ">" is. The same
// pattern as the backend's (`contentBlockRules.ts`), so both refuse the same.
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const isSupportedTag = (tag: string) =>
	tag === "<b>" || tag === "</b>" || tag === "</a>" || /^<a\s[^>]*>$/.test(tag);

/** What a reader sees of a piece of marked-up text, shortened for a message. */
function visibleText(markup: string): string {
	const text = markup.replace(/^<a[^>]*>|<\/?[a-zA-Z][^<>]*>/g, "").trim();
	return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The selection in a Text block's editor, as far as the formatting rules care. */
export interface FormattingSelection {
	/** The selected text; empty for a cursor. */
	text: string;
	/** A line break inside the selection. */
	spansLines: boolean;
	/** Any of the selection (or, for a cursor, where it stands) is a link. */
	inLink: boolean;
	/** Any of the selection is bold. */
	inBold: boolean;
	/** All of the selection is bold already: the button would take bold off. */
	allBold: boolean;
}

/**
 * Why Bold or Link cannot be used on this selection, in Polish; null where it
 * can. The same rules the saved text is checked against (below), applied
 * before the change is made, so the editor never builds what the app cannot
 * show. Taking bold off is always allowed.
 */
export function formattingBlockers(selection: FormattingSelection): {
	bold: string | null;
	link: string | null;
} {
	const splitting = splittingCharacters(selection.text);
	const splitText = splitting.length > 0 ? ` (${splitting.join(" ")})` : "";
	const bold = selection.allBold
		? null
		: selection.inLink
			? "Nie można pogrubić tekstu linku: w aplikacji pogrubienie i link nie mogą się nakładać. Zaznacz tekst poza linkiem."
			: splitting.length > 0
				? `W zaznaczeniu jest emoji, symbol albo „[”${splitText}: pogrubienie przerywa się na takim znaku i w aplikacji nie zadziała. Zaznacz tekst bez nich.`
				: selection.spansLines
					? "Pogrubienie nie może przechodzić przez nową linię. Pogrub każdą linię osobno."
					: null;
	// A cursor in a link opens that link to edit it: always allowed.
	const editingLink = selection.inLink && selection.text === "";
	const link = editingLink
		? null
		: selection.inBold
			? "Nie można dodać linku do pogrubionego tekstu: w aplikacji pogrubienie i link nie mogą się nakładać. Najpierw zdejmij pogrubienie (B) z tego fragmentu."
			: splitting.length > 0
				? `W zaznaczeniu jest emoji, symbol albo „[”${splitText}: link przerywa się na takim znaku i w aplikacji nie zadziała. Zaznacz tekst bez nich.`
				: selection.spansLines
					? "Link nie może przechodzić przez nową linię. Zaznacz tekst w jednej linii."
					: null;
	return { bold, link };
}

function count(text: string, pattern: RegExp): number {
	return (text.match(pattern) ?? []).length;
}

function textProblems(text: string): Array<[ContentIssue["severity"], string]> {
	const out: Array<[ContentIssue["severity"], string]> = [];
	const error = (message: string) => out.push(["error", message]);
	const warning = (message: string) => out.push(["warning", message]);

	if (!text.trim()) {
		error("Tekst jest pusty");
		return out;
	}

	// Tags the app does not understand are printed as typed. One message per
	// tag name: <i> and its </i> are the same problem.
	const reported = new Set<string>();
	for (const [tag] of text.matchAll(TAG)) {
		if (isSupportedTag(tag)) continue;
		const name = /^<\/?\s*([a-zA-Z][\w-]*)/.exec(tag)?.[1]?.toLowerCase();
		if (name === "b" || name === "a") {
			error(
				`Tag ${tag} jest zapisany inaczej, niż rozumie aplikacja. Dozwolone: <b>, </b>, <a href="…">, </a>`,
			);
		} else if (!reported.has(name ?? tag)) {
			reported.add(name ?? tag);
			error(
				`Tag ${name ? `<${name}>` : tag} nie jest obsługiwany i wyświetli się dosłownie. Dozwolone są tylko pogrubienie i link`,
			);
		}
	}
	const withoutTags = text.replace(TAG, "");
	if (/<\/?[a-zA-Z]/.test(withoutTags)) error("Tag bez zamykającego znaku >");

	const openB = count(text, /<b>/g);
	const closeB = count(text, /<\/b>/g);
	const openA = count(text, /<a[\s>]/g);
	const closeA = count(text, /<\/a>/g);
	if (openB !== closeB) {
		error("Pogrubienie nie jest domknięte: każde <b> potrzebuje </b>");
	}
	if (openA !== closeA) {
		error("Link nie jest domknięty: każde <a …> potrzebuje </a>");
	}
	if (openB === closeB && openA === closeA) {
		const split = text.split("\n").some((line) => {
			return (
				count(line, /<b>/g) !== count(line, /<\/b>/g) ||
				count(line, /<a[\s>]/g) !== count(line, /<\/a>/g)
			);
		});
		if (split) {
			error(
				"Formatowanie nie może przechodzić przez nową linię. Zamknij tag w tym samym akapicie",
			);
		}
	}

	for (const [whole] of text.matchAll(/<b>(.+?)<\/b>/g)) {
		if (splittingCharacters(whole).length > 0) {
			error(
				"Pogrubienie nie zadziała, bo w środku jest emoji, symbol albo „[”. Przenieś ten znak poza <b>…</b>",
			);
		}
		if (/<a[\s>]/.test(whole)) {
			error(
				`Link w pogrubionym tekście „${visibleText(whole)}” nie zadziała w aplikacji: pogrubienie i link nie mogą się nakładać. Zdejmij pogrubienie z tego fragmentu albo przenieś link poza nie`,
			);
		}
	}
	if (/<b>\s*<\/b>/.test(text)) error("Puste pogrubienie <b></b>; usuń je");

	for (const [whole] of text.matchAll(/<a(.+?)<\/a>/g)) {
		if (splittingCharacters(whole).length > 0) {
			error(
				"Link nie zadziała, bo w środku jest emoji, symbol albo „[”. Przenieś ten znak poza link",
			);
		}
		if (whole.includes("<b>")) {
			error(
				`Pogrubienie w linku „${visibleText(whole)}” nie zadziała w aplikacji: pogrubienie i link nie mogą się nakładać. Zdejmij pogrubienie z tekstu linku`,
			);
		}

		const quoted = /"(.+?)"/.exec(whole);
		if (!quoted) {
			error(
				'Link nie ma adresu w podwójnych cudzysłowach. Wymagany zapis: <a href="https://…">tekst</a>',
			);
		} else if (!/href=$/.test(whole.slice(0, quoted.index))) {
			error("W linku href musi być pierwszym atrybutem");
		} else if (UNSAFE_SCHEME.test(quoted[1] ?? "")) {
			// javascript:, data:, file: and the like must never reach the app.
			error(unsafeAddress(quoted[1] ?? ""));
		} else if (!/^https?:\/\//i.test(quoted[1] ?? "")) {
			warning(notHttpsAddress(quoted[1] ?? ""));
		}
	}

	const entities = text.match(/&[a-z]+;|&#\d+;/gi);
	if (entities) {
		error(
			`Zapis ${[...new Set(entities)].join(", ")} wyświetli się dosłownie. Wpisz znak wprost, np. & zamiast &amp;`,
		);
	}
	if (text.includes("[")) {
		warning(
			"Znak „[” wyświetli się inną czcionką niż reszta zdania. Użyj nawiasów okrągłych",
		);
	}
	return out;
}

function blockProblems(
	block: ContentBlock,
): Array<[ContentIssue["severity"], string]> {
	const content = block.content ?? "";

	if (block.type === "Title") {
		if (!content.trim()) return [["error", "Tytuł jest pusty"]];
		const out: Array<[ContentIssue["severity"], string]> = [];
		if (new RegExp(TAG.source).test(content)) {
			out.push([
				"error",
				"Tytuł nie obsługuje tagów. Przenieś formatowany fragment do bloku tekstu",
			]);
		}
		if (content.includes("\n")) {
			out.push([
				"warning",
				"Tytuł ma złamanie linii; w aplikacji to jeden akapit",
			]);
		}
		return out;
	}

	if (block.type === "Text") return textProblems(content);

	if (block.type === "Image") {
		const path = block.metadata?.imageRelativePath?.trim();
		if (!path) return [["error", "Nie wybrano obrazu"]];
		const out: Array<[ContentIssue["severity"], string]> = [];
		if (/\s/.test(path) || /[^\x20-\x7E]/.test(path)) {
			out.push([
				"warning",
				"Nazwa pliku ma spacje albo polskie znaki; na części urządzeń obraz może się nie wczytać",
			]);
		}
		const ratio = block.metadata?.heightToWidthRatio;
		if (typeof ratio !== "number" || !(ratio > 0) || ratio >= 5) {
			out.push([
				"error",
				"Nie udało się ustalić proporcji obrazu. Wybierz obraz ponownie",
			]);
		}
		return out;
	}

	return [
		[
			"error",
			`Nieznany rodzaj bloku „${block.type}”. Popraw „type” w JSON-ie (Title, Text albo Image) albo usuń ten blok`,
		],
	];
}

/** Everything wrong or risky in a list of blocks. */
export function contentIssues(blocks: readonly ContentBlock[]): ContentIssue[] {
	return blocks.flatMap((block, index) => {
		const seen = new Set<string>();
		return blockProblems(block)
			.filter(([, message]) => !seen.has(message) && seen.add(message))
			.map(([severity, message]) => ({ index, severity, message }));
	});
}

export const contentErrors = (blocks: readonly ContentBlock[]) =>
	contentIssues(blocks).filter((issue) => issue.severity === "error");

// ---------------------------------------------------------------------------
// Preview: what the app will draw for a Text block.

export type TextSegment =
	| { kind: "text"; text: string }
	| { kind: "bold"; text: string }
	| { kind: "link"; text: string; href: string };

/**
 * Splits a Text block the way the app does: bold first, then links, anything
 * else as typed. Tags the app would not recognise stay visible as text, which
 * is exactly what a user would see. That includes bold or a link with an
 * emoji, a symbol or "[" inside: the app stops formatting at such a character
 * and prints the tags.
 */
export function textSegments(content: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const pattern = /<b>(.+?)<\/b>|<a(.+?)>(.+?)<\/a>/g;
	let last = 0;
	for (const match of content.matchAll(pattern)) {
		if (splittingCharacters(match[0]).length > 0) continue;
		const start = match.index ?? 0;
		if (start > last) {
			segments.push({ kind: "text", text: content.slice(last, start) });
		}
		if (match[1] !== undefined) {
			segments.push({ kind: "bold", text: match[1] });
		} else {
			const href = linkAddressIn(match[2] ?? "");
			segments.push({ kind: "link", text: match[3] ?? "", href });
		}
		last = start + match[0].length;
	}
	if (last < content.length) {
		segments.push({ kind: "text", text: content.slice(last) });
	}
	return segments;
}

// ---------------------------------------------------------------------------
// Making blocks: from scratch, from pasted text, from pasted JSON.

export function newBlock(type: BlockType): ContentBlock {
	return {
		type,
		content: "",
		metadata:
			type === "Image"
				? { imageRelativePath: "", heightToWidthRatio: 0 }
				: null,
	};
}

export const DEFAULT_TITLE_MAX = 20;

/**
 * Ready-made text → blocks. A blank line separates blocks. A one-line
 * paragraph of up to `titleMax` characters that does not end a sentence
 * becomes a Title; everything else is Text, with single line breaks and the
 * <b> and <a> tags kept.
 *
 * A paragraph whose first line is such a title and whose next lines are
 * longer text ("Dla kogo" and a sentence under it, with no blank line
 * between) becomes a Title and a Text. A paragraph of short lines only (a
 * list: "Hantle", "Mata", "Roller") stays one Text.
 */
export function textToBlocks(
	text: string,
	titleMax = DEFAULT_TITLE_MAX,
): ContentBlock[] {
	const max = Math.max(1, titleMax);
	const plainOf = (line: string) => line.replace(/<[^>]+>/g, "");
	const titleLike = (plain: string) =>
		plain.length > 0 && plain.length <= max && !/[.!?…]$/.test(plain);
	// what may stand under a heading: more than a heading-sized line
	const headedBy = (line: string) => {
		const plain = plainOf(line);
		// "Potrzebujesz:" or "Hantle," leads into what follows
		return titleLike(plain) && !/[:,;]$/.test(plain);
	};
	const toTitle = (line: string): ContentBlock => ({
		type: "Title",
		content: plainOf(line),
		metadata: null,
	});
	const toText = (content: string): ContentBlock => ({
		type: "Text",
		content,
		metadata: null,
	});

	return text
		.replace(/\r\n?/g, "\n")
		.split(/\n[ \t]*\n+/)
		.map((paragraph) =>
			paragraph
				.split("\n")
				.map((line) => line.trim())
				.join("\n")
				.trim(),
		)
		.filter(Boolean)
		.flatMap((paragraph): ContentBlock[] => {
			const [first = "", ...rest] = paragraph.split("\n");
			if (rest.length === 0) {
				return titleLike(plainOf(first)) ? [toTitle(first)] : [toText(first)];
			}
			const body = rest.join("\n").trim();
			const bodyIsText = rest.some((line) => !titleLike(plainOf(line)));
			return headedBy(first) && body !== "" && bodyIsText
				? [toTitle(first), toText(body)]
				: [toText(paragraph)];
		});
}

/** True when pasted text is meant as the JSON form of blocks. */
export const looksLikeJson = (text: string) => /^\s*[[{]/.test(text);

export type ParsedJson =
	| { ok: true; blocks: ContentBlock[] }
	| { ok: false; problem: string };

/** What is wrong with one block of JSON, for the list and the preview. */
export interface BlockJsonProblem {
	index: number;
	/** What is wrong, without the block's number: "brakuje pola „content”". */
	reason: string;
	/** With the number, for a list: "Blok 1: brakuje pola „content”". */
	message: string;
}

/**
 * JSON looked at as it is typed: not JSON at all, not a list, a list where
 * some blocks are not blocks (each with what it lacks, and the good ones kept
 * in place, null for the others), or all good.
 */
export type InspectedJson =
	| { kind: "ok"; blocks: ContentBlock[] }
	| { kind: "syntax"; problem: string }
	| { kind: "notList"; problem: string }
	| {
			kind: "blocks";
			blocks: (ContentBlock | null)[];
			problems: BlockJsonProblem[];
	  };

const SYNTAX =
	"To nie jest poprawny JSON. Sprawdź przecinki, cudzysłowy i nawiasy";

/** Where the browser says the JSON broke, as a line number, when it says. */
function syntaxProblem(error: unknown, text: string): string {
	const said = error instanceof Error ? error.message : "";
	const line = /line (\d+)/.exec(said)?.[1];
	const position = /position (\d+)/.exec(said)?.[1];
	const at = line
		? Number(line)
		: position
			? text.slice(0, Number(position)).split("\n").length
			: null;
	return at ? `${SYNTAX} (w okolicy linii ${at})` : SYNTAX;
}

/** Why a value is not a block, in words; null when it is one. */
function blockReason(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return "to nie jest obiekt { … }";
	}
	const value = raw as Record<string, unknown>;
	const reasons: string[] = [];
	for (const field of ["type", "content"] as const) {
		if (!(field in value)) reasons.push(`brakuje pola „${field}”`);
		else if (typeof value[field] !== "string") {
			reasons.push(`pole „${field}” musi być tekstem w cudzysłowie`);
		}
	}
	if (reasons.length === 0 && !contentBlockSchema.safeParse(raw).success) {
		reasons.push(
			"pole „metadata” musi mieć „imageRelativePath” (tekst) i „heightToWidthRatio” (liczbę) albo być null",
		);
	}
	return reasons.length > 0 ? reasons.join(", ") : null;
}

/** A comma right before "}" or "]": the usual leftover of a deleted field. */
export interface TrailingComma {
	/** Which block it is in (or after, for one after the last block). */
	index: number;
	/** 1-based line of the comma. */
	line: number;
	/** Offset of the comma in the text. */
	at: number;
	/** What it stands before: "}" ends a block, "]" the list. */
	before: "}" | "]";
}

/**
 * Every comma that only a "}" or "]" follows, outside quoted text, with the
 * block it belongs to. JSON does not allow them; people leave them behind
 * when they delete the last field of a block.
 */
export function trailingCommas(text: string): TrailingComma[] {
	const found: TrailingComma[] = [];
	let inString = false;
	let escaped = false;
	let depth = 0;
	let block = 0;
	let line = 1;
	let pending: { at: number; line: number; depth: number } | null = null;
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (char === "\n") line += 1;
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === " " || char === "\n" || char === "\r" || char === "\t") {
			continue;
		}
		if ((char === "}" || char === "]") && pending) {
			found.push({
				// a comma after the last block of the list belongs to that block
				index: pending.depth === 1 ? Math.max(0, block - 1) : block,
				line: pending.line,
				at: pending.at,
				before: char,
			});
		}
		pending = null;
		if (char === '"') inString = true;
		else if (char === "{" || char === "[") depth += 1;
		else if (char === "}" || char === "]") depth -= 1;
		else if (char === ",") {
			pending = { at: i, line, depth };
			if (depth === 1) block += 1;
		}
	}
	return found;
}

/** The blocks of a parsed list, each checked; null where a block is wrong. */
function inspectList(list: readonly unknown[]): {
	blocks: (ContentBlock | null)[];
	problems: BlockJsonProblem[];
} {
	const blocks: (ContentBlock | null)[] = [];
	const problems: BlockJsonProblem[] = [];
	list.forEach((item, index) => {
		const reason = blockReason(item);
		if (reason === null) {
			blocks.push(contentBlockSchema.parse(item));
		} else {
			blocks.push(null);
			problems.push({ index, reason, message: `Blok ${index + 1}: ${reason}` });
		}
	});
	return { blocks, problems };
}

const commaReason = (comma: TrailingComma) =>
	comma.before === "}"
		? `zbędny przecinek przed „}” (linia ${comma.line}): usuń go`
		: `zbędny przecinek po ostatnim bloku (linia ${comma.line}): usuń go`;

/**
 * JSON with commas left before "}" or "]": said block by block, and when
 * that is its only mistake, the rest of the blocks still checked and shown.
 */
function withTrailingCommas(
	text: string,
	commas: readonly TrailingComma[],
	error: unknown,
): InspectedJson {
	let repaired: unknown;
	try {
		let fixed = text;
		for (const comma of [...commas].reverse()) {
			fixed = fixed.slice(0, comma.at) + fixed.slice(comma.at + 1);
		}
		repaired = JSON.parse(fixed);
	} catch {
		repaired = undefined;
	}
	if (!Array.isArray(repaired)) {
		const [first] = commas;
		return {
			kind: "syntax",
			problem: first
				? `${syntaxProblem(error, text)}. Blok ${first.index + 1}: ${commaReason(first)}`
				: syntaxProblem(error, text),
		};
	}
	const { blocks, problems } = inspectList(repaired);
	for (const comma of commas) {
		blocks[comma.index] = null;
		const known = problems.find((problem) => problem.index === comma.index);
		const reason = commaReason(comma);
		if (known) {
			known.reason = `${reason}, ${known.reason}`;
			known.message = `Blok ${comma.index + 1}: ${known.reason}`;
		} else {
			problems.push({
				index: comma.index,
				reason,
				message: `Blok ${comma.index + 1}: ${reason}`,
			});
		}
	}
	problems.sort((a, b) => a.index - b.index);
	return { kind: "blocks", blocks, problems };
}

export function inspectContentJson(text: string): InspectedJson {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		const commas = trailingCommas(text);
		if (commas.length > 0) return withTrailingCommas(text, commas, error);
		return { kind: "syntax", problem: syntaxProblem(error, text) };
	}
	if (!Array.isArray(raw)) {
		return {
			kind: "notList",
			problem: "JSON musi być listą bloków: [ { … }, { … } ]",
		};
	}
	const { blocks, problems } = inspectList(raw);
	if (problems.length > 0) return { kind: "blocks", blocks, problems };
	return { kind: "ok", blocks: blocks as ContentBlock[] };
}

/**
 * Blocks from their JSON form (what the old panel's editor held). Fields this
 * panel does not know are kept on each block.
 */
export function parseContentJson(text: string): ParsedJson {
	const inspected = inspectContentJson(text);
	if (inspected.kind === "ok") return { ok: true, blocks: inspected.blocks };
	if (inspected.kind !== "blocks") {
		return { ok: false, problem: inspected.problem };
	}
	const [first, ...more] = inspected.problems;
	return {
		ok: false,
		problem: `${first?.message ?? "Któryś blok jest niepełny"}${more.length > 0 ? ` (i ${more.length} więcej)` : ""}`,
	};
}

/** The JSON form of blocks, for copying out. */
export function blocksToJson(blocks: readonly ContentBlock[]): string {
	return JSON.stringify(blocks, null, 2);
}

/** A short plain-text taste of the content, for lists and summaries. */
export function contentExcerpt(
	blocks: readonly ContentBlock[],
	maxLength = 140,
): string {
	const text = blocks
		.filter((block) => block.type !== "Image")
		.map((block) => block.content.replace(/<[^>]+>/g, "").trim())
		.filter(Boolean)
		.join(" · ");
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
