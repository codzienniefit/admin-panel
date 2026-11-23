import { describe, expect, it } from "vitest";
import { workoutConfigFixture as config } from "@/data/api/mock/configFixtures";
import { blankWorkout, type NewWorkout } from "@/data/schemas/workout";
import {
	DURATION_MAX,
	DURATION_MIN,
	MEDIA_REQUIRED,
	statusChangeFrom,
	workoutIssues,
} from "./workoutRules";

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
				"videoUrl",
			]);
		}
	});

	it("takes a whole number of minutes from 1 to 600, whatever the app's filter offers", () => {
		// The configuration's `duration` is the range of the app's filter by
		// length, not a rule about workouts: one of 5 or of 95 minutes is fine.
		for (const durationMinutes of [1, 5, 10, 90, 95, 600]) {
			expect(
				paths({ ...complete, durationMinutes }),
				String(durationMinutes),
			).toEqual([]);
		}
		for (const durationMinutes of [0, -5, 601, 12.5, Number.NaN]) {
			expect(
				paths({ ...complete, durationMinutes }),
				String(durationMinutes),
			).toEqual(["durationMinutes"]);
		}
		expect(DURATION_MIN).toBe(1);
		expect(DURATION_MAX).toBe(600);
	});

	it("leaves the length of a draft for later", () => {
		expect(paths({ ...complete, status: "draft", durationMinutes: 0 })).toEqual(
			[],
		);
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

	describe("a film or a recording, outside a draft", () => {
		const bare: NewWorkout = { ...complete, videoUrl: null };

		it("lets a draft without either be saved", () => {
			expect(paths({ ...bare, status: "draft" })).toEqual([]);
		});

		it("refuses to publish without either", () => {
			expect(workoutIssues({ ...bare, status: "published" }, config)).toEqual([
				{ path: "videoUrl", message: MEDIA_REQUIRED },
			]);
			expect(MEDIA_REQUIRED).toBe(
				"Dodaj film albo nagranie, żeby opublikować trening",
			);
		});

		it("refuses to hide without either", () => {
			expect(paths({ ...bare, status: "hidden" })).toEqual(["videoUrl"]);
		});

		it("accepts either one", () => {
			for (const status of ["published", "hidden"] as const) {
				expect(paths({ ...bare, status, videoUrl: complete.videoUrl })).toEqual(
					[],
				);
				expect(
					paths({ ...bare, status, audioRelativePath: "audio/plecy.m4a" }),
				).toEqual([]);
			}
		});

		it("does not count a path made only of spaces", () => {
			expect(paths({ ...bare, audioRelativePath: "   " })).toEqual([
				"videoUrl",
			]);
		});

		it("lets a published workout be taken down to hidden, as the status route does", () => {
			const stored = { ...bare, status: "published" as const };
			const hidden = { ...bare, status: "hidden" as const };
			expect(statusChangeFrom(stored, hidden)).toBe("published");
			expect(
				workoutIssues(hidden, config, { statusChangeFrom: "published" }),
			).toEqual([]);
			// Hiding a draft, or hiding with other changes, still needs one.
			expect(
				workoutIssues(hidden, config, { statusChangeFrom: "draft" }),
			).toEqual([{ path: "videoUrl", message: MEDIA_REQUIRED }]);
			expect(
				statusChangeFrom(stored, { ...hidden, title: "Inna nazwa" }),
			).toBeUndefined();
			// Publishing again is not taking down.
			expect(
				workoutIssues(stored, config, { statusChangeFrom: "hidden" }),
			).toEqual([{ path: "videoUrl", message: MEDIA_REQUIRED }]);
		});
	});

	it("asks nothing more of a workout being deleted", () => {
		expect(
			paths({ ...blankWorkout(), title: "Abc", status: "deleted" }),
		).toEqual([]);
	});
});

describe("statusChangeFrom", () => {
	const stored = { ...complete, etag: "3", updatedAtUtc: "2026-11-01" };

	it("is the stored status when only the status changes", () => {
		expect(
			statusChangeFrom(stored, {
				...stored,
				status: "hidden",
				etag: "4",
				updatedAtUtc: "2026-11-02",
			}),
		).toBe("published");
	});

	it("is undefined for a new workout or any other change", () => {
		expect(statusChangeFrom(undefined, complete)).toBeUndefined();
		expect(
			statusChangeFrom(stored, { ...stored, status: "hidden", pro: true }),
		).toBeUndefined();
		expect(
			statusChangeFrom(stored, { ...stored, equipmentIds: ["noeq"] }),
		).toBeUndefined();
	});

	it("ignores a collection row's own bookkeeping", () => {
		expect(
			statusChangeFrom({ ...stored, $key: "W1" } as typeof stored, {
				...stored,
				status: "hidden",
			}),
		).toBe("published");
	});
});
