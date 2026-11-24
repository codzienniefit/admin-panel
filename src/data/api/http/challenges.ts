import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable } from "@/data/api/capabilities";
import { ApiError, isApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import {
	type Challenge,
	type ContentStatus,
	challengeSchema,
	type NewChallenge,
	type Path,
} from "@/data/schemas/challenge";
import { unexpectedAnswer } from "./failures";
import {
	addedAt,
	CONTENT_DATE_FRACTION,
	checkSave,
	conform,
	exactIds,
	exactText,
	exactTitle,
	isoInstantOrNull,
	READ_ONLY_FIELDS,
	readWarnings,
	savedId,
	sentUpdatedAt,
	statusFields,
	statusFrom,
	statusWatch,
	versionOf,
	wholeNumber,
	withCurrent,
} from "./shared";
import type { Transport } from "./transport";

// Challenges and plans: `manageChallenges` of the backend
// (ChallengeUpsertAdminDto in its src/models/dto/internal.ts, and
// src/handlers/admin/manageChallangesHandler.ts for what a save does).

// ─── What the backend sends ─────────────────────────────────────────────────

// Only what the mapping below reads is described, and all of it leniently:
// the backend omits some unset fields and sends null for others, and rows
// written years ago can lack what newer ones have.
const wirePathSchema = z.looseObject({
	pathId: z.string().nullish(),
	levelId: z.string(),
	// Free text in the backend ("3", sometimes "3-4").
	frequency: z.union([z.string(), z.number()]).nullish(),
	minimumDaysToComplete: z.number().nullish(),
	days: z
		.array(
			z.looseObject({
				dayIndex: z.number(),
				workoutIds: z.array(z.string()).nullish(),
			}),
		)
		.nullish(),
});
type WirePath = z.infer<typeof wirePathSchema>;

export const wireChallengeSchema = z.looseObject({
	id: z.string(),
	etag: z.string().nullish(),
	title: z.string().nullish(),
	status: z.string().nullish(),
	hidden: z.boolean().nullish(),
	pro: z.boolean().nullish(),
	lengthDays: z.number().nullish(),
	updatedAtUtc: z.string().nullish(),
	paths: z.array(wirePathSchema).nullish(),
	// Only in the answer to a save: what publishing would refuse.
	warnings: z.array(z.unknown()).nullish(),
});
export type WireChallenge = z.infer<typeof wireChallengeSchema>;

// ─── Variant ids ────────────────────────────────────────────────────────────
//
// The planner's address, the list of recent plans and every planning
// document name a variant by its `pathId`. The backend has such ids since
// 2026-11-13, but a variant stored before then has none until its challenge
// is saved the next time (`pathId: null`), and the panel needs one now.
//
// So the client makes one up from the level, and (with `planning` on) makes
// it up in a form the backend takes as a proposal: a save sends it, the
// backend stores it as that variant's id (its `assignPathIds`: a variant
// continues a stored one or "proposes its own"), and the id the person had
// in the address bar before the save is the id after it. Nothing changes
// under the planner, and nothing has to be moved in a planning document.
//
// Where that cannot work, the id does change, to the backend's own
// `p_` + 12 hex digits: when the challenge is saved from Retool, or deleted,
// or its status is changed by the status call, before the panel saved it
// once; and for a level whose id does not fit the backend's rule for path
// ids. For those cases the planning list carries the data over when it is
// read (`carryVariantKeys` in panelDocs.ts).

/** A variant's id on a backend that has none: its level. Never sent. */
const LEVEL_ID = "level:";
/** The same in the form the backend accepts as the id of a variant. */
const PROPOSED_ID = "level-";
/** What the backend accepts as a path id (its `isValidPathId`). */
const PATH_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a path id this client made up and never sends back. */
export const isDerivedPathId = (pathId: string): boolean =>
	pathId.startsWith(LEVEL_ID);

function madeUpPathId(levelId: string, n: number, proposable: boolean): string {
	if (proposable) {
		const id =
			n === 1 ? `${PROPOSED_ID}${levelId}` : `${PROPOSED_ID}${levelId}-${n}`;
		if (PATH_ID.test(id)) return id;
	}
	return n === 1 ? `${LEVEL_ID}${levelId}` : `${LEVEL_ID}${levelId}#${n}`;
}

export interface PathIds {
	/** One id per variant, in order. */
	ids: string[];
	/** True when at least one was made up here. */
	madeUp: boolean;
}

/**
 * The id the panel knows each variant by: the backend's where it has one,
 * otherwise one made up from the level.
 *
 * @param proposable make ids up in the form a save can propose
 */
export function pathIdsOf(
	paths: readonly { pathId?: string | null; levelId: string }[],
	proposable: boolean,
): PathIds {
	const own = new Set(
		paths.map((path) => path.pathId).filter((id) => typeof id === "string"),
	);
	const taken = new Set<string>();
	let madeUp = false;
	const ids = paths.map((path) => {
		let id = path.pathId ?? null;
		if (id === null || taken.has(id)) {
			madeUp = true;
			// Two variants at the same level are possible in old rows (nothing
			// forbade it): the second is numbered. So is a repeated id.
			for (let n = id === null ? 1 : 2; ; n++) {
				id = madeUpPathId(path.levelId, n, proposable);
				if (!taken.has(id) && !own.has(id)) break;
			}
		}
		taken.add(id);
		return id;
	});
	return { ids, madeUp };
}

/**
 * Every id this client would have shown for a variant of this level while
 * the backend had none for it: both forms, the first and the numbered ones.
 */
export function formerPathIds(
	levelIds: readonly string[],
): readonly string[][] {
	const none = levelIds.map((levelId) => ({ levelId }));
	const proposed = pathIdsOf(none, true).ids;
	const never = pathIdsOf(none, false).ids;
	return levelIds.map((_levelId, index) => [
		...new Set([proposed[index] ?? "", never[index] ?? ""]),
	]);
}

// ─── Issue paths ────────────────────────────────────────────────────────────

/**
 * The backend names a variant in a problem by its place in the request
 * ("paths.0.days.2.workoutIds"); the panel's forms and its own rules name it
 * by its id ("paths.<pathId>", domain/challengeRules.ts). The place becomes
 * the id; what follows it stays, so the day is still told.
 */
export function pathById(path: string, pathIds: readonly string[]): string {
	const match = /^paths\.(\d+)(?=\.|$)/.exec(path);
	const id = match ? pathIds[Number(match[1])] : undefined;
	return match && id !== undefined
		? `paths.${id}${path.slice(match[0].length)}`
		: path;
}

/** A refusal with its problems named the panel's way. */
function withPathIds(error: unknown, pathIds: readonly string[]): unknown {
	if (!isApiError(error) || error.kind !== "validation") return error;
	const issues = error.issues.map((issue) => ({
		...issue,
		path: pathById(issue.path, pathIds),
	}));
	if (
		issues.every((issue, index) => issue.path === error.issues[index]?.path)
	) {
		return error;
	}
	return new ApiError("validation", error.message, {
		issues,
		status: error.status,
		current: error.current,
	});
}

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * "3" → 3. Anything that is not a plain number keeps its text next to the
 * number the planner works with, so saving does not rewrite "3-4" as "3".
 */
export function readFrequency(raw: string | number | null | undefined): {
	frequency: number;
	frequencyText?: string;
} {
	if (typeof raw === "number" && Number.isFinite(raw))
		return { frequency: raw };
	const text = typeof raw === "string" ? raw.trim() : "";
	const parsed = Number.parseFloat(text.replace(",", "."));
	if (!Number.isFinite(parsed)) {
		// An empty text is kept as well: a save must not turn "" into "1".
		return typeof raw === "string"
			? { frequency: 1, frequencyText: text }
			: { frequency: 1 };
	}
	return String(parsed) === text
		? { frequency: parsed }
		: { frequency: parsed, frequencyText: text };
}

function toPath(wire: WirePath, pathId: string): unknown {
	return {
		...wire,
		pathId,
		...readFrequency(wire.frequency),
		minimumDaysToComplete: wholeNumber(wire.minimumDaysToComplete, 0),
		days: (wire.days ?? []).map((day) => ({
			...day,
			workoutIds: day.workoutIds ?? [],
		})),
	};
}

/**
 * A challenge as the panel holds it, and whether all of it is the backend's
 * own (false when a variant's id was made up here).
 */
export function readChallenge(
	raw: unknown,
	capabilities?: Pick<Capabilities, "planning">,
): { challenge: Challenge; whole: boolean } {
	const wire = conform(wireChallengeSchema, raw, "Wyzwanie");
	const wirePaths = wire.paths ?? [];
	const pathIds = pathIdsOf(wirePaths, capabilities?.planning === true);
	const paths = wirePaths.map((path, index) =>
		toPath(path, pathIds.ids[index] ?? ""),
	);
	const longest = Math.max(
		1,
		...wirePaths.map((path) => path.days?.length ?? 0),
	);
	const { warnings: said, ...rest } = wire;
	const warnings = readWarnings(said, (path) => pathById(path, pathIds.ids));
	const challenge = conform(
		challengeSchema,
		{
			...rest,
			// Kept on the challenge the save answered with, for the screen to
			// show; never sent back, and gone with the next read of the list.
			...(warnings.length > 0 ? { warnings } : {}),
			etag: versionOf(wire),
			status: statusFrom(wire),
			title: wire.title ?? "",
			pro: wire.pro ?? false,
			lengthDays: wholeNumber(wire.lengthDays, longest, 1),
			updatedAtUtc: wire.updatedAtUtc ?? "",
			paths,
		},
		`Wyzwanie ${wire.id}`,
	);
	return { challenge, whole: !pathIds.madeUp };
}

/**
 * @param capabilities with `planning` on, a variant without an id gets one
 *   a save can propose to the backend (see "Variant ids" above)
 */
export function toChallenge(
	raw: unknown,
	capabilities?: Pick<Capabilities, "planning">,
): Challenge {
	return readChallenge(raw, capabilities).challenge;
}

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * Whether the backend takes this for a variant's workouts a week: a text of
 * at most 40 characters, no space around it, that starts with a number of
 * at least one ("3", "3-4", "3,5").
 */
export function isFrequencyText(value: unknown): value is string {
	if (typeof value !== "string" || value === "" || value !== value.trim()) {
		return false;
	}
	if (value.length > 40) return false;
	const perWeek = Number.parseFloat(value.replace(",", "."));
	return Number.isFinite(perWeek) && perWeek >= 1;
}

function fromPath(path: Path, exact: boolean): Record<string, unknown> {
	const { pathId, frequency, frequencyText, ...rest } = path;
	const kept =
		typeof frequencyText === "string" ? readFrequency(frequencyText) : null;
	const body: Record<string, unknown> = {
		...rest,
		// An id made up in the form the backend cannot take stays here, and the
		// backend assigns its own. Any other is sent: the backend's own, one
		// the panel gave a new variant, or one made up for it to adopt.
		...(isDerivedPathId(pathId) ? {} : { pathId }),
		// The text as it was, unless the number was changed in the planner.
		frequency:
			kept && kept.frequency === frequency
				? (frequencyText as string)
				: String(frequency),
	};
	if (exact) {
		// The backend takes only a text that starts with a number of at least
		// one. A kept text that is none ("", "abc") would be refused whatever
		// the planner shows, and choosing the same number again would not
		// help: then the number the planner shows is what is sent.
		if (!isFrequencyText(body.frequency)) body.frequency = String(frequency);
		// Required outside a draft; the form shows "no" for a variant that
		// never said.
		body.pro = path.pro ?? false;
		// A description is stored as it is sent: none for one that is blank.
		body.description = exactText(path.description);
		body.difficultyLevelsIds = exactIds(path.difficultyLevelsIds);
		// A day is told by its number, not by its place; the backend wants
		// them in order.
		body.days = [...path.days].sort((a, b) => a.dayIndex - b.dayIndex);
	}
	return body;
}

/** The ids the backend takes exactly as stored: no space around them, null for none. */
const EXACT_IDS = [
	"categoryId",
	"badgeId",
	"perfectCompletionBadgeId",
	"offeringId",
	"offeringDiscountedId",
] as const;

/** The lists that are sets of ids: no empty entry, none twice. */
const ID_LISTS = [
	"goalsIds",
	"difficultyLevelsIds",
	"unlockedByEntitlementIds",
	"discountedForEntitlementIds",
] as const;

/** The moments of a challenge: each a full ISO instant, or null for none. */
const DATES = [
	"addedAtUtc",
	"liveAtUtc",
	"endsAtUtc",
	"availableAtUtc",
] as const;

/** Each challenge to suggest once, in the order given (the first time counts). */
function exactRecommendations(list: unknown): unknown {
	if (!Array.isArray(list)) return list;
	const seen = new Set<string>();
	return list.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [entry];
		const id = (entry as { id?: unknown }).id;
		if (typeof id !== "string") return [entry];
		const exact = id.trim();
		if (exact === "" || seen.has(exact)) return [];
		seen.add(exact);
		return [{ ...entry, id: exact }];
	});
}

/**
 * The request body for a save: ChallengeUpsertAdminDto.
 *
 * With `etag` on (the editing contract) what the backend would refuse for
 * its spelling alone is put right first: see "Sent exactly as it is to be
 * stored" in shared.ts. What is wrong in substance is sent as it is.
 */
export function fromChallenge(
	challenge: Challenge | NewChallenge,
	capabilities: Capabilities,
	now: () => string = () => new Date().toISOString(),
): Record<string, unknown> {
	const { etag: _etag, status, hidden: _hidden, paths, ...rest } = challenge;
	// What the backend keeps about the challenge itself is not an edit.
	for (const field of READ_ONLY_FIELDS) {
		delete (rest as Record<string, unknown>)[field];
	}
	// the backend's defaults are its own; a backend that does not send them
	// would refuse the field
	delete (rest as Record<string, unknown>).defaultRecommendedNext;
	const isNew = typeof challenge.id !== "string";
	const exact = capabilities.etag;
	const body: Record<string, unknown> = {
		...rest,
		// Null makes the backend assign the next free id.
		id: isNew ? null : challenge.id,
		...statusFields(status, capabilities),
		subtitle: challenge.subtitle ?? "",
		imageRelativePath: challenge.imageRelativePath ?? "",
		// Required by the backend's type; it writes its own time.
		updatedAtUtc:
			typeof challenge.updatedAtUtc === "string" && challenge.updatedAtUtc
				? challenge.updatedAtUtc
				: now(),
		paths: paths.map((path) => fromPath(path, exact)),
	};
	if (exact) {
		// A title or a subtitle with a space before or after it, or with a
		// character nobody can see in it, is refused, not tidied: it is sent
		// without.
		for (const field of ["title", "subtitle"] as const) {
			body[field] = exactTitle(body[field]);
		}
		for (const field of EXACT_IDS) body[field] = exactText(body[field]);
		for (const field of ID_LISTS) body[field] = exactIds(body[field]);
		body.imageRelativePath = exactText(body.imageRelativePath) ?? "";
		body.recommendedNext = exactRecommendations(body.recommendedNext);
		addedAt(body, isNew, now);
		// A full instant or null: "" is not "no date" there, and a date
		// without a time or a zone is left for the backend to refuse.
		for (const field of DATES) {
			if (field in body) {
				body[field] = isoInstantOrNull(body[field], CONTENT_DATE_FRACTION);
			}
		}
		sentUpdatedAt(body);
	}
	return body;
}

// ─── The area ───────────────────────────────────────────────────────────────

const MARK = { field: "Komentarz wewnętrzny", path: "internalTitle" } as const;

export interface ChallengesArea {
	api: ApiClient["challenges"];
	/** One challenge as stored now; "notFound" when it is not there. */
	read(id: string): Promise<Challenge>;
}

export function challengesArea(
	transport: Transport,
	capabilities: Capabilities,
): ChallengesArea {
	// Every version the backend sends is noted, to tell a change of status
	// from an edit when it comes back through `save`.
	const watch = statusWatch<Challenge>();
	const take = (raw: unknown): Challenge => {
		const { challenge, whole } = readChallenge(raw, capabilities);
		return watch.remember(challenge, whole);
	};

	const read = async (id: string) =>
		take(await transport.request({ path: ["manageChallenges", id] }));

	/** Runs a write and names the variants in its refusal by their ids. */
	async function sent<R>(
		pathIds: readonly string[],
		run: () => Promise<R>,
	): Promise<R> {
		try {
			return await run();
		} catch (error) {
			throw withPathIds(error, pathIds);
		}
	}

	async function write(
		body: Record<string, unknown>,
		headers: Record<string, string>,
	): Promise<Challenge> {
		const raw = await transport.request({
			method: "POST",
			path: ["manageChallenges"],
			body,
			headers,
		});
		// The panel's route answers with the saved challenge; Retool's, and the
		// backend before 2026-11-13, only name it.
		const direct = wireChallengeSchema.safeParse(raw);
		if (direct.success && Array.isArray(direct.data.paths)) {
			return take(raw);
		}
		const id = savedId(raw, /Challenge (\S+) updated/);
		if (!id) {
			throw unexpectedAnswer(
				"Zapisano wyzwanie, ale backend nie podał jego identyfikatora. Odśwież listę.",
			);
		}
		return read(id);
	}

	/** Publish, hide, back to draft, delete, restore: the stored challenge, another status. */
	async function changeStatus(
		id: string,
		status: ContentStatus,
		headers: Record<string, string>,
	): Promise<Challenge> {
		return take(
			await transport.request({
				method: "POST",
				path: ["manageChallenges", id, "status"],
				body: { status },
				headers,
			}),
		);
	}

	return {
		read,
		api: {
			async list() {
				const rows = await transport.request({
					path: ["manageChallenges"],
					// Without it the backend leaves the bin out; the panel shows it.
					query: capabilities.status ? { includeDeleted: true } : undefined,
					schema: z.array(z.unknown()),
					what: "Lista wyzwań",
				});
				return rows.map(take);
			},
			async create(challenge) {
				assertWritable(capabilities, "challenges", {
					texts: [challenge.internalTitle],
					...MARK,
				});
				return sent(
					challenge.paths.map((path) => path.pathId),
					() => write(fromChallenge(challenge, capabilities), {}),
				);
			},
			async save(challenge, options) {
				const headers = await checkSave({
					capabilities,
					area: "challenges",
					incoming: challenge,
					etag: options.etag,
					readStored: () => read(challenge.id),
					markOf: (item) => item.internalTitle,
					...MARK,
				});
				// A delete changes the status and nothing else, whatever else the
				// request carries, so it is asked for as what it is. Any other
				// status goes the same way when nothing else was changed.
				//
				// A challenge with a variant id made up here is sent whole all the
				// same, so that the id is adopted (the status call would give the
				// variant another). With one exception: hiding what is published.
				// The status call takes a challenge down as it is, where a save
				// that ends hidden is held to every rule, and content from before
				// those rules must not stand in the way of taking it down.
				const stored = watch.storedStatus(challenge.id, options.etag);
				const takingDown =
					stored === "published" && challenge.status === "hidden";
				const statusAlone =
					capabilities.status &&
					((challenge.status === "deleted" && stored !== "deleted") ||
						watch.onlyStatusChanged(challenge, options.etag, takingDown));
				return withCurrent(
					() =>
						sent(
							challenge.paths.map((path) => path.pathId),
							() =>
								statusAlone
									? changeStatus(challenge.id, challenge.status, headers)
									: write(fromChallenge(challenge, capabilities), headers),
						),
					take,
					() => read(challenge.id),
				);
			},
		},
	};
}
