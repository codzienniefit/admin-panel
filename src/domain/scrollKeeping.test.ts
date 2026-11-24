import { describe, expect, it } from "vitest";
import { keepsScroll } from "./scrollKeeping";

const ROOT = ["__root__", "/_app"];
const workouts = [...ROOT, "/_app/workouts"];
const workout = [...workouts, "/_app/workouts/$workoutId"];
const newWorkout = [...workouts, "/_app/workouts/new"];
const challenges = [...ROOT, "/_app/challenges", "/_app/challenges/"];
const challenge = [
	...ROOT,
	"/_app/challenges",
	"/_app/challenges/$challengeId",
	"/_app/challenges/$challengeId/",
];
const challengeContent = [
	...ROOT,
	"/_app/challenges",
	"/_app/challenges/$challengeId",
	"/_app/challenges/$challengeId/content",
];

describe("keepsScroll", () => {
	it("keeps the list where it is when an editor opens over it", () => {
		expect(keepsScroll(workouts, workout)).toBe(true);
		expect(keepsScroll(workouts, newWorkout)).toBe(true);
	});

	it("keeps it when the editor closes back to the list", () => {
		expect(keepsScroll(workout, workouts)).toBe(true);
		expect(keepsScroll(newWorkout, workouts)).toBe(true);
	});

	it("keeps it when only the address of the same screen changes", () => {
		// filters, sort, another item in the same editor
		expect(keepsScroll(workouts, workouts)).toBe(true);
		expect(keepsScroll(workout, workout)).toBe(true);
	});

	it("starts at the top on another screen", () => {
		expect(keepsScroll(challenges, challenge)).toBe(false);
		expect(keepsScroll(challenge, challenges)).toBe(false);
		expect(keepsScroll(workouts, challenges)).toBe(false);
		expect(keepsScroll(workout, newWorkout)).toBe(false);
	});

	it("starts at the top when a challenge's tab is another page", () => {
		expect(keepsScroll(challenge, challengeContent)).toBe(false);
	});

	it("starts at the top when nothing is matched", () => {
		expect(keepsScroll([], workouts)).toBe(false);
		expect(keepsScroll(workouts, [])).toBe(false);
	});
});
