import type { ApiIssue } from "@/data/api/errors";
import {
	CONDITION_TYPES,
	type Condition,
	type ConditionType,
	type PlanType,
} from "@/data/schemas/planning";

// What a week rule consists of: which numbers each kind needs, what they may
// be, and how to tidy one up before saving. How a rule is CHECKED against a
// week is in weekValidation.ts.

export const ALL_SCOPE = "all";

type NumberField = "value" | "valueMin" | "valueMax" | "valueDays";

interface ConditionSpec {
	label: string;
	/** Whether the rule can be limited to one training type. */
	scoped: boolean;
	/** Whether it can count training days instead of workouts. */
	countsDays: boolean;
	fields: ReadonlyArray<{ key: NumberField; label: string; max: number }>;
}

export const CONDITION_SPECS: Record<ConditionType, ConditionSpec> = {
	limit: {
		label: "Limit (max)",
		scoped: true,
		countsDays: true,
		fields: [{ key: "value", label: "Najwyżej", max: 14 }],
	},
	minimum: {
		label: "Minimum",
		scoped: true,
		countsDays: false,
		fields: [{ key: "value", label: "Co najmniej", max: 14 }],
	},
	zakres: {
		label: "Zakres (min–max)",
		scoped: true,
		countsDays: true,
		fields: [
			{ key: "valueMin", label: "Od", max: 14 },
			{ key: "valueMax", label: "Do", max: 14 },
		],
	},
	odstep: {
		label: "Odstęp (dni wolne po)",
		scoped: true,
		countsDays: false,
		fields: [{ key: "value", label: "Dni wolnych", max: 7 }],
	},
	min_odstep: {
		label: "Min. odstęp między (dni)",
		scoped: true,
		countsDays: false,
		fields: [{ key: "value", label: "Dni", max: 7 }],
	},
	max_w_ciagu: {
		label: "Max w ciągu X dni",
		scoped: true,
		countsDays: false,
		fields: [
			{ key: "value", label: "Najwyżej", max: 14 },
			{ key: "valueDays", label: "W ciągu dni", max: 7 },
		],
	},
	min_dni_odpoczynku: {
		label: "Min. dni odpoczynku",
		scoped: false,
		countsDays: false,
		fields: [{ key: "value", label: "Dni", max: 7 }],
	},
	max_w_dniu: {
		label: "Max w jednym dniu",
		scoped: false,
		countsDays: false,
		fields: [{ key: "value", label: "Treningów", max: 5 }],
	},
};

export const isConditionType = (type: string): type is ConditionType =>
	(CONDITION_TYPES as readonly string[]).includes(type);

export function blankCondition(type: ConditionType = "limit"): Condition {
	return normalizeCondition({
		type,
		scope: ALL_SCOPE,
		value: 2,
		valueMin: 0,
		valueMax: 4,
		valueDays: 2,
	});
}

/**
 * Keeps only what the rule's kind uses, so stored rules stay small and equal
 * rules compare equal. A kind this panel does not know is left alone. The
 * old "max training days" kind becomes a limit counted in days.
 */
export function normalizeCondition(condition: Condition): Condition {
	if (condition.type === "max_dni_treningowych") {
		return normalizeCondition({
			...condition,
			type: "limit",
			countMode: "days",
		});
	}
	if (!isConditionType(condition.type)) return condition;
	const spec = CONDITION_SPECS[condition.type];
	const tidy: Condition = {
		type: condition.type,
		scope: spec.scoped ? condition.scope || ALL_SCOPE : ALL_SCOPE,
	};
	if (spec.countsDays && condition.countMode === "days") {
		tidy.countMode = "days";
	}
	for (const field of spec.fields) {
		tidy[field.key] = Math.round(Number(condition[field.key]) || 0);
	}
	return tidy;
}

/** Problems with one rule; `path` is where it sits, for the messages. */
export function conditionIssues(
	condition: Condition,
	path: string,
	trainingTypeIds: ReadonlySet<string>,
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	if (!isConditionType(condition.type)) return issues;
	const spec = CONDITION_SPECS[condition.type];

	if (
		spec.scoped &&
		condition.scope !== ALL_SCOPE &&
		!trainingTypeIds.has(condition.scope)
	) {
		issues.push({
			path,
			message: `${spec.label}: typ treningu „${condition.scope}” nie istnieje`,
		});
	}
	for (const field of spec.fields) {
		const value = condition[field.key];
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < 0 ||
			value > field.max
		) {
			issues.push({
				path,
				message: `${spec.label}: „${field.label}” musi być liczbą od 0 do ${field.max}`,
			});
		}
	}
	if (
		condition.type === "zakres" &&
		(condition.valueMax ?? 0) < (condition.valueMin ?? 0)
	) {
		issues.push({
			path,
			message: `${spec.label}: „Do” nie może być mniejsze niż „Od”`,
		});
	}
	if (condition.type === "max_w_ciagu" && (condition.valueDays ?? 0) < 1) {
		issues.push({
			path,
			message: `${spec.label}: liczba dni musi wynosić co najmniej 1`,
		});
	}
	return issues;
}

/** Problems with a list of plan types (the global ones, or a challenge's own). */
export function planTypeIssues(
	planTypes: readonly PlanType[],
	path: string,
	trainingTypeIds: ReadonlySet<string>,
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	const seen = new Set<string>();
	planTypes.forEach((planType, index) => {
		const here = `${path}.${planType.id || index}`;
		if (!planType.id) {
			issues.push({
				path: here,
				message: "Rodzaj planu nie ma identyfikatora",
			});
		} else if (seen.has(planType.id)) {
			issues.push({
				path: here,
				message: `Dwa rodzaje planu mają ten sam identyfikator: ${planType.id}`,
			});
		}
		seen.add(planType.id);
		if (!planType.name.trim()) {
			issues.push({ path: here, message: "Rodzaj planu musi mieć nazwę" });
		}
		for (const condition of planType.conditions) {
			issues.push(...conditionIssues(condition, here, trainingTypeIds));
		}
	});
	return issues;
}

/** The plan types every new installation starts with (from Patryk's app). */
export const DEFAULT_PLAN_TYPES: readonly PlanType[] = [
	{
		id: "running",
		name: "Biegowy",
		description: "Plan ukierunkowany na bieganie i jednostki biegowe",
		conditions: [
			{ type: "minimum", scope: "all", value: 3 },
			{ type: "minimum", scope: "cardio", value: 2 },
		],
	},
	{
		id: "balanced",
		name: "Zbalansowany",
		description: "Mieszanka treningów siłowych, cardio i rozciągania",
		conditions: [
			{ type: "minimum", scope: "all", value: 2 },
			{ type: "limit", scope: "all", value: 4 },
			{ type: "minimum", scope: "cardio", value: 1 },
			{ type: "limit", scope: "cardio", value: 3 },
		],
	},
	{
		id: "strength",
		name: "Siłowy",
		description: "Skupiony na treningach siłowych",
		conditions: [
			{ type: "minimum", scope: "all", value: 4 },
			{ type: "limit", scope: "all", value: 6 },
			{ type: "minimum", scope: "cardio", value: 1 },
			{ type: "limit", scope: "cardio", value: 2 },
		],
	},
	{
		id: "cardio",
		name: "Cardio",
		description: "Skupiony na treningach cardio",
		conditions: [
			{ type: "minimum", scope: "all", value: 4 },
			{ type: "limit", scope: "all", value: 6 },
			{ type: "minimum", scope: "cardio", value: 3 },
			{ type: "limit", scope: "cardio", value: 5 },
		],
	},
	{
		id: "flexibility",
		name: "Rozciąganie",
		description: "Skupiony na rozciąganiu i mobilności",
		conditions: [
			{ type: "minimum", scope: "all", value: 4 },
			{ type: "limit", scope: "all", value: 6 },
			{ type: "minimum", scope: "stretching", value: 2 },
			{ type: "limit", scope: "cardio", value: 2 },
		],
	},
];
