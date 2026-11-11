import { z } from "zod";

// Planning data: everything the team needs to prepare a challenge that the
// mobile app never sees. One document per challenge, with the same id.

/** The kinds of week rule the planner knows. Others pass through untouched. */
export const CONDITION_TYPES = [
	"limit",
	"minimum",
	"zakres",
	"odstep",
	"min_odstep",
	"max_w_ciagu",
	"min_dni_odpoczynku",
	"max_w_dniu",
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** One rule a week of a plan has to meet. Which keys matter depends on `type`. */
export const conditionSchema = z.looseObject({
	type: z.string(),
	/** "all" or the id of a training type. */
	scope: z.string().default("all"),
	/** What a limit or a range counts: workouts (default) or training days. */
	countMode: z.enum(["trainings", "days"]).optional().catch(undefined),
	value: z.number().optional(),
	valueMin: z.number().optional(),
	valueMax: z.number().optional(),
	valueDays: z.number().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const planTypeSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	description: z.string().default(""),
	conditions: z.array(conditionSchema).default([]),
});
export type PlanType = z.infer<typeof planTypeSchema>;

export const PREP_STATUSES = ["not_started", "in_progress", "ready"] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

const dayPlanningSchema = z.looseObject({
	note: z.string().optional(),
	/** `#rrggbb` from the calendar palette. */
	tint: z.string().optional(),
});
export type DayPlanning = z.infer<typeof dayPlanningSchema>;

const cardPlanningSchema = z.looseObject({
	note: z.string().optional(),
	color: z.string().optional(),
});
export type CardPlanning = z.infer<typeof cardPlanningSchema>;

/** What is planned about one variant; keyed by its pathId. */
export const variantPlanningSchema = z.looseObject({
	planTypeId: z.string().nullish().default(null),
	prepStatus: z.enum(PREP_STATUSES).default("not_started").catch("not_started"),
	/** "What is still missing", shown while the variant is in progress. */
	prepNote: z.string().default(""),
	/** Free notes above the plan. */
	notes: z.string().default(""),
	/** Keyed by day number. */
	days: z.record(z.string(), dayPlanningSchema).default({}),
	/** Keyed by `cardKey(dayIndex, workoutId)`. */
	cards: z.record(z.string(), cardPlanningSchema).default({}),
});
export type VariantPlanning = z.infer<typeof variantPlanningSchema>;

export const planningSchema = z.looseObject({
	/** The challenge this belongs to. */
	id: z.string(),
	etag: z.string(),
	updatedAtUtc: z.string().default(""),
	/** `#rrggbb`; empty means a colour derived from the id. */
	calendarColor: z.string().nullish().default(null),
	/** Internal note about the challenge. */
	note: z.string().default(""),
	folderId: z.string().nullish().default(null),
	/** Workouts kept aside, shared by every variant. */
	scratchpad: z.array(z.string()).default([]),
	/** Plan types that exist only in this challenge. */
	customPlanTypes: z.array(planTypeSchema).default([]),
	/** Rules that replace a plan type's own, keyed by plan type id. */
	conditionOverrides: z
		.record(z.string(), z.array(conditionSchema))
		.default({}),
	variants: z.record(z.string(), variantPlanningSchema).default({}),
});
export type Planning = z.infer<typeof planningSchema>;

/** The etag of a document nobody has saved yet. */
export const UNSAVED_ETAG = "0";

export function blankPlanning(challengeId: string): Planning {
	return {
		id: challengeId,
		etag: UNSAVED_ETAG,
		updatedAtUtc: "",
		calendarColor: null,
		note: "",
		folderId: null,
		scratchpad: [],
		customPlanTypes: [],
		conditionOverrides: {},
		variants: {},
	};
}

export function blankVariantPlanning(): VariantPlanning {
	return {
		planTypeId: null,
		prepStatus: "not_started",
		prepNote: "",
		notes: "",
		days: {},
		cards: {},
	};
}

export const cardKey = (dayIndex: number, workoutId: string): string =>
	`${dayIndex}:${workoutId}`;
