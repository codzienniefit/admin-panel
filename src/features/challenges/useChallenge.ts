import { useLiveQuery } from "@tanstack/react-db";
import { challengesCollection } from "@/data/collections/challenges";
import type { Challenge } from "@/data/schemas/challenge";

/**
 * One challenge from the collection. The tabs of a challenge render inside
 * ChallengeLayout, which only shows them once the challenge has loaded.
 */
export function useChallenge(challengeId: string): Challenge | undefined {
	const { data } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	return data?.find((challenge) => challenge.id === challengeId);
}
