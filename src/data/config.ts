import { api } from "@/data/api";
import { queryClient } from "@/data/collections/queryClient";
import type { InternalConfig, WorkoutConfig } from "@/data/schemas/config";

export interface PanelConfig {
	workouts: WorkoutConfig;
	internal: InternalConfig;
}

/**
 * The backend's configuration, fetched once and kept. Unlike challenges or
 * workouts these are two single documents, not lists, so they live in the
 * query cache instead of a collection. The guarded layout route loads them
 * before any screen renders; screens read them with useConfig().
 */
const CONFIG_KEY = ["config"] as const;

/**
 * Chooses the promoted challenge. Callers refresh the route afterwards
 * (router.invalidate) so that every screen reads the new configuration.
 */
export async function setPromotedChallenge(
	challengeId: string | null,
): Promise<void> {
	const internal = await api.config.setPromotedChallenge(challengeId);
	queryClient.setQueryData<PanelConfig>(CONFIG_KEY, (current) =>
		current ? { ...current, internal } : current,
	);
}

export function loadConfig(): Promise<PanelConfig> {
	return queryClient.fetchQuery({
		queryKey: CONFIG_KEY,
		queryFn: async () => {
			const [workouts, internal] = await Promise.all([
				api.config.workouts(),
				api.config.internal(),
			]);
			return { workouts, internal };
		},
	});
}
