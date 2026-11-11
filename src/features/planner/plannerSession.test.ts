import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "@/data/api";
import { ApiError } from "@/data/api/errors";
import { defaultMockControls, mockControls } from "@/data/api/mock/controls";
import { UNKNOWN_FIELD } from "@/data/api/mock/fixtures";
import {
	challengeSaver,
	challengesCollection,
} from "@/data/collections/challenges";
import { planningCollection, planningSaver } from "@/data/collections/planning";
import type { Challenge } from "@/data/schemas/challenge";
import {
	addToScratchpadStep,
	setDayStep,
	toScratchpadStep,
} from "@/domain/plannerOps";
import {
	AUTOSAVE_WAIT_MS,
	discardStaged,
	dispatchStep,
	plannerHistory,
	redo,
	saveStaged,
	stagedSchedules,
	undo,
} from "./plannerSession";

// The planner's saving, end to end against the in-process mock, no DOM: a
// nested challenge in a collection, debounced autosave, undo, concurrent
// changes (the Phase 0 gate for TanStack DB, docs/PLAN.md §7), and since
// Phase 5 the planning document and staged saves of a published challenge.

const ID = "C1";
const PATH = "p-easy";

const quiet = { ...defaultMockControls, minLatencyMs: 0, maxLatencyMs: 0 };

/** Lets the debounce, the mock latency and every retry run out. */
const settle = () => vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS + 3000);

async function onServer(): Promise<Challenge> {
	const pending = api.challenges.list();
	await vi.advanceTimersByTimeAsync(1000);
	const found = (await pending).find((c) => c.id === ID);
	if (!found) throw new Error("challenge missing on the server");
	return found;
}

function onScreen(): Challenge {
	const found = challengesCollection.get(ID);
	if (!found) throw new Error("challenge missing in the collection");
	return found;
}

const day = (challenge: Challenge, dayIndex: number, pathId = PATH) =>
	challenge.paths
		.find((p) => p.pathId === pathId)
		?.days.find((d) => d.dayIndex === dayIndex)?.workoutIds;

const add = (dayIndex: number, workoutId: string, index = 0) =>
	dispatchStep(ID, [
		{
			type: "add",
			pathId: PATH,
			dayIndex,
			index,
			workoutId,
		},
	]);

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

beforeAll(async () => {
	vi.useFakeTimers();
	mockControls.set(quiet);
	const loaded = Promise.all([
		challengesCollection.preload(),
		planningCollection.preload(),
	]);
	await vi.advanceTimersByTimeAsync(100);
	await loaded;
});

afterEach(async () => {
	vi.restoreAllMocks();
	mockControls.set(quiet);
	await settle();
});

describe("planner autosave on a TanStack DB collection", () => {
	it("shows an edit at once and saves it after the pause", async () => {
		const before = await onServer();
		expect(day(before, 1)).toEqual(["W1"]);
		expect(day(before, 3)).toEqual([]);

		const refused = dispatchStep(ID, [
			{
				type: "move",
				pathId: PATH,
				from: { dayIndex: 1, index: 0 },
				to: { dayIndex: 3, index: 0 },
			},
		]);
		expect(refused).toBeNull();

		// On screen immediately, before anything is sent.
		expect(day(onScreen(), 1)).toEqual([]);
		expect(day(onScreen(), 3)).toEqual(["W1"]);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("dirty");

		await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS - 200);
		expect(day(await onServer(), 3)).toEqual([]);

		await settle();
		const after = await onServer();
		expect(day(after, 1)).toEqual([]);
		expect(day(after, 3)).toEqual(["W1"]);
		expect(after.etag).not.toBe(before.etag);
		expect(onScreen().etag).toBe(after.etag);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("saved");
		// Fields this panel has no schema for went there and back untouched.
		expect(unknownFieldsOf(after)).toEqual(unknownFieldsOf(before));
	});

	it("sends rapid edits as one save", async () => {
		const save = vi.spyOn(api.challenges, "save");
		add(2, "W9");
		await vi.advanceTimersByTimeAsync(300);
		add(2, "W10");
		await vi.advanceTimersByTimeAsync(300);
		add(6, "W11");
		await settle();
		expect(save).toHaveBeenCalledTimes(1);
		const after = await onServer();
		expect(day(after, 2)).toEqual(["W10", "W9", "W2"]);
		expect(day(after, 6)).toEqual(["W11"]);
	});

	it("undoes and redoes through the same save path", async () => {
		const before = day(await onServer(), 7);
		add(7, "W12");
		expect(day(onScreen(), 7)).toEqual(["W12", ...(before ?? [])]);

		undo(ID);
		expect(day(onScreen(), 7)).toEqual(before);
		await settle();
		expect(day(await onServer(), 7)).toEqual(before);

		redo(ID);
		expect(day(onScreen(), 7)).toEqual(["W12", ...(before ?? [])]);
		await settle();
		expect(day(await onServer(), 7)).toEqual(["W12", ...(before ?? [])]);
		expect(plannerHistory.get()[ID]?.redo).toEqual([]);
	});

	it("refuses the same workout twice in a day without saving", async () => {
		const save = vi.spyOn(api.challenges, "save");
		expect(add(7, "W12")).toBe("Ten trening jest już w tym dniu");
		await settle();
		expect(save).not.toHaveBeenCalled();
	});

	it("keeps edits made to the same day while a save is in flight", async () => {
		mockControls.set({ ...quiet, minLatencyMs: 800, maxLatencyMs: 800 });
		add(10, "W3");
		// The pause ends and the first save starts; it takes 800 ms.
		await vi.advanceTimersByTimeAsync(AUTOSAVE_WAIT_MS + 100);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("saving");
		add(10, "W4");
		expect(day(onScreen(), 10)).toEqual(["W4", "W3"]);

		await settle();
		await settle();
		expect(challengeSaver.held.get()).toBeNull();
		expect(day(await onServer(), 10)).toEqual(["W4", "W3"]);
		expect(day(onScreen(), 10)).toEqual(["W4", "W3"]);
	});

	it("merges silently when someone else changed another field", async () => {
		mockControls.set({ ...quiet, conflictNextSave: "otherField" });
		add(13, "W5");
		await settle();

		const after = await onServer();
		expect(after.title).toContain("zmienione przez innego admina");
		expect(day(after, 13)).toEqual(["W5"]);
		expect(onScreen().title).toBe(after.title);
		expect(day(onScreen(), 13)).toEqual(["W5"]);
		expect(challengeSaver.held.get()).toBeNull();
		expect(challengeSaver.status.get()[ID]).toMatchObject({
			phase: "saved",
			mergedWithOthers: true,
		});
	});

	it("holds my edits when someone else changed the same day", async () => {
		const before = day(await onServer(), 4);
		mockControls.set({ ...quiet, conflictNextSave: "sameFields" });
		add(4, "W12");
		const mine = ["W12", ...(before ?? [])];
		expect(day(onScreen(), 4)).toEqual(mine);
		await settle();

		const held = challengeSaver.held.get();
		expect(held).toMatchObject({
			id: ID,
			reason: "conflict",
			conflicts: [`paths[${PATH}].days[4].workoutIds`],
		});
		expect(day(held?.mine as Challenge, 4)).toEqual(mine);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("conflict");

		// The screen shows the server's version; nothing of mine was sent.
		const theirs = day(await onServer(), 4);
		expect(theirs).not.toEqual(mine);
		expect(theirs).not.toContain("W12");
		expect(day(onScreen(), 4)).toEqual(theirs);
		expect(plannerHistory.get()[ID]?.undo).toEqual([]);

		// "Nadpisz moimi zmianami"
		challengeSaver.reapplyHeld("mine");
		expect(day(onScreen(), 4)).toEqual(mine);
		await settle();
		expect(day(await onServer(), 4)).toEqual(mine);
		expect(challengeSaver.held.get()).toBeNull();
	});

	it("holds my edits when the save keeps failing, and retries on request", async () => {
		const before = day(await onServer(), 5);
		const save = vi
			.spyOn(api.challenges, "save")
			.mockRejectedValue(new ApiError("server", "Serwer nie odpowiada"));
		add(5, "W6");
		const mine = ["W6", ...(before ?? [])];
		await settle();

		expect(save).toHaveBeenCalledTimes(3); // one try and two retries
		expect(challengeSaver.held.get()).toMatchObject({
			reason: "error",
			message: "Serwer nie odpowiada",
		});
		expect(day(challengeSaver.held.get()?.mine as Challenge, 5)).toEqual(mine);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("error");
		expect(day(onScreen(), 5)).toEqual(before);

		save.mockRestore();
		challengeSaver.reapplyHeld("mine");
		await settle();
		expect(day(await onServer(), 5)).toEqual(mine);
		expect(challengeSaver.status.get()[ID]?.phase).toBe("saved");
	});
});

// --- since Phase 5 -------------------------------------------------------------

const PUBLISHED = "C2";

async function planningOnServer(id = ID) {
	const pending = api.planning.list();
	await vi.advanceTimersByTimeAsync(1000);
	const found = (await pending).find((p) => p.id === id);
	if (!found) throw new Error("planning missing on the server");
	return found;
}

describe("planning data", () => {
	it("autosaves a day note and keeps unknown fields", async () => {
		const before = await planningOnServer();
		const state = () => ({
			paths: onScreen().paths,
			planning: planningCollection.get(ID),
		});
		expect(
			dispatchStep(ID, setDayStep(state(), PATH, 2, { note: "sprzęt: mata" })),
		).toBeNull();
		expect(planningCollection.get(ID)?.variants[PATH]?.days["2"]?.note).toBe(
			"sprzęt: mata",
		);
		expect(planningSaver.status.get()[ID]?.phase).toBe("dirty");
		await settle();

		const after = await planningOnServer();
		expect(after.variants[PATH]?.days["2"]).toEqual({ note: "sprzęt: mata" });
		expect(after.etag).not.toBe(before.etag);
		expect(unknownFieldsOf(after)).toEqual(unknownFieldsOf(before));
		expect(planningSaver.status.get()[ID]?.phase).toBe("saved");
	});

	it("undoes a step that spans the schedule and the scratchpad together", async () => {
		const state = () => ({
			paths: onScreen().paths,
			planning: planningCollection.get(ID),
		});
		const before = {
			day: [...(day(onScreen(), 2) ?? [])],
			scratchpad: [...(planningCollection.get(ID)?.scratchpad ?? [])],
		};
		const moved = before.day[0];
		expect(moved).toBeDefined();

		expect(
			dispatchStep(
				ID,
				toScratchpadStep(state(), PATH, { dayIndex: 2, index: 0 }),
			),
		).toBeNull();
		expect(day(onScreen(), 2)).toEqual(before.day.slice(1));
		expect(planningCollection.get(ID)?.scratchpad).toEqual([
			...before.scratchpad,
			moved,
		]);

		expect(undo(ID)).toBeNull();
		expect(day(onScreen(), 2)).toEqual(before.day);
		expect(planningCollection.get(ID)?.scratchpad).toEqual(before.scratchpad);
		await settle();
		expect(day(await onServer(), 2)).toEqual(before.day);
		expect((await planningOnServer()).scratchpad).toEqual(before.scratchpad);
	});

	it("refuses a workout that is already in the scratchpad", () => {
		const planning = planningCollection.get(ID);
		const first = planning?.scratchpad[0] ?? "";
		expect(
			dispatchStep(
				ID,
				addToScratchpadStep({ paths: onScreen().paths, planning }, first),
			),
		).toBe("Ten trening jest już w brudnopisie");
	});

	it("holds my planning edits when someone else changed the same note", async () => {
		const state = () => ({
			paths: onScreen().paths,
			planning: planningCollection.get(ID),
		});
		mockControls.set({ ...quiet, conflictNextSave: "sameFields" });
		dispatchStep(ID, setDayStep(state(), PATH, 6, { note: "moja" }));
		await settle();

		const held = planningSaver.held.get();
		expect(held).toMatchObject({ id: ID, reason: "conflict" });
		expect(planningSaver.status.get()[ID]?.phase).toBe("conflict");
		planningSaver.reapplyHeld("mine");
		await settle();
		expect((await planningOnServer()).variants[PATH]?.days["6"]?.note).toBe(
			"moja",
		);
		expect(planningSaver.held.get()).toBeNull();
	});
});

describe("a published challenge", () => {
	const publishedPath = () => {
		const challenge = challengesCollection.get(PUBLISHED);
		const path = challenge?.paths[0];
		if (!challenge || !path) throw new Error("published challenge missing");
		return { challenge, path };
	};
	const serverDay = async (dayIndex: number) => {
		const pending = api.challenges.list();
		await vi.advanceTimersByTimeAsync(1000);
		const { path } = publishedPath();
		return (await pending)
			.find((c) => c.id === PUBLISHED)
			?.paths.find((p) => p.pathId === path.pathId)
			?.days.find((d) => d.dayIndex === dayIndex)?.workoutIds;
	};
	const emptyDay = () => {
		const found = publishedPath().path.days.find(
			(d) => d.workoutIds.length === 0,
		);
		if (!found) throw new Error("no rest day in the sample challenge");
		return found.dayIndex;
	};
	const addThere = (dayIndex: number, workoutId: string) =>
		dispatchStep(PUBLISHED, [
			{
				type: "add",
				pathId: publishedPath().path.pathId,
				dayIndex,
				index: 0,
				workoutId,
			},
		]);
	const screenDay = (dayIndex: number) =>
		publishedPath().path.days.find((d) => d.dayIndex === dayIndex)?.workoutIds;

	it("is sample data in the state this suite expects", () => {
		expect(publishedPath().challenge.status).toBe("published");
	});

	it("does not save schedule changes until asked", async () => {
		const save = vi.spyOn(api.challenges, "save");
		const target = emptyDay();
		expect(addThere(target, "W1")).toBeNull();
		expect(screenDay(target)).toEqual(["W1"]);
		expect(stagedSchedules.get().has(PUBLISHED)).toBe(true);

		await settle();
		expect(save).not.toHaveBeenCalled();
		expect(await serverDay(target)).toEqual([]);

		const saving = saveStaged(PUBLISHED);
		await settle();
		await saving;
		expect(save).toHaveBeenCalledTimes(1);
		expect(await serverDay(target)).toEqual(["W1"]);
		expect(stagedSchedules.get().has(PUBLISHED)).toBe(false);
		expect(challengeSaver.status.get()[PUBLISHED]?.phase).toBe("saved");
	});

	it("puts the plan back when staged changes are discarded", async () => {
		const save = vi.spyOn(api.challenges, "save");
		const target = emptyDay();
		addThere(target, "W2");
		addThere(target, "W3");
		expect(screenDay(target)).toEqual(["W3", "W2"]);

		discardStaged(PUBLISHED);
		expect(screenDay(target)).toEqual([]);
		expect(stagedSchedules.get().has(PUBLISHED)).toBe(false);
		expect(plannerHistory.get()[PUBLISHED]?.undo).toEqual([]);
		expect(challengeSaver.status.get()[PUBLISHED]?.phase).toBe("idle");
		await settle();
		expect(save).not.toHaveBeenCalled();
	});

	it("keeps the changes staged when the server refuses them", async () => {
		const issues = [{ path: "paths", message: "Reguła znana tylko serwerowi" }];
		const save = vi
			.spyOn(api.challenges, "save")
			.mockRejectedValue(new ApiError("validation", "odmowa", { issues }));
		const target = emptyDay();
		addThere(target, "W6");

		const saving = saveStaged(PUBLISHED);
		await settle();
		expect(await saving).toEqual(issues);
		// Still on screen, still waiting to be saved, and nothing is held.
		expect(screenDay(target)).toEqual(["W6"]);
		expect(stagedSchedules.get().has(PUBLISHED)).toBe(true);
		expect(challengeSaver.held.get()).toBeNull();

		// Once the reason is gone, the same changes save.
		save.mockRestore();
		const again = saveStaged(PUBLISHED);
		await settle();
		expect(await again).toBeNull();
		expect(await serverDay(target)).toEqual(["W6"]);
		expect(stagedSchedules.get().has(PUBLISHED)).toBe(false);
	});

	it("undo works inside staged changes and is saved with them", async () => {
		// Earlier tests filled the rest days; any day with room for two will do.
		const roomy = publishedPath().path.days.find(
			(d) => d.workoutIds.length <= 1,
		);
		if (!roomy) throw new Error("no day with room in the sample challenge");
		const target = roomy.dayIndex;
		const before = [...roomy.workoutIds];
		addThere(target, "W4");
		addThere(target, "W5");
		expect(undo(PUBLISHED)).toBeNull();
		expect(screenDay(target)).toEqual(["W4", ...before]);
		const saving = saveStaged(PUBLISHED);
		await settle();
		await saving;
		expect(await serverDay(target)).toEqual(["W4", ...before]);
	});
});

describe("a deleted challenge", () => {
	it("cannot be planned", () => {
		const deleted = [...challengesCollection.values()].find(
			(c) => c.status === "deleted",
		);
		if (!deleted) return;
		expect(
			dispatchStep(deleted.id, [
				{ type: "scratchAdd", index: 0, workoutId: "W1" },
			]),
		).toContain("w koszu");
	});
});
