import { api } from "@/data/api";
import type { CachePurgeResult } from "@/data/api/types";
import { createStore } from "@/lib/store";

// The app's CDN cache, cleared by hand from Ustawienia. Not an entity, so no
// collection: one call, and the last success remembered for this tab, so the
// time stays on screen when the person moves between settings tabs.

/** The last purge that went through in this tab, or null. */
export const lastAppCachePurge = createStore<CachePurgeResult | null>(null);

export async function purgeAppCache(): Promise<CachePurgeResult> {
	const result = await api.cache.purge();
	lastAppCachePurge.set(result);
	return result;
}
