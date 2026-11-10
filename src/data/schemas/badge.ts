import { z } from "zod";

export const badgeSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	/** "normal" badges are the ones a workout or a challenge can award. */
	type: z.string(),
	imageRelativePath: z.string(),
	isHidden: z.boolean().nullish().default(false),
});
export type Badge = z.infer<typeof badgeSchema>;
