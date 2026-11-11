import { api } from "@/data/api";
import type { PlannerSettings } from "@/data/schemas/settings";
import { createVersionedCollection } from "./versioned";

// The planner's shared settings: a collection with exactly one row, so that
// it is read, saved and merged like everything else.
const settings = createVersionedCollection<PlannerSettings>({
	name: "plannerSettings",
	list: async () => [await api.settings.planner()],
	save: (document, options) => api.settings.savePlanner(document, options),
});

export const plannerSettingsCollection = settings.collection;
export const plannerSettingsSaver = settings.saver;
export const plannerSettingsTarget = settings.target;

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
