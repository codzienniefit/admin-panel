import { useLiveQuery } from "@tanstack/react-db";
import { plannerSettingsCollection } from "@/data/collections/settings";
import type { PlannerSettings } from "@/data/schemas/settings";

/** The planner's shared settings; undefined until they have loaded. */
export function usePlannerSettings(): PlannerSettings | undefined {
	const { data } = useLiveQuery({
		query: (q) => q.from({ settings: plannerSettingsCollection }),
	});
	return data?.[0];
}
