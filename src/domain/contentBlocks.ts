import { z } from "zod";
import { type ContentBlock, contentBlockSchema } from "@/data/schemas/workout";

/**
 * An address with a scheme other than the few a link in the app may use.
 * "x.pl" has no scheme and only gets a warning; "javascript:…" is refused.
 */
const UNSAFE_SCHEME = /^\s*(?!(?:https?|mailto|tel):)[a-z][a-z0-9+.-]*:/i;

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

function splittingCharacters(text: string): string[] {
	const found = text.match(new RegExp(APP_SPLIT_PATTERN, "g")) ?? [];
	return [...new Set(found)];
}

const TAG = /<\/?[^<>]*>/g;
const isSupportedTag = (tag: string) =>
	tag === "<b>" || tag === "</b>" || tag === "</a>" || /^<a\s[^>]*>$/.test(tag);

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
		if (/<a[\s>]/.test(whole)) error("Link w środku pogrubienia nie działa");
	}
	if (/<b>\s*<\/b>/.test(text)) error("Puste pogrubienie <b></b>; usuń je");

	for (const [whole] of text.matchAll(/<a(.+?)<\/a>/g)) {
		if (splittingCharacters(whole).length > 0) {
			error(
				"Link nie zadziała, bo w środku jest emoji, symbol albo „[”. Przenieś ten znak poza link",
			);
		}
		if (whole.includes("<b>")) error("Pogrubienie w środku linku nie działa");

		const quoted = /"(.+?)"/.exec(whole);
		if (!quoted) {
			error(
				'Link nie ma adresu w podwójnych cudzysłowach. Wymagany zapis: <a href="https://…">tekst</a>',
			);
		} else if (!/href=$/.test(whole.slice(0, quoted.index))) {
			error("W linku href musi być pierwszym atrybutem");
		} else if (UNSAFE_SCHEME.test(quoted[1] ?? "")) {
			// javascript:, data:, file: and the like must never reach the app.
			error(
				`Adres linku „${quoted[1]}” jest niedozwolony. Link musi zaczynać się od https://`,
			);
		} else if (!/^https?:\/\//i.test(quoted[1] ?? "")) {
			warning(`Adres linku „${quoted[1]}” nie zaczyna się od https://`);
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
		if (/<[^>]*>/.test(content)) {
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
		["error", `Nieznany rodzaj bloku „${block.type}”; aplikacja go pominie`],
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
			const href = /"(.+?)"/.exec(match[2] ?? "")?.[1] ?? "";
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
 */
export function textToBlocks(
	text: string,
	titleMax = DEFAULT_TITLE_MAX,
): ContentBlock[] {
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
		.map((paragraph) => {
			const plain = paragraph.replace(/<[^>]+>/g, "");
			const isTitle =
				!plain.includes("\n") &&
				plain.length <= Math.max(1, titleMax) &&
				!/[.!?…]$/.test(plain);
			return isTitle
				? { type: "Title", content: plain, metadata: null }
				: { type: "Text", content: paragraph, metadata: null };
		});
}

/** True when pasted text is meant as the JSON form of blocks. */
export const looksLikeJson = (text: string) => /^\s*[[{]/.test(text);

export type ParsedJson =
	| { ok: true; blocks: ContentBlock[] }
	| { ok: false; problem: string };

/**
 * Blocks from their JSON form (what the old panel's editor held). Fields this
 * panel does not know are kept on each block.
 */
export function parseContentJson(text: string): ParsedJson {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return {
			ok: false,
			problem:
				"To nie jest poprawny JSON. Sprawdź przecinki, cudzysłowy i nawiasy",
		};
	}
	if (!Array.isArray(raw)) {
		return {
			ok: false,
			problem: "JSON musi być listą bloków: [ { … }, { … } ]",
		};
	}
	const parsed = z.array(contentBlockSchema).safeParse(raw);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const position =
			typeof first?.path[0] === "number" ? first.path[0] + 1 : null;
		return {
			ok: false,
			problem: position
				? `Blok ${position} nie ma wymaganych pól „type” i „content”`
				: "Każdy blok musi mieć pola „type” i „content”",
		};
	}
	return { ok: true, blocks: parsed.data };
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
