import { readStoredJson, writeStored } from "@/lib/storage";
import { createStore, useStore } from "@/lib/store";

// The plans this person opened last, on this device. Ids only: titles come
// from the collections, so a renamed challenge shows its new name.

export interface RecentPlan {
	challengeId: string;
	pathId: string;
}

const KEY = "cf.recentPlans";
const LIMIT = 6;

function read(): RecentPlan[] {
	const parsed = readStoredJson(KEY);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter(
			(item): item is RecentPlan =>
				typeof item?.challengeId === "string" &&
				typeof item?.pathId === "string",
		)
		.slice(0, LIMIT);
}

const recent = createStore<readonly RecentPlan[]>(read());

export function rememberPlan(challengeId: string, pathId: string): void {
	const current = recent.get();
	if (
		current[0]?.challengeId === challengeId &&
		current[0]?.pathId === pathId
	) {
		return;
	}
	const next = [
		{ challengeId, pathId },
		...current.filter(
			(plan) => plan.challengeId !== challengeId || plan.pathId !== pathId,
		),
	].slice(0, LIMIT);
	recent.set(next);
	// In private mode or with a full storage the list just does not survive
	// a reload.
	writeStored(KEY, JSON.stringify(next));
}

export const useRecentPlans = (): readonly RecentPlan[] => useStore(recent);
