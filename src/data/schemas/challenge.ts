import { z } from "zod";
import {
	contentBlockSchema,
	contentStatusSchema,
	idList,
	optionalText,
} from "./common";

export { type ContentStatus, contentStatusSchema } from "./common";

export const daySchema = z.looseObject({
	/** 1-based and consecutive within a path. */
	dayIndex: z.number().int().min(1),
	/** Empty means a rest day. */
	workoutIds: z.array(z.string()),
});
export type Day = z.infer<typeof daySchema>;

/** One variant of a challenge: the same challenge at one level. */
export const pathSchema = z.looseObject({
	/** Stable identity of a variant (backend scope B3.3). */
	pathId: z.string(),
	/** From workoutsConfig.challengeLevels; what user attempts store today. */
	levelId: z.string(),
	/** Workouts per week, shown to the user. */
	frequency: z.coerce.number().default(1),
	minimumDaysToComplete: z.number().int().min(0).default(0),
	description: optionalText,
	pro: z.boolean().nullish().default(false),
	difficultyLevelsIds: idList,
	days: z.array(daySchema),
});
export type Path = z.infer<typeof pathSchema>;

export const challengeSchema = z.looseObject({
	id: z.string(),
	/** Opaque version token; sent back on save to detect conflicts. */
	etag: z.string(),
	title: z.string(),
	subtitle: z.string().nullish().default(""),
	/** Comment for the team; not shown in the app. */
	internalTitle: optionalText,
	status: contentStatusSchema,
	pro: z.boolean().default(false),
	lengthDays: z.number().int().min(1),
	/** How many days ahead a participant can see. */
	visibleDaysUpFront: z.number().nullish().default(null),
	imageRelativePath: optionalText,
	descriptionFancyContent: z.array(contentBlockSchema).default([]),
	categoryId: optionalText,
	goalsIds: idList,
	difficultyLevelsIds: idList,
	addedAtUtc: z.string().default(""),
	/** Set: a live challenge with a premiere. Empty: a plan. */
	liveAtUtc: optionalText,
	/** When a live challenge leaves the list. */
	endsAtUtc: optionalText,
	availableAtUtc: optionalText,
	updatedAtUtc: z.string(),
	// Paid access (RevenueCat ids).
	unlockedByEntitlementIds: idList,
	offeringId: optionalText,
	discountedForEntitlementIds: idList,
	offeringDiscountedId: optionalText,
	/** Badge for completing; and for completing every day. */
	badgeId: optionalText,
	perfectCompletionBadgeId: optionalText,
	/** What to suggest after this one, in order. */
	recommendedNext: z
		.array(z.looseObject({ id: z.string() }))
		.nullish()
		.transform((value) => value ?? []),
	paths: z.array(pathSchema),
});
export type Challenge = z.infer<typeof challengeSchema>;

/** What a create request carries: everything the server does not assign. */
export const newChallengeSchema = challengeSchema.omit({
	id: true,
	etag: true,
	updatedAtUtc: true,
});
export type NewChallenge = z.infer<typeof newChallengeSchema>;

export function blankChallenge(now = new Date().toISOString()): NewChallenge {
	return {
		title: "",
		subtitle: "",
		internalTitle: null,
		status: "draft",
		pro: false,
		lengthDays: 28,
		visibleDaysUpFront: 100,
		imageRelativePath: null,
		descriptionFancyContent: [],
		categoryId: null,
		goalsIds: [],
		difficultyLevelsIds: [],
		addedAtUtc: now,
		liveAtUtc: null,
		endsAtUtc: null,
		availableAtUtc: null,
		unlockedByEntitlementIds: [],
		offeringId: null,
		discountedForEntitlementIds: [],
		offeringDiscountedId: null,
		badgeId: null,
		perfectCompletionBadgeId: null,
		recommendedNext: [],
		paths: [],
	};
}

/** A new variant: one empty day per day of the challenge. */
export function blankPath(
	pathId: string,
	levelId: string,
	lengthDays: number,
): Path {
	return {
		pathId,
		levelId,
		frequency: 3,
		minimumDaysToComplete: 0,
		description: null,
		pro: false,
		difficultyLevelsIds: [],
		days: Array.from({ length: Math.max(1, lengthDays) }, (_, i) => ({
			dayIndex: i + 1,
			workoutIds: [],
		})),
	};
}
