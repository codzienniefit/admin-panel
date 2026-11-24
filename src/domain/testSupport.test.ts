import { describe, expect, it } from "vitest";
import { polishMoment } from "./testSupport";

describe("polishMoment, the tests' Polish clock", () => {
	it("is the UTC moment of a Polish wall-clock time, winter and summer", () => {
		expect(polishMoment(2026, 0, 15, 11, 53)).toBe("2026-01-15T10:53:00.000Z");
		expect(polishMoment(2026, 6, 15, 11, 53, 15, 250)).toBe(
			"2026-07-15T09:53:15.250Z",
		);
		expect(polishMoment(2027, 0, 1)).toBe("2026-12-31T23:00:00.000Z");
	});

	it("refuses a time the clock skips", () => {
		expect(() => polishMoment(2026, 2, 29, 2, 30)).toThrow();
	});
});
