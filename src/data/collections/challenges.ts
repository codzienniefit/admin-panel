import { api } from "@/data/api";
import type { Challenge, NewChallenge } from "@/data/schemas/challenge";
import { addBlankPlanning } from "./planning";
import { createVersionedCollection } from "./versioned";

// The single copy of every challenge. Screens read it through live queries
// and write through update(); nothing else holds challenge data.
const challenges = createVersionedCollection<Challenge>({
	name: "challenges",
	list: () => api.challenges.list(),
	save: (challenge, options) => api.challenges.save(challenge, options),
});

export const challengesCollection = challenges.collection;
export const challengeSaver = challenges.saver;
export const challengeTarget = challenges.target;
export const persistChallengeMutations = challenges.persistMutations;

export async function createChallenge(input: NewChallenge): Promise<Challenge> {
	const created = await challenges.addCreated(
		await api.challenges.create(input),
	);
	await addBlankPlanning(created.id);
	return created;
}

// This module owns singletons. Re-evaluating it while screens are mounted
// would leave hooks holding the old instances, so a hot update during
// development reloads the page instead.
if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
