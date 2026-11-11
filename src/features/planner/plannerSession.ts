import {
	createPacedMutations,
	createTransaction,
	debounceStrategy,
} from "@tanstack/react-db";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import {
	challengeSaver,
	challengesCollection,
	persistChallengeMutations,
} from "@/data/collections/challenges";
import {
	persistPlanningMutations,
	planningCollection,
	planningSaver,
} from "@/data/collections/planning";
import type { Challenge } from "@/data/schemas/challenge";
import type { Planning } from "@/data/schemas/planning";
import {
	applyPlanningOp,
	invertStep,
	isScheduleOp,
	type PlannerStep,
	type PlanningOp,
	stepRejectReason,
} from "@/domain/plannerOps";
import { applyOp, type ScheduleOp } from "@/domain/schedule";
import { createStore } from "@/lib/store";

// The planner's working state that is NOT server data: undo and redo, and
// which challenges have schedule changes waiting to be saved. The schedule and
// the planning document themselves live only in their collections.
//
// How a change is saved depends on who can see it (docs/PLAN.md, decision 2):
//
//   planning data            never public       autosaved after a pause
//   schedule of a draft      not public yet     autosaved after a pause
//   schedule, published      app users see it   staged until "Zapisz zmiany"
//   or hidden challenge

export const AUTOSAVE_WAIT_MS = 1200;
const HISTORY_LIMIT = 50;

interface History {
	undo: PlannerStep[];
	redo: PlannerStep[];
}

const emptyHistory: History = { undo: [], redo: [] };

export const plannerHistory = createStore<Readonly<Record<string, History>>>(
	{},
);

/** The workout picked with "Kopiuj", waiting to be pasted into a day. */
export const plannerClipboard = createStore<string | null>(null);

/** Challenges whose schedule has changes waiting for "Zapisz zmiany". */
export const stagedSchedules = createStore<ReadonlySet<string>>(new Set());

// Rapid edits merge into one transaction; it is saved once the user has
// paused for AUTOSAVE_WAIT_MS.
const autosaveSchedule = createPacedMutations<
	{ challengeId: string; ops: ScheduleOp[] },
	Challenge
>({
	onMutate: ({ challengeId, ops }) => {
		challengesCollection.update(challengeId, (draft) => {
			for (const op of ops) applyOp(draft.paths, op);
		});
	},
	mutationFn: ({ transaction }) =>
		persistChallengeMutations(transaction.mutations),
	strategy: debounceStrategy({ wait: AUTOSAVE_WAIT_MS }),
});

const autosavePlanning = createPacedMutations<
	{ challengeId: string; ops: PlanningOp[] },
	Planning
>({
	onMutate: ({ challengeId, ops }) => {
		planningCollection.update(challengeId, (draft) => {
			for (const op of ops) applyPlanningOp(draft as Planning, op);
		});
	},
	mutationFn: ({ transaction }) =>
		persistPlanningMutations(transaction.mutations),
	strategy: debounceStrategy({ wait: AUTOSAVE_WAIT_MS }),
});

// Typed text (the notes above a plan) is not a step: the text field has its
// own undo, so it is saved after a pause and stays out of the history.
const autosavePlanningEdit = createPacedMutations<
	{ challengeId: string; change: (draft: Planning) => void },
	Planning
>({
	onMutate: ({ challengeId, change }) => {
		planningCollection.update(challengeId, (draft) =>
			change(draft as Planning),
		);
	},
	mutationFn: ({ transaction }) =>
		persistPlanningMutations(transaction.mutations),
	strategy: debounceStrategy({ wait: AUTOSAVE_WAIT_MS }),
});

/** Changes planning data as the user types; saved after a pause, not undoable. */
export function editPlanning(
	challengeId: string,
	change: (draft: Planning) => void,
): void {
	if (!planningCollection.get(challengeId)) return;
	planningSaver.markDirty(challengeId);
	autosavePlanningEdit({ challengeId, change })
		.when("settled")
		.catch(() => undefined);
}

type StagedTransaction = ReturnType<typeof createTransaction<Challenge>>;
const staged = new Map<string, StagedTransaction>();

function setStaged(challengeId: string, isStaged: boolean) {
	stagedSchedules.set((current) => {
		if (current.has(challengeId) === isStaged) return current;
		const next = new Set(current);
		if (isStaged) next.add(challengeId);
		else next.delete(challengeId);
		return next;
	});
}

function applySchedule(challenge: Challenge, ops: ScheduleOp[]) {
	if (ops.length === 0) return;
	challengeSaver.markDirty(challenge.id);

	// Nobody outside the team sees a draft, so it saves by itself. Once
	// something is staged it stays staged until saved or discarded.
	if (challenge.status === "draft" && !staged.has(challenge.id)) {
		// A failed save is reported through the saver's status and held edits.
		autosaveSchedule({ challengeId: challenge.id, ops })
			.when("settled")
			.catch(() => undefined);
		return;
	}

	stage(challenge.id, (draft) => {
		for (const op of ops) applyOp(draft.paths, op);
	});
}

/** Adds a change to the challenge's open, uncommitted transaction. */
function stage(challengeId: string, change: (draft: Challenge) => void) {
	let transaction = staged.get(challengeId);
	if (!transaction) {
		transaction = createTransaction<Challenge>({
			autoCommit: false,
			mutationFn: ({ transaction: tx }) =>
				persistChallengeMutations(tx.mutations),
		});
		staged.set(challengeId, transaction);
		setStaged(challengeId, true);
	}
	transaction.mutate(() => {
		challengesCollection.update(challengeId, (draft) =>
			change(draft as Challenge),
		);
	});
}

function applyPlanning(challengeId: string, ops: PlanningOp[]) {
	if (ops.length === 0) return;
	planningSaver.markDirty(challengeId);
	autosavePlanning({ challengeId, ops })
		.when("settled")
		.catch(() => undefined);
}

function apply(challengeId: string, step: PlannerStep): string | null {
	const challenge = challengesCollection.get(challengeId);
	if (!challenge) return "Nie znaleziono wyzwania";
	if (challenge.status === "deleted") {
		return "Wyzwanie jest w koszu. Przywróć je, żeby zmieniać plan";
	}
	const planning = planningCollection.get(challengeId);
	const planningOps = step.filter((op): op is PlanningOp => !isScheduleOp(op));
	// Notes and colours live in the planning document. Until it has loaded
	// there is nothing to write them to, and they must not vanish silently.
	if (!planning && planningOps.length > 0) {
		return "Notatki tego wyzwania jeszcze się wczytują. Spróbuj za chwilę";
	}
	const reason = stepRejectReason({ paths: challenge.paths, planning }, step);
	if (reason) return reason;

	applySchedule(challenge, step.filter(isScheduleOp));
	applyPlanning(challengeId, planningOps);
	return null;
}

function updateHistory(challengeId: string, change: (h: History) => History) {
	plannerHistory.set((all) => ({
		...all,
		[challengeId]: change(all[challengeId] ?? emptyHistory),
	}));
}

/**
 * Applies one user action. Returns why it was refused, or null. An empty
 * step (nothing would change) is accepted and leaves no trace.
 */
export function dispatchStep(
	challengeId: string,
	step: PlannerStep,
): string | null {
	if (step.length === 0) return null;
	const refused = apply(challengeId, step);
	if (refused) return refused;
	updateHistory(challengeId, (h) => ({
		undo: [...h.undo, invertStep(step)].slice(-HISTORY_LIMIT),
		redo: [],
	}));
	return null;
}

/** Returns why the last step could not be undone, or null. */
export function undo(challengeId: string): string | null {
	const step = plannerHistory.get()[challengeId]?.undo.at(-1);
	if (!step) return null;
	const refused = apply(challengeId, step);
	if (refused) return refused;
	updateHistory(challengeId, (h) => ({
		undo: h.undo.slice(0, -1),
		redo: [...h.redo, invertStep(step)],
	}));
	return null;
}

export function redo(challengeId: string): string | null {
	const step = plannerHistory.get()[challengeId]?.redo.at(-1);
	if (!step) return null;
	const refused = apply(challengeId, step);
	if (refused) return refused;
	updateHistory(challengeId, (h) => ({
		undo: [...h.undo, invertStep(step)],
		redo: h.redo.slice(0, -1),
	}));
	return null;
}

/**
 * Saves the staged schedule changes of a published or hidden challenge.
 *
 * Resolves when the save has finished, with the server's reasons if it
 * refused the content, else null. Nothing is lost either way: a conflict or a
 * failure is held by the saver (HeldEditsNotice), and after a refusal the
 * changes are staged again, exactly as they were on screen.
 */
export async function saveStaged(
	challengeId: string,
): Promise<readonly ApiIssue[] | null> {
	const transaction = staged.get(challengeId);
	if (!transaction) return null;
	const onScreen = challengesCollection.get(challengeId);
	staged.delete(challengeId);
	setStaged(challengeId, false);
	try {
		await transaction.commit();
		return null;
	} catch (error) {
		if (isApiError(error) && error.kind === "validation" && onScreen) {
			const paths = structuredClone(onScreen.paths);
			stage(challengeId, (draft) => {
				draft.paths = paths;
			});
			challengeSaver.markDirty(challengeId);
			return error.issues;
		}
		// The saver holds the edits and the page shows what happened.
		return null;
	}
}

/** Throws the staged schedule changes away; the plan goes back to what is saved. */
export function discardStaged(challengeId: string): void {
	const transaction = staged.get(challengeId);
	if (!transaction) return;
	staged.delete(challengeId);
	setStaged(challengeId, false);
	transaction.rollback();
	// Recorded steps describe a plan that no longer exists.
	updateHistory(challengeId, () => emptyHistory);
	challengeSaver.status.set((all) => ({
		...all,
		[challengeId]: { phase: "idle" },
	}));
}

// When a save stops (conflict or error) what is on screen is replaced by the
// server's version, so recorded steps no longer describe it.
for (const saver of [challengeSaver, planningSaver]) {
	saver.held.subscribe(() => {
		const held = saver.held.get();
		if (held) updateHistory(held.id, () => emptyHistory);
	});
}

// This module owns singletons. Re-evaluating it while screens are mounted
// would leave hooks holding the old instances, so a hot update during
// development reloads the page instead.
if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
