import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable } from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import {
	internalConfigSchema,
	workoutConfigSchema,
} from "@/data/schemas/config";
import type { Transport } from "./transport";

// The two configuration documents: `workoutsConfig` and `internalConfig`.
// Both are public and cached at the edge.

const promotedAnswerSchema = z.looseObject({
	promotedChallengeId: z.string().nullish(),
});

export function configArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["config"] {
	const internal = () =>
		transport.request({
			path: ["internalConfig"],
			schema: internalConfigSchema,
			what: "Konfiguracja panelu",
		});

	return {
		internal,
		workouts: () =>
			transport.request({
				path: ["workoutsConfig"],
				schema: workoutConfigSchema,
				what: "Konfiguracja treningów",
			}),
		async setPromotedChallenge(challengeId) {
			// Changes what every app user sees first; there is no test version.
			assertWritable(capabilities, "promotedChallenge", null);
			const answer = await transport.request({
				method: "POST",
				path: ["manageChallenges", "promotedChallenge"],
				// An id exactly as stored, or null to clear: the backend takes
				// neither "" nor an id with a space around it for either.
				body: { promotedChallengeId: challengeId?.trim() || null },
				schema: promotedAnswerSchema,
				what: "Zmiana promowanego wyzwania",
			});
			// `internalConfig` is served from a cache that can still hold the
			// old value, so the answer to the change is what counts.
			return {
				...(await internal()),
				promotedChallengeId: answer.promotedChallengeId ?? null,
			};
		},
	};
}
