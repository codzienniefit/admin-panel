import {
	browserStorage,
	readStored,
	removeStored,
	type StorageLike,
	writeStored,
} from "@/lib/storage";
import type { DatasetSize } from "./fixtures";

// The sample data lives in the browser. Edits are kept in localStorage so a
// demo survives a reload; "reset" throws them away and starts from the seed.

/** Bump when the shape of the sample data changes; old snapshots are dropped. */
export const SNAPSHOT_KEY = "cf.mock.v4";
const DATASET_KEY = "cf.mock.dataset";

export function readDataset(
	storage: StorageLike | null = browserStorage(),
): DatasetSize {
	return readStored(DATASET_KEY, storage) === "stress" ? "stress" : "normal";
}

/** Starts again from the seed, optionally with another dataset. Reloads. */
export function resetSampleData(dataset?: DatasetSize): void {
	removeStored(SNAPSHOT_KEY);
	if (dataset) writeStored(DATASET_KEY, dataset);
	window.location.reload();
}
