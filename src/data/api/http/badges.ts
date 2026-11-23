import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable, refuse } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import { type Badge, badgeSchema, type NewBadge } from "@/data/schemas/badge";
import { normalizeClaimToken } from "@/domain/badgeRules";
import { unexpectedAnswer } from "./failures";
import {
	checkSave,
	conform,
	exactText,
	isBackendEtag,
	isoInstantOrNull,
	versionOf,
	withCurrent,
} from "./shared";
import type { Transport } from "./transport";

// Badge definitions: `manageBadges` of the backend (BadgeUpsertAdminDto in,
// BadgeAdminDto out; src/handlers/admin/manageBadgesHandler.ts).

export const wireBadgeSchema = z.looseObject({
	id: z.string(),
	etag: z.string().nullish(),
	name: z.string().nullish(),
	type: z.string().nullish(),
	imageRelativePath: z.string().nullish(),
	updatedAtUtc: z.string().nullish(),
});

export function toBadge(raw: unknown): Badge {
	const wire = conform(wireBadgeSchema, raw, "Odznaka");
	return conform(
		badgeSchema,
		{
			...wire,
			etag: versionOf(wire),
			name: wire.name ?? "",
			type: wire.type ?? "normal",
			imageRelativePath: wire.imageRelativePath ?? "",
		},
		`Odznaka ${wire.id}`,
	);
}

// The backend refuses a badge that carries a field belonging to another
// type ("must not be set"). What has to be done about such a field depends
// on the contract:
//
// - Before the editing contract a field left out was simply not there, so
//   the body is cut down to what the type allows.
// - With it, a field left out of a save keeps its stored value. A badge that
//   changes its type would keep the fields of the type it had and be refused
//   for them, so they are sent as null, which clears them.
const NEVER_SENT = [
	"etag",
	// Worked out by the backend from what the badge is assigned to.
	"sectionId",
	"subsectionId",
	"createdAtUtc",
	"updatedAtUtc",
	"assignedToWorkouts",
	"assignedToChallenges",
] as const;

const EVENT_ONLY = ["claimToken", "isClaimLinkActive"] as const;
const MILESTONE_ONLY = ["repeatCategory", "milestoneCount"] as const;
const DATES = ["activeFromUtc", "activeTillUtc"] as const;

/**
 * The request body for a save: BadgeUpsertAdminDto.
 *
 * @param capabilities with `etag` on (the editing contract), a field of
 *   another type is sent as null instead of being left out, and what the
 *   backend would refuse for its spelling alone is put right first
 */
export function fromBadge(
	badge: Badge | NewBadge,
	capabilities?: Pick<Capabilities, "etag">,
): Record<string, unknown> {
	const exact = capabilities?.etag === true;
	const body: Record<string, unknown> = { ...badge };
	const drop = (keys: readonly string[]) => {
		for (const key of keys) delete body[key];
	};
	const clear = (keys: readonly string[]) => {
		for (const key of keys) body[key] = null;
	};
	const notOfThisType = exact ? clear : drop;
	drop(NEVER_SENT);
	body.id = typeof badge.id === "string" ? badge.id : null;

	const manual = badge.type === "manual";
	const event = manual && badge.specialCategory === "event";
	const milestone = badge.type === "milestone";
	if (!manual) notOfThisType(["specialCategory"]);
	if (manual) notOfThisType(DATES);
	if (!milestone) notOfThisType(MILESTONE_ONLY);
	if (!event) {
		notOfThisType(EVENT_ONLY);
	} else if (!badge.claimToken?.trim()) {
		// Left out, the backend keeps the stored code or makes a new one.
		delete body.claimToken;
	}
	if (!exact) return body;

	// A badge has no draft: every save is held to every rule, and nothing is
	// trimmed, put in capitals or read as a date on the way to storage.
	if (typeof body.name === "string") body.name = body.name.trim();
	if (typeof body.imageRelativePath === "string") {
		body.imageRelativePath = body.imageRelativePath.trim();
	}
	if (typeof body.id === "string") body.id = exactText(body.id);
	if (!manual) {
		// A full instant or null: "" is not "no date" there.
		for (const field of DATES) body[field] = isoInstantOrNull(body[field]);
	}
	if (event) {
		if (typeof body.claimToken === "string") {
			// Codes are stored in capitals; one sent any other way is refused.
			body.claimToken = normalizeClaimToken(body.claimToken);
		}
		// Whether the link hands the badge out has to be said. Where the panel
		// does not know, the field is left out: the stored answer is kept for
		// a badge that exists, and a new one is refused at this field.
		if (typeof body.isClaimLinkActive !== "boolean") {
			delete body.isClaimLinkActive;
		}
	}
	if (milestone && body.milestoneCount == null) {
		// Never null on a milestone badge (everyone would earn it at once):
		// left out, the stored count is kept.
		delete body.milestoneCount;
	}
	return body;
}

// The panel's route answers with the badge itself, as the list shows it;
// Retool's, and the backend before 2026-11-13, with `{ savedBadges: [badge] }`.
const savedSchema = z.looseObject({
	id: z.string().nullish(),
	savedBadges: z.array(z.looseObject({ id: z.string() })).nullish(),
});

const MARK = { field: "Komentarz", path: "comment" } as const;

export function badgesArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["badges"] {
	async function list(): Promise<Badge[]> {
		const rows = await transport.request({
			path: ["manageBadges"],
			schema: z.array(z.unknown()),
			what: "Lista odznak",
		});
		return rows.map(toBadge);
	}

	// The panel's routes have `GET manageBadges/{id}` as well. The list is
	// read all the same: it is small, it costs the backend the same reads,
	// and it is the one way that works with and without the editing contract.
	async function read(id: string): Promise<Badge> {
		const found = (await list()).find((badge) => badge.id === id);
		if (!found) throw new ApiError("notFound", "Nie ma takiej odznaki.");
		return found;
	}

	async function write(
		body: Record<string, unknown>,
		headers: Record<string, string>,
	): Promise<Badge> {
		const raw = await transport.request({
			method: "POST",
			path: ["manageBadges"],
			body,
			headers,
			schema: savedSchema,
			what: "Zapis odznaki",
		});
		// The badge itself, with everything the list shows: nothing to read.
		if (raw.id && !raw.savedBadges && typeof raw.type === "string") {
			return toBadge(raw);
		}
		const id = raw.savedBadges?.[0]?.id ?? raw.id;
		if (!id) {
			throw unexpectedAnswer(
				"Zapisano odznakę, ale backend nie podał jej identyfikatora. Odśwież listę.",
			);
		}
		// That answer lacks the section and the dates; the list has them.
		return read(id);
	}

	return {
		list,
		async create(badge) {
			assertWritable(capabilities, "badges", {
				texts: [badge.comment],
				...MARK,
			});
			return write(fromBadge(badge, capabilities), {});
		},
		async save(badge, options) {
			const headers = await checkSave({
				capabilities,
				area: "badges",
				incoming: badge,
				etag: options.etag,
				readStored: () => read(badge.id),
				markOf: (item) => item.comment,
				...MARK,
			});
			return withCurrent(
				() => write(fromBadge(badge, capabilities), headers),
				toBadge,
				() => read(badge.id),
			);
		},
		async remove(badgeId, options) {
			if (!capabilities.badgeDelete) {
				refuse("Produkcja nie potrafi jeszcze usuwać odznak. Można ją ukryć.");
			}
			// The section's switch first: a closed one costs no request.
			assertWritable(capabilities, "badges", { texts: [], ...MARK });
			const stored = await read(badgeId);
			assertWritable(capabilities, "badges", {
				texts: [stored.comment],
				...MARK,
			});
			if (stored.etag !== options.etag) {
				throw new ApiError("conflict", "Ktoś zmienił to w międzyczasie.", {
					current: stored,
				});
			}
			await withCurrent(
				() =>
					transport.request({
						method: "DELETE",
						path: ["manageBadges", badgeId],
						headers: isBackendEtag(options.etag)
							? { "if-match": options.etag }
							: {},
					}),
				toBadge,
				() => read(badgeId),
			);
		},
	};
}
