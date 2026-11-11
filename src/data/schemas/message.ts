import { z } from "zod";
import { contentBlockSchema, optionalText } from "./common";

// A message to app users. It starts as a draft, is sent once to a target
// group and can then only be archived: what was delivered cannot be edited.

export const messageStatusSchema = z.enum(["draft", "sent", "archived"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const messageSchema = z.looseObject({
	id: z.string(),
	etag: z.string(),
	/** Description for the team; the app does not show it. */
	title: z.string(),
	/** Sender name shown in the app. */
	from: z.string().default(""),
	status: messageStatusSchema,
	/** One of `internalConfig.draftMessageTargetGroups`. */
	targetGroup: optionalText,
	/** Extra value some groups need (for example a challenge id). */
	targetGroupValue: optionalText,
	fancyContent: z.array(contentBlockSchema).default([]),
	createdAtUtc: z.string(),
	sentAtUtc: optionalText,
	archivedAtUtc: optionalText,
	updatedAtUtc: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

/**
 * What a create request carries. A new message is always a draft: status and
 * its dates belong to the server.
 */
export const newMessageSchema = messageSchema.omit({
	id: true,
	etag: true,
	status: true,
	sentAtUtc: true,
	archivedAtUtc: true,
	updatedAtUtc: true,
});
export type NewMessage = z.infer<typeof newMessageSchema>;

export function blankMessage(now = new Date().toISOString()): NewMessage {
	return {
		title: "",
		from: "",
		targetGroup: null,
		targetGroupValue: null,
		fancyContent: [],
		createdAtUtc: now,
	};
}
