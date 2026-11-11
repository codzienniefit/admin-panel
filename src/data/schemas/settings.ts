import { z } from "zod";
import { planTypeSchema } from "./planning";

// Settings of the planner, shared by the whole team: one document.

export const trainingTypeStyleSchema = z.looseObject({
	/** One of the panel's colour tones. */
	tone: z.string(),
	emoji: z.string().default(""),
});
export type TrainingTypeStyle = z.infer<typeof trainingTypeStyleSchema>;

export const folderSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
});
export type Folder = z.infer<typeof folderSchema>;

export const PLANNER_SETTINGS_ID = "planner";

export const plannerSettingsSchema = z.looseObject({
	id: z.string().default(PLANNER_SETTINGS_ID),
	etag: z.string(),
	updatedAtUtc: z.string().default(""),
	planTypes: z.array(planTypeSchema).default([]),
	/** Keyed by training type id from the backend configuration. */
	trainingTypeStyles: z.record(z.string(), trainingTypeStyleSchema).default({}),
	folders: z.array(folderSchema).default([]),
});
export type PlannerSettings = z.infer<typeof plannerSettingsSchema>;
