import type { Environment } from "@/data/environment";
import { ApiError } from "./errors";

// What an environment's backend can do, and what the panel may write to it.
//
// Test has everything: the mock implements the whole target contract.
// Produkcja gains one line at a time, as the backend gains the feature and
// Michał accepts the section (docs/ROADMAP.md §1, §4 and §5). The HTTP
// client reads this before every call: something that is off costs no
// request.
//
// Two kinds of line. A feature switch says what the backend can do; it
// decides how the client talks to it, also when it only reads. A write mode
// says what the panel may change. A feature that is on opens no write.

/**
 * - off: the section is read-only
 * - test-only: only items marked [TEST] can be created or changed
 * - on: normal
 */
export type WriteMode = "off" | "test-only" | "on";

export type WriteArea =
	| "workouts"
	| "challenges"
	| "badges"
	| "messages"
	| "media"
	/** Delivering a message to real people. Cannot be tried on a test item. */
	| "sendMessage"
	/** Which challenge the app shows first. Cannot be tried on a test item. */
	| "promotedChallenge"
	/** A person's e-mail address. */
	| "users"
	/** Giving and taking back a person's badge. */
	| "userBadges"
	/**
	 * Planning documents of challenges and the planner's settings. A document
	 * has no comment to carry [TEST]: in test-only mode the mark is read from
	 * the stored challenge it belongs to, and the settings stay closed.
	 */
	| "planning"
	/**
	 * Special offers (campaign codes). An offer has no comment to carry
	 * [TEST], so there is no test-only mode: the section is off or on.
	 */
	| "offers"
	/**
	 * Clearing the app's CDN cache, so the app shows the newest content at
	 * once. Changes no data: it is open in Produkcja while the rest is
	 * read-only, and does not count when deciding whether anything can be
	 * saved (`isReadOnly`).
	 */
	| "cache";

export interface Capabilities {
	writes: Record<WriteArea, WriteMode>;
	/**
	 * The backend speaks the editing contract (BACKEND-SCOPE B2): it returns
	 * an etag with every entity and refuses a save based on an old one, it
	 * answers a save with the saved entity, a field left out of a save keeps
	 * its stored value and null clears it, and it refuses by itself a create
	 * that would land on an existing item. Off: the panel compares with a
	 * fresh read just before saving (which catches a stale tab but is not
	 * atomic), reads again after it, checks before a create, and names no
	 * version. The backend as it is since 2026-11-13 refuses a change to an
	 * existing item that names none (428), so turning this off there stops
	 * every such save: a brake, not a second way to save.
	 */
	etag: boolean;
	/**
	 * Draft and deleted exist (B1), a list has to ask for the deleted ones,
	 * and a status can be changed without sending the whole item. Off: there
	 * is only "hidden", as in Retool; a draft is stored as hidden and nothing
	 * can be deleted.
	 */
	status: boolean;
	/**
	 * The store for planning documents and planner settings exists (B3), and
	 * so do the variants' own ids, which planning is keyed by (B3.3). Whether
	 * the panel may save there is `writes.planning`.
	 */
	planning: boolean;
	badgeDelete: boolean;
	messageUnarchive: boolean;
}

const every = (mode: WriteMode): Record<WriteArea, WriteMode> => ({
	workouts: mode,
	challenges: mode,
	badges: mode,
	messages: mode,
	media: mode,
	sendMessage: mode,
	promotedChallenge: mode,
	users: mode,
	userBadges: mode,
	planning: mode,
	offers: mode,
	cache: mode,
});

export const ALL_CAPABILITIES: Capabilities = {
	writes: every("on"),
	etag: true,
	status: true,
	planning: true,
	badgeDelete: true,
	messageUnarchive: true,
};

/**
 * Produkcja today: everything can be read, no data can be written
 * (roadmap slice L2). To open a section, change its line to "test-only"
 * first, and to "on" only when Michał says the section is accepted. The
 * Worker keeps its own list (`OPEN_FOR_WRITING` in worker/proxy.ts): a
 * section is open only when both say so. The one area on is `cache`:
 * clearing the app's CDN cache changes no data.
 *
 * The five features are what the backend has had since 2026-11-13. Each can
 * go back to false on its own: the client then talks to the backend the way
 * it did before, for that feature only.
 */
export const PRODUCTION_CAPABILITIES: Capabilities = {
	writes: { ...every("off"), cache: "on" },
	etag: true,
	status: true,
	planning: true,
	badgeDelete: true,
	messageUnarchive: true,
};

export function capabilitiesFor(environment: Environment): Capabilities {
	return environment === "production"
		? PRODUCTION_CAPABILITIES
		: ALL_CAPABILITIES;
}

/**
 * True when no data at all can be saved. Clearing the app's cache changes no
 * data, so it does not count.
 */
export const isReadOnly = (capabilities: Capabilities): boolean =>
	Object.entries(capabilities.writes).every(
		([area, mode]) => area === "cache" || mode === "off",
	);

/** How a test item is marked: at the start of its internal comment. */
export const TEST_MARK = "[TEST]";

export const isTestMarked = (text: string | null | undefined): boolean =>
	(text ?? "").trimStart().toUpperCase().startsWith(TEST_MARK);

/**
 * A save the panel itself will not make. It is a "validation" error on
 * purpose: screens show its text next to the form, and the saver does not
 * retry it the way it retries a lost connection.
 */
export function refuse(message: string, path = ""): never {
	throw new ApiError("validation", message, {
		issues: [{ path, message }],
	});
}

const LABEL: Record<WriteArea, string> = {
	workouts: "Treningi",
	challenges: "Wyzwania",
	badges: "Odznaki",
	messages: "Wiadomości",
	media: "Media",
	sendMessage: "Wysyłanie wiadomości",
	promotedChallenge: "Promowane wyzwanie",
	users: "Użytkownicy",
	userBadges: "Odznaki użytkowników",
	planning: "Planowanie",
	offers: "Oferty specjalne",
	cache: "Pamięć podręczna backendu",
};

export interface TestMark {
	/** The text that has to start with the mark; one per version checked. */
	texts: readonly (string | null | undefined)[];
	/** What the person sees the field called, e.g. "Komentarz wewnętrzny". */
	field: string;
	/** The field's path in the entity, to put the message next to it. */
	path: string;
}

/**
 * Stops a write the environment does not allow. Called before any request.
 *
 * @param mark how this write shows that it is a test item, or null when the
 *   action cannot be limited to one (it is then allowed only when "on")
 */
export function assertWritable(
	capabilities: Capabilities,
	area: WriteArea,
	mark: TestMark | null,
): void {
	const mode = capabilities.writes[area];
	if (mode === "on") return;
	if (mode === "off") {
		refuse(
			`Produkcja jest na razie tylko do odczytu: zapis w sekcji „${LABEL[area]}” jest wyłączony.`,
		);
	}
	if (!mark) {
		refuse(
			`Produkcja: „${LABEL[area]}” nie da się wypróbować na elemencie testowym, więc ta operacja jest jeszcze wyłączona.`,
		);
	}
	if (!mark.texts.every(isTestMarked)) {
		refuse(
			`Produkcja: na razie można zapisywać tylko elementy testowe. Pole „${mark.field}” musi zaczynać się od ${TEST_MARK}, także w wersji już zapisanej.`,
			mark.path,
		);
	}
}

/** True when a save has to look at the stored version before writing. */
export const needsStoredCopy = (
	capabilities: Capabilities,
	area: WriteArea,
): boolean => capabilities.writes[area] === "test-only" || !capabilities.etag;
