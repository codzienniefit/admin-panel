import type { Capabilities } from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import { badgesArea } from "./badges";
import { cacheArea } from "./cache";
import { challengesArea } from "./challenges";
import { configArea } from "./config";
import { mediaArea } from "./media";
import { messagesArea } from "./messages";
import { offersArea } from "./offers";
import { panelDocsArea } from "./panelDocs";
import { sharedLoad } from "./shared";
import type { Transport } from "./transport";
import { usersArea } from "./users";
import { workoutsArea } from "./workouts";

// The ApiClient for the real backend: every call the panel makes, as an HTTP
// request to the endpoints of `codzienniefit/backend`.
//
// Which request each call makes, and what it does where the backend cannot
// do the thing yet, is listed in docs/PRODUCTION-API.md. Each area is a file
// of its own with three parts: what the backend sends (a lenient schema),
// the mapping both ways (pure functions, tested on their own), and the calls.

export interface HttpApiOptions {
	transport: Transport;
	capabilities: Capabilities;
}

export function createHttpApi({
	transport,
	capabilities,
}: HttpApiOptions): ApiClient {
	const challenges = challengesArea(transport, capabilities);
	const workouts = workoutsArea(transport, capabilities);

	// The planning list needs every challenge id while the challenge list is
	// loading anyway: both share one request.
	const allChallenges = sharedLoad(() => challenges.api.list());

	return {
		config: configArea(transport, capabilities),
		challenges: { ...challenges.api, list: allChallenges.fresh },
		workouts: workouts.api,
		media: mediaArea(transport, capabilities),
		badges: badgesArea(transport, capabilities),
		messages: messagesArea(transport, capabilities),
		users: usersArea(transport, capabilities),
		...panelDocsArea(transport, capabilities, {
			challengeIds: async () =>
				(await allChallenges.recent(10_000)).map((challenge) => challenge.id),
			challenges: () => allChallenges.recent(10_000),
			lastChallenges: () => allChallenges.last(),
		}),
		offers: offersArea(transport, capabilities),
		cache: cacheArea(transport, capabilities),
	};
}
