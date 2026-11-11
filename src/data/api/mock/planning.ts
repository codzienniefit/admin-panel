import { ApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import type { Challenge } from "@/data/schemas/challenge";
import {
	blankPlanning,
	blankVariantPlanning,
	type Planning,
	planningSchema,
} from "@/data/schemas/planning";
import { planningIssues } from "@/domain/planningRules";
import { workoutConfigFixture } from "./configFixtures";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, disagree, type MockKernel } from "./kernel";

// Planning documents: one per challenge, created on the first save.

interface PlanningDeps {
	challenges(): Challenge[];
}

const trainingTypeIds = new Set(
	workoutConfigFixture.trainingTypes.map((type) => type.id),
);

/** Sample planning for the generated challenges; the same on every load. */
export function buildPlanningFixtures(
	challenges: readonly Challenge[],
): Planning[] {
	const planTypes = ["balanced", "strength", "cardio", "flexibility"];
	const statuses = ["not_started", "in_progress", "ready"] as const;
	return challenges.map((challenge, index) => {
		const planning = blankPlanning(challenge.id);
		planning.etag = "1";
		Object.assign(planning, { [UNKNOWN_FIELD]: "planning" });
		if (challenge.categoryId === "archived") planning.folderId = "f-archive";
		else if (index % 6 === 5) planning.folderId = "f-next";

		challenge.paths.forEach((path, p) => {
			const variant = blankVariantPlanning();
			variant.planTypeId = planTypes[(index + p) % planTypes.length] ?? null;
			variant.prepStatus =
				challenge.status === "published"
					? "ready"
					: (statuses[(index + p) % statuses.length] ?? "not_started");
			if (variant.prepStatus === "in_progress") {
				variant.prepNote = "Brakuje nagrań do ostatniego tygodnia.";
			}
			Object.assign(variant, { [UNKNOWN_FIELD]: "planning:variant" });
			planning.variants[path.pathId] = variant;
		});

		if (challenge.id === "C1") {
			planning.note = "Premiera razem z kampanią wiosenną.";
			planning.scratchpad = ["W5", "W9"];
			const easy = planning.variants["p-easy"];
			if (easy) {
				easy.notes =
					"Tydzień 1 spokojnie, od tygodnia 2 dokładamy jedno cardio.";
				easy.days = {
					"3": { note: "Nagranie w środę, sprawdzić dźwięk." },
					"5": { tint: "#22c55e" },
				};
			}
		}
		return planning;
	});
}

export function planningApi(
	kernel: MockKernel,
	deps: PlanningDeps,
): ApiClient["planning"] {
	const table = kernel.table<Planning>(
		"planning",
		() => buildPlanningFixtures(deps.challenges()),
		(planning) => planning.id,
	);

	return {
		async list() {
			await kernel.latency();
			return planningSchema
				.array()
				.parse(
					deps
						.challenges()
						.map((challenge) =>
							copy(table.get(challenge.id) ?? blankPlanning(challenge.id)),
						),
				);
		},
		async save(planning, options) {
			await kernel.latency();
			kernel.takeFailure();
			const incoming = planningSchema.parse(copy(planning));
			if (!deps.challenges().some((c) => c.id === incoming.id)) {
				throw new ApiError("notFound", "Nie ma takiego wyzwania");
			}
			let stored = table.get(incoming.id);
			if (!stored) {
				stored = blankPlanning(incoming.id);
				table.set(incoming.id, stored);
			}
			kernel.takeConcurrentChange<Planning>(stored, incoming, {
				otherField: (row) => {
					row.note = `${row.note} (dopisane przez innego admina)`.trim();
				},
				sameFields: disagree,
			});
			kernel.checkEtag(stored, options.etag);
			kernel.reject(planningIssues(incoming, trainingTypeIds));
			return kernel.store(table, incoming);
		},
	};
}
