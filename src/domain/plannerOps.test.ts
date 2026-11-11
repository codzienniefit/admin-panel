import { describe, expect, it } from "vitest";
import {
	blankPlanning,
	blankVariantPlanning,
	type Planning,
} from "@/data/schemas/planning";
import {
	addToScratchpadStep,
	addWorkoutStep,
	applyPlanningOp,
	cardPlanningOf,
	dayPlanningOf,
	invertStep,
	isScheduleOp,
	moveDayNoteStep,
	moveWorkoutStep,
	type PlannerState,
	type PlannerStep,
	prunePlanning,
	removeFromScratchpadStep,
	removeWorkoutStep,
	setCardStep,
	setDayStep,
	stepRejectReason,
	toScratchpadStep,
} from "./plannerOps";
import { applyOp, type SchedulePath } from "./schedule";

const P = "p1";

function build(): { paths: SchedulePath[]; planning: Planning } {
	const planning = blankPlanning("C1");
	planning.scratchpad = ["S1"];
	planning.variants[P] = {
		...blankVariantPlanning(),
		days: { "1": { note: "rano" } },
		cards: { "1:A": { note: "lekko", color: "#ef4444" } },
	};
	return {
		paths: [
			{
				pathId: P,
				days: [
					{ dayIndex: 1, workoutIds: ["A", "B"] },
					{ dayIndex: 2, workoutIds: [] },
					{ dayIndex: 3, workoutIds: ["C", "D", "E"] },
				],
			},
		],
		planning,
	};
}

/** Applies a step the way the planner session does. */
function run(state: PlannerState, step: PlannerStep) {
	expect(stepRejectReason(state, step)).toBeNull();
	for (const op of step) {
		if (isScheduleOp(op)) applyOp(state.paths as SchedulePath[], op);
		else if (state.planning) applyPlanningOp(state.planning, op);
	}
}

const day = (state: PlannerState, dayIndex: number) =>
	state.paths[0]?.days.find((d) => d.dayIndex === dayIndex)?.workoutIds;

describe("planner steps", () => {
	it("every step is undone by its inverse", () => {
		const builders: Array<(state: PlannerState) => PlannerStep> = [
			(s) => addWorkoutStep(s, P, 2, "Z"),
			(s) => removeWorkoutStep(s, P, { dayIndex: 1, index: 0 }),
			(s) =>
				moveWorkoutStep(
					s,
					P,
					{ dayIndex: 1, index: 0 },
					{ dayIndex: 2, index: 0 },
				),
			(s) => toScratchpadStep(s, P, { dayIndex: 1, index: 0 }),
			(s) => addToScratchpadStep(s, "S2"),
			(s) => removeFromScratchpadStep(s, "S1"),
			(s) => setDayStep(s, P, 2, { note: "wolne", tint: "#22c55e" }),
			(s) => setDayStep(s, P, 1, { note: "" }),
			(s) => setCardStep(s, P, 1, "A", { color: "" }),
			(s) => moveDayNoteStep(s, P, 1, 2),
		];
		for (const builder of builders) {
			const state = build();
			const before = structuredClone(state);
			const step = builder(state);
			expect(step.length).toBeGreaterThan(0);
			run(state, step);
			expect(state).not.toEqual(before);
			run(state, invertStep(step));
			expect(state).toEqual(before);
		}
	});

	it("removing a workout drops its card note and colour", () => {
		const state = build();
		run(state, removeWorkoutStep(state, P, { dayIndex: 1, index: 0 }));
		expect(day(state, 1)).toEqual(["B"]);
		expect(cardPlanningOf(state.planning, P, 1, "A")).toBeUndefined();
	});

	it("a card's note and colour travel with it to another day", () => {
		const state = build();
		run(
			state,
			moveWorkoutStep(
				state,
				P,
				{ dayIndex: 1, index: 0 },
				{ dayIndex: 2, index: 0 },
			),
		);
		expect(day(state, 2)).toEqual(["A"]);
		expect(cardPlanningOf(state.planning, P, 1, "A")).toBeUndefined();
		expect(cardPlanningOf(state.planning, P, 2, "A")).toEqual({
			note: "lekko",
			color: "#ef4444",
		});
	});

	it("reordering inside a day keeps the card's note where it is", () => {
		const state = build();
		const step = moveWorkoutStep(
			state,
			P,
			{ dayIndex: 1, index: 0 },
			{ dayIndex: 1, index: 1 },
		);
		expect(step).toHaveLength(1);
		run(state, step);
		expect(day(state, 1)).toEqual(["B", "A"]);
		expect(cardPlanningOf(state.planning, P, 1, "A")?.note).toBe("lekko");
	});

	it("day to scratchpad is a move, and never duplicates there", () => {
		const state = build();
		run(state, toScratchpadStep(state, P, { dayIndex: 1, index: 1 }));
		expect(day(state, 1)).toEqual(["A"]);
		expect(state.planning?.scratchpad).toEqual(["S1", "B"]);

		state.planning?.scratchpad.push("A");
		run(state, toScratchpadStep(state, P, { dayIndex: 1, index: 0 }));
		expect(state.planning?.scratchpad).toEqual(["S1", "B", "A"]);
	});

	it("refuses a fourth workout in a day and a duplicate", () => {
		const state = build();
		expect(stepRejectReason(state, addWorkoutStep(state, P, 3, "Z"))).toContain(
			"najwyżej 3",
		);
		expect(stepRejectReason(state, addWorkoutStep(state, P, 1, "A"))).toContain(
			"już w tym dniu",
		);
		expect(
			stepRejectReason(
				state,
				moveWorkoutStep(
					state,
					P,
					{ dayIndex: 1, index: 0 },
					{ dayIndex: 3, index: 0 },
				),
			),
		).toContain("najwyżej 3");
		expect(stepRejectReason(state, addToScratchpadStep(state, "S1"))).toContain(
			"brudnopisie",
		);
	});

	it("refuses planning changes until the planning document has loaded", () => {
		const state: PlannerState = { paths: build().paths, planning: undefined };
		expect(
			stepRejectReason(state, [
				{ type: "scratchAdd", index: 0, workoutId: "X" },
			]),
		).toContain("wczytują");
	});

	it("returns an empty step when nothing would change", () => {
		const state = build();
		expect(setDayStep(state, P, 1, { note: "rano" })).toEqual([]);
		expect(setCardStep(state, P, 2, "nobody", { note: "" })).toEqual([]);
		expect(removeFromScratchpadStep(state, "not-there")).toEqual([]);
		expect(removeWorkoutStep(state, P, { dayIndex: 2, index: 0 })).toEqual([]);
		expect(moveDayNoteStep(state, P, 2, 3)).toEqual([]);
		expect(
			moveWorkoutStep(
				state,
				P,
				{ dayIndex: 1, index: 0 },
				{ dayIndex: 1, index: 0 },
			),
		).toEqual([]);
	});

	it("clearing the last value removes the entry; other values stay", () => {
		const state = build();
		run(state, setCardStep(state, P, 1, "A", { note: "" }));
		expect(cardPlanningOf(state.planning, P, 1, "A")).toEqual({
			color: "#ef4444",
		});
		run(state, setCardStep(state, P, 1, "A", { color: "" }));
		expect(cardPlanningOf(state.planning, P, 1, "A")).toBeUndefined();
	});

	it("creates the variant's planning on its first note", () => {
		const state = build();
		run(state, setDayStep(state, "p-new", 1, { note: "start" }));
		expect(dayPlanningOf(state.planning, "p-new", 1)).toEqual({
			note: "start",
		});
	});

	it("moving a day note replaces the note of the target day", () => {
		const state = build();
		run(state, setDayStep(state, P, 2, { note: "stara", tint: "#22c55e" }));
		run(state, moveDayNoteStep(state, P, 1, 2));
		expect(dayPlanningOf(state.planning, P, 1)).toBeUndefined();
		expect(dayPlanningOf(state.planning, P, 2)).toEqual({
			note: "rano",
			tint: "#22c55e",
		});
	});
});

describe("pruning stale planning", () => {
	it("drops removed variants, days beyond the end and cards that left", () => {
		const { paths, planning } = build();
		planning.variants.gone = blankVariantPlanning();
		const variant = planning.variants[P];
		if (variant) {
			variant.days["9"] = { note: "za końcem" };
			variant.cards["2:A"] = { note: "nie ma go tam" };
		}
		const pruned = prunePlanning(planning, paths);
		expect(Object.keys(pruned.variants)).toEqual([P]);
		expect(pruned.variants[P]?.days).toEqual({ "1": { note: "rano" } });
		expect(Object.keys(pruned.variants[P]?.cards ?? {})).toEqual(["1:A"]);
	});

	it("returns the same object when nothing is stale", () => {
		const { paths, planning } = build();
		expect(prunePlanning(planning, paths)).toBe(planning);
	});
});
