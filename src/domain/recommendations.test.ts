import { describe, expect, it } from "vitest";
import {
	isDefaultRecommendations,
	startingRecommendations,
	storedRecommendations,
} from "./recommendations";

const DEFAULTS = ["C62", "C34"];

describe("recommended next: the backend's defaults and the challenge's own list", () => {
	it("starts from the challenge's own list, or from the defaults while it has none", () => {
		expect(startingRecommendations(["C25"], DEFAULTS)).toEqual(["C25"]);
		expect(startingRecommendations([], DEFAULTS)).toEqual(DEFAULTS);
		expect(startingRecommendations([], [])).toEqual([]);
	});

	it("stores nothing while the list is exactly the defaults", () => {
		expect(storedRecommendations(["C62", "C34"], DEFAULTS)).toEqual([]);
		expect(isDefaultRecommendations(["C62", "C34"], DEFAULTS)).toBe(true);
	});

	it("stores any real change: another order, one more, one fewer, another one", () => {
		for (const chosen of [
			["C34", "C62"],
			["C62", "C34", "C25"],
			["C62"],
			["C25", "C34"],
		]) {
			expect(storedRecommendations(chosen, DEFAULTS)).toEqual(chosen);
			expect(isDefaultRecommendations(chosen, DEFAULTS)).toBe(false);
		}
	});

	it("an empty list is stored empty, and a challenge without defaults keeps its list", () => {
		expect(storedRecommendations([], DEFAULTS)).toEqual([]);
		expect(storedRecommendations(["C25"], [])).toEqual(["C25"]);
		expect(isDefaultRecommendations([], [])).toBe(false);
	});
});
