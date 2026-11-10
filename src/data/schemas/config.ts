import { z } from "zod";

// The two configuration documents the backend serves. They feed every list of
// options in the panel (levels, equipment, training types, goals…).

/** One selectable value, as `workoutsConfig` lists them. */
export const configOptionSchema = z.looseObject({
	id: z.string(),
	title: z.string(),
	visible: z.boolean().optional(),
});
export type ConfigOption = z.infer<typeof configOptionSchema>;

const options = z.array(configOptionSchema);

/** GET /api/workoutsConfig */
export const workoutConfigSchema = z.looseObject({
	equipmentTypes: options,
	trainingTypes: options,
	trainingLevels: options,
	challengeLevels: options,
	challengeCategories: options,
	challengeGoals: options,
	difficultyLevels: options,
	duration: z.looseObject({
		fromSeconds: z.number(),
		toSeconds: z.number(),
	}),
});
export type WorkoutConfig = z.infer<typeof workoutConfigSchema>;

/** GET /api/internalConfig */
export const internalConfigSchema = z.looseObject({
	draftMessageStates: z.array(
		z.looseObject({ state: z.string(), label: z.string() }),
	),
	draftMessageTargetGroups: z.array(
		z.looseObject({
			state: z.string(),
			label: z.string(),
			requiresTargetGroupValue: z.string().nullable(),
		}),
	),
	badgeTypes: z.array(z.looseObject({ value: z.string(), label: z.string() })),
	badgeSections: z.array(
		z.looseObject({
			id: z.string(),
			label: z.string(),
			subsections: z.array(
				z.looseObject({ id: z.string(), label: z.string() }),
			),
		}),
	),
	promotedChallengeId: z.string().nullable(),
});
export type InternalConfig = z.infer<typeof internalConfigSchema>;
