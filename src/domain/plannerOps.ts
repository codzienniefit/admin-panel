import {
	blankVariantPlanning,
	type CardPlanning,
	cardKey,
	type DayPlanning,
	type Planning,
} from "@/data/schemas/planning";
import {
	applyOp,
	type DaySlot,
	invertOp,
	rejectReason,
	type ScheduleOp,
	type SchedulePath,
} from "./schedule";

// Everything the planner can change, as small reversible operations over two
// documents: the challenge's schedule (schedule.ts) and its planning document
// (scratchpad, day notes and tints, card notes and colours).
//
// One user action is a STEP: a list of operations applied together and undone
// together. Dragging a workout to the scratchpad, for example, removes it
// from the day, drops its card note and adds it to the scratchpad.

export type PlanningOp =
	| { type: "scratchAdd"; index: number; workoutId: string }
	| { type: "scratchRemove"; index: number; workoutId: string }
	| {
			type: "daySet";
			pathId: string;
			dayIndex: number;
			from: DayPlanning | undefined;
			to: DayPlanning | undefined;
	  }
	| {
			type: "cardSet";
			pathId: string;
			dayIndex: number;
			workoutId: string;
			from: CardPlanning | undefined;
			to: CardPlanning | undefined;
	  };

export type PlannerOp = ScheduleOp | PlanningOp;
export type PlannerStep = readonly PlannerOp[];

export interface PlannerState {
	paths: readonly SchedulePath[];
	planning: Planning | undefined;
}

export const isScheduleOp = (op: PlannerOp): op is ScheduleOp =>
	op.type === "add" || op.type === "remove" || op.type === "move";

/** Why a planning operation cannot be applied, or null when it can. */
export function planningRejectReason(
	planning: Planning,
	op: PlanningOp,
): string | null {
	if (op.type === "scratchAdd") {
		return planning.scratchpad.includes(op.workoutId)
			? "Ten trening jest już w brudnopisie"
			: null;
	}
	if (op.type === "scratchRemove") {
		return planning.scratchpad[op.index] === op.workoutId
			? null
			: "Tego treningu nie ma już w brudnopisie";
	}
	return null;
}

/** Applies a planning operation in place. Call planningRejectReason first. */
export function applyPlanningOp(planning: Planning, op: PlanningOp): void {
	if (op.type === "scratchAdd") {
		planning.scratchpad.splice(op.index, 0, op.workoutId);
		return;
	}
	if (op.type === "scratchRemove") {
		planning.scratchpad.splice(op.index, 1);
		return;
	}
	let variant = planning.variants[op.pathId];
	if (!variant) {
		if (op.to === undefined) return;
		variant = blankVariantPlanning();
		planning.variants[op.pathId] = variant;
	}
	if (op.type === "daySet") {
		const key = String(op.dayIndex);
		if (op.to === undefined) delete variant.days[key];
		else variant.days[key] = structuredClone(op.to);
		return;
	}
	const key = cardKey(op.dayIndex, op.workoutId);
	if (op.to === undefined) delete variant.cards[key];
	else variant.cards[key] = structuredClone(op.to);
}

function invert(op: PlannerOp): PlannerOp {
	if (isScheduleOp(op)) return invertOp(op);
	if (op.type === "scratchAdd") return { ...op, type: "scratchRemove" };
	if (op.type === "scratchRemove") return { ...op, type: "scratchAdd" };
	return { ...op, from: op.to, to: op.from };
}

/** The step that undoes `step` when applied right after it. */
export const invertStep = (step: PlannerStep): PlannerStep =>
	[...step].reverse().map(invert);

/**
 * Why a step cannot be applied to this state, or null. Checks the operations
 * in order on a scratch copy, so later ones see the effect of earlier ones.
 */
export function stepRejectReason(
	state: PlannerState,
	step: PlannerStep,
): string | null {
	const paths = structuredClone(state.paths) as SchedulePath[];
	const planning = state.planning ? structuredClone(state.planning) : undefined;
	for (const op of step) {
		if (isScheduleOp(op)) {
			const reason = rejectReason(paths, op);
			if (reason) return reason;
			applyOp(paths, op);
		} else {
			if (!planning) return "Dane planowania jeszcze się wczytują";
			const reason = planningRejectReason(planning, op);
			if (reason) return reason;
			applyPlanningOp(planning, op);
		}
	}
	return null;
}

// --- reading -----------------------------------------------------------------

export const dayPlanningOf = (
	planning: Planning | undefined,
	pathId: string,
	dayIndex: number,
): DayPlanning | undefined =>
	planning?.variants[pathId]?.days[String(dayIndex)];

export const cardPlanningOf = (
	planning: Planning | undefined,
	pathId: string,
	dayIndex: number,
	workoutId: string,
): CardPlanning | undefined =>
	planning?.variants[pathId]?.cards[cardKey(dayIndex, workoutId)];

function workoutAt(
	paths: readonly SchedulePath[],
	pathId: string,
	slot: DaySlot,
): string | undefined {
	return paths
		.find((path) => path.pathId === pathId)
		?.days.find((day) => day.dayIndex === slot.dayIndex)?.workoutIds[
		slot.index
	];
}

/** A note or colour object with its empty values dropped; undefined if none are left. */
function tidy<T extends Record<string, unknown>>(value: T): T | undefined {
	const kept = Object.fromEntries(
		Object.entries(value).filter(
			([, v]) => v !== undefined && v !== null && v !== "",
		),
	);
	return Object.keys(kept).length > 0 ? (kept as T) : undefined;
}

// --- steps for user actions -------------------------------------------------

export function addWorkoutStep(
	state: PlannerState,
	pathId: string,
	dayIndex: number,
	workoutId: string,
): PlannerStep {
	const day = state.paths
		.find((path) => path.pathId === pathId)
		?.days.find((d) => d.dayIndex === dayIndex);
	return [
		{
			type: "add",
			pathId,
			dayIndex,
			index: day?.workoutIds.length ?? 0,
			workoutId,
		},
	];
}

/** Removes a workout from a day, together with its card note and colour. */
export function removeWorkoutStep(
	state: PlannerState,
	pathId: string,
	slot: DaySlot,
): PlannerStep {
	const workoutId = workoutAt(state.paths, pathId, slot);
	if (workoutId === undefined) return [];
	const step: PlannerOp[] = [
		{
			type: "remove",
			pathId,
			dayIndex: slot.dayIndex,
			index: slot.index,
			workoutId,
		},
	];
	const card = cardPlanningOf(state.planning, pathId, slot.dayIndex, workoutId);
	if (card) {
		step.push({
			type: "cardSet",
			pathId,
			dayIndex: slot.dayIndex,
			workoutId,
			from: card,
			to: undefined,
		});
	}
	return step;
}

/** Moves a workout; its card note and colour travel with it to another day. */
export function moveWorkoutStep(
	state: PlannerState,
	pathId: string,
	from: DaySlot,
	to: DaySlot,
): PlannerStep {
	const workoutId = workoutAt(state.paths, pathId, from);
	if (workoutId === undefined) return [];
	if (from.dayIndex === to.dayIndex && from.index === to.index) return [];
	const step: PlannerOp[] = [{ type: "move", pathId, from, to }];
	const card = cardPlanningOf(state.planning, pathId, from.dayIndex, workoutId);
	if (card && from.dayIndex !== to.dayIndex) {
		step.push(
			{
				type: "cardSet",
				pathId,
				dayIndex: from.dayIndex,
				workoutId,
				from: card,
				to: undefined,
			},
			{
				type: "cardSet",
				pathId,
				dayIndex: to.dayIndex,
				workoutId,
				from: cardPlanningOf(state.planning, pathId, to.dayIndex, workoutId),
				to: card,
			},
		);
	}
	return step;
}

/** Day → scratchpad is a move: the workout leaves the day. */
export function toScratchpadStep(
	state: PlannerState,
	pathId: string,
	slot: DaySlot,
): PlannerStep {
	const workoutId = workoutAt(state.paths, pathId, slot);
	if (workoutId === undefined) return [];
	const step = [...removeWorkoutStep(state, pathId, slot)];
	// Already kept aside: taking it off the day is enough.
	if (!state.planning?.scratchpad.includes(workoutId)) {
		step.push({
			type: "scratchAdd",
			index: state.planning?.scratchpad.length ?? 0,
			workoutId,
		});
	}
	return step;
}

export function addToScratchpadStep(
	state: PlannerState,
	workoutId: string,
): PlannerStep {
	return [
		{
			type: "scratchAdd",
			index: state.planning?.scratchpad.length ?? 0,
			workoutId,
		},
	];
}

export function removeFromScratchpadStep(
	state: PlannerState,
	workoutId: string,
): PlannerStep {
	const index = state.planning?.scratchpad.indexOf(workoutId) ?? -1;
	return index < 0 ? [] : [{ type: "scratchRemove", index, workoutId }];
}

/** Changes a day's note or tint; an empty value clears it. */
export function setDayStep(
	state: PlannerState,
	pathId: string,
	dayIndex: number,
	change: Partial<DayPlanning>,
): PlannerStep {
	const from = dayPlanningOf(state.planning, pathId, dayIndex);
	const to = tidy({ ...from, ...change });
	return JSON.stringify(from) === JSON.stringify(to)
		? []
		: [{ type: "daySet", pathId, dayIndex, from, to }];
}

/** Moves a day's note onto another day, replacing what was there. */
export function moveDayNoteStep(
	state: PlannerState,
	pathId: string,
	fromDay: number,
	toDay: number,
): PlannerStep {
	const note = dayPlanningOf(state.planning, pathId, fromDay)?.note;
	if (!note || fromDay === toDay) return [];
	return [
		...setDayStep(state, pathId, fromDay, { note: "" }),
		...setDayStep(state, pathId, toDay, { note }),
	];
}

/** Changes a placed workout's note or colour; an empty value clears it. */
export function setCardStep(
	state: PlannerState,
	pathId: string,
	dayIndex: number,
	workoutId: string,
	change: Partial<CardPlanning>,
): PlannerStep {
	const from = cardPlanningOf(state.planning, pathId, dayIndex, workoutId);
	const to = tidy({ ...from, ...change });
	return JSON.stringify(from) === JSON.stringify(to)
		? []
		: [{ type: "cardSet", pathId, dayIndex, workoutId, from, to }];
}

/**
 * Planning data that points at something the schedule no longer has: a
 * removed variant, a day beyond the challenge's length, a card whose workout
 * left its day. Returned as a cleaned copy; the same object when nothing is stale.
 */
export function prunePlanning(
	planning: Planning,
	paths: readonly SchedulePath[],
): Planning {
	let changed = false;
	const variants: Planning["variants"] = {};
	for (const [pathId, variant] of Object.entries(planning.variants)) {
		const path = paths.find((p) => p.pathId === pathId);
		if (!path) {
			changed = true;
			continue;
		}
		const placed = new Set(
			path.days.flatMap((day) =>
				day.workoutIds.map((id) => cardKey(day.dayIndex, id)),
			),
		);
		const dayNumbers = new Set(path.days.map((day) => String(day.dayIndex)));
		const days = Object.fromEntries(
			Object.entries(variant.days).filter(([key]) => dayNumbers.has(key)),
		);
		const cards = Object.fromEntries(
			Object.entries(variant.cards).filter(([key]) => placed.has(key)),
		);
		if (
			Object.keys(days).length !== Object.keys(variant.days).length ||
			Object.keys(cards).length !== Object.keys(variant.cards).length
		) {
			changed = true;
		}
		variants[pathId] = { ...variant, days, cards };
	}
	return changed ? { ...planning, variants } : planning;
}
