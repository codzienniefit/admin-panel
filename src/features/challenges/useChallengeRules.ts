import { useLiveQuery } from "@tanstack/react-db";
import { badgesCollection } from "@/data/collections/badges";
import { challengesCollection } from "@/data/collections/challenges";
import { workoutsCollection } from "@/data/collections/workouts";
import type { ChallengeContext } from "@/domain/challengeRules";
import { useConfig } from "@/features/config/useConfig";

/**
 * Everything the challenge rules need to know about the rest of the data:
 * which workouts and badges exist, which challenges, which one is promoted.
 */
export function useChallengeRules(ownId?: string) {
	const config = useConfig();
	const { data: workouts, isLoading: loadingWorkouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const { data: badges, isLoading: loadingBadges } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const { data: challenges, isLoading: loadingChallenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});

	const context: ChallengeContext = {
		workoutStatus: new Map((workouts ?? []).map((w) => [w.id, w.status])),
		badgeIds: new Set(
			(badges ?? []).filter((b) => b.type === "normal").map((b) => b.id),
		),
		challengeIds: new Set((challenges ?? []).map((c) => c.id)),
		ownId,
		promotedChallengeId: config.internal.promotedChallengeId,
	};

	return {
		config: config.workouts,
		context,
		badges: (badges ?? []).filter((b) => b.type === "normal" && !b.isHidden),
		challenges: challenges ?? [],
		/**
		 * False until the lists the rules depend on have arrived. Checking a
		 * challenge before that would call every workout in it unknown, so a
		 * screen must not validate or save while this is false.
		 */
		ready: !loadingWorkouts && !loadingBadges && !loadingChallenges,
	};
}
