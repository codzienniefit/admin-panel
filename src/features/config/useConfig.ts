import { getRouteApi } from "@tanstack/react-router";
import type { PanelConfig } from "@/data/config";

const appRoute = getRouteApi("/_app");

/** The backend configuration; available on every screen behind sign-in. */
export function useConfig(): PanelConfig {
	return appRoute.useLoaderData();
}

/** The ids of the training types that exist, as the rule functions take them. */
export function trainingTypeIdsOf(config: {
	trainingTypes: ReadonlyArray<{ id: string }>;
}): ReadonlySet<string> {
	return new Set(config.trainingTypes.map((type) => type.id));
}
