import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import {
	blankWorkout,
	type NewWorkout,
	type Workout,
} from "@/data/schemas/workout";
import {
	capabilities,
	conflictReply,
	errorReply,
	failure,
	fakeBackend,
	json,
	notFoundReply,
	panelWorkout,
	production,
	type Recorded,
	SWITCHED_OFF,
	tableEtag,
	validationReply,
	wireWorkout,
} from "./testSupport";
import { fromWorkout, toWorkout, workoutsArea, youTubeId } from "./workouts";

// Rows and answers below follow `manageWorkouts` as it is today
// (docs/research/backend-audit.md §1a, §4a, §4c, §9) and as it is planned
// (docs/BACKEND-SCOPE.md B1.2, B2.1, B2.2).

const VIDEO_ID = "dQw4w9WgXcQ";
const PLANNED_ETAG = "W/\"datetime'2026-11-10T09%3A00%3A00.0000000Z'\"";
const NEWER_ETAG = "W/\"datetime'2026-11-11T07%3A30%3A00.0000000Z'\"";

const plannedWorkout = (overrides: Record<string, unknown> = {}) =>
	wireWorkout({ etag: PLANNED_ETAG, status: "published", ...overrides });

/** An audio workout: no video, as `mapToAdminWorkout` sends it. */
const audioWorkout = (overrides: Record<string, unknown> = {}) =>
	wireWorkout({
		id: "W7",
		title: "Medytacja",
		videoUrl: null,
		audioRelativePath: "audio/medytacja.mp3",
		blurHash: null,
		...overrides,
	});

const bodyOf = (request: Recorded) => request.body as Record<string, unknown>;

function thrownBy(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		if (error instanceof ApiError) return error;
		throw error;
	}
	throw new Error("test: expected it to throw");
}

// ─── Reading ────────────────────────────────────────────────────────────────

describe("toWorkout", () => {
	it("reads a row as the backend sends it today", () => {
		expect(toWorkout(wireWorkout())).toEqual({
			id: "W12",
			etag: "t:2026-11-02T10:30:00.000Z",
			title: "Mobilność bioder",
			internalTitle: "[TEST] mobilność",
			status: "published",
			pro: false,
			durationMinutes: 25,
			levelId: "beginner",
			equipmentIds: ["mat"],
			trainingTypeIds: ["mobility"],
			imageRelativePath: "workouts/mobilnosc.webp",
			audioRelativePath: null,
			videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			descriptionFancyContent: [{ type: "Text", content: "Spokojnie." }],
			badgeId: null,
			addedAtUtc: "2026-02-10T09:00:00.000Z",
			// Left out by the backend when unset.
			liveAtUtc: null,
			availableAtUtc: null,
			updatedAtUtc: "2026-11-02T10:30:00.000Z",
			// Kept as they came: the panel has no field for them.
			hidden: false,
			blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		});
	});

	it("reads the status from `hidden` on today's backend", () => {
		expect(toWorkout(wireWorkout({ hidden: true })).status).toBe("hidden");
		expect(toWorkout(wireWorkout({ hidden: false })).status).toBe("published");
	});

	it("reads the backend's own etag and status once it sends them", () => {
		expect(
			toWorkout(plannedWorkout({ status: "draft", hidden: true })),
		).toMatchObject({ etag: PLANNED_ETAG, status: "draft" });
	});

	it("reads a row without a time of change by its fingerprint", () => {
		const row = wireWorkout({ updatedAtUtc: undefined });
		const workout = toWorkout(row);
		expect(workout.etag).toMatch(/^h:[0-9a-f]{8}$/);
		expect(workout.updatedAtUtc).toBe("");
		expect(toWorkout({ ...row, durationMinutes: 26 }).etag).not.toBe(
			workout.etag,
		);
	});

	it("reads a workout whose length was never stored as zero minutes", () => {
		// The backend divides stored seconds; a row without them gives null.
		expect(
			toWorkout(wireWorkout({ durationMinutes: null })).durationMinutes,
		).toBe(0);
		expect(
			toWorkout(wireWorkout({ durationMinutes: undefined })).durationMinutes,
		).toBe(0);
		expect(
			toWorkout(wireWorkout({ durationMinutes: 24.5 })).durationMinutes,
		).toBe(24);
		expect(
			toWorkout(wireWorkout({ durationMinutes: -3 })).durationMinutes,
		).toBe(0);
	});

	it("reads a row that has little more than an id", () => {
		const workout = toWorkout({ id: "W1" });
		expect(workout).toMatchObject({
			id: "W1",
			title: "",
			internalTitle: null,
			status: "published",
			pro: false,
			durationMinutes: 0,
			levelId: null,
			equipmentIds: [],
			trainingTypeIds: [],
			imageRelativePath: null,
			audioRelativePath: null,
			videoUrl: null,
			descriptionFancyContent: [],
			badgeId: null,
			addedAtUtc: "",
			updatedAtUtc: "",
		});
		expect(workout.etag).toMatch(/^h:/);
	});

	it("reads nulls the same as missing fields", () => {
		expect(
			toWorkout({
				id: "W1",
				title: null,
				hidden: null,
				pro: null,
				durationMinutes: null,
				levelId: null,
				equipmentIds: null,
				trainingTypeIds: null,
				addedAtUtc: null,
				updatedAtUtc: null,
				etag: null,
				status: null,
			}),
		).toMatchObject({
			title: "",
			status: "published",
			pro: false,
			durationMinutes: 0,
			levelId: null,
			equipmentIds: [],
			trainingTypeIds: [],
			addedAtUtc: "",
			updatedAtUtc: "",
		});
	});

	it("keeps fields this build does not know", () => {
		const workout = toWorkout(
			wireWorkout({ recordingStatus: "in_editing", format: "premiere" }),
		);
		expect(workout.recordingStatus).toBe("in_editing");
		expect(workout.format).toBe("premiere");
	});

	it("fails loudly for a row without an id", () => {
		const error = thrownBy(() => toWorkout({ title: "Bez id" }));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Trening: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["id"]);
	});

	it("fails loudly, naming the workout and the field", () => {
		const error = thrownBy(() =>
			toWorkout(wireWorkout({ descriptionFancyContent: [{ type: "Text" }] })),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Trening W12: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"descriptionFancyContent.0.content",
		]);
	});
});

describe("youTubeId", () => {
	it.each([
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com/watch?v=dQw4w9WgXcQ",
		"http://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"www.youtube.com/watch?v=dQw4w9WgXcQ",
		"youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
		"https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=42",
		"https://www.youtube.com/embed/dQw4w9WgXcQ",
		"https://www.youtube.com/e/dQw4w9WgXcQ",
		"https://www.youtube.com/v/dQw4w9WgXcQ",
	])("finds the video id in %s", (url) => {
		expect(youTubeId(url)).toBe(VIDEO_ID);
	});

	it("reads ids with a dash and an underscore", () => {
		expect(youTubeId("https://youtu.be/a-b_c-D_E-1")).toBe("a-b_c-D_E-1");
	});

	it.each([
		null,
		undefined,
		"",
		"audio/medytacja.mp3",
		"https://vimeo.com/123456789",
		"https://www.youtube.com/watch?v=short",
		"https://www.youtube.com/",
		"see https://youtu.be/dQw4w9WgXcQ",
	])("finds none in %j", (url) => {
		expect(youTubeId(url)).toBeNull();
	});

	it("misses exactly what the backend's pattern misses", () => {
		// The backend would give these a W-number, not the video id, so the
		// panel must not look for a workout under the video id either.
		expect(youTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
		expect(youTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBeNull();
		expect(youTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBeNull();
	});
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("fromWorkout", () => {
	const NOW = "2026-11-11T10:00:00.000Z";
	const now = () => NOW;

	it("sends the production fields only when the workout has them", () => {
		const without = fromWorkout(toWorkout(wireWorkout({})), SWITCHED_OFF, now);
		const sent = JSON.parse(JSON.stringify(without));
		for (const field of ["recordingStatus", "format", "runningDescription"]) {
			expect(sent).not.toHaveProperty(field);
		}

		const withThem = fromWorkout(
			toWorkout(
				wireWorkout({
					recordingStatus: "in_editing",
					format: "running",
					runningDescription: "5 km spokojnie",
				}),
			),
			SWITCHED_OFF,
			now,
		);
		expect(withThem).toMatchObject({
			recordingStatus: "in_editing",
			format: "running",
			runningDescription: "5 km spokojnie",
		});
		// a value this build does not know is kept, not cleared
		expect(
			fromWorkout(
				toWorkout(wireWorkout({ recordingStatus: "reshoot", format: null })),
				SWITCHED_OFF,
				now,
			),
		).toMatchObject({ recordingStatus: "reshoot", format: null });
	});

	it("sends back what was loaded, field for field", () => {
		const wire = wireWorkout({
			recordingStatus: "published",
			availableAtUtc: "2026-02-12T09:00:00.000Z",
		});
		const body = fromWorkout(toWorkout(wire), SWITCHED_OFF, now);
		expect(body).toMatchObject(wire);
		expect(Object.keys(body).toSorted()).toEqual(
			[...Object.keys(wire), "liveAtUtc"].toSorted(),
		);
		expect(body.liveAtUtc).toBeNull();
	});

	it("never sends the version or the panel's status to today's backend", () => {
		const body = fromWorkout(toWorkout(wireWorkout()), SWITCHED_OFF, now);
		expect(body).not.toHaveProperty("etag");
		expect(body).not.toHaveProperty("status");
	});

	it("keeps the blur hash the picture was loaded with", () => {
		expect(
			fromWorkout(toWorkout(wireWorkout()), SWITCHED_OFF, now).blurHash,
		).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
	});

	it("sends a null blur hash when there is none", () => {
		expect(fromWorkout(blankWorkout(), SWITCHED_OFF, now)).toHaveProperty(
			"blurHash",
			null,
		);
		expect(
			fromWorkout(
				toWorkout(wireWorkout({ blurHash: undefined })),
				SWITCHED_OFF,
				now,
			),
		).toHaveProperty("blurHash", null);
	});

	it("sends an empty video address, never null, which crashes the backend", () => {
		// `extractYouTubeVideoID` calls a string method on it (audit §9.3).
		const body = fromWorkout(toWorkout(audioWorkout()), SWITCHED_OFF, now);
		expect(body.videoUrl).toBe("");
		expect(body.audioRelativePath).toBe("audio/medytacja.mp3");
		expect(fromWorkout(blankWorkout(), SWITCHED_OFF, now).videoUrl).toBe("");
	});

	it("sends an empty picture path where the backend's type wants text", () => {
		expect(
			fromWorkout(blankWorkout(), SWITCHED_OFF, now).imageRelativePath,
		).toBe("");
	});

	it("sends a null id for a new workout, so the backend assigns it", () => {
		const created: NewWorkout = {
			...blankWorkout("2026-11-11T09:00:00.000Z"),
			title: "Nowy trening",
		};
		const body = fromWorkout(created, SWITCHED_OFF, now);
		expect(body).toHaveProperty("id", null);
		expect(body.addedAtUtc).toBe("2026-11-11T09:00:00.000Z");
		expect(body.updatedAtUtc).toBe(NOW);
		expect(body.durationMinutes).toBe(20);
	});

	it("sends the id and the stored time of change of an existing workout", () => {
		const body = fromWorkout(toWorkout(wireWorkout()), SWITCHED_OFF, now);
		expect(body.id).toBe("W12");
		expect(body.updatedAtUtc).toBe("2026-11-02T10:30:00.000Z");
	});

	describe("status", () => {
		const workout = (status: Workout["status"]): Workout => ({
			...toWorkout(wireWorkout({ hidden: status === "published" })),
			status,
		});

		it("is `hidden` alone for a backend without statuses", () => {
			expect(fromWorkout(workout("published"), SWITCHED_OFF, now).hidden).toBe(
				false,
			);
			expect(fromWorkout(workout("hidden"), SWITCHED_OFF, now).hidden).toBe(
				true,
			);
		});

		it("stores a draft as hidden there", () => {
			const body = fromWorkout(workout("draft"), SWITCHED_OFF, now);
			expect(body.hidden).toBe(true);
			expect(body).not.toHaveProperty("status");
		});

		it("refuses to delete there", () => {
			const error = thrownBy(() =>
				fromWorkout(workout("deleted"), SWITCHED_OFF, now),
			);
			expect(error.kind).toBe("validation");
			expect(error.issues[0]?.path).toBe("status");
		});

		it.each([
			["draft", true],
			["published", false],
			["hidden", true],
			["deleted", true],
		] as const)(
			"is %s with hidden=%s for a backend with statuses",
			(status, hidden) => {
				expect(
					fromWorkout(workout(status), ALL_CAPABILITIES, now),
				).toMatchObject({ status, hidden });
			},
		);
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

const TODAY_ON = capabilities({ writes: { workouts: "on" } });
const TEST_ONLY = capabilities({ writes: { workouts: "test-only" } });

/** All `manageWorkouts` POST answers today: the id is inside the sentence. */
const SAVED_TODAY = (id: string) => json({ result: `Workout ${id} updated` });

describe("workoutsArea: reading", () => {
	it("lists every workout with one request", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageWorkouts",
			json([wireWorkout(), audioWorkout({ hidden: true })]),
		);
		const { api } = workoutsArea(backend.transport, SWITCHED_OFF);
		const list = await api.list();
		expect(list.map((workout) => [workout.id, workout.status])).toEqual([
			["W12", "published"],
			["W7", "hidden"],
		]);
		expect(backend.requests).toHaveLength(1);
		expect(backend.only("GET", "manageWorkouts").query).toEqual({});
	});

	it("fails when the answer is not a list", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageWorkouts",
			json({ result: "?" }),
		);
		const { api } = workoutsArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.list());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Lista treningów");
	});

	it("fails the whole list when one row cannot be read", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageWorkouts",
			json([wireWorkout(), { id: 7 }]),
		);
		const { api } = workoutsArea(backend.transport, SWITCHED_OFF);
		expect((await failure(api.list())).kind).toBe("server");
	});

	it("reads one workout by its id", async () => {
		const backend = fakeBackend().on(
			"GET",
			`manageWorkouts/${VIDEO_ID}`,
			json(wireWorkout({ id: VIDEO_ID })),
		);
		const area = workoutsArea(backend.transport, SWITCHED_OFF);
		expect((await area.read(VIDEO_ID)).id).toBe(VIDEO_ID);
		expect(backend.calls()).toEqual([`GET manageWorkouts/${VIDEO_ID}`]);
	});

	it("says so when the workout is not there", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageWorkouts/W99",
			errorReply(404, "Workout W99 not found", { errorCode: null }),
		);
		const area = workoutsArea(backend.transport, SWITCHED_OFF);
		const error = await failure(area.read("W99"));
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Workout W99 not found");
	});
});

describe("workoutsArea: create", () => {
	const audio: NewWorkout = {
		...blankWorkout("2026-11-11T09:00:00.000Z"),
		title: "Medytacja",
		internalTitle: "[TEST] medytacja",
		status: "hidden",
		audioRelativePath: "audio/medytacja.mp3",
		imageRelativePath: "workouts/medytacja.webp",
		levelId: "beginner",
		trainingTypeIds: ["mindfulness"],
	};
	const video: NewWorkout = {
		...audio,
		title: "Mobilność",
		audioRelativePath: null,
		videoUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
	};

	it("posts the workout without an id and reads it by the id in the sentence", async () => {
		const stored = audioWorkout({ id: "W13" });
		const backend = fakeBackend()
			.on("POST", "manageWorkouts", SAVED_TODAY("W13"))
			.on("GET", "manageWorkouts/W13", json(stored));
		const { api } = workoutsArea(backend.transport, TODAY_ON);

		const result = await api.create(audio);

		expect(result).toEqual(toWorkout(stored));
		// No video, so nothing to look up first.
		expect(backend.calls()).toEqual([
			"POST manageWorkouts",
			"GET manageWorkouts/W13",
		]);
		const post = backend.only("POST", "manageWorkouts");
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toMatchObject({
			id: null,
			title: "Medytacja",
			internalTitle: "[TEST] medytacja",
			hidden: true,
			pro: false,
			durationMinutes: 20,
			levelId: "beginner",
			equipmentIds: [],
			trainingTypeIds: ["mindfulness"],
			imageRelativePath: "workouts/medytacja.webp",
			audioRelativePath: "audio/medytacja.mp3",
			videoUrl: "",
			blurHash: null,
			descriptionFancyContent: [],
			addedAtUtc: "2026-11-11T09:00:00.000Z",
		});
		expect(bodyOf(post)).not.toHaveProperty("etag");
		expect(bodyOf(post)).not.toHaveProperty("status");
	});

	describe("with a YouTube address", () => {
		it("first makes sure no workout has that video's id, then creates", async () => {
			const stored = wireWorkout({ id: VIDEO_ID });
			const backend = fakeBackend()
				.on(
					"GET",
					`manageWorkouts/${VIDEO_ID}`,
					errorReply(404, `Workout ${VIDEO_ID} not found`),
					json(stored),
				)
				.on("POST", "manageWorkouts", SAVED_TODAY(VIDEO_ID));
			const { api } = workoutsArea(backend.transport, TODAY_ON);

			const result = await api.create(video);

			expect(result.id).toBe(VIDEO_ID);
			expect(backend.calls()).toEqual([
				`GET manageWorkouts/${VIDEO_ID}`,
				"POST manageWorkouts",
				`GET manageWorkouts/${VIDEO_ID}`,
			]);
			expect(bodyOf(backend.only("POST", "manageWorkouts"))).toMatchObject({
				id: null,
				videoUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
			});
		});

		it("refuses, without posting, when that workout exists: the save would replace it", async () => {
			const backend = fakeBackend().on(
				"GET",
				`manageWorkouts/${VIDEO_ID}`,
				json(wireWorkout({ id: VIDEO_ID, title: "Istniejący trening" })),
			);
			const { api } = workoutsArea(backend.transport, TODAY_ON);

			const error = await failure(api.create(video));

			expect(error.kind).toBe("validation");
			expect(error.message).toContain(VIDEO_ID);
			expect(error.issues).toEqual([
				{ path: "videoUrl", message: error.message },
			]);
			expect(backend.calls()).toEqual([`GET manageWorkouts/${VIDEO_ID}`]);
		});

		it("does not create when it could not find out", async () => {
			const backend = fakeBackend().on(
				"GET",
				`manageWorkouts/${VIDEO_ID}`,
				errorReply(500, `Failed to return workout ${VIDEO_ID}: RestError`),
			);
			const { api } = workoutsArea(backend.transport, TODAY_ON);
			const error = await failure(api.create(video));
			expect(error.kind).toBe("server");
			expect(backend.all("POST", "manageWorkouts")).toEqual([]);
		});

		it("looks for the same id whichever way the address is written", async () => {
			for (const videoUrl of [
				`https://youtu.be/${VIDEO_ID}?t=3`,
				`https://www.youtube.com/embed/${VIDEO_ID}`,
			]) {
				const backend = fakeBackend().on(
					"GET",
					`manageWorkouts/${VIDEO_ID}`,
					json(wireWorkout({ id: VIDEO_ID })),
				);
				const { api } = workoutsArea(backend.transport, TODAY_ON);
				expect((await failure(api.create({ ...video, videoUrl }))).kind).toBe(
					"validation",
				);
			}
		});
	});

	it("takes the saved workout from the answer once the backend sends it", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json(
				audioWorkout({
					id: "W13",
					etag: PLANNED_ETAG,
					status: "draft",
					hidden: true,
				}),
			),
		);
		const { api } = workoutsArea(backend.transport, ALL_CAPABILITIES);
		const result = await api.create({ ...audio, status: "draft" });
		expect(result).toMatchObject({
			id: "W13",
			etag: PLANNED_ETAG,
			status: "draft",
		});
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
		expect(bodyOf(backend.only("POST", "manageWorkouts"))).toMatchObject({
			id: null,
			status: "draft",
			hidden: true,
		});
	});

	it("says so when the save went through but the answer names no workout", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json({ result: "Saved" }),
		);
		const { api } = workoutsArea(backend.transport, TODAY_ON);
		const error = await failure(api.create(audio));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("nie podał jego identyfikatora");
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const { api } = workoutsArea(backend.transport, SWITCHED_OFF);
		for (const workout of [audio, video]) {
			const error = await failure(api.create(workout));
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("„Treningi”");
		}
		expect(backend.requests).toEqual([]);
	});

	it("creates only test items in test-only mode", async () => {
		const backend = fakeBackend()
			.on("POST", "manageWorkouts", SAVED_TODAY("W13"))
			.on("GET", "manageWorkouts/W13", json(audioWorkout({ id: "W13" })));
		const { api } = workoutsArea(backend.transport, TEST_ONLY);

		const error = await failure(
			api.create({ ...video, internalTitle: "mobilność" }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{ path: "internalTitle", message: error.message },
		]);
		// Not even the look-up of the video.
		expect(backend.requests).toEqual([]);

		expect((await api.create(audio)).id).toBe("W13");
	});
});

describe("workoutsArea: save on today's backend", () => {
	const stored = wireWorkout();
	const loaded = toWorkout(stored);
	const edited: Workout = { ...loaded, title: "Mobilność bioder i kolan" };
	const afterSave = wireWorkout({
		title: "Mobilność bioder i kolan",
		updatedAtUtc: "2026-11-11T10:00:05.000Z",
	});

	it("checks the stored version, posts, and reads back what was stored", async () => {
		const backend = fakeBackend()
			.on("GET", "manageWorkouts/W12", json(stored), json(afterSave))
			.on("POST", "manageWorkouts", SAVED_TODAY("W12"));
		const { api } = workoutsArea(backend.transport, TODAY_ON);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toEqual(toWorkout(afterSave));
		// The video's id is not looked up: this workout exists already.
		expect(backend.calls()).toEqual([
			"GET manageWorkouts/W12",
			"POST manageWorkouts",
			"GET manageWorkouts/W12",
		]);
		const post = backend.only("POST", "manageWorkouts");
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toMatchObject({
			...stored,
			title: "Mobilność bioder i kolan",
		});
	});

	it("reads back by the id it saved, whatever the sentence says", async () => {
		const backend = fakeBackend()
			.on("GET", "manageWorkouts/W12", json(stored), json(afterSave))
			.on("POST", "manageWorkouts", json({ result: "Saved" }));
		const { api } = workoutsArea(backend.transport, TODAY_ON);
		expect((await api.save(edited, { etag: loaded.etag })).id).toBe("W12");
	});

	it("sends an audio workout with an empty video address", async () => {
		const audio = audioWorkout();
		const backend = fakeBackend()
			.on("GET", "manageWorkouts/W7", json(audio))
			.on("POST", "manageWorkouts", SAVED_TODAY("W7"));
		const { api } = workoutsArea(backend.transport, TODAY_ON);
		const workout = toWorkout(audio);
		await api.save(workout, { etag: workout.etag });
		expect(bodyOf(backend.only("POST", "manageWorkouts"))).toMatchObject({
			id: "W7",
			videoUrl: "",
			audioRelativePath: "audio/medytacja.mp3",
		});
	});

	it("reports a conflict, without posting, when someone saved in between", async () => {
		const theirs = wireWorkout({
			title: "Tytuł Patryka",
			updatedAtUtc: "2026-11-11T09:59:00.000Z",
		});
		const backend = fakeBackend().on("GET", "manageWorkouts/W12", json(theirs));
		const { api } = workoutsArea(backend.transport, TODAY_ON);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toWorkout(theirs));
		expect(backend.calls()).toEqual(["GET manageWorkouts/W12"]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const { api } = workoutsArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("saves only test items in test-only mode", async () => {
		const real = wireWorkout({ internalTitle: "mobilność" });
		const backend = fakeBackend().on("GET", "manageWorkouts/W12", json(real));
		const { api } = workoutsArea(backend.transport, TEST_ONLY);

		// The stored workout is a real one: adding the mark does not open it.
		const marking = await failure(api.save(edited, { etag: loaded.etag }));
		expect(marking.kind).toBe("validation");
		expect(marking.issues[0]?.path).toBe("internalTitle");
		expect(backend.calls()).toEqual(["GET manageWorkouts/W12"]);

		// A change without the mark is refused before any request.
		const unmarked = await failure(
			api.save({ ...edited, internalTitle: null }, { etag: loaded.etag }),
		);
		expect(unmarked.kind).toBe("validation");
		expect(backend.requests).toHaveLength(1);
	});

	it("reports a crash as the backend failing", async () => {
		const backend = fakeBackend()
			.on("GET", "manageWorkouts/W12", json(stored))
			.on(
				"POST",
				"manageWorkouts",
				errorReply(
					500,
					"Failed to update workout: TypeError: Cannot read properties of null (reading 'match')",
				),
			);
		const { api } = workoutsArea(backend.transport, TODAY_ON);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

describe("workoutsArea: save on a backend with etags", () => {
	const stored = plannedWorkout();
	const loaded = toWorkout(stored);
	const edited: Workout = { ...loaded, title: "Nowy tytuł" };

	it("posts with If-Match and takes the saved workout from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json(plannedWorkout({ title: "Nowy tytuł", etag: NEWER_ETAG })),
		);
		const { api } = workoutsArea(backend.transport, ALL_CAPABILITIES);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({ title: "Nowy tytuł", etag: NEWER_ETAG });
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
		const post = backend.only("POST", "manageWorkouts");
		expect(post.headers["if-match"]).toBe(PLANNED_ETAG);
		expect(bodyOf(post)).toMatchObject({
			id: "W12",
			status: "published",
			hidden: false,
		});
	});

	it("reads the workout when the answer is still only a sentence", async () => {
		const backend = fakeBackend()
			.on("POST", "manageWorkouts", SAVED_TODAY("W12"))
			.on(
				"GET",
				"manageWorkouts/W12",
				json(plannedWorkout({ etag: NEWER_ETAG })),
			);
		const { api } = workoutsArea(backend.transport, ALL_CAPABILITIES);
		expect((await api.save(edited, { etag: loaded.etag })).etag).toBe(
			NEWER_ETAG,
		);
		expect(backend.calls()).toEqual([
			"POST manageWorkouts",
			"GET manageWorkouts/W12",
		]);
	});

	it("turns a 409 with the current workout into a conflict that carries it", async () => {
		const theirs = plannedWorkout({ title: "Tytuł Patryka", etag: NEWER_ETAG });
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			errorReply(409, "Conflict", { current: theirs }),
		);
		const { api } = workoutsArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(409);
		expect(error.current).toEqual(toWorkout(theirs));
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
	});

	it("reads the current workout when the 409 came without it", async () => {
		const theirs = plannedWorkout({ title: "Tytuł Patryka", etag: NEWER_ETAG });
		const backend = fakeBackend()
			.on("POST", "manageWorkouts", errorReply(409, "Conflict"))
			.on("GET", "manageWorkouts/W12", json(theirs));
		const { api } = workoutsArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toWorkout(theirs));
		expect(backend.calls()).toEqual([
			"POST manageWorkouts",
			"GET manageWorkouts/W12",
		]);
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Rows and answers below are the ones the backend's own tests show
// (tests/handlers/manageWorkoutsEditing.test.ts).

/** Produkcja's features, with the section accepted. */
const OPEN = production({ writes: { workouts: "on" } });

const STATUS = (id: string) => `manageWorkouts/${id}/status`;

describe("toWorkout: a row of the panel's route", () => {
	it("reads the version and the status, and keeps the production fields", () => {
		const workout = toWorkout(
			panelWorkout({
				status: "draft",
				hidden: true,
				recordingStatus: "recorded",
				format: "premiere",
			}),
		);
		expect(workout).toMatchObject({
			etag: tableEtag(0),
			status: "draft",
			recordingStatus: "recorded",
			format: "premiere",
			deletedAtUtc: null,
			deletedBy: null,
		});
	});

	it("keeps when and by whom a workout was deleted", () => {
		expect(
			toWorkout(
				panelWorkout({
					status: "deleted",
					hidden: true,
					deletedAtUtc: "2026-11-13T09:00:00.000Z",
					deletedBy: "admin-9",
				}),
			),
		).toMatchObject({
			status: "deleted",
			deletedAtUtc: "2026-11-13T09:00:00.000Z",
			deletedBy: "admin-9",
		});
	});

	it("keeps what a save of a draft said publishing would refuse", () => {
		const workout = toWorkout(
			panelWorkout({
				status: "draft",
				hidden: true,
				warnings: [
					{ path: "levelId", code: "REQUIRED", message: "Wybierz poziom" },
					{
						path: "descriptionFancyContent.0",
						code: "INVALID_CONTENT",
						message: 'Item 1: Content cannot be empty for type "Text".',
					},
				],
			}),
		);
		expect(workout.warnings).toEqual([
			{ path: "levelId", code: "REQUIRED", message: "Wybierz poziom" },
			{
				path: "descriptionFancyContent.0",
				code: "INVALID_CONTENT",
				message: 'Item 1: Content cannot be empty for type "Text".',
			},
		]);
	});

	it("has no warnings on a workout whose save had none", () => {
		expect(toWorkout(panelWorkout({ warnings: [] }))).not.toHaveProperty(
			"warnings",
		);
		expect(toWorkout(panelWorkout())).not.toHaveProperty("warnings");
	});
});

describe("fromWorkout: what a save sends to the panel's route", () => {
	const now = () => "2026-11-13T10:00:00.000Z";

	it("sends the production fields back as they came, so a save keeps them", () => {
		const body = fromWorkout(
			toWorkout(
				panelWorkout({ recordingStatus: "in_editing", format: "live" }),
			),
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			recordingStatus: "in_editing",
			format: "live",
			status: "published",
			hidden: false,
		});
	});

	it("does not invent them for a new workout: left out, the backend stores none", () => {
		const body = fromWorkout(blankWorkout(), OPEN, now);
		expect(body).not.toHaveProperty("recordingStatus");
		expect(body).not.toHaveProperty("format");
		expect(body.status).toBe("draft");
	});

	it("never sends back what the backend keeps about the workout itself", () => {
		const body = fromWorkout(
			toWorkout(
				panelWorkout({
					status: "deleted",
					hidden: true,
					deletedAtUtc: "2026-11-13T09:00:00.000Z",
					deletedBy: "admin-9",
					warnings: [
						{ path: "levelId", code: "REQUIRED", message: "Wybierz poziom" },
					],
				}),
			),
			OPEN,
			now,
		);
		for (const field of ["warnings", "deletedAtUtc", "deletedBy", "etag"]) {
			expect(body, field).not.toHaveProperty(field);
		}
	});

	it("clears an emptied field with null", () => {
		const workout = toWorkout(
			panelWorkout({ badgeId: "n_7", internalTitle: "x" }),
		);
		const body = fromWorkout(
			{
				...workout,
				badgeId: null,
				internalTitle: null,
				audioRelativePath: null,
			},
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			badgeId: null,
			internalTitle: null,
			audioRelativePath: null,
		});
	});
});

describe("workoutsArea: reading, in Produkcja as it is", () => {
	it("asks for the bin as well and reads what is in it", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageWorkouts",
			json([
				panelWorkout(),
				panelWorkout({ id: "W13", status: "deleted", hidden: true }),
			]),
		);
		const { api } = workoutsArea(backend.transport, production());
		expect((await api.list()).map((workout) => workout.status)).toEqual([
			"published",
			"deleted",
		]);
		expect(backend.only("GET", "manageWorkouts").query).toEqual({
			includeDeleted: "true",
		});
	});

	it("does not ask for the bin while there are no statuses", async () => {
		const backend = fakeBackend().on("GET", "manageWorkouts", json([]));
		await workoutsArea(
			backend.transport,
			production({ status: false }),
		).api.list();
		expect(backend.only("GET", "manageWorkouts").query).toEqual({});
	});
});

describe("workoutsArea: create, once the section is open", () => {
	const video: NewWorkout = {
		...blankWorkout("2026-11-13T09:00:00.000Z"),
		title: "Mobilność bioder",
		internalTitle: "[TEST] mobilność",
		videoUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
	};

	it("creates from a YouTube address without looking first: the backend never replaces", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json(
				panelWorkout({
					id: VIDEO_ID,
					status: "draft",
					hidden: true,
					warnings: [],
				}),
			),
		);
		const { api } = workoutsArea(backend.transport, OPEN);

		const created = await api.create(video);

		expect(created).toMatchObject({ id: VIDEO_ID, etag: tableEtag(0) });
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
		expect(bodyOf(backend.only("POST", "manageWorkouts"))).toMatchObject({
			id: null,
			status: "draft",
			hidden: true,
		});
	});

	it("shows the backend's words that the video already has a workout", async () => {
		// "is refused with 409 when that video is already in the catalogue".
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			conflictReply(
				`Workout ${VIDEO_ID} already exists for this YouTube video ('Ten już jest'). Edit that workout instead of creating a new one.`,
				panelWorkout({ id: VIDEO_ID, title: "Ten już jest" }),
				"WORKOUT_EXISTS",
				{ existingId: VIDEO_ID },
			),
		);
		const { api } = workoutsArea(backend.transport, OPEN);

		const error = await failure(api.create(video));

		// A refusal, not "someone changed it meanwhile".
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			`Workout ${VIDEO_ID} already exists for this YouTube video ('Ten już jest'). Edit that workout instead of creating a new one.`,
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.current).toBeUndefined();
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
	});

	it("still looks first while the backend does not speak the editing contract", async () => {
		const backend = fakeBackend().on(
			"GET",
			`manageWorkouts/${VIDEO_ID}`,
			json(panelWorkout({ id: VIDEO_ID })),
		);
		const { api } = workoutsArea(
			backend.transport,
			production({ etag: false, writes: { workouts: "on" } }),
		);
		const error = await failure(api.create(video));
		expect(error.kind).toBe("validation");
		expect(backend.calls()).toEqual([`GET manageWorkouts/${VIDEO_ID}`]);
	});

	it("reports the problems of a refused create at their fields", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			validationReply(
				[
					{ path: "title", code: "REQUIRED", message: "Nazwa jest wymagana" },
					{
						path: "recordingStatus",
						code: "INVALID_VALUE",
						message:
							"recordingStatus musi być jedną z wartości: not_recorded, recorded, in_editing, published, live",
					},
				],
				"Nazwa jest wymagana\nrecordingStatus musi być jedną z wartości: not_recorded, recorded, in_editing, published, live",
			),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.create({ ...video, title: "" }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"title",
			"recordingStatus",
		]);
	});
});

describe("workoutsArea: save, once the section is open", () => {
	const stored = panelWorkout();
	const loaded = toWorkout(stored);
	const edited: Workout = { ...loaded, title: "Nowy tytuł" };

	async function afterList(rows: unknown[] = [stored]) {
		const backend = fakeBackend().on("GET", "manageWorkouts", json(rows));
		const { api } = workoutsArea(backend.transport, OPEN);
		const list = await api.list();
		return { backend, api, list };
	}

	it("posts once, with If-Match, and takes the saved workout from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json(
				panelWorkout({ title: "Nowy tytuł", etag: tableEtag(1), warnings: [] }),
			),
		);
		const { api } = workoutsArea(backend.transport, OPEN);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({ title: "Nowy tytuł", etag: tableEtag(1) });
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
		expect(backend.only("POST", "manageWorkouts").headers["if-match"]).toBe(
			tableEtag(0),
		);
	});

	it("turns a stale version into a conflict that carries the stored workout", async () => {
		const theirs = panelWorkout({
			title: "Ktoś inny zdążył",
			etag: tableEtag(1),
		});
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			conflictReply("Trening został zmieniony w międzyczasie", theirs),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(error.message).toBe("Trening został zmieniony w międzyczasie");
		expect(error.current).toEqual(toWorkout(theirs));
	});

	it("reports a workout that is gone as not found", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			notFoundReply("Workout W12 not found"),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
	});

	it("changes a status with the status call when nothing else was changed", async () => {
		const { backend, api, list } = await afterList();
		const [first] = list as [Workout];
		backend.on(
			"POST",
			STATUS("W12"),
			json(
				panelWorkout({ status: "hidden", hidden: true, etag: tableEtag(1) }),
			),
		);

		const result = await api.save(
			{ ...first, status: "hidden" },
			{ etag: first.etag },
		);

		expect(result.status).toBe("hidden");
		expect(backend.calls()).toEqual([
			"GET manageWorkouts",
			`POST ${STATUS("W12")}`,
		]);
		const post = backend.only("POST", STATUS("W12"));
		expect(bodyOf(post)).toEqual({ status: "hidden" });
		expect(post.headers["if-match"]).toBe(tableEtag(0));
	});

	it("sends the whole workout when anything else changed with the status", async () => {
		const { backend, api, list } = await afterList();
		const [first] = list as [Workout];
		backend.on(
			"POST",
			"manageWorkouts",
			json(panelWorkout({ etag: tableEtag(1) })),
		);
		await api.save(
			{ ...first, status: "hidden", durationMinutes: 30 },
			{ etag: first.etag },
		);
		expect(backend.calls()).toEqual([
			"GET manageWorkouts",
			"POST manageWorkouts",
		]);
	});

	it("deletes with the status call, and keeps the workout as it was stored", async () => {
		const backend = fakeBackend().on(
			"POST",
			STATUS("W12"),
			json(
				panelWorkout({
					status: "deleted",
					hidden: true,
					deletedAtUtc: "2026-11-13T10:01:00.000Z",
					deletedBy: "uid-ada",
					recordingStatus: "recorded",
					etag: tableEtag(1),
				}),
			),
		);
		const { api } = workoutsArea(backend.transport, OPEN);

		const result = await api.save(
			{ ...loaded, status: "deleted", title: "Zmiana razem z usunięciem" },
			{ etag: loaded.etag },
		);

		expect(result).toMatchObject({
			status: "deleted",
			title: "Mobilność bioder",
			deletedBy: "uid-ada",
		});
		expect(bodyOf(backend.only("POST", STATUS("W12")))).toEqual({
			status: "deleted",
		});
	});

	it("refuses a delete while challenges use the workout, in the backend's words", async () => {
		const backend = fakeBackend().on(
			"POST",
			STATUS("W12"),
			conflictReply(
				"Trening jest używany w wyzwaniach: Plan A (C1), Szkic C (C3)",
				stored,
				"IN_USE",
				{
					usedBy: [
						{ id: "C1", title: "Plan A", status: "published" },
						{ id: "C3", title: "Szkic C", status: "draft" },
					],
				},
			),
		);
		const { api } = workoutsArea(backend.transport, OPEN);

		const error = await failure(
			api.save({ ...loaded, status: "deleted" }, { etag: loaded.etag }),
		);

		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			"Trening jest używany w wyzwaniach: Plan A (C1), Szkic C (C3)",
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		// Not a conflict: the stored workout is not read again or merged.
		expect(backend.calls()).toEqual([`POST ${STATUS("W12")}`]);
	});

	it("refuses the way back to a draft the same way, through a full save too", async () => {
		// "cannot go back to a draft while a challenge the app can see uses it".
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			conflictReply(
				"Trening jest w opublikowanych wyzwaniach, więc nie może wrócić do szkicu: Plan A (C1)",
				stored,
				"IN_USE",
				{ usedBy: [{ id: "C1", title: "Plan A", status: "published" }] },
			),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.save(
				{ ...edited, status: "draft" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe(
			"Trening jest w opublikowanych wyzwaniach, więc nie może wrócić do szkicu: Plan A (C1)",
		);
	});

	it("turns a stale version on the status call into a conflict", async () => {
		const theirs = panelWorkout({
			title: "Ktoś inny zdążył",
			etag: tableEtag(1),
		});
		const backend = fakeBackend().on(
			"POST",
			STATUS("W12"),
			conflictReply("Trening został zmieniony w międzyczasie", theirs),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.save(
				{ ...loaded, status: "deleted" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toWorkout(theirs));
	});

	it("says what a restored workout came back without", async () => {
		const binned = panelWorkout({ status: "deleted", hidden: true });
		const { backend, api, list } = await afterList([binned]);
		const [first] = list as [Workout];
		backend.on(
			"POST",
			STATUS("W12"),
			json(
				panelWorkout({
					status: "draft",
					hidden: true,
					badgeId: null,
					etag: tableEtag(1),
					warnings: [
						{
							path: "badgeId",
							code: "BADGE_DROPPED",
							message:
								"Odznaka została odpięta przy przywracaniu: Badge n_7 is assigned to workout 'Inny' (W9) — cannot mix workouts and challenges",
						},
					],
				}),
			),
		);

		const result = await api.save(
			{ ...first, status: "draft" },
			{ etag: first.etag },
		);

		expect(result.status).toBe("draft");
		expect(result.warnings).toEqual([
			expect.objectContaining({ path: "badgeId", code: "BADGE_DROPPED" }),
		]);
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const { api } = workoutsArea(backend.transport, production());
		for (const run of [
			() => api.save(edited, { etag: loaded.etag }),
			() => api.save({ ...loaded, status: "deleted" }, { etag: loaded.etag }),
			() => api.create({ ...blankWorkout(), internalTitle: "[TEST] x" }),
		]) {
			const error = await failure(run());
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("„Treningi”");
		}
		expect(backend.requests).toEqual([]);
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("fromWorkout: sent exactly as it is to be stored", () => {
	const NOW = "2026-11-13T10:00:00.000Z";
	const now = () => NOW;
	const loaded = toWorkout(panelWorkout());

	it("sends an address, the paths and the ids without the spaces around them", () => {
		// "videoUrl nie może zaczynać się ani kończyć spacją" and its like.
		const body = fromWorkout(
			{
				...loaded,
				videoUrl: ` https://www.youtube.com/watch?v=${VIDEO_ID} `,
				imageRelativePath: "workouts/mobilnosc.webp ",
				levelId: " beginner",
				badgeId: "n_7 ",
			},
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			videoUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
			imageRelativePath: "workouts/mobilnosc.webp",
			levelId: "beginner",
			badgeId: "n_7",
		});
		expect(
			fromWorkout(
				{ ...loaded, videoUrl: null, audioRelativePath: " audio/a.m4a " },
				OPEN,
				now,
			),
		).toMatchObject({ videoUrl: "", audioRelativePath: "audio/a.m4a" });
	});

	it("sends what is only spaces as nothing", () => {
		const body = fromWorkout(
			{
				...loaded,
				videoUrl: "  ",
				audioRelativePath: " ",
				badgeId: " ",
				levelId: "",
			},
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			videoUrl: "",
			audioRelativePath: null,
			badgeId: null,
			levelId: null,
		});
	});

	it("sends each training type and each piece of equipment once", () => {
		const body = fromWorkout(
			{
				...loaded,
				trainingTypeIds: ["mobility", "mobility", ""],
				equipmentIds: ["mat", " mat"],
			},
			OPEN,
			now,
		);
		expect(body.trainingTypeIds).toEqual(["mobility"]);
		expect(body.equipmentIds).toEqual(["mat"]);
	});

	it("says when a new workout was added, and keeps the stored date of one that does not say", () => {
		expect(
			fromWorkout({ ...blankWorkout(""), status: "published" }, OPEN, now)
				.addedAtUtc,
		).toBe(NOW);
		expect(
			fromWorkout({ ...loaded, addedAtUtc: "" }, OPEN, now),
		).not.toHaveProperty("addedAtUtc");
	});

	it("does not put right what is wrong in substance", () => {
		const body = fromWorkout(
			{ ...loaded, title: "Ab", durationMinutes: 500, videoUrl: "youtu.be/x" },
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			title: "Ab",
			durationMinutes: 500,
			videoUrl: "youtu.be/x",
		});
	});

	it("does none of this while the backend does not speak the editing contract", () => {
		const body = fromWorkout(
			{ ...loaded, levelId: " beginner", trainingTypeIds: ["a", "a"] },
			production({ etag: false }),
			now,
		);
		expect(body.levelId).toBe(" beginner");
		expect(body.trainingTypeIds).toEqual(["a", "a"]);
	});
});

describe("workoutsArea: the stricter backend", () => {
	const loaded = toWorkout(panelWorkout());

	it("passes on, at their fields, the rules only the person can meet", async () => {
		// tests/handlers/manageWorkoutsEditing.test.ts: the film twice in the
		// catalogue, a length of more than ten hours.
		const issues = [
			{
				path: "videoUrl",
				code: "DUPLICATE",
				message: "Ten film jest już w katalogu jako „Mobilność bioder” (W3)",
			},
			{
				path: "durationMinutes",
				code: "OUT_OF_RANGE",
				message: "Czas trwania może wynosić najwyżej 600 minut",
			},
			{
				path: "title",
				code: "TOO_SHORT",
				message: "Nazwa musi mieć co najmniej 4 znaki",
			},
		];
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			validationReply(issues, issues.map((issue) => issue.message).join("\n")),
		);
		const error = await failure(
			workoutsArea(backend.transport, OPEN).api.save(
				{ ...loaded, durationMinutes: 700 },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual(
			issues.map(({ path, message }) => ({ path, message })),
		);
	});

	it("says what a new workout is to be", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json(panelWorkout({ id: "W13", status: "draft", hidden: true })),
		);
		await workoutsArea(backend.transport, OPEN).api.create({
			...blankWorkout("2026-11-13T09:00:00.000Z"),
			title: "Nowy",
			internalTitle: "[TEST] nowy",
		});
		expect(bodyOf(backend.only("POST", "manageWorkouts"))).toMatchObject({
			id: null,
			status: "draft",
			hidden: true,
			addedAtUtc: "2026-11-13T09:00:00.000Z",
		});
	});
});

// ─── The backend as tightened once more (third pass) ────────────────────────

describe("fromWorkout: titles, dates and nothing of the panel's own", () => {
	const now = () => "2026-11-13T10:00:00.000Z";
	const loaded = toWorkout(panelWorkout());

	it("sends the title without the spaces around it", () => {
		expect(
			fromWorkout({ ...loaded, title: " Mobilność bioder  " }, OPEN, now).title,
		).toBe("Mobilność bioder");
	});

	it("takes out of a title what nobody can see, and leaves a line break for the backend to refuse", () => {
		expect(
			fromWorkout(
				{ ...loaded, title: "Mobilność\u200b bioder\ufeff" },
				OPEN,
				now,
			).title,
		).toBe("Mobilność bioder");
		expect(
			fromWorkout({ ...loaded, title: "Mobilność\nbioder" }, OPEN, now).title,
		).toBe("Mobilność\nbioder");
	});

	it("sends every date as a full instant or as null, never as an empty text", () => {
		const body = fromWorkout(
			{ ...loaded, liveAtUtc: "", availableAtUtc: "2026-11-20T08:00+01:00" },
			OPEN,
			now,
		);
		expect(body.liveAtUtc).toBeNull();
		expect(body.availableAtUtc).toBe("2026-11-20T07:00:00.000Z");
		expect(body.addedAtUtc).toBe("2026-02-10T09:00:00.000Z");
		// A bare date is not made into a moment here.
		expect(
			fromWorkout({ ...loaded, liveAtUtc: "2026-12-01" }, OPEN, now).liveAtUtc,
		).toBe("2026-12-01");
	});

	it("writes a date out the way the routes of workouts take it, and never makes up a day", () => {
		const body = fromWorkout(
			{
				...loaded,
				liveAtUtc: "2026-12-01T18:00:00.1234567Z",
				availableAtUtc: "2026-02-31T18:00Z",
			},
			OPEN,
			now,
		);
		expect(body.liveAtUtc).toBe("2026-12-01T18:00:00.123Z");
		expect(body.availableAtUtc).toBe("2026-02-31T18:00Z");
	});

	it("sends updatedAtUtc back only as a full instant", () => {
		const sent = (updatedAtUtc: string) =>
			fromWorkout({ ...loaded, updatedAtUtc }, OPEN, now);
		expect(sent("2026-11-13T09:00:00.000Z").updatedAtUtc).toBe(
			"2026-11-13T09:00:00.000Z",
		);
		expect(sent("").updatedAtUtc).toBe(now());
		expect(sent("2026-11-13")).not.toHaveProperty("updatedAtUtc");
		// The switch-off path sends it as it always did.
		expect(
			fromWorkout({ ...loaded, updatedAtUtc: "2026-11-13" }, SWITCHED_OFF, now)
				.updatedAtUtc,
		).toBe("2026-11-13");
	});

	it("gives a new workout no id of its own", () => {
		expect(fromWorkout(blankWorkout(now()), OPEN, now).id).toBeNull();
	});

	it("sends only fields the backend takes or itself returns for a workout", () => {
		// WorkoutUpsertAdminDto and WorkoutResultAdminDto
		// (src/models/dto/internal.ts of the backend).
		const WORKOUT = [
			"id",
			"title",
			"addedAtUtc",
			"liveAtUtc",
			"availableAtUtc",
			"internalTitle",
			"updatedAtUtc",
			"hidden",
			"pro",
			"durationMinutes",
			"imageRelativePath",
			"audioRelativePath",
			"videoUrl",
			"blurHash",
			"levelId",
			"equipmentIds",
			"trainingTypeIds",
			"descriptionFancyContent",
			"badgeId",
			"status",
			"recordingStatus",
			"format",
			"etag",
			"deletedAtUtc",
			"deletedBy",
			"warnings",
		];
		const bodies = [
			fromWorkout(
				toWorkout(
					panelWorkout({
						status: "draft",
						hidden: true,
						recordingStatus: "recorded",
						format: "premiere",
						warnings: [{ path: "levelId", code: "REQUIRED", message: "x" }],
						descriptionFancyContent: [
							{ type: "Text", content: "Spokojnie." },
							{
								type: "Image",
								content: "",
								metadata: {
									imageRelativePath: "workouts/ruch.webp",
									heightToWidthRatio: 0.5,
								},
							},
						],
					}),
				),
				OPEN,
				now,
			),
			fromWorkout({ ...blankWorkout(now()), title: "Nowy" }, OPEN, now),
		];
		for (const body of bodies) {
			expect(Object.keys(body).filter((key) => !WORKOUT.includes(key))).toEqual(
				[],
			);
			for (const block of body.descriptionFancyContent as {
				metadata?: object | null;
			}[]) {
				expect(
					Object.keys(block).filter(
						(key) => !["type", "content", "metadata"].includes(key),
					),
				).toEqual([]);
				if (block.metadata) {
					expect(
						Object.keys(block.metadata).filter(
							(key) =>
								!["imageRelativePath", "heightToWidthRatio"].includes(key),
						),
					).toEqual([]);
				}
			}
		}
		expect(bodies[0]).not.toHaveProperty("warnings");
		expect(bodies[0]).not.toHaveProperty("etag");
	});
});
