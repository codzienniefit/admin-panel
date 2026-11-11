// Edits to a challenge schedule, as small reversible operations.
// Pure: no React, no storage. The same functions run on a collection draft
// (mutating it in place) and on plain copies in tests.

export interface ScheduleDay {
	dayIndex: number;
	workoutIds: string[];
}

export interface SchedulePath {
	pathId: string;
	days: ScheduleDay[];
}

export interface DaySlot {
	dayIndex: number;
	/** Position within the day's workout list. */
	index: number;
}

export type ScheduleOp =
	| {
			type: "add";
			pathId: string;
			dayIndex: number;
			index: number;
			workoutId: string;
	  }
	| {
			type: "remove";
			pathId: string;
			dayIndex: number;
			index: number;
			workoutId: string;
	  }
	| { type: "move"; pathId: string; from: DaySlot; to: DaySlot };

/**
 * The app shows up to three workouts in a day (the limit Retool enforced).
 * Open decision 10 in docs/PLAN.md: raise it only once the app team confirms.
 */
export const MAX_WORKOUTS_PER_DAY = 3;
const DAY_FULL = `W jednym dniu mogą być najwyżej ${MAX_WORKOUTS_PER_DAY} treningi`;

function findDay(
	paths: readonly SchedulePath[],
	pathId: string,
	dayIndex: number,
): ScheduleDay | undefined {
	return paths
		.find((p) => p.pathId === pathId)
		?.days.find((d) => d.dayIndex === dayIndex);
}

/**
 * Why an operation cannot be applied, or null when it can.
 * Mirrors the backend rule that a day may not list the same workout twice.
 */
export function rejectReason(
	paths: readonly SchedulePath[],
	op: ScheduleOp,
): string | null {
	if (op.type === "add") {
		const day = findDay(paths, op.pathId, op.dayIndex);
		if (!day) return "Nie ma takiego dnia";
		if (day.workoutIds.includes(op.workoutId))
			return "Ten trening jest już w tym dniu";
		if (day.workoutIds.length >= MAX_WORKOUTS_PER_DAY) return DAY_FULL;
		return null;
	}
	if (op.type === "remove") {
		const day = findDay(paths, op.pathId, op.dayIndex);
		if (!day || day.workoutIds[op.index] !== op.workoutId)
			return "Tego treningu nie ma już w tym miejscu";
		return null;
	}
	const from = findDay(paths, op.pathId, op.from.dayIndex);
	const to = findDay(paths, op.pathId, op.to.dayIndex);
	const workoutId = from?.workoutIds[op.from.index];
	if (!from || !to || workoutId === undefined)
		return "Tego treningu nie ma już w tym miejscu";
	if (from !== to && to.workoutIds.includes(workoutId))
		return "Ten trening jest już w tym dniu";
	if (from !== to && to.workoutIds.length >= MAX_WORKOUTS_PER_DAY)
		return DAY_FULL;
	return null;
}

/** Applies an operation in place. Call rejectReason first. */
export function applyOp(paths: SchedulePath[], op: ScheduleOp): void {
	if (op.type === "add") {
		findDay(paths, op.pathId, op.dayIndex)?.workoutIds.splice(
			op.index,
			0,
			op.workoutId,
		);
		return;
	}
	if (op.type === "remove") {
		findDay(paths, op.pathId, op.dayIndex)?.workoutIds.splice(op.index, 1);
		return;
	}
	const from = findDay(paths, op.pathId, op.from.dayIndex);
	const to = findDay(paths, op.pathId, op.to.dayIndex);
	if (!from || !to) return;
	const [workoutId] = from.workoutIds.splice(op.from.index, 1);
	if (workoutId === undefined) return;
	to.workoutIds.splice(op.to.index, 0, workoutId);
}

/** The operation that undoes `op` when applied right after it. */
export function invertOp(op: ScheduleOp): ScheduleOp {
	if (op.type === "add") return { ...op, type: "remove" };
	if (op.type === "remove") return { ...op, type: "add" };
	return { type: "move", pathId: op.pathId, from: op.to, to: op.from };
}

/** Days grouped into weeks of seven; the last week may be shorter. */
export function toWeeks<T extends ScheduleDay>(days: readonly T[]): T[][] {
	const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex);
	const weeks: T[][] = [];
	for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));
	return weeks;
}
