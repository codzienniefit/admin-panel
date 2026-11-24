import { describe, expect, it } from "vitest";
import { currentCall, runInCall } from "./callContext";

describe("runInCall", () => {
	it("names the call only while it starts", async () => {
		expect(currentCall()).toBeNull();
		let seen: number | null = null;
		let later: number | null = 0;
		const answer = await runInCall(7, async () => {
			seen = currentCall();
			await Promise.resolve();
			later = currentCall();
			return "done";
		});
		expect(answer).toBe("done");
		expect(seen).toBe(7);
		// after the first await the call is no longer known
		expect(later).toBeNull();
		expect(currentCall()).toBeNull();
	});

	it("puts the outer call back, also after a throw", () => {
		runInCall(1, () => {
			expect(() =>
				runInCall(2, () => {
					expect(currentCall()).toBe(2);
					throw new Error("x");
				}),
			).toThrow("x");
			expect(currentCall()).toBe(1);
		});
		expect(currentCall()).toBeNull();
	});
});
