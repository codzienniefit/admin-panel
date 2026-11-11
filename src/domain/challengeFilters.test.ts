import { describe, expect, it } from "vitest";
import { blankChallenge, type Challenge } from "@/data/schemas/challenge";
import { filterChallenges, NO_FOLDER, scheduleStats } from "./challengeFilters";

const make = (id: string, patch: Partial<Challenge>): Challenge => ({
	...blankChallenge("2026-01-01T00:00:00.000Z"),
	id,
	etag: "1",
	updatedAtUtc: "2026-01-01T00:00:00.000Z",
	status: "published",
	...patch,
});

const challenges = [
	make("C1", {
		title: "Wiosenny start",
		subtitle: "Cztery tygodnie",
		liveAtUtc: "2026-04-01T13:00:00.000Z",
		addedAtUtc: "2026-03-01T00:00:00.000Z",
		updatedAtUtc: "2026-03-05T00:00:00.000Z",
	}),
	make("C2", {
		title: "Żelazne plecy",
		internalTitle: "do poprawy grafiki",
		categoryId: "main",
		addedAtUtc: "2026-05-01T00:00:00.000Z",
		updatedAtUtc: "2026-05-01T00:00:00.000Z",
	}),
	make("C3", {
		title: "Letnie wyzwanie",
		status: "draft",
		liveAtUtc: "2026-07-01T13:00:00.000Z",
		addedAtUtc: "2026-02-01T00:00:00.000Z",
		updatedAtUtc: "2026-06-01T00:00:00.000Z",
	}),
	make("C4", {
		title: "Stary plan",
		status: "deleted",
		categoryId: "archived",
	}),
	make("C5", {
		title: "Abs w 10 minut",
		status: "hidden",
		addedAtUtc: "2026-01-15T00:00:00.000Z",
		updatedAtUtc: "2026-01-20T00:00:00.000Z",
	}),
];

const idsOf = (filters: Parameters<typeof filterChallenges>[1]) =>
	filterChallenges(challenges, filters).map((challenge) => challenge.id);

describe("challenge list filters", () => {
	it("hides the trash unless asked for it", () => {
		expect(idsOf({})).not.toContain("C4");
		expect(idsOf({ status: "deleted" })).toEqual(["C4"]);
	});

	it("filters by status", () => {
		expect(idsOf({ status: "draft" })).toEqual(["C3"]);
		expect(idsOf({ status: "hidden" })).toEqual(["C5"]);
	});

	it("filters by kind: a premiere date makes a challenge", () => {
		expect(idsOf({ kind: "challenge" }).sort()).toEqual(["C1", "C3"]);
		expect(idsOf({ kind: "main" })).toEqual(["C2"]);
		expect(idsOf({ kind: "plan" })).toEqual(["C5"]);
	});

	it("searches title, subtitle, comment and id, ignoring Polish letters", () => {
		expect(idsOf({ q: "zelazne" })).toEqual(["C2"]);
		expect(idsOf({ q: "tygodnie" })).toEqual(["C1"]);
		expect(idsOf({ q: "grafiki" })).toEqual(["C2"]);
		expect(idsOf({ q: "c5" })).toEqual(["C5"]);
		expect(idsOf({ q: "nie ma takiego" })).toEqual([]);
	});

	it("combines filters", () => {
		expect(
			idsOf({ q: "wyzwanie", kind: "challenge", status: "draft" }),
		).toEqual(["C3"]);
	});

	it("orders by last change unless told otherwise", () => {
		expect(idsOf({})).toEqual(["C3", "C2", "C1", "C5"]);
		expect(idsOf({ sort: "added" })).toEqual(["C2", "C1", "C3", "C5"]);
	});

	it("orders by title the Polish way", () => {
		expect(idsOf({ sort: "title" })).toEqual(["C5", "C3", "C1", "C2"]);
	});

	it("orders by premiere: latest first, plans after", () => {
		expect(idsOf({ sort: "premiere" })).toEqual(["C3", "C1", "C5", "C2"]);
	});

	it("filters by folder, and by having none", () => {
		const folders: Record<string, string> = { C1: "f-a", C2: "f-b" };
		const folderOf = (id: string) => folders[id] ?? null;
		const ids = (folder: string) =>
			filterChallenges(challenges, { folder }, folderOf)
				.map((challenge) => challenge.id)
				.sort();
		expect(ids("f-a")).toEqual(["C1"]);
		expect(ids(NO_FOLDER)).toEqual(["C3", "C5"]);
		expect(ids("f-missing")).toEqual([]);
	});

	it("does not reorder the list it was given", () => {
		const before = challenges.map((challenge) => challenge.id);
		filterChallenges(challenges, { sort: "title" });
		expect(challenges.map((challenge) => challenge.id)).toEqual(before);
	});
});

describe("schedule stats", () => {
	it("counts training days, rest days and workouts", () => {
		expect(
			scheduleStats([
				{ workoutIds: ["W1"] },
				{ workoutIds: [] },
				{ workoutIds: ["W2", "W3"] },
			]),
		).toEqual({ days: 3, trainingDays: 2, restDays: 1, workouts: 3 });
	});

	it("handles an empty plan", () => {
		expect(scheduleStats([])).toEqual({
			days: 0,
			trainingDays: 0,
			restDays: 0,
			workouts: 0,
		});
	});
});
