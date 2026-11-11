import { useLiveQuery } from "@tanstack/react-db";
import { challengesCollection } from "@/data/collections/challenges";
import { workoutsCollection } from "@/data/collections/workouts";
import { assignmentsByBadge, type BadgeAssignment } from "@/domain/badgeRules";

const NONE: readonly BadgeAssignment[] = [];

/**
 * Which workouts and challenges award each badge. Nothing stores this: it is
 * worked out from the two collections, so it is right the moment either
 * changes.
 */
export function useBadgeAssignments() {
	const { data: workouts, isLoading: loadingWorkouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const { data: challenges, isLoading: loadingChallenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	const byBadge = assignmentsByBadge(workouts ?? [], challenges ?? []);
	return {
		/** False until both lists have arrived; "unassigned" is not known yet. */
		ready: !loadingWorkouts && !loadingChallenges,
		of: (badgeId: string): readonly BadgeAssignment[] =>
			byBadge.get(badgeId) ?? NONE,
	};
}
