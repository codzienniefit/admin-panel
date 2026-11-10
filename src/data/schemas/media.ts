import { z } from "zod";

export const mediaTypeSchema = z.enum(["image", "audio", "video", "other"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaFileSchema = z.looseObject({
	/** Path inside the public container, e.g. "workouts/mobilnosc.webp". */
	path: z.string(),
	type: mediaTypeSchema,
	createdAtUtc: z.string(),
	sizeBytes: z.number().optional(),
});
export type MediaFile = z.infer<typeof mediaFileSchema>;

export const mediaUploadResultSchema = z.looseObject({
	requestedRelativePath: z.string(),
	/** The path actually stored; always use this one. */
	relativePath: z.string(),
	type: mediaTypeSchema,
	pathSanitized: z.boolean(),
	renamedToAvoidOverwrite: z.boolean(),
});
export type MediaUploadResult = z.infer<typeof mediaUploadResultSchema>;
