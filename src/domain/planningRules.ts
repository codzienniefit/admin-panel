import type { ApiIssue } from "@/data/api/errors";
import {
	type Condition,
	type Planning,
	type PlanType,
	PREP_STATUSES,
	type PrepStatus,
	type VariantPlanning,
} from "@/data/schemas/planning";
import type { PlannerSettings } from "@/data/schemas/settings";
import { conditionIssues, planTypeIssues } from "./conditions";
import { isHexColor } from "./palette";

// Rules for planning documents and planner settings, shared by the screens
// and the mock server.

export const PREP_LABELS: Record<PrepStatus, string> = {
	not_started: "Niezaczęty",
	in_progress: "W przygotowaniu",
	ready: "Gotowy",
};

export const isPrepStatus = (value: unknown): value is PrepStatus =>
	(PREP_STATUSES as readonly unknown[]).includes(value);

const NOTE_MAX = 2000;

/** Problems with one challenge's planning document. */
export function planningIssues(
	planning: Planning,
	trainingTypeIds: ReadonlySet<string>,
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });

	if (planning.calendarColor && !isHexColor(planning.calendarColor)) {
		add("calendarColor", "Kolor w kalendarzu musi mieć postać #rrggbb");
	}
	if (new Set(planning.scratchpad).size !== planning.scratchpad.length) {
		add("scratchpad", "Ten sam trening jest w brudnopisie dwa razy");
	}
	issues.push(
		...planTypeIssues(
			planning.customPlanTypes,
			"customPlanTypes",
			trainingTypeIds,
		),
	);
	for (const [planTypeId, conditions] of Object.entries(
		planning.conditionOverrides,
	)) {
		for (const condition of conditions) {
			issues.push(
				...conditionIssues(
					condition,
					`conditionOverrides.${planTypeId}`,
					trainingTypeIds,
				),
			);
		}
	}
	for (const [pathId, variant] of Object.entries(planning.variants)) {
		const where = `variants.${pathId}`;
		for (const [day, value] of Object.entries(variant.days)) {
			if (value.tint && !isHexColor(value.tint)) {
				add(where, `Kolor dnia ${day} musi mieć postać #rrggbb`);
			}
			if ((value.note ?? "").length > NOTE_MAX) {
				add(
					where,
					`Notatka dnia ${day} jest za długa (limit ${NOTE_MAX} znaków)`,
				);
			}
		}
		for (const value of Object.values(variant.cards)) {
			if (value.color && !isHexColor(value.color)) {
				add(where, "Kolor treningu musi mieć postać #rrggbb");
			}
		}
	}
	return issues;
}

/** Problems with the planner's shared settings. */
export function plannerSettingsIssues(
	settings: PlannerSettings,
	trainingTypeIds: ReadonlySet<string>,
	tones: readonly string[],
): ApiIssue[] {
	const issues: ApiIssue[] = [
		...planTypeIssues(settings.planTypes, "planTypes", trainingTypeIds),
	];
	const names = new Set<string>();
	const ids = new Set<string>();
	for (const folder of settings.folders) {
		const here = `folders.${folder.id}`;
		const key = folder.name.trim().toLocaleLowerCase("pl");
		if (!key) {
			issues.push({ path: here, message: "Folder musi mieć nazwę" });
		} else if (names.has(key)) {
			issues.push({
				path: here,
				message: `Folder „${folder.name.trim()}” już istnieje`,
			});
		}
		if (ids.has(folder.id)) {
			issues.push({
				path: here,
				message: "Dwa foldery mają ten sam identyfikator",
			});
		}
		names.add(key);
		ids.add(folder.id);
	}
	for (const [typeId, style] of Object.entries(settings.trainingTypeStyles)) {
		if (!tones.includes(style.tone)) {
			issues.push({
				path: `trainingTypeStyles.${typeId}`,
				message: `Nieznany kolor: ${style.tone}`,
			});
		}
		if ([...(style.emoji ?? "")].length > 4) {
			issues.push({
				path: `trainingTypeStyles.${typeId}`,
				message: "Emoji może mieć najwyżej 4 znaki",
			});
		}
	}
	return issues;
}

/** Every plan type a variant of this challenge can have: its own first. */
export function availablePlanTypes(
	planning: Pick<Planning, "customPlanTypes"> | undefined,
	settings: Pick<PlannerSettings, "planTypes"> | undefined,
): PlanType[] {
	const own = planning?.customPlanTypes ?? [];
	const ownIds = new Set(own.map((type) => type.id));
	return [
		...own,
		...(settings?.planTypes ?? []).filter((type) => !ownIds.has(type.id)),
	];
}

/**
 * The rules a variant's weeks are checked against: the challenge's override
 * for the plan type if it has one, else the plan type's own. An empty list
 * means "no rules set" and the planner uses its default.
 */
export function resolveConditions(
	planning: Pick<Planning, "conditionOverrides"> | undefined,
	planType: PlanType | undefined,
): Condition[] {
	if (!planType) return [];
	const override = planning?.conditionOverrides[planType.id];
	return override?.length ? override : planType.conditions;
}

export function variantPlanningOf(
	planning: Planning | undefined,
	pathId: string,
): VariantPlanning | undefined {
	return planning?.variants[pathId];
}

/** How far along the variants of a challenge are, for lists and cards. */
export function prepSummary(
	planning: Planning | undefined,
	pathIds: readonly string[],
): Record<PrepStatus, number> {
	const counts: Record<PrepStatus, number> = {
		not_started: 0,
		in_progress: 0,
		ready: 0,
	};
	for (const pathId of pathIds) {
		counts[planning?.variants[pathId]?.prepStatus ?? "not_started"] += 1;
	}
	return counts;
}
