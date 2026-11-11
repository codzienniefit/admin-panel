import { describe, expect, it } from "vitest";
import {
	blankPlanning,
	blankVariantPlanning,
	type Planning,
	type PlanType,
} from "@/data/schemas/planning";
import type { PlannerSettings } from "@/data/schemas/settings";
import {
	availablePlanTypes,
	isPrepStatus,
	plannerSettingsIssues,
	planningIssues,
	prepSummary,
	resolveConditions,
} from "./planningRules";

const types = new Set(["cardio"]);
const TONES = ["blue", "red"];

const planType = (
	id: string,
	conditions: PlanType["conditions"] = [],
): PlanType => ({
	id,
	name: id,
	description: "",
	conditions,
});

const settings = (patch: Partial<PlannerSettings> = {}): PlannerSettings => ({
	id: "planner",
	etag: "1",
	updatedAtUtc: "",
	planTypes: [
		planType("balanced", [{ type: "minimum", scope: "all", value: 2 }]),
	],
	trainingTypeStyles: { cardio: { tone: "red", emoji: "🏃" } },
	folders: [{ id: "f1", name: "Archiwum" }],
	...patch,
});

const planning = (change: (draft: Planning) => void = () => {}): Planning => {
	const draft = blankPlanning("C1");
	change(draft);
	return draft;
};

const messages = (document: Planning) =>
	planningIssues(document, types).map((issue) => issue.message);

describe("planning document rules", () => {
	it("accepts a blank document and a filled one", () => {
		expect(messages(planning())).toEqual([]);
		expect(
			messages(
				planning((d) => {
					d.calendarColor = "#22c55e";
					d.scratchpad = ["W1", "W2"];
					d.variants.p1 = {
						...blankVariantPlanning(),
						days: { "1": { note: "ok", tint: "#EF4444" } },
						cards: { "1:W1": { color: "#3b82f6" } },
					};
				}),
			),
		).toEqual([]);
	});

	it("refuses colours that are not #rrggbb, wherever they are", () => {
		expect(
			messages(
				planning((d) => {
					d.calendarColor = "red";
				}),
			),
		).toHaveLength(1);
		const bad = planning((d) => {
			d.variants.p1 = {
				...blankVariantPlanning(),
				days: { "2": { tint: "#12" } },
				cards: { "2:W1": { color: "blue" } },
			};
		});
		expect(messages(bad)).toHaveLength(2);
	});

	it("refuses the same workout twice in the scratchpad", () => {
		expect(
			messages(
				planning((d) => {
					d.scratchpad = ["W1", "W1"];
				}),
			),
		).toHaveLength(1);
	});

	it("refuses a note that is too long", () => {
		const long = planning((d) => {
			d.variants.p1 = {
				...blankVariantPlanning(),
				days: { "1": { note: "a".repeat(2001) } },
			};
		});
		expect(messages(long).join(" ")).toContain("za długa");
	});

	it("checks the challenge's own plan types and its overrides", () => {
		const broken = planning((d) => {
			d.customPlanTypes = [
				planType("mine", [{ type: "limit", scope: "all", value: 50 }]),
			];
			d.conditionOverrides.balanced = [
				{ type: "minimum", scope: "nobody", value: 1 },
			];
		});
		expect(messages(broken)).toHaveLength(2);
	});
});

describe("planner settings rules", () => {
	const issues = (patch: Partial<PlannerSettings>) =>
		plannerSettingsIssues(settings(patch), types, TONES).map((i) => i.message);

	it("accepts the sample settings", () => {
		expect(issues({})).toEqual([]);
	});

	it("needs folder names, unique regardless of case and spaces", () => {
		expect(issues({ folders: [{ id: "a", name: "  " }] })).toHaveLength(1);
		expect(
			issues({
				folders: [
					{ id: "a", name: "Archiwum" },
					{ id: "b", name: " archiwum " },
				],
			}).join(" "),
		).toContain("już istnieje");
	});

	it("refuses a tone the panel does not have and a long emoji", () => {
		expect(
			issues({ trainingTypeStyles: { cardio: { tone: "neon", emoji: "" } } }),
		).toHaveLength(1);
		expect(
			issues({
				trainingTypeStyles: { cardio: { tone: "red", emoji: "abcde" } },
			}),
		).toHaveLength(1);
		// One emoji made of several code points still counts as one or two.
		expect(
			issues({ trainingTypeStyles: { cardio: { tone: "red", emoji: "🧘‍♀️" } } }),
		).toEqual([]);
	});

	it("checks the plan types", () => {
		expect(issues({ planTypes: [planType("a"), planType("a")] })).toHaveLength(
			1,
		);
	});
});

describe("which rules a variant is checked against", () => {
	const global = planType("balanced", [
		{ type: "minimum", scope: "all", value: 2 },
	]);
	const own = planType("balanced", [{ type: "limit", scope: "all", value: 9 }]);

	it("offers the challenge's own plan types first, without duplicates", () => {
		const available = availablePlanTypes(
			{ customPlanTypes: [own, planType("special")] },
			{ planTypes: [global, planType("strength")] },
		);
		expect(available.map((t) => t.id)).toEqual([
			"balanced",
			"special",
			"strength",
		]);
		expect(available[0]).toBe(own);
		expect(availablePlanTypes(undefined, undefined)).toEqual([]);
	});

	it("uses the challenge's override when it has rules, else the plan type's", () => {
		const override = [{ type: "minimum", scope: "all", value: 5 }];
		expect(
			resolveConditions({ conditionOverrides: { balanced: override } }, global),
		).toBe(override);
		expect(
			resolveConditions({ conditionOverrides: { balanced: [] } }, global),
		).toBe(global.conditions);
		expect(resolveConditions({ conditionOverrides: {} }, global)).toBe(
			global.conditions,
		);
		expect(resolveConditions(undefined, undefined)).toEqual([]);
	});
});

describe("preparation status", () => {
	it("counts variants; one without planning has not started", () => {
		const document = planning((d) => {
			d.variants.a = { ...blankVariantPlanning(), prepStatus: "ready" };
			d.variants.b = { ...blankVariantPlanning(), prepStatus: "in_progress" };
		});
		expect(prepSummary(document, ["a", "b", "c"])).toEqual({
			not_started: 1,
			in_progress: 1,
			ready: 1,
		});
		expect(prepSummary(undefined, ["a"])).toEqual({
			not_started: 1,
			in_progress: 0,
			ready: 0,
		});
	});

	it("recognises its three values", () => {
		expect(isPrepStatus("ready")).toBe(true);
		expect(isPrepStatus("done")).toBe(false);
	});
});
