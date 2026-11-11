import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/lib/storage";

// The module reads the stored list once, when it is first imported. Each
// test therefore puts its storage in place and imports a fresh copy.

const KEY = "cf.recentPlans";

const plan = (challengeId: string, pathId = "p-easy") => ({
	challengeId,
	pathId,
});

async function load(stored?: string) {
	const storage = memoryStorage(stored === undefined ? {} : { [KEY]: stored });
	const writes: string[] = [];
	vi.stubGlobal("localStorage", {
		getItem: storage.getItem,
		removeItem: storage.removeItem,
		setItem(key: string, value: string) {
			writes.push(key);
			storage.setItem(key, value);
		},
	});
	vi.resetModules();
	const { rememberPlan } = await import("./recentPlans");
	const kept = (): unknown => {
		const raw = storage.data.get(KEY);
		return raw === undefined ? undefined : JSON.parse(raw);
	};
	return { rememberPlan, kept, writes };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("recently opened plans", () => {
	it("starts empty and keeps the first plan", async () => {
		const { rememberPlan, kept, writes } = await load();
		expect(kept()).toBeUndefined();

		rememberPlan("C1", "p-easy");

		expect(kept()).toEqual([plan("C1")]);
		expect(writes).toEqual([KEY]);
	});

	it("puts the newest first, ahead of what was stored", async () => {
		const { rememberPlan, kept } = await load(
			JSON.stringify([plan("C1"), plan("C2", "p-hard")]),
		);
		rememberPlan("C3", "p-easy");
		expect(kept()).toEqual([plan("C3"), plan("C1"), plan("C2", "p-hard")]);
	});

	it("moves a plan opened again to the front instead of listing it twice", async () => {
		const { rememberPlan, kept } = await load(
			JSON.stringify([plan("C1"), plan("C2"), plan("C3")]),
		);
		rememberPlan("C3", "p-easy");
		expect(kept()).toEqual([plan("C3"), plan("C1"), plan("C2")]);
	});

	it("writes nothing when the plan is already the newest", async () => {
		const { rememberPlan, kept, writes } = await load(
			JSON.stringify([plan("C1"), plan("C2")]),
		);
		rememberPlan("C1", "p-easy");
		expect(writes).toEqual([]);
		expect(kept()).toEqual([plan("C1"), plan("C2")]);
	});

	it("treats two variants of one challenge as two plans", async () => {
		const { rememberPlan, kept } = await load();
		rememberPlan("C1", "p-easy");
		rememberPlan("C1", "p-hard");
		rememberPlan("C2", "p-easy");
		expect(kept()).toEqual([
			plan("C2", "p-easy"),
			plan("C1", "p-hard"),
			plan("C1", "p-easy"),
		]);
	});

	it("keeps the six newest", async () => {
		const { rememberPlan, kept } = await load();
		for (const id of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
			rememberPlan(id, "p-easy");
		}
		expect(kept()).toEqual(
			["C7", "C6", "C5", "C4", "C3", "C2"].map((id) => plan(id)),
		);
	});

	it("reads no more than six from a longer stored list", async () => {
		const stored = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"].map((id) =>
			plan(id),
		);
		const { rememberPlan, kept } = await load(JSON.stringify(stored));
		rememberPlan("C9", "p-easy");
		expect(kept()).toEqual(
			["C9", "C1", "C2", "C3", "C4", "C5"].map((id) => plan(id)),
		);
	});

	it("skips stored entries of the wrong shape", async () => {
		const { rememberPlan, kept } = await load(
			JSON.stringify([
				plan("C1"),
				{ challengeId: 5, pathId: "p-easy" },
				{ challengeId: "C2" },
				null,
				"C3",
				["C4", "p-easy"],
				plan("C5", "p-hard"),
			]),
		);
		rememberPlan("C6", "p-easy");
		expect(kept()).toEqual([plan("C6"), plan("C1"), plan("C5", "p-hard")]);
	});

	it.each([
		["text that is not JSON", "{nie json"],
		["an object", '{"challengeId":"C1","pathId":"p-easy"}'],
		["a text", '"C1"'],
		["null", "null"],
	])("starts empty when the stored value is %s", async (_what, stored) => {
		const { rememberPlan, kept } = await load(stored);
		rememberPlan("C1", "p-easy");
		expect(kept()).toEqual([plan("C1")]);
	});

	it("stores ids only", async () => {
		const { rememberPlan, kept } = await load(
			JSON.stringify([
				{ challengeId: "C1", pathId: "p-easy", title: "Wiosenne wyzwanie" },
			]),
		);
		rememberPlan("C2", "p-easy");
		expect(kept()).toEqual([
			plan("C2"),
			// What was already stored is passed on as it was read.
			{ challengeId: "C1", pathId: "p-easy", title: "Wiosenne wyzwanie" },
		]);
	});

	it("works where nothing can be stored", async () => {
		vi.stubGlobal("localStorage", undefined);
		vi.resetModules();
		const { rememberPlan } = await import("./recentPlans");
		expect(() => {
			rememberPlan("C1", "p-easy");
			rememberPlan("C2", "p-easy");
		}).not.toThrow();
	});

	it("works when the storage refuses every call", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {},
		});
		vi.resetModules();
		const { rememberPlan } = await import("./recentPlans");
		expect(() => rememberPlan("C1", "p-easy")).not.toThrow();
	});
});
