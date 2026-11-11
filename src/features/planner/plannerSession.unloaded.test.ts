import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMockControls, mockControls } from "@/data/api/mock/controls";
import { challengesCollection } from "@/data/collections/challenges";
import { planningCollection } from "@/data/collections/planning";
import { addWorkoutStep, setDayStep } from "@/domain/plannerOps";
import { dispatchStep, plannerHistory } from "./plannerSession";

// The planner before the planning documents have arrived: the challenge is
// on screen, its notes and colours are not yet. Found by the UI tests: a note
// added in that moment used to disappear without a word.

const ID = "C1";
const PATH = "p-easy";

describe("the planner before planning has loaded", () => {
	beforeAll(async () => {
		vi.useFakeTimers();
		mockControls.set({
			...defaultMockControls,
			minLatencyMs: 0,
			maxLatencyMs: 0,
		});
		const loading = challengesCollection.preload();
		await vi.advanceTimersByTimeAsync(1000);
		await loading;
	});

	afterAll(() => {
		vi.useRealTimers();
		mockControls.set(defaultMockControls);
	});

	const state = () => {
		const challenge = challengesCollection.get(ID);
		if (!challenge) throw new Error("challenge missing in the collection");
		return { paths: challenge.paths, planning: planningCollection.get(ID) };
	};

	it("starts with the challenge loaded and its planning document not", () => {
		expect(state().paths.length).toBeGreaterThan(0);
		expect(state().planning).toBeUndefined();
	});

	it("refuses a day note, and says why, instead of losing it", () => {
		const step = setDayStep(state(), PATH, 2, {
			note: "Nagrać ponownie wstęp",
		});
		expect(step).toHaveLength(1);

		expect(dispatchStep(ID, step)).toBe(
			"Notatki tego wyzwania jeszcze się wczytują. Spróbuj za chwilę",
		);
		// Nothing to undo: the step did not happen.
		expect(plannerHistory.get()[ID]?.undo ?? []).toHaveLength(0);
	});

	it("still takes a change to the plan itself", async () => {
		// Day 3 of this plan is a rest day.
		const step = addWorkoutStep(state(), PATH, 3, "W5");
		expect(dispatchStep(ID, step)).toBeNull();
		expect(
			state()
				.paths.find((path) => path.pathId === PATH)
				?.days.find((day) => day.dayIndex === 3)?.workoutIds,
		).toEqual(["W5"]);
		await vi.advanceTimersByTimeAsync(5000);
	});
});
