import type { ApiClient } from "@/data/api/types";
import {
	PLANNER_SETTINGS_ID,
	type PlannerSettings,
	plannerSettingsSchema,
} from "@/data/schemas/settings";
import { DEFAULT_PLAN_TYPES } from "@/domain/conditions";
import { plannerSettingsIssues } from "@/domain/planningRules";
import { TONES } from "@/ui/tones";
import { workoutConfigFixture } from "./configFixtures";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, disagree, type MockKernel } from "./kernel";

// The planner's shared settings: plan types, training-type styles, folders.

const trainingTypeIds = new Set(
	workoutConfigFixture.trainingTypes.map((type) => type.id),
);

export function buildPlannerSettings(): PlannerSettings {
	return {
		id: PLANNER_SETTINGS_ID,
		etag: "1",
		updatedAtUtc: "",
		planTypes: copy([...DEFAULT_PLAN_TYPES]),
		// Colours and emoji match the defaults in Patryk's planner.
		trainingTypeStyles: {
			strength: { tone: "blue", emoji: "💪" },
			cardio: { tone: "red", emoji: "🏃" },
			stretching: { tone: "green", emoji: "🧘" },
			yoga: { tone: "purple", emoji: "🧘‍♀️" },
			pilates: { tone: "orange", emoji: "🤸" },
			hiit: { tone: "pink", emoji: "⚡" },
		},
		folders: [
			{ id: "f-archive", name: "Archiwum" },
			{ id: "f-next", name: "Następny sezon" },
		],
		[UNKNOWN_FIELD]: "settings",
	};
}

export function settingsApi(kernel: MockKernel): ApiClient["settings"] {
	const table = kernel.table<PlannerSettings>(
		"plannerSettings",
		() => [buildPlannerSettings()],
		(settings) => settings.id,
	);
	const current = () =>
		table.get(PLANNER_SETTINGS_ID) ?? buildPlannerSettings();

	return {
		async planner() {
			await kernel.latency();
			return plannerSettingsSchema.parse(copy(current()));
		},
		async savePlanner(settings, options) {
			await kernel.latency();
			kernel.takeFailure();
			const incoming = plannerSettingsSchema.parse(copy(settings));
			const stored = current();
			table.set(stored.id, stored);
			kernel.takeConcurrentChange<PlannerSettings>(stored, incoming, {
				otherField: (row) => {
					row.folders = [
						...row.folders,
						{ id: `f-${kernel.nextEtag()}`, name: "Folder innego admina" },
					];
				},
				sameFields: disagree,
			});
			kernel.checkEtag(stored, options.etag);
			kernel.reject(plannerSettingsIssues(incoming, trainingTypeIds, TONES));
			return kernel.store(table, { ...incoming, id: PLANNER_SETTINGS_ID });
		},
	};
}
