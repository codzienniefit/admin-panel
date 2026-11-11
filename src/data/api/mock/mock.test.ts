import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import { blankChallenge } from "@/data/schemas/challenge";
import { blankWorkout } from "@/data/schemas/workout";
import { memoryStorage } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { defaultMockControls, type MockControls } from "./controls";
import { UNKNOWN_FIELD } from "./fixtures";
import { createMockApi } from "./index";
import { SNAPSHOT_KEY } from "./persistence";

// The start of the conformance suite: these expectations hold for ANY
// ApiClient, and will run against the HTTP adapter's read side later.

function setup(overrides: Partial<MockControls> = {}) {
	const controls = createStore<MockControls>({
		...defaultMockControls,
		minLatencyMs: 0,
		maxLatencyMs: 0,
		...overrides,
	});
	const api = createMockApi({ controls, sleep: async () => {}, storage: null });
	return { api, controls };
}

async function first(api: ReturnType<typeof createMockApi>) {
	const [challenge] = await api.challenges.list();
	if (!challenge) throw new Error("fixtures are empty");
	return challenge;
}

function unknownFieldsOf(value: unknown, found: string[] = []): string[] {
	if (Array.isArray(value)) {
		for (const item of value) unknownFieldsOf(item, found);
	} else if (typeof value === "object" && value !== null) {
		for (const [key, inner] of Object.entries(value)) {
			if (key === UNKNOWN_FIELD) found.push(String(inner));
			else unknownFieldsOf(inner, found);
		}
	}
	return found;
}

describe("ApiClient contract", () => {
	it("returns a field this panel has no schema for, at every level", async () => {
		const { api } = setup();
		const challenge = await first(api);
		const found = unknownFieldsOf(challenge);
		expect(found).toContain(`challenge:${challenge.id}`);
		expect(found.some((f) => f.startsWith("path:"))).toBe(true);
		expect(found.some((f) => f.startsWith("day:"))).toBe(true);
	});

	it("keeps unknown fields through a save", async () => {
		const { api } = setup();
		const before = await first(api);
		const saved = await api.challenges.save(
			{ ...before, title: "Zmieniony tytuł" },
			{ etag: before.etag },
		);
		expect(saved.title).toBe("Zmieniony tytuł");
		expect(unknownFieldsOf(saved)).toEqual(unknownFieldsOf(before));
		const reread = (await api.challenges.list()).find(
			(c) => c.id === before.id,
		);
		expect(unknownFieldsOf(reread)).toEqual(unknownFieldsOf(before));
	});

	it("issues a new etag on every save", async () => {
		const { api } = setup();
		const before = await first(api);
		const saved = await api.challenges.save(before, { etag: before.etag });
		expect(saved.etag).not.toBe(before.etag);
	});

	it("rejects a stale etag with the current version", async () => {
		const { api } = setup();
		const before = await first(api);
		const current = await api.challenges.save(
			{ ...before, title: "Pierwszy" },
			{ etag: before.etag },
		);
		const stale = api.challenges.save(
			{ ...before, title: "Drugi" },
			{ etag: before.etag },
		);
		await expect(stale).rejects.toMatchObject({ kind: "conflict", current });
		const stored = (await api.challenges.list()).find(
			(c) => c.id === before.id,
		);
		expect(stored?.title).toBe("Pierwszy");
	});

	it("reports validation problems with field paths", async () => {
		const { api } = setup();
		const before = await first(api);
		const error = await api.challenges
			.save({ ...before, title: "  " }, { etag: before.etag })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			kind: "validation",
			issues: [{ path: "title", message: "Nazwa jest wymagana" }],
		});
	});

	it("serves the configuration that feeds every select", async () => {
		const { api } = setup();
		const [workouts, internal] = await Promise.all([
			api.config.workouts(),
			api.config.internal(),
		]);
		for (const list of [
			workouts.trainingTypes,
			workouts.trainingLevels,
			workouts.challengeLevels,
			workouts.equipmentTypes,
			workouts.challengeGoals,
			workouts.challengeCategories,
			workouts.difficultyLevels,
		]) {
			expect(list.length).toBeGreaterThan(0);
			expect(list[0]).toMatchObject({
				id: expect.any(String),
				title: expect.any(String),
			});
		}
		expect(workouts.duration.fromSeconds).toBeLessThan(
			workouts.duration.toSeconds,
		);
		expect(internal.badgeTypes.length).toBeGreaterThan(0);
		expect(internal.draftMessageTargetGroups.length).toBeGreaterThan(0);
	});

	it("uses only ids the configuration knows", async () => {
		const { api } = setup();
		const config = await api.config.workouts();
		const typeIds = new Set(config.trainingTypes.map((t) => t.id));
		const levelIds = new Set(config.challengeLevels.map((l) => l.id));
		for (const workout of await api.workouts.list()) {
			for (const id of workout.trainingTypeIds) {
				expect(typeIds, `training type of ${workout.id}`).toContain(id);
			}
		}
		for (const challenge of await api.challenges.list()) {
			for (const path of challenge.paths) {
				expect(levelIds, `level of ${challenge.id}`).toContain(path.levelId);
			}
		}
	});

	it("does not let a caller change stored data by reference", async () => {
		const { api } = setup();
		const challenge = await first(api);
		challenge.title = "zmienione lokalnie";
		expect((await first(api)).title).not.toBe("zmienione lokalnie");
	});
});

describe("workouts contract", () => {
	const complete = {
		...blankWorkout("2026-11-10T09:00:00.000Z"),
		title: "Nowy trening mobilności",
		levelId: "beginner",
		trainingTypeIds: ["stretching"],
		imageRelativePath: "workouts/nowy.webp",
		durationMinutes: 25,
	};

	it("assigns the id on create and returns the stored workout", async () => {
		const { api } = setup();
		const before = await api.workouts.list();
		const created = await api.workouts.create({ ...complete, status: "draft" });
		expect(created.id).toMatch(/^W\d+$/);
		expect(before.map((w) => w.id)).not.toContain(created.id);
		expect(created.etag).not.toBe("");
		expect(created.title).toBe(complete.title);
		const after = await api.workouts.list();
		expect(after.find((w) => w.id === created.id)).toEqual(created);
	});

	it("saves an incomplete draft but refuses to publish it", async () => {
		const { api } = setup();
		const draft = await api.workouts.create({
			...blankWorkout(),
			title: "Sam pomysł",
		});
		expect(draft.status).toBe("draft");
		const publish = api.workouts.save(
			{ ...draft, status: "published" },
			{ etag: draft.etag },
		);
		await expect(publish).rejects.toMatchObject({ kind: "validation" });
		const error = await publish.catch((e: ApiError) => e);
		expect((error as ApiError).issues.map((i) => i.path)).toEqual(
			expect.arrayContaining([
				"levelId",
				"trainingTypeIds",
				"imageRelativePath",
			]),
		);
	});

	it("keeps unknown fields of a workout through a save", async () => {
		const { api } = setup();
		const [workout] = await api.workouts.list();
		if (!workout) throw new Error("no workouts");
		const saved = await api.workouts.save(
			{ ...workout, title: "Inna nazwa treningu" },
			{ etag: workout.etag },
		);
		expect(unknownFieldsOf(saved)).toEqual(unknownFieldsOf(workout));
		expect(unknownFieldsOf(workout).length).toBeGreaterThan(1);
	});

	it("refuses a film that another workout already uses", async () => {
		const { api } = setup();
		const taken = (await api.workouts.list()).find((w) => w.videoUrl);
		if (!taken) throw new Error("no workout with a film");
		const error = await api.workouts
			.create({ ...complete, status: "draft", videoUrl: taken.videoUrl })
			.catch((e: ApiError) => e);
		expect(error).toMatchObject({
			kind: "validation",
			issues: [{ path: "videoUrl" }],
		});
	});

	it("will not delete a workout that a challenge uses", async () => {
		const { api } = setup();
		const used = (await api.workouts.list()).find((w) => w.id === "W1");
		if (!used) throw new Error("W1 missing");
		const error = await api.workouts
			.save({ ...used, status: "deleted" }, { etag: used.etag })
			.catch((e: ApiError) => e);
		expect(error).toMatchObject({
			kind: "validation",
			issues: [{ path: "status" }],
		});
		expect((error as ApiError).message).toContain("Wiosenny start");
	});

	it("deletes an unused workout, then only lets it be restored", async () => {
		const { api } = setup();
		const created = await api.workouts.create({
			...complete,
			status: "published",
		});
		const deleted = await api.workouts.save(
			{ ...created, status: "deleted" },
			{ etag: created.etag },
		);
		expect(deleted.status).toBe("deleted");
		expect((await api.workouts.list()).map((w) => w.id)).toContain(created.id);

		await expect(
			api.workouts.save(
				{ ...deleted, title: "Zmiana w koszu" },
				{ etag: deleted.etag },
			),
		).rejects.toMatchObject({ kind: "validation" });

		const restored = await api.workouts.save(
			{ ...deleted, status: "draft" },
			{ etag: deleted.etag },
		);
		expect(restored.status).toBe("draft");
	});

	it("rejects a stale etag for a workout with the current version", async () => {
		const { api } = setup();
		const [workout] = await api.workouts.list();
		if (!workout) throw new Error("no workouts");
		const current = await api.workouts.save(
			{ ...workout, internalTitle: "pierwsza zmiana" },
			{ etag: workout.etag },
		);
		await expect(
			api.workouts.save(
				{ ...workout, internalTitle: "druga zmiana" },
				{ etag: workout.etag },
			),
		).rejects.toMatchObject({ kind: "conflict", current });
	});
});

describe("media contract", () => {
	const file = (bytes = 2000) => new Blob([new Uint8Array(bytes)]);

	it("lists files newest first with a type", async () => {
		const { api } = setup();
		const files = await api.media.list();
		expect(files.length).toBeGreaterThan(100);
		expect(files.some((f) => f.type === "audio")).toBe(true);
		const dates = files.map((f) => f.createdAtUtc);
		expect(dates).toEqual([...dates].sort().reverse());
	});

	it("stores an upload and reports progress", async () => {
		const { api } = setup();
		const progress: number[] = [];
		const result = await api.media.upload(file(), {
			relativePath: "workouts/nowa-grafika.webp",
			onProgress: (fraction) => progress.push(fraction),
		});
		expect(result).toMatchObject({
			relativePath: "workouts/nowa-grafika.webp",
			type: "image",
			pathSanitized: false,
			renamedToAvoidOverwrite: false,
		});
		expect(progress.at(-1)).toBe(1);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
		expect((await api.media.list()).map((f) => f.path)).toContain(
			"workouts/nowa-grafika.webp",
		);
		expect(api.media.urlFor(result.relativePath)).toMatch(/^data:image\/webp/);
	});

	it("cleans up the name and never overwrites", async () => {
		const { api } = setup();
		const first = await api.media.upload(file(), {
			relativePath: "workouts/Moja Grafika.webp",
		});
		expect(first).toMatchObject({
			relativePath: "workouts/moja-grafika.webp",
			pathSanitized: true,
		});
		const second = await api.media.upload(file(), {
			relativePath: "workouts/moja-grafika.webp",
		});
		expect(second).toMatchObject({
			relativePath: "workouts/moja-grafika-1.webp",
			renamedToAvoidOverwrite: true,
		});
	});

	it("refuses a kind of file it does not know", async () => {
		const { api } = setup();
		await expect(
			api.media.upload(file(), { relativePath: "workouts/skrypt.exe" }),
		).rejects.toMatchObject({ kind: "validation" });
	});

	it("gives every path an address without the network", async () => {
		const { api } = setup();
		expect(api.media.urlFor("workouts/cokolwiek.webp")).toMatch(/^data:image/);
		expect(api.media.urlFor("audio/cokolwiek.m4a")).toMatch(/^data:audio/);
	});
});

describe("sample data persistence", () => {
	const controls = () =>
		createStore<MockControls>({
			...defaultMockControls,
			minLatencyMs: 0,
			maxLatencyMs: 0,
		});
	const open = (storage: ReturnType<typeof memoryStorage>) =>
		createMockApi({ controls: controls(), sleep: async () => {}, storage });

	it("keeps edits and uploads across a reload", async () => {
		const storage = memoryStorage();
		const before = open(storage);
		const [workout] = await before.workouts.list();
		if (!workout) throw new Error("no workouts");
		const saved = await before.workouts.save(
			{ ...workout, title: "Zmieniona przed odświeżeniem" },
			{ etag: workout.etag },
		);
		await before.media.upload(new Blob([new Uint8Array(500)]), {
			relativePath: "workouts/trwala.webp",
		});

		const after = open(storage);
		const reloaded = (await after.workouts.list()).find(
			(w) => w.id === workout.id,
		);
		expect(reloaded).toEqual(saved);
		expect((await after.media.list()).map((f) => f.path)).toContain(
			"workouts/trwala.webp",
		);
		expect(after.media.urlFor("workouts/trwala.webp")).toMatch(
			/^data:image\/webp/,
		);

		// A save after the reload must not reuse an etag from before it.
		const again = await after.workouts.save(
			{ ...saved, title: "Po odświeżeniu" },
			{ etag: saved.etag },
		);
		expect(again.etag).not.toBe(saved.etag);
	});

	it("starts from the seed when the stored data is unreadable", async () => {
		const storage = memoryStorage();
		storage.setItem(SNAPSHOT_KEY, "{not json");
		const api = open(storage);
		expect((await api.workouts.list()).length).toBe(150);
	});

	it("loads the large dataset when asked", async () => {
		const stress = createStore<MockControls>({
			...defaultMockControls,
			minLatencyMs: 0,
			maxLatencyMs: 0,
			dataset: "stress",
		});
		const api = createMockApi({
			controls: stress,
			sleep: async () => {},
			storage: null,
		});
		expect((await api.workouts.list()).length).toBe(2000);
		expect((await api.challenges.list()).length).toBe(300);
	});
});

describe("challenges contract", () => {
	it("assigns the id on create", async () => {
		const { api } = setup();
		const created = await api.challenges.create({
			...blankChallenge(),
			title: "Nowe wyzwanie z testu",
		});
		expect(created.id).toMatch(/^C\d+$/);
		expect(created.status).toBe("draft");
		expect((await api.challenges.list()).map((c) => c.id)).toContain(
			created.id,
		);
	});

	it("saves a draft with gaps but refuses to publish it", async () => {
		const { api } = setup();
		const draft = await api.challenges.create({
			...blankChallenge(),
			title: "Sam pomysł",
		});
		const error = await api.challenges
			.save({ ...draft, status: "published" }, { etag: draft.etag })
			.catch((e: ApiError) => e);
		expect(error).toMatchObject({ kind: "validation" });
		expect((error as ApiError).issues.map((i) => i.path)).toEqual(
			expect.arrayContaining(["subtitle", "imageRelativePath", "paths"]),
		);
	});

	it("moves the promoted challenge and keeps it published", async () => {
		const { api } = setup();
		expect((await api.config.internal()).promotedChallengeId).toBe("C2");

		const promoted = (await api.challenges.list()).find((c) => c.id === "C2");
		if (!promoted) throw new Error("C2 missing");
		await expect(
			api.challenges.save(
				{ ...promoted, status: "hidden" },
				{ etag: promoted.etag },
			),
		).rejects.toMatchObject({
			kind: "validation",
			issues: [{ path: "status" }],
		});

		await expect(api.config.setPromotedChallenge("C1")).rejects.toMatchObject({
			kind: "validation",
		});
		await expect(api.config.setPromotedChallenge("C999")).rejects.toMatchObject(
			{
				kind: "validation",
			},
		);

		const cleared = await api.config.setPromotedChallenge(null);
		expect(cleared.promotedChallengeId).toBeNull();
		const hidden = await api.challenges.save(
			{ ...promoted, status: "hidden" },
			{ etag: promoted.etag },
		);
		expect(hidden.status).toBe("hidden");
	});

	it("will not send a workout back to draft while a published challenge uses it", async () => {
		const { api } = setup();
		const used = (await api.workouts.list()).find((w) => w.id === "W10");
		if (!used) throw new Error("W10 missing");
		const error = await api.workouts
			.save({ ...used, status: "draft" }, { etag: used.etag })
			.catch((e: ApiError) => e);
		expect(error).toMatchObject({
			kind: "validation",
			issues: [{ path: "status" }],
		});
		expect((error as ApiError).message).toContain("Mocne plecy w 7 dni");
	});

	it("deletes a challenge, then only lets it be restored", async () => {
		const { api } = setup();
		const draft = await api.challenges.create({
			...blankChallenge(),
			title: "Do usunięcia",
		});
		const deleted = await api.challenges.save(
			{ ...draft, status: "deleted" },
			{ etag: draft.etag },
		);
		await expect(
			api.challenges.save(
				{ ...deleted, title: "Zmiana w koszu" },
				{ etag: deleted.etag },
			),
		).rejects.toMatchObject({ kind: "validation" });
		const restored = await api.challenges.save(
			{ ...deleted, status: "draft" },
			{ etag: deleted.etag },
		);
		expect(restored.status).toBe("draft");
	});
});
