import { z } from "zod";

// Pieces shared by several entities. Every object schema in this folder is
// LOOSE: fields this build does not know are kept as they came and sent back
// on save, so a panel older than the backend never wipes a field it has no
// schema for. See docs/PLAN.md §6.2.

export const contentStatusSchema = z.enum([
	"draft",
	"published",
	"hidden",
	"deleted",
]);
export type ContentStatus = z.infer<typeof contentStatusSchema>;

/** One block of a description or message body ("fancy content"). */
export const contentBlockSchema = z.looseObject({
	type: z.string(),
	content: z.string(),
	metadata: z
		.looseObject({
			imageRelativePath: z.string(),
			heightToWidthRatio: z.number(),
		})
		.nullish(),
});
export type ContentBlock = z.infer<typeof contentBlockSchema>;

// The backend leaves unset fields out of some responses and sends null in
// others. Both mean "empty"; on read they become null (or an empty list).
export const optionalText = z.string().nullish().default(null);
export const idList = z
	.array(z.string())
	.nullish()
	.transform((value) => value ?? []);
