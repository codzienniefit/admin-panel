import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, type PendingMutation } from "@tanstack/react-db";
import { api } from "@/data/api";
import type { Challenge, NewChallenge } from "@/data/schemas/challenge";
import { queryClient } from "./queryClient";
import { createSaver } from "./saver";

/** Persists the updates of one transaction through the saver. */
export async function persistChallengeMutations(
	mutations: ReadonlyArray<PendingMutation<Challenge>>,
): Promise<void> {
	for (const mutation of mutations) {
		if (mutation.type !== "update") continue;
		await challengeSaver.persist(
			mutation.original as Challenge,
			mutation.modified,
		);
	}
}

// The single copy of every challenge. Screens read it through live queries
// and write through update(); nothing else holds challenge data.
export const challengesCollection = createCollection(
	queryCollectionOptions<Challenge>({
		id: "challenges",
		queryKey: ["challenges"],
		queryClient,
		queryFn: async () => {
			const list = await api.challenges.list();
			challengeSaver.remember(list);
			return list;
		},
		getKey: (challenge) => challenge.id,
		onUpdate: ({ transaction }) =>
			persistChallengeMutations(transaction.mutations),
	}),
);

export const challengeSaver = createSaver<Challenge>({
	save: (challenge, options) => api.challenges.save(challenge, options),
	writeBack: (challenge) => challengesCollection.utils.writeUpsert(challenge),
	readVisible: (id) => challengesCollection.get(id),
	update: async (id, change) => {
		await challengesCollection
			.update(id, (draft) => change(draft as Challenge))
			.when("settled");
	},
});

/**
 * Creates a challenge. Not optimistic: the server assigns the id, so the new
 * row appears once it answers.
 */
export async function createChallenge(input: NewChallenge): Promise<Challenge> {
	const saved = await api.challenges.create(input);
	challengeSaver.remember([saved]);
	await challengesCollection.utils.writeInsert(saved);
	return saved;
}

// This module owns singletons. Re-evaluating it while screens are mounted
// would leave hooks holding the old instances, so a hot update during
// development reloads the page instead.
if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
