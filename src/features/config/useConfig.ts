import { getRouteApi } from "@tanstack/react-router";
import type { PanelConfig } from "@/data/config";

const appRoute = getRouteApi("/_app");

/** The backend configuration; available on every screen behind sign-in. */
export function useConfig(): PanelConfig {
	return appRoute.useLoaderData();
}
