import { describe, expect, it } from "vitest";
import { blankWorkout, type Workout } from "@/data/schemas/workout";
import { challengesUsing, filterWorkouts } from "./workoutFilters";

const make = (id: string, patch: Partial<Workout>): Workout => ({
	...blankWorkout("2026-01-01T00:00:00.000Z"),
	id,
	etag: "1",
	updatedAtUtc: "2026-01-01T00:00:00.000Z",
	status: "published",
	...patch,
});

const workouts = [
	make("W1", {
		title: "Joga na dobry sen",
		trainingTypeIds: ["yoga"],
		levelId: "beginner",
		addedAtUtc: "2026-03-01T00:00:00.000Z",
		updatedAtUtc: "2026-03-02T00:00:00.000Z",
	}),
	make("W2", {
		title: "Siła pośladków",
		internalTitle: "do ponownego nagrania",
		trainingTypeIds: ["strength"],
		levelId: "advanced",
		addedAtUtc: "2026-05-01T00:00:00.000Z",
		updatedAtUtc: "2026-05-01T00:00:00.000Z",
	}),
	make("W3", {
		title: "Łagodne rozciąganie",
		status: "draft",
		trainingTypeIds: ["stretching", "yoga"],
		addedAtUtc: "2026-04-01T00:00:00.000Z",
		updatedAtUtc: "2026-06-01T00:00:00.000Z",
	}),
	make("W4", { title: "Stary trening", status: "deleted" }),
];

const ids = (list: Workout[]) => list.map((w) => w.id);

describe("filterWorkouts", () => {
	it("hides the trash unless it is asked for", () => {
		expect(ids(filterWorkouts(workouts, {}))).not.toContain("W4");
		expect(ids(filterWorkouts(workouts, { status: "deleted" }))).toEqual([
			"W4",
		]);
	});

	it("puts the newest first by default", () => {
		expect(ids(filterWorkouts(workouts, {}))).toEqual(["W2", "W3", "W1"]);
	});

	it("sorts by last change and by name", () => {
		expect(ids(filterWorkouts(workouts, { sort: "updated" }))).toEqual([
			"W3",
			"W2",
			"W1",
		]);
		expect(ids(filterWorkouts(workouts, { sort: "title" }))).toEqual([
			"W1",
			"W3",
			"W2",
		]);
	});

	it("filters by status, type and level", () => {
		expect(ids(filterWorkouts(workouts, { status: "draft" }))).toEqual(["W3"]);
		expect(ids(filterWorkouts(workouts, { type: "yoga" }))).toEqual([
			"W3",
			"W1",
		]);
		expect(ids(filterWorkouts(workouts, { level: "advanced" }))).toEqual([
			"W2",
		]);
	});

	it("searches name, comment and id without Polish characters", () => {
		expect(ids(filterWorkouts(workouts, { q: "lagodne" }))).toEqual(["W3"]);
		expect(ids(filterWorkouts(workouts, { q: "posladkow sila" }))).toEqual([
			"W2",
		]);
		expect(ids(filterWorkouts(workouts, { q: "ponownego" }))).toEqual(["W2"]);
		expect(ids(filterWorkouts(workouts, { q: "w1" }))).toEqual(["W1"]);
		expect(filterWorkouts(workouts, { q: "pływanie" })).toEqual([]);
	});

	it("does not reorder the list it was given", () => {
		const before = ids(workouts);
		filterWorkouts(workouts, { sort: "title" });
		expect(ids(workouts)).toEqual(before);
	});
});

describe("challengesUsing", () => {
	const challenge = (
		id: string,
		status: "published" | "deleted",
		day: string[],
	) => ({
		id,
		status,
		paths: [{ days: [{ workoutIds: day }, { workoutIds: [] }] }],
	});

	it("finds challenges that schedule the workout, ignoring deleted ones", () => {
		const list = [
			challenge("C1", "published", ["W1", "W2"]),
			challenge("C2", "published", ["W3"]),
			challenge("C3", "deleted", ["W1"]),
		];
		expect(challengesUsing(list, "W1").map((c) => c.id)).toEqual(["C1"]);
		expect(challengesUsing(list, "W9")).toEqual([]);
	});
});
