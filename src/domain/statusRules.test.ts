import { describe, expect, it } from "vitest";
import {
	restoredAs,
	restoreStatusFor,
	statusMoveProblem,
	wasShown,
} from "./statusRules";

describe("status rules: a draft means not published yet", () => {
	it("knows what the app has shown, from the status or the backend's mark", () => {
		expect(wasShown({ status: "published" })).toBe(true);
		expect(wasShown({ status: "hidden" })).toBe(true);
		expect(wasShown({ status: "draft" })).toBe(false);
		expect(wasShown({ status: "deleted" })).toBe(false);
		expect(wasShown({ status: "deleted", wasPublic: true })).toBe(true);
		expect(wasShown({ status: "draft", wasPublic: true })).toBe(true);
	});

	it("never moves something published or hidden back to a draft", () => {
		for (const status of ["published", "hidden"] as const) {
			expect(statusMoveProblem({ status }, "draft", "challenge")).toMatch(
				/można je ukryć, ale nie cofnąć do szkicu/,
			);
			expect(statusMoveProblem({ status }, "draft", "workout")).toMatch(
				/można go ukryć, ale nie cofnąć do szkicu/,
			);
		}
		// every other move is the backend's to judge
		expect(
			statusMoveProblem({ status: "published" }, "hidden", "workout"),
		).toBeNull();
		expect(
			statusMoveProblem({ status: "hidden" }, "published", "workout"),
		).toBeNull();
		expect(
			statusMoveProblem({ status: "draft" }, "published", "workout"),
		).toBeNull();
		expect(
			statusMoveProblem({ status: "draft" }, "draft", "workout"),
		).toBeNull();
		expect(statusMoveProblem(undefined, "draft", "workout")).toBeNull();
	});

	it("restores as hidden what the app has shown, as a draft what it never has", () => {
		const shown = { status: "deleted" as const, wasPublic: true };
		const never = { status: "deleted" as const, wasPublic: false };
		expect(restoreStatusFor(shown)).toBe("hidden");
		expect(restoreStatusFor(never)).toBe("draft");
		// an older backend says nothing: as before, a draft
		expect(restoreStatusFor({ status: "deleted" })).toBe("draft");

		expect(statusMoveProblem(shown, "hidden", "challenge")).toBeNull();
		expect(statusMoveProblem(shown, "draft", "challenge")).toMatch(
			/jako ukryte/,
		);
		expect(statusMoveProblem(shown, "published", "workout")).toMatch(
			/jako ukryty/,
		);
		expect(statusMoveProblem(never, "draft", "workout")).toBeNull();
		expect(statusMoveProblem(never, "hidden", "workout")).toMatch(/jako szkic/);
	});

	it("says what a restored item came back as", () => {
		expect(
			restoredAs({ status: "deleted", wasPublic: true }, "challenge"),
		).toBe("Wyzwanie przywrócone jako ukryte");
		expect(restoredAs({ status: "deleted" }, "workout")).toBe(
			"Trening przywrócony jako szkic",
		);
	});
});
