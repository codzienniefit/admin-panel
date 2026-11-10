import type { DatasetSize } from "./fixtures";

// The sample data lives in the browser. Edits are kept in localStorage so a
// demo survives a reload; "reset" throws them away and starts from the seed.

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Bump when the shape of the sample data changes; old snapshots are dropped. */
export const SNAPSHOT_KEY = "cf.mock.v3";
const DATASET_KEY = "cf.mock.dataset";

export function browserStorage(): StorageLike | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function readDataset(storage = browserStorage()): DatasetSize {
	try {
		return storage?.getItem(DATASET_KEY) === "stress" ? "stress" : "normal";
	} catch {
		return "normal";
	}
}

/** Starts again from the seed, optionally with another dataset. Reloads. */
export function resetSampleData(dataset?: DatasetSize): void {
	const storage = browserStorage();
	try {
		storage?.removeItem(SNAPSHOT_KEY);
		if (dataset) storage?.setItem(DATASET_KEY, dataset);
	} catch {
		// Nothing stored, nothing to clear.
	}
	window.location.reload();
}
