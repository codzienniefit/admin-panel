import { describe, expect, it } from "vitest";
import type { Condition, PlanType } from "@/data/schemas/planning";
import {
	blankCondition,
	CONDITION_SPECS,
	conditionIssues,
	DEFAULT_PLAN_TYPES,
	isConditionType,
	normalizeCondition,
	planTypeIssues,
} from "./conditions";

const types = new Set(["cardio", "strength"]);
const messages = (condition: Condition) =>
	conditionIssues(condition, "x", types).map((issue) => issue.message);

describe("tidying a week rule", () => {
	it("keeps only what its kind uses", () => {
		expect(
			normalizeCondition({
				type: "minimum",
				scope: "cardio",
				countMode: "days",
				value: 2,
				valueMin: 1,
				valueMax: 9,
				valueDays: 3,
			}),
		).toEqual({ type: "minimum", scope: "cardio", value: 2 });
		expect(
			normalizeCondition({
				type: "zakres",
				scope: "all",
				valueMin: 1,
				valueMax: 3,
			}),
		).toEqual({ type: "zakres", scope: "all", valueMin: 1, valueMax: 3 });
	});

	it("keeps counting in days only where a kind can", () => {
		expect(
			normalizeCondition({
				type: "limit",
				scope: "all",
				countMode: "days",
				value: 4,
			}),
		).toEqual({ type: "limit", scope: "all", countMode: "days", value: 4 });
	});

	it("drops the scope of rules about the whole week", () => {
		expect(
			normalizeCondition({ type: "max_w_dniu", scope: "cardio", value: 2 }),
		).toEqual({ type: "max_w_dniu", scope: "all", value: 2 });
	});

	it("rounds numbers and turns missing ones into 0", () => {
		expect(
			normalizeCondition({ type: "limit", scope: "all", value: 2.6 }).value,
		).toBe(3);
		expect(normalizeCondition({ type: "limit", scope: "all" }).value).toBe(0);
	});

	it("turns the old training-days kind into a limit counted in days", () => {
		expect(
			normalizeCondition({
				type: "max_dni_treningowych",
				scope: "cardio",
				value: 3,
			}),
		).toEqual({ type: "limit", scope: "cardio", countMode: "days", value: 3 });
	});

	it("leaves a kind it does not know exactly as it is", () => {
		const future = {
			type: "from_the_future",
			scope: "all",
			value: 1,
			extra: true,
		};
		expect(normalizeCondition(future)).toBe(future);
		expect(isConditionType("from_the_future")).toBe(false);
	});

	it("makes a blank rule of every kind that passes its own checks", () => {
		for (const type of Object.keys(CONDITION_SPECS)) {
			if (!isConditionType(type)) continue;
			expect(messages(blankCondition(type))).toEqual([]);
		}
	});
});

describe("checking a week rule", () => {
	it("accepts the defaults", () => {
		for (const planType of DEFAULT_PLAN_TYPES) {
			expect(
				planTypeIssues(
					[planType],
					"planTypes",
					new Set(["cardio", "stretching"]),
				),
			).toEqual([]);
		}
	});

	it("refuses a training type that does not exist", () => {
		expect(
			messages({ type: "minimum", scope: "swimming", value: 1 }),
		).toHaveLength(1);
		expect(messages({ type: "minimum", scope: "all", value: 1 })).toEqual([]);
	});

	it("refuses numbers outside the allowed range, fractions and text", () => {
		expect(messages({ type: "limit", scope: "all", value: 15 })).toHaveLength(
			1,
		);
		expect(messages({ type: "limit", scope: "all", value: -1 })).toHaveLength(
			1,
		);
		expect(messages({ type: "limit", scope: "all", value: 1.5 })).toHaveLength(
			1,
		);
		expect(messages({ type: "limit", scope: "all" })).toHaveLength(1);
		expect(
			messages({ type: "max_w_dniu", scope: "all", value: 6 }),
		).toHaveLength(1);
		expect(messages({ type: "odstep", scope: "all", value: 8 })).toHaveLength(
			1,
		);
	});

	it("refuses a range that ends before it starts", () => {
		expect(
			messages({ type: "zakres", scope: "all", valueMin: 4, valueMax: 2 }).join(
				" ",
			),
		).toContain("mniejsze");
	});

	it("needs at least one day in a window", () => {
		expect(
			messages({ type: "max_w_ciagu", scope: "all", value: 2, valueDays: 0 }),
		).toHaveLength(1);
	});

	it("says nothing about a kind it does not know", () => {
		expect(messages({ type: "from_the_future", scope: "nobody" })).toEqual([]);
	});
});

describe("checking a list of plan types", () => {
	const make = (id: string, label: string): PlanType => ({
		id,
		name: label,
		description: "",
		conditions: [],
	});

	it("needs a name and unique ids", () => {
		const issues = planTypeIssues(
			[make("a", "Pierwszy"), make("a", "Drugi"), make("b", "  ")],
			"planTypes",
			types,
		).map((issue) => issue.message);
		expect(issues.join(" ")).toContain("ten sam identyfikator");
		expect(issues.join(" ")).toContain("musi mieć nazwę");
	});

	it("reports the rules inside a plan type", () => {
		const broken = {
			...make("a", "Zły"),
			conditions: [{ type: "limit", scope: "all", value: 99 }],
		};
		expect(planTypeIssues([broken], "planTypes", types)).toHaveLength(1);
	});
});
