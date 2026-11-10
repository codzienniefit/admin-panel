import type { Challenge, ContentStatus } from "@/data/schemas/challenge";
import { type ChallengeKind, challengeKind } from "./challengeRules";
import { matchesQuery } from "./text";

export type ChallengeSort = "updated" | "added" | "title" | "premiere";

export interface ChallengeFilters {
	q?: string;
	/** Absent: everything except the trash. "deleted": the trash only. */
	status?: ContentStatus;
	kind?: ChallengeKind;
	sort?: ChallengeSort;
}

const byTitle = new Intl.Collator("pl", { sensitivity: "base", numeric: true });

/** The challenges a list should show for these filters, in order. */
export function filterChallenges(
	challenges: readonly Challenge[],
	filters: ChallengeFilters,
): Challenge[] {
	const { q, status, kind, sort = "updated" } = filters;

	const shown = challenges.filter((challenge) => {
		if (status ? challenge.status !== status : challenge.status === "deleted") {
			return false;
		}
		if (kind && challengeKind(challenge) !== kind) return false;
		if (
			q &&
			!matchesQuery(
				`${challenge.title} ${challenge.subtitle ?? ""} ${challenge.internalTitle ?? ""} ${challenge.id}`,
				q,
			)
		) {
			return false;
		}
		return true;
	});

	return shown.sort((a, b) => {
		if (sort === "title") return byTitle.compare(a.title, b.title);
		if (sort === "premiere") {
			// Challenges with a premiere first, the latest on top; plans after.
			return (
				(b.liveAtUtc ?? "").localeCompare(a.liveAtUtc ?? "") ||
				byTitle.compare(a.title, b.title)
			);
		}
		const key = sort === "added" ? "addedAtUtc" : "updatedAtUtc";
		return b[key].localeCompare(a[key]) || byTitle.compare(a.title, b.title);
	});
}

/** Counts for the summary line of a variant. */
export function scheduleStats(
	days: ReadonlyArray<{ workoutIds: readonly string[] }>,
) {
	const training = days.filter((day) => day.workoutIds.length > 0).length;
	return {
		days: days.length,
		trainingDays: training,
		restDays: days.length - training,
		workouts: days.reduce((sum, day) => sum + day.workoutIds.length, 0),
	};
}
