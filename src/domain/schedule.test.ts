import { describe, expect, it } from "vitest";
import {
	applyOp,
	invertOp,
	rejectReason,
	type ScheduleOp,
	type SchedulePath,
	toWeeks,
} from "./schedule";

const build = (): SchedulePath[] => [
	{
		pathId: "p",
		days: [
			{ dayIndex: 1, workoutIds: ["A", "B"] },
			{ dayIndex: 2, workoutIds: [] },
			{ dayIndex: 3, workoutIds: ["C"] },
		],
	},
];

const ops: ScheduleOp[] = [
	{ type: "add", pathId: "p", dayIndex: 2, index: 0, workoutId: "Z" },
	{ type: "remove", pathId: "p", dayIndex: 1, index: 0, workoutId: "A" },
	{
		type: "move",
		pathId: "p",
		from: { dayIndex: 1, index: 1 },
		to: { dayIndex: 3, index: 0 },
	},
	{
		type: "move",
		pathId: "p",
		from: { dayIndex: 1, index: 0 },
		to: { dayIndex: 1, index: 1 },
	},
];

describe("schedule operations", () => {
	it.each(ops)("$type is undone by its inverse", (op) => {
		const paths = build();
		expect(rejectReason(paths, op)).toBeNull();
		applyOp(paths, op);
		expect(paths).not.toEqual(build());
		applyOp(paths, invertOp(op));
		expect(paths).toEqual(build());
	});

	it("moves a workout to another day", () => {
		const paths = build();
		applyOp(paths, ops[2] as ScheduleOp);
		expect(paths[0]?.days.map((d) => d.workoutIds)).toEqual([
			["A"],
			[],
			["B", "C"],
		]);
	});

	it("refuses the same workout twice in one day", () => {
		expect(
			rejectReason(build(), {
				type: "add",
				pathId: "p",
				dayIndex: 1,
				index: 0,
				workoutId: "A",
			}),
		).toBe("Ten trening jest już w tym dniu");
	});

	it("refuses an operation whose source has changed", () => {
		expect(
			rejectReason(build(), {
				type: "remove",
				pathId: "p",
				dayIndex: 1,
				index: 0,
				workoutId: "B",
			}),
		).not.toBeNull();
	});

	it("groups days into weeks of seven", () => {
		const days = Array.from({ length: 16 }, (_, i) => ({
			dayIndex: 16 - i,
			workoutIds: [],
		}));
		const weeks = toWeeks(days);
		expect(weeks.map((w) => w.length)).toEqual([7, 7, 2]);
		expect(weeks[0]?.[0]?.dayIndex).toBe(1);
	});
});
