import { ApiError, type ApiIssue } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import { type Badge, badgeSchema, newBadgeSchema } from "@/data/schemas/badge";
import type { Challenge } from "@/data/schemas/challenge";
import type { Workout } from "@/data/schemas/workout";
import {
	assignmentsByBadge,
	badgeIssues,
	badgeRemovalIssues,
	isEventBadge,
} from "@/domain/badgeRules";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, disagree, type MockKernel } from "./kernel";

// Badge definitions. Which workouts and challenges award a badge is not
// stored here: it is read from them, as the backend does.

interface BadgeDeps {
	workouts(): Workout[];
	challenges(): Challenge[];
}

const ID_PREFIX: Record<string, string> = { normal: "n_", manual: "s_" };
const TOKEN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function badgesArea(kernel: MockKernel, deps: BadgeDeps) {
	const table = kernel.table<Badge>(
		"badges",
		() => kernel.seed().badges,
		(badge) => badge.id,
	);

	const assignmentsOf = (badgeId: string) =>
		assignmentsByBadge(deps.workouts(), deps.challenges()).get(badgeId) ?? [];

	function problems(incoming: Badge, stored: Badge | undefined): ApiIssue[] {
		return badgeIssues(incoming, {
			assignments: assignmentsOf(incoming.id),
			takenClaimTokens: new Set(
				[...table.values()]
					.filter((badge) => badge.id !== incoming.id && badge.claimToken)
					.map((badge) => (badge.claimToken ?? "").toLowerCase()),
			),
			storedType: stored?.type,
		});
	}

	/** An event badge always has a code; one left empty is made up here. */
	function withClaimToken(badge: Badge): Badge {
		if (!isEventBadge(badge) || badge.claimToken) return badge;
		const taken = new Set([...table.values()].map((b) => b.claimToken));
		for (;;) {
			const token = Array.from(
				{ length: 10 },
				() => TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)],
			).join("");
			if (!taken.has(token)) return { ...badge, claimToken: token };
		}
	}

	const api: ApiClient["badges"] = {
		async list() {
			await kernel.latency();
			return badgeSchema.array().parse(copy([...table.values()]));
		},
		async create(badge) {
			await kernel.latency();
			kernel.takeFailure();
			const fields = newBadgeSchema.parse(copy(badge));
			const incoming: Badge = {
				...fields,
				id: kernel.freeId(ID_PREFIX[fields.type] ?? "b_", table),
				etag: "",
				sectionId: null,
				subsectionId: null,
				createdAtUtc: kernel.now(),
				updatedAtUtc: kernel.now(),
				[UNKNOWN_FIELD]: "badge:new",
			};
			kernel.reject(problems(incoming, undefined));
			return kernel.store(table, withClaimToken(incoming));
		},
		async save(badge, options) {
			await kernel.latency();
			kernel.takeFailure();
			const incoming = badgeSchema.parse(copy(badge));
			const stored = table.get(incoming.id);
			if (!stored) throw new ApiError("notFound", "Nie ma takiej odznaki");
			kernel.takeConcurrentChange<Badge>(stored, incoming, {
				otherField: (row) => {
					row.comment = "zmienione przez innego admina";
				},
				sameFields: disagree,
			});
			kernel.checkEtag(stored, options.etag);
			kernel.reject(problems(incoming, stored));
			return kernel.store(
				table,
				withClaimToken({
					...incoming,
					// The server's own: where the app lists the badge.
					sectionId: stored.sectionId,
					subsectionId: stored.subsectionId,
					createdAtUtc: stored.createdAtUtc,
				}),
			);
		},
		async remove(badgeId, options) {
			await kernel.latency();
			kernel.takeFailure();
			const stored = table.get(badgeId);
			if (!stored) throw new ApiError("notFound", "Nie ma takiej odznaki");
			kernel.checkEtag(stored, options.etag);
			kernel.reject(badgeRemovalIssues(assignmentsOf(badgeId)));
			table.delete(badgeId);
			kernel.persist();
		},
	};

	return {
		api,
		/** Read by the other areas: users hold badges, workouts award them. */
		all: (): Badge[] => [...table.values()],
		/** Badges a workout or a challenge may award. */
		assignableIds: (): Set<string> =>
			new Set(
				[...table.values()]
					.filter((badge) => badge.type === "normal")
					.map((badge) => badge.id),
			),
	};
}
