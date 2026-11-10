import { z } from "zod";
import {
	contentBlockSchema,
	contentStatusSchema,
	idList,
	optionalText,
} from "./common";

export { type ContentBlock, contentBlockSchema } from "./common";

export const workoutSchema = z.looseObject({
	id: z.string(),
	etag: z.string(),
	title: z.string(),
	/** Comment for the team; not shown in the app. */
	internalTitle: optionalText,
	status: contentStatusSchema,
	pro: z.boolean().default(false),
	durationMinutes: z.number().int().min(0),
	levelId: optionalText,
	equipmentIds: idList,
	trainingTypeIds: z.array(z.string()),
	imageRelativePath: optionalText,
	audioRelativePath: optionalText,
	videoUrl: optionalText,
	descriptionFancyContent: z.array(contentBlockSchema).default([]),
	/** Badge earned by completing the workout. */
	badgeId: optionalText,
	addedAtUtc: z.string(),
	liveAtUtc: optionalText,
	availableAtUtc: optionalText,
	updatedAtUtc: z.string(),
});
export type Workout = z.infer<typeof workoutSchema>;

/** What a create request carries: everything the server does not assign. */
export const newWorkoutSchema = workoutSchema.omit({
	id: true,
	etag: true,
	updatedAtUtc: true,
});
export type NewWorkout = z.infer<typeof newWorkoutSchema>;

export function blankWorkout(now = new Date().toISOString()): NewWorkout {
	return {
		title: "",
		internalTitle: null,
		status: "draft",
		pro: false,
		durationMinutes: 20,
		levelId: null,
		equipmentIds: [],
		trainingTypeIds: [],
		imageRelativePath: null,
		audioRelativePath: null,
		videoUrl: null,
		descriptionFancyContent: [],
		badgeId: null,
		addedAtUtc: now,
		liveAtUtc: null,
		availableAtUtc: null,
	};
}
