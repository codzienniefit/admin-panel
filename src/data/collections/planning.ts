import { api } from "@/data/api";
import { blankPlanning, type Planning } from "@/data/schemas/planning";
import { createVersionedCollection } from "./versioned";

// Planning documents, one per challenge, with the challenge's id. The list
// has a row for every challenge; one nobody has saved yet is blank.
const planning = createVersionedCollection<Planning>({
	name: "planning",
	list: () => api.planning.list(),
	save: (document, options) => api.planning.save(document, options),
});

export const planningCollection = planning.collection;
export const planningSaver = planning.saver;
export const planningTarget = planning.target;
export const persistPlanningMutations = planning.persistMutations;

/**
 * Gives a challenge created in this session its blank planning document, so
 * the planner can be used on it at once. If planning has not been loaded yet
 * there is nothing to add to: the first load brings the blank document.
 */
export async function addBlankPlanning(challengeId: string): Promise<void> {
	if (planningCollection.get(challengeId)) return;
	try {
		await planning.addCreated(blankPlanning(challengeId));
	} catch {
		// Not loaded yet; see above.
	}
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
