import { createStore } from "@/lib/store";
import type { DatasetSize } from "./fixtures";
import { readDataset } from "./persistence";

export type ForcedConflict =
	/** Another admin changed a field this user did not touch. */
	| "otherField"
	/** Another admin changed the very fields (or days) this user edited. */
	| "sameFields";

export interface MockControls {
	minLatencyMs: number;
	maxLatencyMs: number;
	/** The next save fails with a server error, then the flag clears. */
	failNextSave: boolean;
	/** The next save meets a concurrent change, then the flag clears. */
	conflictNextSave: ForcedConflict | null;
	/** Which sample dataset is loaded; changing it needs a reset. */
	dataset: DatasetSize;
}

export const defaultMockControls: MockControls = {
	minLatencyMs: 150,
	maxLatencyMs: 400,
	failNextSave: false,
	conflictNextSave: null,
	dataset: "normal",
};

/** Knobs for exercising loading states, rollbacks and the conflict flow. */
export const mockControls = createStore<MockControls>({
	...defaultMockControls,
	dataset: readDataset(),
});
