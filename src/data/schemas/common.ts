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

/**
 * A block with nothing in it: no type, no text, no picture. Old tools left
 * such `{}` behind in stored descriptions (workout 5fauJdypS9Y has one); the
 * app shows nothing for it.
 */
function isEmptyBlock(block: unknown): boolean {
	if (block === null || block === undefined) return true;
	if (typeof block !== "object" || Array.isArray(block)) return false;
	const { type, content, metadata } = block as Record<string, unknown>;
	const blank = (value: unknown) =>
		value === undefined ||
		value === null ||
		(typeof value === "string" && value.trim() === "");
	return blank(type) && blank(content) && blank(metadata);
}

/**
 * A description or message body as stored. Empty blocks are left out on
 * read, so one leftover `{}` does not stop a whole list from loading; the next
 * save writes the body without it. Anything else that does not fit still
 * fails loudly, with the entity's id and the field.
 */
export const contentBlocksSchema = z.preprocess(
	(value) =>
		Array.isArray(value)
			? value.filter((block) => !isEmptyBlock(block))
			: value,
	z
		.array(contentBlockSchema)
		.nullish()
		.transform((value) => value ?? []),
);

// The backend leaves unset fields out of some responses and sends null in
// others. Both mean "empty"; on read they become null (or an empty list).
export const optionalText = z.string().nullish().default(null);
export const idList = z
	.array(z.string())
	.nullish()
	.transform((value) => value ?? []);
