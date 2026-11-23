import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable } from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import type { Transport } from "./transport";

// Clearing the app's CDN cache: `panel/manageCache/purge` of the backend
// (src/handlers/admin/panelCacheHandler.ts). It changes no data, which is
// why it is the one write open in Produkcja (capabilities.ts and the
// Worker's OPEN_FOR_WRITING).

const purgeAnswerSchema = z.looseObject({ purgedAtUtc: z.string() });

export function cacheArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["cache"] {
	return {
		async purge() {
			// Nothing to mark as a test item: on, or not at all.
			assertWritable(capabilities, "cache", null);
			const answer = await transport.request({
				method: "POST",
				path: ["manageCache", "purge"],
				schema: purgeAnswerSchema,
				what: "Czyszczenie cache backendu",
			});
			return { purgedAtUtc: answer.purgedAtUtc };
		},
	};
}
