import type { z } from "zod";
import {
	assertWritable,
	type Capabilities,
	needsStoredCopy,
	refuse,
	type WriteArea,
} from "@/data/api/capabilities";
import { ApiError, type ApiIssue, isApiError } from "@/data/api/errors";
import type { Versioned } from "@/data/api/types";
import { type ContentStatus, contentStatusSchema } from "@/data/schemas/common";
import { unexpectedAnswer } from "./failures";

// Pieces every area of the HTTP client uses: versions for entities the
// backend does not version yet, the checks before a save, and fitting what
// came over the wire into the panel's own schemas.

// ─── Versions ───────────────────────────────────────────────────────────────

const STAMP = "t:";
const HASH = "h:";

/** FNV-1a over the JSON text: short, stable, and good enough to tell versions apart. */
export function fingerprint(value: unknown): string {
	const text = JSON.stringify(value) ?? "";
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The version of an entity as read. The backend's own etag when it sends
 * one (BACKEND-SCOPE B2.1); until then the time of its last change, and
 * where it has none, a fingerprint of the whole row. All three change
 * whenever the stored row changes, which is all a version has to do.
 */
export function versionOf(wire: {
	etag?: string | null;
	updatedAtUtc?: string | null;
}): string {
	if (wire.etag) return wire.etag;
	if (wire.updatedAtUtc) return `${STAMP}${wire.updatedAtUtc}`;
	return `${HASH}${fingerprint(wire)}`;
}

/** True for an etag the backend issued, as opposed to one worked out here. */
export const isBackendEtag = (etag: string): boolean =>
	etag !== "" && !etag.startsWith(STAMP) && !etag.startsWith(HASH);

// ─── Status ─────────────────────────────────────────────────────────────────

/** Rows from before statuses existed only say whether they are hidden. */
export function statusFrom(wire: {
	status?: string | null;
	hidden?: boolean | null;
}): ContentStatus {
	const known = contentStatusSchema.safeParse(wire.status);
	if (known.success) return known.data;
	return wire.hidden ? "hidden" : "published";
}

/**
 * What to send for a status. A backend without statuses stores a draft as
 * hidden (the closest it has) and cannot delete at all.
 */
export function statusFields(
	status: ContentStatus,
	capabilities: Capabilities,
): { hidden: boolean; status?: ContentStatus } {
	const hidden = status !== "published";
	if (capabilities.status) return { hidden, status };
	if (status === "deleted") {
		refuse(
			"Produkcja nie ma jeszcze kosza: usuwanie dojdzie razem ze statusami w backendzie. Na razie można tylko ukryć.",
			"status",
		);
	}
	return { hidden };
}

/** What the backend keeps about an item itself; never sent back as an edit. */
export const READ_ONLY_FIELDS = [
	"warnings",
	"deletedAtUtc",
	"deletedBy",
] as const;

/**
 * One thing the answer to a save of a draft says publishing would refuse.
 * The save went through; this is for the person to see, not an error.
 */
export interface SaveWarning extends ApiIssue {
	/** Stable, for code: REQUIRED, UNKNOWN_ID, LENGTH_MISMATCH, … */
	code: string;
}

/**
 * The `warnings` of an answer, each with a text; anything else is dropped.
 *
 * @param placed turns the backend's path of a problem into the panel's
 */
export function readWarnings(
	raw: unknown,
	placed: (path: string) => string = (path) => path,
): SaveWarning[] {
	if (!Array.isArray(raw)) return [];
	const warnings: SaveWarning[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const { path, code, message } = item as Record<string, unknown>;
		if (typeof message !== "string" || message.trim() === "") continue;
		warnings.push({
			path: placed(typeof path === "string" ? path : ""),
			code: typeof code === "string" ? code : "",
			message,
		});
	}
	return warnings;
}

/** JSON with every object's keys in order: the same value reads the same however it was built. */
function ordered(value: unknown): string {
	return (
		JSON.stringify(value, (_key, inner: unknown) =>
			typeof inner === "object" && inner !== null && !Array.isArray(inner)
				? Object.fromEntries(
						Object.entries(inner).sort(([a], [b]) =>
							a < b ? -1 : a > b ? 1 : 0,
						),
					)
				: inner,
		) ?? ""
	);
}

/** What a save changes when it changes nothing but the status. */
const apartFromStatus = (item: object): string => {
	const {
		status: _status,
		etag: _etag,
		warnings: _warnings,
		...rest
	} = item as Record<string, unknown>;
	return ordered(rest);
};

export interface StatusWatch<T> {
	/**
	 * Notes a version the backend sent.
	 *
	 * @param whole false when part of the item was made up here (a variant
	 *   without an id of its own): the stored item is then not what a status
	 *   change alone would leave
	 */
	remember(item: T, whole?: boolean): T;
	/** The status of that version as stored, when this is the version seen. */
	storedStatus(id: string, etag: string): ContentStatus | undefined;
	/**
	 * True when `incoming` is the version `etag` names with another status and
	 * nothing else changed. Only then can the status be changed without
	 * sending the item: anything that cannot be shown to be untouched is sent.
	 *
	 * @param evenInPart also for a version part of which was made up here
	 */
	onlyStatusChanged(incoming: T, etag: string, evenInPart?: boolean): boolean;
}

/**
 * Remembers each item as the backend last sent it, to tell a change of
 * status from an edit. The ApiClient has one `save` for both; the backend
 * has a call of its own for a status (`POST …/{id}/status`).
 */
export function statusWatch<
	T extends Versioned & { status: ContentStatus },
>(): StatusWatch<T> {
	const seen = new Map<string, { item: T; whole: boolean }>();
	const at = (id: string, etag: string) => {
		const known = seen.get(id);
		return known && known.item.etag === etag ? known : undefined;
	};
	return {
		remember(item, whole = true) {
			seen.set(item.id, { item, whole });
			return item;
		},
		storedStatus: (id, etag) => at(id, etag)?.item.status,
		onlyStatusChanged(incoming, etag, evenInPart = false) {
			const known = at(incoming.id, etag);
			return (
				known !== undefined &&
				(known.whole || evenInPart) &&
				known.item.status !== incoming.status &&
				apartFromStatus(known.item) === apartFromStatus(incoming)
			);
		},
	};
}

// ─── Sent exactly as it is to be stored ─────────────────────────────────────
//
// On the panel's routes the backend tidies nothing outside a draft: a text
// id with a space after it, an empty entry in a list of ids, a date that is
// not a full instant are each refused with a field and a code, where they
// used to be trimmed, dropped or guessed on the way to storage. What can be
// put right without changing what the person meant is put right here, before
// it is sent. Anything else is left alone, for the backend to refuse at its
// field: a value is never bent into something valid.

/**
 * An id, a path or an address without the white space around it; null when
 * nothing is left. Anything that is not a text comes back as it is.
 */
export function exactText<T>(value: T): T | string | null {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * Characters nobody can see and nobody means to type: control characters, a
 * zero-width space, a byte order mark. They come along when a text is pasted
 * from a document. Not a tab or a line break: those the person can see, and
 * what becomes of them is theirs to decide.
 */
const isInvisible = (code: number): boolean =>
	(code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
	(code >= 0x7f && code <= 0x9f) ||
	code === 0x200b ||
	code === 0xfeff;

/**
 * A title the way the backend takes one: no white space around it and no
 * character nobody can see inside it (it refuses both). A line break or a
 * tab inside is left for the backend to refuse: joining two lines into one
 * would be writing the title for the person. Anything that is not a text
 * comes back as it is.
 */
export function exactTitle<T>(value: T): T | string {
	if (typeof value !== "string") return value;
	return [...value]
		.filter((character) => !isInvisible(character.codePointAt(0) ?? 0))
		.join("")
		.trim();
}

/**
 * A list of ids that is a set: each id without the space around it, no empty
 * entry, each id once (the first time it appears, so the order holds).
 * Anything that is not a list, and any entry that is not a text, comes back
 * as it is.
 */
export function exactIds<T>(list: T): T {
	if (!Array.isArray(list)) return list;
	const seen = new Set<string>();
	const ids: unknown[] = [];
	for (const entry of list) {
		if (typeof entry !== "string") {
			ids.push(entry);
			continue;
		}
		const id = entry.trim();
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids as T;
}

/**
 * What the backend takes for a moment: ISO 8601 with a time to the second
 * and a zone. Groups: year, month, day, the digits after the second.
 */
const ISO_INSTANT =
	/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;
/** A time that says which zone it is in, in a spelling the backend does not take. */
const WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/;

/** Whether the day a text starts with is one the calendar has (not 31 February). */
function isRealDay(year: string, month: string, day: string): boolean {
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return (
		date.getUTCFullYear() === Number(year) &&
		date.getUTCMonth() === Number(month) - 1 &&
		date.getUTCDate() === Number(day)
	);
}

/**
 * A date the way the backend stores one: a full ISO instant, or null for
 * none ("" is not "no date" there). A moment that names its zone in another
 * spelling ("2026-01-31T00:00Z", or with more digits after the second than
 * the route takes) is written out in full. Everything else is left as it
 * is, for the backend to refuse at its field: a date without a time or
 * without a zone (which moment it means would be a guess), and a day that
 * does not exist (`new Date` would quietly make 31 February a day in March).
 *
 * @param fraction how many digits after the second the route takes: three
 *   for challenges and workouts, seven for badges, messages and grants
 */
export function isoInstantOrNull<T>(value: T, fraction = 7): T | string | null {
	if (typeof value !== "string") return value;
	const text = value.trim();
	if (text === "") return null;
	const full = ISO_INSTANT.exec(text);
	if (full && (full[4]?.length ?? 0) <= fraction) return text;
	const loose = full ?? WITH_ZONE.exec(text);
	if (loose && isRealDay(loose[1] ?? "", loose[2] ?? "", loose[3] ?? "")) {
		const date = new Date(text);
		if (!Number.isNaN(date.getTime())) return date.toISOString();
	}
	return value;
}

/** Digits after the second that the routes of challenges and workouts take. */
export const CONTENT_DATE_FRACTION = 3;

/**
 * `updatedAtUtc` of a challenge or a workout, for a save under the editing
 * contract. The backend writes its own time and ignores this one, but holds
 * it to the rule for dates all the same. So it goes back as a full instant,
 * or not at all: nobody could put right a refusal at a field no form has.
 */
export function sentUpdatedAt(body: Record<string, unknown>): void {
	const value = isoInstantOrNull(body.updatedAtUtc, CONTENT_DATE_FRACTION);
	const full = typeof value === "string" ? ISO_INSTANT.exec(value) : null;
	const year = Number(full?.[1]);
	if (
		typeof value === "string" &&
		full &&
		(full[4]?.length ?? 0) <= CONTENT_DATE_FRACTION &&
		isRealDay(full[1] ?? "", full[2] ?? "", full[3] ?? "") &&
		// the years the backend takes a date of a challenge or a workout to be in
		year >= 2000 &&
		year <= 2100
	) {
		body.updatedAtUtc = value;
	} else {
		delete body.updatedAtUtc;
	}
}

/**
 * A new item says when it was added; one that is stored and does not say is
 * sent without the field, which keeps the stored date. The backend fills in
 * neither outside a draft.
 */
export function addedAt(
	body: Record<string, unknown>,
	isNew: boolean,
	now: () => string,
): void {
	if (typeof body.addedAtUtc === "string" && body.addedAtUtc.trim() !== "") {
		return;
	}
	if (isNew) body.addedAtUtc = now();
	else delete body.addedAtUtc;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// ─── Fitting answers into the panel's schemas ───────────────────────────────

/**
 * Parses one entity. A row that does not fit fails loudly, with its id and
 * the field: a list that silently left a row out would hide real content.
 */
export function conform<T>(
	schema: z.ZodType<T>,
	value: unknown,
	what: string,
): T {
	const parsed = schema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw unexpectedAnswer(
		`${what}: dane nie pasują do oczekiwanych.`,
		parsed.error.issues.slice(0, 20).map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		})),
	);
}

/** A whole number of at least `min`; anything else becomes `fallback`. */
export function wholeNumber(value: unknown, fallback: number, min = 0): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.trunc(value))
		: fallback;
}

/** An ISO date for anything `Date` can read; null for the rest. */
export function isoOrNull(value: unknown): string | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ─── Saving ─────────────────────────────────────────────────────────────────

const CHANGED_MEANWHILE = "Ktoś zmienił to w międzyczasie.";

export function conflict<T>(
	current: T | undefined,
	status?: number,
	message: string = CHANGED_MEANWHILE,
): ApiError<T> {
	return new ApiError<T>("conflict", message, {
		current,
		status,
	});
}

export interface SaveCheck<T extends Versioned> {
	capabilities: Capabilities;
	area: WriteArea;
	incoming: T;
	/** The version the change is based on. */
	etag: string;
	/** Reads the entity as stored now. */
	readStored(): Promise<T>;
	/** The text that carries the [TEST] mark. */
	markOf(item: T): string | null | undefined;
	/** That field's label and path, for the message. */
	field: string;
	path: string;
}

/**
 * Everything that has to hold before an entity is written, in the order
 * that costs least: the environment's switch first (no request), then, only
 * where needed, one read of the stored version to see that it is a test
 * item and that nobody changed it since.
 *
 * @returns the headers that name the version the change is based on, which
 *   make the backend itself refuse a stale save; none for a version worked
 *   out here, which the backend could not check
 */
export async function checkSave<T extends Versioned>(
	check: SaveCheck<T>,
): Promise<Record<string, string>> {
	const { capabilities, area, incoming, etag } = check;
	const mark = (texts: (string | null | undefined)[]) => ({
		texts,
		field: check.field,
		path: check.path,
	});
	assertWritable(capabilities, area, mark([check.markOf(incoming)]));
	// A version worked out here (not issued by the backend) cannot be checked
	// by the backend, so it is always checked against a fresh read.
	if (needsStoredCopy(capabilities, area) || !isBackendEtag(etag)) {
		const stored = await check.readStored();
		assertWritable(
			capabilities,
			area,
			mark([check.markOf(stored), check.markOf(incoming)]),
		);
		if (stored.etag !== etag) throw conflict(stored);
	}
	// The panel's routes refuse a change to an existing item that names no
	// version (428 VERSION_REQUIRED), so with `etag` on every save of one
	// names it. With `etag` off none is named, as before versions existed:
	// against the backend as it is now such a save is refused, which makes
	// that switch a way to stop saving, not a second way to save.
	return capabilities.etag && isBackendEtag(etag) ? { "if-match": etag } : {};
}

/**
 * Runs a write and makes sure a conflict carries the stored entity in the
 * panel's shape: taken from the answer when the backend sends it, read
 * again when it does not. The saver needs it to merge.
 */
export async function withCurrent<R, C>(
	run: () => Promise<R>,
	fromAnswer: (raw: unknown) => C,
	reread: () => Promise<C>,
): Promise<R> {
	try {
		return await run();
	} catch (error) {
		if (!isApiError(error) || error.kind !== "conflict") throw error;
		let current: C | undefined;
		if (error.current !== undefined) {
			try {
				current = fromAnswer(error.current);
			} catch {
				current = undefined;
			}
		}
		if (current === undefined) {
			try {
				current = await reread();
			} catch {
				current = undefined;
			}
		}
		// The backend's own words are kept: a 409 can also mean "still in use".
		throw conflict(current, error.status, error.message || undefined);
	}
}

// ─── Small helpers ──────────────────────────────────────────────────────────

export interface SharedLoad<T> {
	/** Loads now; callers that ask while a load is running share it. */
	fresh(): Promise<T>;
	/** The last result when it is younger than `ms`, otherwise a fresh load. */
	recent(ms: number): Promise<T>;
	/** The last result, however old, without loading; undefined before the first. */
	last(): T | undefined;
}

/**
 * One load shared by callers that need the same list at the same moment.
 * The planning list needs the id of every challenge exactly when the
 * challenge list is loading anyway; this keeps that to one request, without
 * ever handing the challenge list itself a stale answer.
 */
export function sharedLoad<T>(
	load: () => Promise<T>,
	now: () => number = Date.now,
): SharedLoad<T> {
	let running: Promise<T> | null = null;
	let last: { at: number; value: T } | null = null;
	const fresh = () => {
		if (running) return running;
		const started = load().then(
			(value) => {
				last = { at: now(), value };
				running = null;
				return value;
			},
			(error: unknown) => {
				running = null;
				throw error;
			},
		);
		running = started;
		return started;
	};
	return {
		fresh,
		recent: (ms) =>
			last && now() - last.at < ms ? Promise.resolve(last.value) : fresh(),
		last: () => last?.value,
	};
}

/**
 * The id of what a write stored. The planned answer is the entity itself
 * (B2.2); today's is a sentence with the id in it, sometimes next to the
 * stored row in the backend's own casing.
 */
export function savedId(raw: unknown, sentence: RegExp): string | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id === "string" && raw.id !== "") return raw.id;
	const update = raw.update;
	if (isRecord(update)) {
		const id = update.Id ?? update.id;
		if (typeof id === "string" && id !== "") return id;
	}
	if (typeof raw.result === "string") {
		const match = sentence.exec(raw.result);
		if (match?.[1]) return match[1];
	}
	return null;
}
