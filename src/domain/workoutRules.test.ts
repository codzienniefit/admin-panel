import { describe, expect, it } from "vitest";
import { workoutConfigFixture as config } from "@/data/api/mock/configFixtures";
import { blankWorkout, type NewWorkout } from "@/data/schemas/workout";
import { workoutIssues } from "./workoutRules";

const complete: NewWorkout = {
	...blankWorkout(),
	title: "Poranna mobilność",
	status: "published",
	levelId: "beginner",
	trainingTypeIds: ["stretching"],
	equipmentIds: ["mat"],
	imageRelativePath: "workouts/mobilnosc.webp",
	durationMinutes: 20,
	videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
};

const paths = (workout: NewWorkout) =>
	workoutIssues(workout, config, { badgeIds: new Set(["n_1"]) }).map(
		(issue) => issue.path,
	);

describe("workout rules", () => {
	it("accepts a complete published workout", () => {
		expect(paths(complete)).toEqual([]);
	});

	it("lets a draft be saved with only a name", () => {
		expect(paths({ ...blankWorkout(), title: "Pomysł" })).toEqual([]);
	});

	it("needs a name even for a draft", () => {
		expect(paths({ ...blankWorkout(), title: "   " })).toEqual(["title"]);
	});

	it("asks for the full set when publishing or hiding", () => {
		for (const status of ["published", "hidden"] as const) {
			expect(paths({ ...blankWorkout(), title: "Abc", status })).toEqual([
				"title",
				"levelId",
				"trainingTypeIds",
				"imageRelativePath",
			]);
		}
	});

	it("keeps the duration inside the configured range", () => {
		expect(paths({ ...complete, durationMinutes: 5 })).toEqual([
			"durationMinutes",
		]);
		expect(paths({ ...complete, durationMinutes: 95 })).toEqual([
			"durationMinutes",
		]);
		expect(paths({ ...complete, durationMinutes: 10 })).toEqual([]);
		expect(paths({ ...complete, durationMinutes: 90 })).toEqual([]);
	});

	it("refuses a film and an audio file together, at any status", () => {
		const both = { ...complete, audioRelativePath: "audio/a.m4a" };
		expect(paths(both)).toEqual(["videoUrl"]);
		expect(paths({ ...both, status: "draft" })).toEqual(["videoUrl"]);
	});

	it("refuses a link that is not a web address", () => {
		expect(paths({ ...complete, videoUrl: "youtube" })).toEqual(["videoUrl"]);
		expect(paths({ ...complete, videoUrl: "javascript:alert(1)" })).toEqual([
			"videoUrl",
		]);
	});

	it("refuses ids the configuration does not know", () => {
		expect(paths({ ...complete, trainingTypeIds: ["boks"] })).toEqual([
			"trainingTypeIds",
		]);
		expect(paths({ ...complete, equipmentIds: ["rower"] })).toEqual([
			"equipmentIds",
		]);
		expect(paths({ ...complete, levelId: "ekspert" })).toEqual(["levelId"]);
		expect(paths({ ...complete, badgeId: "nie-ma" })).toEqual(["badgeId"]);
		expect(paths({ ...complete, badgeId: "n_1" })).toEqual([]);
	});

	it("will not publish a description the app cannot show, but lets a draft keep it", () => {
		const broken = {
			...complete,
			descriptionFancyContent: [
				{ type: "Text", content: "<i>kursywa</i>", metadata: null },
			],
		};
		expect(paths(broken)).toEqual(["descriptionFancyContent"]);
		expect(paths({ ...broken, status: "draft" })).toEqual([]);
	});

	it("does not mind warnings in a description", () => {
		expect(
			paths({
				...complete,
				descriptionFancyContent: [
					{ type: "Text", content: "Plan [AUDIO]", metadata: null },
				],
			}),
		).toEqual([]);
	});

	it("asks nothing more of a workout being deleted", () => {
		expect(
			paths({ ...blankWorkout(), title: "Abc", status: "deleted" }),
		).toEqual([]);
	});
});
