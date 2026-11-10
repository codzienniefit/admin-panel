import type { ContentStatus } from "@/data/schemas/challenge";
import type { Workout } from "@/data/schemas/workout";
import { matchesQuery } from "./text";

export type WorkoutSort = "added" | "updated" | "title";

export interface WorkoutFilters {
	q?: string;
	/** Absent: everything except the trash. "deleted": the trash only. */
	status?: ContentStatus;
	type?: string;
	level?: string;
	sort?: WorkoutSort;
}

const byTitle = new Intl.Collator("pl", { sensitivity: "base", numeric: true });

/** The workouts a list should show for these filters, in order. */
export function filterWorkouts(
	workouts: readonly Workout[],
	filters: WorkoutFilters,
): Workout[] {
	const { q, status, type, level, sort = "added" } = filters;

	const shown = workouts.filter((workout) => {
		if (status ? workout.status !== status : workout.status === "deleted") {
			return false;
		}
		if (type && !workout.trainingTypeIds.includes(type)) return false;
		if (level && workout.levelId !== level) return false;
		if (
			q &&
			!matchesQuery(
				`${workout.title} ${workout.internalTitle ?? ""} ${workout.id}`,
				q,
			)
		) {
			return false;
		}
		return true;
	});

	return shown.sort((a, b) => {
		if (sort === "title") return byTitle.compare(a.title, b.title);
		const key = sort === "updated" ? "updatedAtUtc" : "addedAtUtc";
		return b[key].localeCompare(a[key]) || byTitle.compare(a.title, b.title);
	});
}

/** Challenges whose schedule contains the workout. */
export function challengesUsing<
	T extends {
		status: ContentStatus;
		paths: ReadonlyArray<{
			days: ReadonlyArray<{ workoutIds: readonly string[] }>;
		}>;
	},
>(challenges: readonly T[], workoutId: string): T[] {
	return challenges.filter(
		(challenge) =>
			challenge.status !== "deleted" &&
			challenge.paths.some((path) =>
				path.days.some((day) => day.workoutIds.includes(workoutId)),
			),
	);
}
