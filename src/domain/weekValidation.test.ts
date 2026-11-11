import { describe, expect, it } from "vitest";
import type { Condition } from "@/data/schemas/planning";
import {
	formatConditionLabel,
	validateWeek,
	type WeekInput,
} from "./weekValidation";

const SCOPE_NAMES: Record<string, string> = {
	all: "Wszystkie treningi",
	cardio: "Cardio",
	strength: "Siłowy",
};
const scopeLabel = (scope: string) => SCOPE_NAMES[scope] ?? scope;

/**
 * A week from a short notation: one entry per day, workouts separated by
 * spaces, types of one workout by "+". "" is a rest day.
 * `week("cardio", "", "cardio+strength strength")`.
 */
const week = (...days: string[]): WeekInput =>
	days.map((day) => ({
		workouts: day
			.split(" ")
			.filter(Boolean)
			.map((workout) => ({ typeIds: workout.split("+") })),
	}));

const REST = ["", "", "", "", "", "", ""] as const;
/** A full week with the given days (0 = Monday) holding one workout each. */
const weekWith = (days: Record<number, string>): WeekInput =>
	week(...REST.map((rest, index) => days[index] ?? rest));

const passes = (
	days: WeekInput,
	condition: Condition,
	neighbours: { prev?: WeekInput; next?: WeekInput } = {},
) => {
	const result = validateWeek(days, [condition], neighbours, scopeLabel);
	return result.results[0]?.pass;
};

describe("the default rule, when a plan type has no rules", () => {
	const stateOf = (days: WeekInput) =>
		validateWeek(days, [], {}, scopeLabel).state;

	it("accepts 2 or 3 workouts", () => {
		expect(stateOf(weekWith({ 0: "cardio", 3: "strength" }))).toBe("valid");
		expect(stateOf(weekWith({ 0: "cardio", 2: "cardio", 4: "cardio" }))).toBe(
			"valid",
		);
	});

	it("refuses 4 or more", () => {
		expect(stateOf(weekWith({ 0: "cardio cardio", 2: "cardio cardio" }))).toBe(
			"invalid",
		);
	});

	it("does not judge a week that is still being filled", () => {
		expect(stateOf(weekWith({}))).toBe("neutral");
		expect(stateOf(weekWith({ 5: "cardio" }))).toBe("neutral");
	});

	it("reports the count and names the rule", () => {
		expect(
			validateWeek(weekWith({ 0: "cardio", 1: "cardio" }), [], {}, scopeLabel),
		).toEqual({
			total: 2,
			state: "valid",
			results: [{ label: "Domyślnie: 2–3 treningi w tygodniu", pass: true }],
		});
	});
});

describe("counting", () => {
	it("counts a workout with two types once for each type", () => {
		const days = week("cardio+strength", "strength", "", "", "", "", "");
		expect(passes(days, { type: "minimum", scope: "cardio", value: 1 })).toBe(
			true,
		);
		expect(passes(days, { type: "minimum", scope: "strength", value: 2 })).toBe(
			true,
		);
		// Still two workouts, not three.
		expect(passes(days, { type: "limit", scope: "all", value: 2 })).toBe(true);
		expect(validateWeek(days, [], {}, scopeLabel).total).toBe(2);
	});

	it("treats a missing scope as every workout", () => {
		const days = weekWith({ 0: "cardio", 1: "strength" });
		expect(passes(days, { type: "limit", scope: "", value: 1 })).toBe(false);
	});
});

describe("limit", () => {
	const days = week("cardio cardio", "strength", "", "cardio", "", "", "");

	it("caps the workouts of a scope", () => {
		expect(passes(days, { type: "limit", scope: "all", value: 4 })).toBe(true);
		expect(passes(days, { type: "limit", scope: "all", value: 3 })).toBe(false);
		expect(passes(days, { type: "limit", scope: "cardio", value: 3 })).toBe(
			true,
		);
		expect(passes(days, { type: "limit", scope: "cardio", value: 2 })).toBe(
			false,
		);
	});

	it("can cap training days instead", () => {
		const inDays: Condition = {
			type: "limit",
			scope: "cardio",
			countMode: "days",
		};
		expect(passes(days, { ...inDays, value: 2 })).toBe(true);
		expect(passes(days, { ...inDays, value: 1 })).toBe(false);
	});

	it("still checks the old 'max training days' kind", () => {
		const legacy = { type: "max_dni_treningowych", scope: "all" };
		expect(passes(days, { ...legacy, value: 3 })).toBe(true);
		expect(passes(days, { ...legacy, value: 2 })).toBe(false);
	});
});

describe("minimum", () => {
	const days = weekWith({ 0: "cardio", 2: "strength", 4: "cardio" });

	it("needs at least that many workouts of a scope", () => {
		expect(passes(days, { type: "minimum", scope: "all", value: 3 })).toBe(
			true,
		);
		expect(passes(days, { type: "minimum", scope: "all", value: 4 })).toBe(
			false,
		);
		expect(passes(days, { type: "minimum", scope: "strength", value: 1 })).toBe(
			true,
		);
		expect(passes(days, { type: "minimum", scope: "strength", value: 2 })).toBe(
			false,
		);
	});
});

describe("zakres (range)", () => {
	const days = week("cardio cardio", "", "cardio", "", "", "", "");
	const range = (valueMin: number, valueMax: number): Condition => ({
		type: "zakres",
		scope: "cardio",
		valueMin,
		valueMax,
	});

	it("passes inside the range, ends included", () => {
		expect(passes(days, range(3, 4))).toBe(true);
		expect(passes(days, range(1, 3))).toBe(true);
	});

	it("fails below and above it", () => {
		expect(passes(days, range(4, 5))).toBe(false);
		expect(passes(days, range(0, 2))).toBe(false);
	});

	it("can count training days instead", () => {
		expect(passes(days, { ...range(2, 2), countMode: "days" })).toBe(true);
		expect(passes(days, { ...range(3, 4), countMode: "days" })).toBe(false);
	});
});

describe("odstep (rest days after)", () => {
	const rule: Condition = { type: "odstep", scope: "strength", value: 2 };

	it("passes when the days after are free", () => {
		expect(passes(weekWith({ 0: "strength", 3: "cardio" }), rule)).toBe(true);
	});

	it("fails when any workout follows too soon, whatever its type", () => {
		expect(passes(weekWith({ 0: "strength", 2: "cardio" }), rule)).toBe(false);
	});

	it("only looks after workouts of its scope", () => {
		expect(passes(weekWith({ 0: "cardio", 1: "cardio" }), rule)).toBe(true);
	});

	it("looks into the next week", () => {
		const days = weekWith({ 6: "strength" });
		expect(passes(days, rule, { next: weekWith({ 1: "cardio" }) })).toBe(false);
		expect(passes(days, rule, { next: weekWith({ 2: "cardio" }) })).toBe(true);
	});

	it("does not look back into the previous week", () => {
		const days = weekWith({ 0: "cardio" });
		expect(passes(days, rule, { prev: weekWith({ 6: "strength" }) })).toBe(
			true,
		);
	});

	it("passes at the end of the plan, where no days follow", () => {
		expect(passes(weekWith({ 6: "strength" }), rule)).toBe(true);
	});

	it("asks for nothing when set to zero", () => {
		const none: Condition = { type: "odstep", scope: "all", value: 0 };
		expect(passes(weekWith({ 0: "cardio", 1: "cardio" }), none)).toBe(true);
	});
});

describe("min_odstep (minimum distance between)", () => {
	const atLeast = (value: number): Condition => ({
		type: "min_odstep",
		scope: "cardio",
		value,
	});

	it("counts adjacent days as one day apart", () => {
		const adjacent = weekWith({ 0: "cardio", 1: "cardio" });
		expect(passes(adjacent, atLeast(1))).toBe(true);
		expect(passes(adjacent, atLeast(2))).toBe(false);
	});

	it("passes when the workouts are far enough apart", () => {
		expect(passes(weekWith({ 0: "cardio", 2: "cardio" }), atLeast(2))).toBe(
			true,
		);
		expect(passes(weekWith({ 0: "cardio", 2: "cardio" }), atLeast(3))).toBe(
			false,
		);
	});

	it("ignores workouts of other types in between", () => {
		const days = weekWith({ 0: "cardio", 1: "strength", 3: "cardio" });
		expect(passes(days, atLeast(3))).toBe(true);
	});

	// PLAN.md §9, decision 11: the old planner counted the free days in between
	// when crossing a week boundary, so Sunday + Monday were "0 apart".
	it("measures Sunday + next Monday exactly like Monday + Tuesday", () => {
		const monday = weekWith({ 0: "cardio" });
		const sunday = weekWith({ 6: "cardio" });

		expect(passes(sunday, atLeast(1), { next: monday })).toBe(true);
		expect(passes(monday, atLeast(1), { prev: sunday })).toBe(true);
		expect(passes(sunday, atLeast(2), { next: monday })).toBe(false);
		expect(passes(monday, atLeast(2), { prev: sunday })).toBe(false);
	});

	it("measures the same distance on either side of a week boundary", () => {
		// Saturday + Monday are two days apart, like Monday + Wednesday.
		const saturday = weekWith({ 5: "cardio" });
		const monday = weekWith({ 0: "cardio" });
		expect(passes(saturday, atLeast(2), { next: monday })).toBe(true);
		expect(passes(monday, atLeast(2), { prev: saturday })).toBe(true);
		expect(passes(saturday, atLeast(3), { next: monday })).toBe(false);
		expect(passes(monday, atLeast(3), { prev: saturday })).toBe(false);
	});

	it("compares the nearest workouts across the boundary", () => {
		const days = weekWith({ 2: "cardio" });
		const prev = weekWith({ 0: "cardio", 5: "cardio" });
		const next = weekWith({ 1: "cardio", 6: "cardio" });
		// Saturday to Wednesday is 4 days, Wednesday to next Tuesday is 6.
		expect(passes(days, atLeast(4), { prev, next })).toBe(true);
		expect(passes(days, atLeast(5), { prev })).toBe(false);
		expect(passes(days, atLeast(6), { next })).toBe(true);
		expect(passes(days, atLeast(7), { next })).toBe(false);
	});

	it("passes a week with no workout of the scope", () => {
		const neighbour = weekWith({ 0: "cardio", 6: "cardio" });
		expect(
			passes(weekWith({ 3: "strength" }), atLeast(7), {
				prev: neighbour,
				next: neighbour,
			}),
		).toBe(true);
	});

	it("reads zero as one, the smallest distance there is", () => {
		expect(passes(weekWith({ 0: "cardio", 1: "cardio" }), atLeast(0))).toBe(
			true,
		);
	});
});

describe("max_w_ciagu (at most N within D days)", () => {
	const rule = (value: number, valueDays: number): Condition => ({
		type: "max_w_ciagu",
		scope: "strength",
		value,
		valueDays,
	});

	it("passes when no run of days holds too many", () => {
		const days = weekWith({ 0: "strength", 2: "strength", 4: "strength" });
		expect(passes(days, rule(1, 2))).toBe(true);
		expect(passes(days, rule(2, 3))).toBe(true);
	});

	it("fails when a run inside the week holds too many", () => {
		const days = weekWith({ 0: "strength", 2: "strength", 4: "strength" });
		expect(passes(days, rule(1, 3))).toBe(false);
		expect(passes(weekWith({ 3: "strength strength" }), rule(1, 2))).toBe(
			false,
		);
	});

	it("counts only workouts of its scope", () => {
		const days = weekWith({ 0: "strength", 1: "cardio", 2: "cardio" });
		expect(passes(days, rule(1, 3))).toBe(true);
	});

	it("checks runs that spill into the next week", () => {
		const days = weekWith({ 6: "strength" });
		expect(
			passes(days, rule(1, 2), { next: weekWith({ 0: "strength" }) }),
		).toBe(false);
		expect(
			passes(days, rule(1, 2), { next: weekWith({ 1: "strength" }) }),
		).toBe(true);
		expect(
			passes(days, rule(1, 3), { next: weekWith({ 1: "strength" }) }),
		).toBe(false);
	});

	it("checks runs that start in the previous week", () => {
		const days = weekWith({ 0: "strength" });
		expect(
			passes(days, rule(1, 2), { prev: weekWith({ 6: "strength" }) }),
		).toBe(false);
		expect(
			passes(days, rule(1, 2), { prev: weekWith({ 5: "strength" }) }),
		).toBe(true);
		expect(
			passes(days, rule(1, 3), { prev: weekWith({ 5: "strength" }) }),
		).toBe(false);
	});

	it("does not blame this week for a run that lies wholly in a neighbour", () => {
		const crowded = weekWith({ 2: "strength", 3: "strength" });
		expect(passes(weekWith({}), rule(1, 2), { prev: crowded })).toBe(true);
		expect(passes(weekWith({}), rule(1, 2), { next: crowded })).toBe(true);
	});

	it("uses a window of 2 days when none is given", () => {
		const twoDays: Condition = { type: "max_w_ciagu", scope: "all", value: 1 };
		expect(passes(weekWith({ 0: "cardio", 1: "cardio" }), twoDays)).toBe(false);
		expect(passes(weekWith({ 0: "cardio", 2: "cardio" }), twoDays)).toBe(true);
	});
});

describe("min_dni_odpoczynku (rest days)", () => {
	const rule = (value: number): Condition => ({
		type: "min_dni_odpoczynku",
		scope: "all",
		value,
	});
	const days = weekWith({ 0: "cardio", 1: "strength", 3: "cardio" });

	it("needs that many days without any workout", () => {
		expect(passes(days, rule(4))).toBe(true);
		expect(passes(days, rule(5))).toBe(false);
	});
});

describe("max_w_dniu (per day)", () => {
	const rule = (value: number): Condition => ({
		type: "max_w_dniu",
		scope: "all",
		value,
	});
	const days = weekWith({ 0: "cardio strength", 3: "cardio" });

	it("caps the workouts of any type in one day", () => {
		expect(passes(days, rule(2))).toBe(true);
		expect(passes(days, rule(1))).toBe(false);
	});
});

describe("a partial last week", () => {
	const lastThreeDays = week("cardio", "", "cardio");

	it("counts what it has", () => {
		const result = validateWeek(lastThreeDays, [], {}, scopeLabel);
		expect(result).toMatchObject({ total: 2, state: "valid" });
	});

	it("has only its own days to rest on", () => {
		const rest = (value: number): Condition => ({
			type: "min_dni_odpoczynku",
			scope: "all",
			value,
		});
		expect(passes(lastThreeDays, rest(1))).toBe(true);
		expect(passes(lastThreeDays, rest(2))).toBe(false);
	});

	it("is not checked against days after the end of the plan", () => {
		const restAfter: Condition = { type: "odstep", scope: "cardio", value: 3 };
		expect(passes(week("", "", "cardio"), restAfter)).toBe(true);
		// A window longer than what is left of the plan has nothing to hold.
		const window: Condition = {
			type: "max_w_ciagu",
			scope: "cardio",
			value: 1,
			valueDays: 5,
		};
		expect(passes(lastThreeDays, window)).toBe(true);
	});

	it("is still checked against the week before it", () => {
		const prev = weekWith({ 6: "cardio" });
		const distance: Condition = {
			type: "min_odstep",
			scope: "cardio",
			value: 2,
		};
		expect(passes(lastThreeDays, distance, { prev })).toBe(false);
		const window: Condition = {
			type: "max_w_ciagu",
			scope: "cardio",
			value: 2,
			valueDays: 5,
		};
		expect(passes(lastThreeDays, window, { prev })).toBe(false);
	});

	it("counts as the next week of the one before it", () => {
		const full = weekWith({ 6: "cardio" });
		const restAfter: Condition = { type: "odstep", scope: "cardio", value: 1 };
		expect(passes(full, restAfter, { next: lastThreeDays })).toBe(false);
		expect(passes(full, restAfter, { next: week("", "cardio") })).toBe(true);
	});
});

describe("a week with rules", () => {
	const rules: Condition[] = [
		{ type: "minimum", scope: "all", value: 2 },
		{ type: "limit", scope: "cardio", value: 1 },
	];

	it("is valid when every rule passes", () => {
		const result = validateWeek(
			weekWith({ 0: "cardio", 2: "strength" }),
			rules,
			{},
			scopeLabel,
		);
		expect(result).toEqual({
			total: 2,
			state: "valid",
			results: [
				{ label: "Min. 2 (Wszystkie treningi)", pass: true },
				{ label: "Max 1 (Cardio)", pass: true },
			],
		});
	});

	it("is invalid when one fails, and says which", () => {
		const result = validateWeek(
			weekWith({ 0: "cardio", 2: "cardio" }),
			rules,
			{},
			scopeLabel,
		);
		expect(result.state).toBe("invalid");
		expect(result.results.map((entry) => entry.pass)).toEqual([true, false]);
	});

	it("is never neutral, even when empty", () => {
		expect(validateWeek(weekWith({}), rules, {}, scopeLabel).state).toBe(
			"invalid",
		);
	});

	it("lets a kind it does not know pass, labelled with its name", () => {
		const result = validateWeek(
			weekWith({}),
			[{ type: "co_drugi_dzien", scope: "all", value: 9 }],
			{},
			scopeLabel,
		);
		expect(result).toEqual({
			total: 0,
			state: "valid",
			results: [{ label: "co_drugi_dzien", pass: true }],
		});
	});
});

describe("condition labels", () => {
	const label = (condition: Condition) =>
		formatConditionLabel(condition, scopeLabel);

	it("names each kind the way the planner did", () => {
		expect(label({ type: "limit", scope: "all", value: 4 })).toBe(
			"Max 4 (Wszystkie treningi)",
		);
		expect(
			label({ type: "limit", scope: "cardio", value: 3, countMode: "days" }),
		).toBe("Max 3 dni treningowych (Cardio)");
		expect(label({ type: "minimum", scope: "cardio", value: 2 })).toBe(
			"Min. 2 (Cardio)",
		);
		expect(
			label({ type: "zakres", scope: "strength", valueMin: 1, valueMax: 3 }),
		).toBe("Od 1 do 3 (Siłowy)");
		expect(
			label({
				type: "zakres",
				scope: "all",
				valueMin: 2,
				valueMax: 5,
				countMode: "days",
			}),
		).toBe("Od 2 do 5 dni treningowych (Wszystkie treningi)");
		expect(label({ type: "odstep", scope: "strength", value: 1 })).toBe(
			"Odstęp 1 dni po (Siłowy)",
		);
		expect(label({ type: "min_odstep", scope: "cardio", value: 2 })).toBe(
			"Min. 2 dni między (Cardio)",
		);
		expect(
			label({ type: "max_w_ciagu", scope: "cardio", value: 2, valueDays: 3 }),
		).toBe("Max 2 w ciągu 3 dni (Cardio)");
		expect(label({ type: "min_dni_odpoczynku", scope: "all", value: 2 })).toBe(
			"Min. 2 dni odpoczynku",
		);
		expect(label({ type: "max_w_dniu", scope: "all", value: 1 })).toBe(
			"Max 1 w jednym dniu",
		);
		expect(
			label({ type: "max_dni_treningowych", scope: "all", value: 5 }),
		).toBe("Max 5 dni treningowych (Wszystkie treningi)");
	});

	it("shows the id of a training type the caller cannot name", () => {
		expect(label({ type: "minimum", scope: "type-1712", value: 1 })).toBe(
			"Min. 1 (type-1712)",
		);
	});
});
