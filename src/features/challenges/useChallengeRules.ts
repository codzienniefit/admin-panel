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
	const { data: workouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const { data: badges } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const { data: challenges } = useLiveQuery({
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
		/** False until the lists the rules depend on have arrived. */
		ready: workouts !== undefined && badges !== undefined,
	};
}
