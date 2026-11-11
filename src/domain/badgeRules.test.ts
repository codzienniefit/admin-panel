import { describe, expect, it } from "vitest";
import { blankBadge, type NewBadge } from "@/data/schemas/badge";
import {
	assignmentsByBadge,
	type BadgeAssignment,
	type BadgeContext,
	badgeIssues,
	badgeRemovalIssues,
	badgeSummary,
	claimLink,
	describeAssignment,
	describeAssignments,
	isEventBadge,
} from "./badgeRules";

const normal: NewBadge = {
	...blankBadge(),
	name: "Siła charakteru",
	imageRelativePath: "badges/sila-charakteru.webp",
};

const eventBadge: NewBadge = {
	...normal,
	name: "Spotkanie na żywo",
	type: "manual",
	specialCategory: "event",
	claimToken: "SPOTKANIE2026",
	isClaimLinkActive: true,
};

const unassigned: BadgeContext = { assignments: [] };

const paths = (badge: NewBadge, context: BadgeContext = unassigned) =>
	badgeIssues(badge, context).map((issue) => issue.path);

const workouts = [
	{ id: "W1", title: "Poranna joga", status: "published", badgeId: "n_1" },
	{ id: "W2", title: "Stary trening", status: "deleted", badgeId: "n_1" },
	{ id: "W3", title: "Bez odznaki", status: "published", badgeId: null },
] as const;
const challenges = [
	{
		id: "C2",
		title: "Mocne plecy",
		status: "published",
		badgeId: "n_3",
		perfectCompletionBadgeId: "n_3",
	},
	{
		id: "C5",
		title: "Wiosenny start",
		status: "draft",
		badgeId: "n_1",
		perfectCompletionBadgeId: "p_1",
	},
] as const;

describe("badge assignments", () => {
	const byBadge = assignmentsByBadge(workouts, challenges);

	it("finds every workout and challenge that awards a badge", () => {
		expect(byBadge.get("n_1")?.map((a) => `${a.kind}:${a.id}`)).toEqual([
			"challenge:C5",
			"workout:W1",
			"workout:W2",
		]);
		expect(byBadge.get("n_2")).toBeUndefined();
	});

	it("tells finishing from finishing in 100%", () => {
		expect(byBadge.get("n_3")?.map((a) => a.role)).toEqual([
			"completion",
			"perfect",
		]);
		expect(byBadge.get("p_1")?.map((a) => a.role)).toEqual(["perfect"]);
	});

	it("marks what is in the trash, because it can be restored", () => {
		expect(byBadge.get("n_1")?.map((a) => a.deleted)).toEqual([
			false,
			false,
			true,
		]);
	});

	it("describes an assignment in words", () => {
		const [first, second] = byBadge.get("n_3") ?? [];
		if (!first || !second) throw new Error("missing assignments");
		expect(describeAssignment(first)).toBe("Wyzwanie „Mocne plecy”");
		expect(describeAssignment(second)).toBe(
			"Wyzwanie „Mocne plecy”, za wykonanie w 100%",
		);
		expect(describeAssignment(byBadge.get("n_1")?.[2] as BadgeAssignment)).toBe(
			"Trening „Stary trening” (w koszu)",
		);
		expect(describeAssignments(byBadge.get("n_1") ?? [], 2)).toBe(
			"Wyzwanie „Wiosenny start”; Trening „Poranna joga” i jeszcze 1",
		);
	});
});

describe("badge rules", () => {
	it("accepts a complete badge of each kind the panel creates", () => {
		expect(paths(normal)).toEqual([]);
		expect(paths(eventBadge)).toEqual([]);
		expect(
			paths({
				...normal,
				type: "manual",
				specialCategory: "specialTraining",
			}),
		).toEqual([]);
	});

	it("needs a name of at least three characters", () => {
		expect(paths({ ...normal, name: "  " })).toEqual(["name"]);
		expect(paths({ ...normal, name: "Ab" })).toEqual(["name"]);
	});

	it("needs a picture from the badges folder", () => {
		expect(paths({ ...normal, imageRelativePath: "" })).toEqual([
			"imageRelativePath",
		]);
		expect(
			paths({ ...normal, imageRelativePath: "workouts/joga.webp" }),
		).toEqual(["imageRelativePath"]);
	});

	it("creates only the two kinds people make by hand", () => {
		expect(paths({ ...normal, type: "milestone" })).toEqual(["type"]);
		expect(paths({ ...normal, type: "perfections" })).toEqual(["type"]);
		expect(paths({ ...normal, type: "inne" })).toEqual(["type"]);
	});

	it("lets a generated badge be edited but never changes a type", () => {
		const milestone = { ...normal, type: "milestone" };
		expect(
			paths(milestone, { ...unassigned, storedType: "milestone" }),
		).toEqual([]);
		expect(paths(normal, { ...unassigned, storedType: "manual" })).toEqual([
			"type",
		]);
	});

	it("wants a known kind for a manual badge and none for the others", () => {
		expect(paths({ ...normal, type: "manual" })).toEqual(["specialCategory"]);
		expect(
			paths({ ...normal, type: "manual", specialCategory: "prezent" }),
		).toEqual(["specialCategory"]);
		expect(paths({ ...normal, specialCategory: "event" })).toEqual([
			"specialCategory",
		]);
	});

	it("keeps visibility dates in order, and off manual badges", () => {
		const from = "2026-03-01T00:00:00.000Z";
		const till = "2026-04-01T00:00:00.000Z";
		expect(
			paths({ ...normal, activeFromUtc: from, activeTillUtc: till }),
		).toEqual([]);
		expect(
			paths({ ...normal, activeFromUtc: till, activeTillUtc: from }),
		).toEqual(["activeTillUtc"]);
		expect(
			paths({ ...normal, activeFromUtc: from, activeTillUtc: from }),
		).toEqual(["activeTillUtc"]);
		expect(paths({ ...eventBadge, activeFromUtc: from })).toEqual([
			"activeFromUtc",
		]);
	});

	it("checks the claim code of an event badge", () => {
		// Left empty, the server makes one up.
		expect(paths({ ...eventBadge, claimToken: null })).toEqual([]);
		for (const claimToken of [
			"ABC",
			"ZA-DŁUGI KOD",
			"żółw2026",
			"A".repeat(33),
		]) {
			expect(paths({ ...eventBadge, claimToken })).toEqual(["claimToken"]);
		}
		expect(
			paths(eventBadge, {
				...unassigned,
				takenClaimTokens: new Set(["spotkanie2026"]),
			}),
		).toEqual(["claimToken"]);
	});

	it("refuses a claim code on a badge that is not for an event", () => {
		expect(isEventBadge(eventBadge)).toBe(true);
		expect(isEventBadge(normal)).toBe(false);
		expect(paths({ ...normal, claimToken: "KOD12345" })).toEqual([
			"claimToken",
		]);
		expect(
			paths({
				...eventBadge,
				specialCategory: "specialTraining",
				claimToken: null,
			}),
		).toEqual(["claimToken"]);
	});

	it("refuses to hide a badge that is still assigned, and says where", () => {
		const assignments =
			assignmentsByBadge(workouts, challenges).get("n_3") ?? [];
		expect(paths({ ...normal, isHidden: true })).toEqual([]);
		const issues = badgeIssues({ ...normal, isHidden: true }, { assignments });
		expect(issues.map((issue) => issue.path)).toEqual(["isHidden"]);
		expect(issues[0]?.message).toContain("Wyzwanie „Mocne plecy”");
		// Visible, it can stay assigned.
		expect(paths(normal, { assignments })).toEqual([]);
	});

	it("refuses to delete a badge that is still assigned, and says where", () => {
		expect(badgeRemovalIssues([])).toEqual([]);
		const assignments =
			assignmentsByBadge(workouts, challenges).get("n_1") ?? [];
		const [issue] = badgeRemovalIssues(assignments);
		expect(issue?.message).toContain("Trening „Poranna joga”");
		expect(issue?.message).toContain("Wyzwanie „Wiosenny start”");
	});

	it("builds the link the app opens to claim a badge", () => {
		expect(claimLink("SPOTKANIE2026")).toBe(
			"codzienniefit://badge?code=SPOTKANIE2026",
		);
	});
});

describe("badge summary", () => {
	const byBadge = assignmentsByBadge(workouts, challenges);

	it("counts what a normal badge is assigned to", () => {
		expect(badgeSummary(normal, [])).toBe("Nieprzypisana");
		expect(badgeSummary(normal, byBadge.get("n_1") ?? [])).toBe(
			"Przypisana: 2 treningi i 1 wyzwanie",
		);
		// One challenge awarding it twice is still one challenge.
		expect(badgeSummary(normal, byBadge.get("n_3") ?? [])).toBe(
			"Przypisana: 1 wyzwanie",
		);
	});

	it("says how the other kinds are earned", () => {
		expect(
			badgeSummary({ ...normal, type: "milestone", milestoneCount: 25 }, []),
		).toBe("Za 25 powtórzeń");
		expect(badgeSummary({ ...normal, type: "perfections" }, [])).toBe(
			"Za wykonania w 100%",
		);
		expect(badgeSummary(eventBadge, [])).toBe("Do zdobycia kodem: aktywna");
		expect(badgeSummary({ ...eventBadge, isClaimLinkActive: false }, [])).toBe(
			"Do zdobycia kodem: wyłączona",
		);
		expect(
			badgeSummary({ ...eventBadge, specialCategory: "specialTraining" }, []),
		).toBe("Przyznawana ręcznie");
	});
});
