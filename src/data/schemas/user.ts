import { z } from "zod";
import { optionalText } from "./common";

// People who use the mobile app. This is personal data: the panel never
// loads the whole list, only what a search returns, and keeps none of it
// outside memory.

const userFields = {
	uid: z.string(),
	email: optionalText,
	displayName: optionalText,
	emailVerified: z.boolean().default(false),
	disabled: z.boolean().default(false),
	/** Sign-in methods, e.g. "password", "google.com", "apple.com". */
	providers: z.array(z.string()).default([]),
	createdAtUtc: optionalText,
	lastSignInAtUtc: optionalText,
};

/** One row of a search result. */
export const userSummarySchema = z.looseObject(userFields);
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userSearchResultSchema = z.looseObject({
	users: z.array(userSummarySchema),
	/** How many accounts matched before the limit was applied. */
	totalMatches: z.number(),
	truncated: z.boolean().default(false),
});
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;

/** One account, as the user page shows it. */
export const userAccountSchema = z.looseObject({
	...userFields,
	hasProSubscription: z.boolean().default(false),
});
export type UserAccount = z.infer<typeof userAccountSchema>;

/** A badge a user holds. The definition is in the badges collection. */
export const userBadgeSchema = z.looseObject({
	badgeId: z.string(),
	earnedAtUtc: z.string(),
	/**
	 * Present when the badge was given by hand or claimed with a code. Only
	 * such a badge can be taken back.
	 */
	grantId: optionalText,
});
export type UserBadge = z.infer<typeof userBadgeSchema>;

export const userWorkoutCompletionSchema = z.looseObject({
	workoutId: z.string(),
	completedAtUtc: z.string(),
});
export type UserWorkoutCompletion = z.infer<typeof userWorkoutCompletionSchema>;

export const userChallengeAttemptSchema = z.looseObject({
	challengeId: z.string(),
	/** The variant the user chose. */
	levelId: optionalText,
	startedAtUtc: z.string(),
	completedAtUtc: optionalText,
	abortedAtUtc: optionalText,
	completedDays: z.number().default(0),
});
export type UserChallengeAttempt = z.infer<typeof userChallengeAttemptSchema>;

export const userProgressSchema = z.looseObject({
	/** Newest first. */
	workouts: z.array(userWorkoutCompletionSchema).default([]),
	challenges: z.array(userChallengeAttemptSchema).default([]),
});
export type UserProgress = z.infer<typeof userProgressSchema>;
