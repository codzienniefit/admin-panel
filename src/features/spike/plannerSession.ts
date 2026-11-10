import { createPacedMutations, debounceStrategy } from "@tanstack/react-db";
import {
	challengeSaver,
	challengesCollection,
	persistChallengeMutations,
} from "@/data/collections/challenges";
import type { Challenge } from "@/data/schemas/challenge";
import {
	applyOp,
	invertOp,
	rejectReason,
	type ScheduleOp,
} from "@/domain/schedule";
import { createStore } from "@/lib/store";

// The planner's working state that is NOT server data: the undo and redo
// stacks. The schedule itself lives only in the challenges collection.

export const AUTOSAVE_WAIT_MS = 1200;
const HISTORY_LIMIT = 50;

interface Edit {
	challengeId: string;
	op: ScheduleOp;
}

interface History {
	undo: ScheduleOp[];
	redo: ScheduleOp[];
}

const emptyHistory: History = { undo: [], redo: [] };

export const plannerHistory = createStore<Readonly<Record<string, History>>>(
	{},
);

// Rapid edits merge into one transaction; it is saved once the user has
// paused for AUTOSAVE_WAIT_MS.
const autosave = createPacedMutations<Edit, Challenge>({
	onMutate: ({ challengeId, op }) => {
		challengesCollection.update(challengeId, (draft) => {
			applyOp(draft.paths, op);
		});
	},
	mutationFn: ({ transaction }) =>
		persistChallengeMutations(transaction.mutations),
	strategy: debounceStrategy({ wait: AUTOSAVE_WAIT_MS }),
});

function apply(challengeId: string, op: ScheduleOp): string | null {
	const challenge = challengesCollection.get(challengeId);
	if (!challenge) return "Nie znaleziono wyzwania";
	const reason = rejectReason(challenge.paths, op);
	if (reason) return reason;
	challengeSaver.markDirty(challengeId);
	// A failed save is reported through the saver's status and held edits.
	autosave({ challengeId, op })
		.when("settled")
		.catch(() => undefined);
	return null;
}

function updateHistory(challengeId: string, change: (h: History) => History) {
	plannerHistory.set((all) => ({
		...all,
		[challengeId]: change(all[challengeId] ?? emptyHistory),
	}));
}

/** Applies a user edit. Returns why it was refused, or null. */
export function dispatchEdit(
	challengeId: string,
	op: ScheduleOp,
): string | null {
	const refused = apply(challengeId, op);
	if (refused) return refused;
	updateHistory(challengeId, (h) => ({
		undo: [...h.undo, invertOp(op)].slice(-HISTORY_LIMIT),
		redo: [],
	}));
	return null;
}

export function undo(challengeId: string): void {
	const op = plannerHistory.get()[challengeId]?.undo.at(-1);
	if (!op || apply(challengeId, op)) return;
	updateHistory(challengeId, (h) => ({
		undo: h.undo.slice(0, -1),
		redo: [...h.redo, invertOp(op)],
	}));
}

export function redo(challengeId: string): void {
	const op = plannerHistory.get()[challengeId]?.redo.at(-1);
	if (!op || apply(challengeId, op)) return;
	updateHistory(challengeId, (h) => ({
		undo: [...h.undo, invertOp(op)],
		redo: h.redo.slice(0, -1),
	}));
}

// When a save stops (conflict or error) the schedule on screen is replaced by
// the server's version, so recorded steps no longer describe it.
challengeSaver.held.subscribe(() => {
	const held = challengeSaver.held.get();
	if (held) updateHistory(held.id, () => emptyHistory);
});

// This module owns singletons. Re-evaluating it while screens are mounted
// would leave hooks holding the old instances, so a hot update during
// development reloads the page instead.
if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
