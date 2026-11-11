import { eq, useLiveQuery } from "@tanstack/react-db";
import { planningCollection } from "@/data/collections/planning";
import type { Planning } from "@/data/schemas/planning";

/** The planning document of one challenge; undefined until it has loaded. */
export function usePlanning(challengeId: string): Planning | undefined {
	const { data } = useLiveQuery({
		query: (q) =>
			q
				.from({ planning: planningCollection })
				.where(({ planning }) => eq(planning.id, challengeId)),
	});
	return data?.[0];
}

/** Every planning document, by challenge id. */
export function usePlanningById(): ReadonlyMap<string, Planning> {
	const { data } = useLiveQuery({
		query: (q) => q.from({ planning: planningCollection }),
	});
	return new Map((data ?? []).map((planning) => [planning.id, planning]));
}
