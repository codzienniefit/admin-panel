import { describe, expect, it } from "vitest";
import { createStore } from "./store";

interface Controls {
	failNextSave: boolean;
	latencyMs: number;
}

const quiet: Controls = { failNextSave: false, latencyMs: 0 };

describe("createStore", () => {
	it("starts with the given value", () => {
		expect(createStore("Szkic").get()).toBe("Szkic");
		expect(createStore(quiet).get()).toBe(quiet);
		expect(createStore<string | null>(null).get()).toBeNull();
	});

	it("replaces the value", () => {
		const store = createStore(quiet);
		const next = { ...quiet, failNextSave: true };
		store.set(next);
		expect(store.get()).toBe(next);
	});

	it("works the next value out from the previous one", () => {
		const store = createStore(quiet);
		store.set((previous) => ({ ...previous, latencyMs: 250 }));
		store.set((previous) => ({
			...previous,
			latencyMs: previous.latencyMs * 2,
		}));
		expect(store.get()).toEqual({ failNextSave: false, latencyMs: 500 });
	});

	it("tells every listener once per change", () => {
		const store = createStore(0);
		const seen: number[] = [];
		const alsoSeen: number[] = [];
		store.subscribe(() => seen.push(store.get()));
		store.subscribe(() => alsoSeen.push(store.get()));

		store.set(1);
		store.set((n) => n + 1);

		// The value is already the new one when a listener runs.
		expect(seen).toEqual([1, 2]);
		expect(alsoSeen).toEqual([1, 2]);
	});

	it("stays silent when the value is the same", () => {
		const store = createStore(quiet);
		let calls = 0;
		store.subscribe(() => calls++);

		store.set(quiet);
		store.set((previous) => previous);
		expect(calls).toBe(0);

		// An equal-looking but different object is a change.
		store.set({ ...quiet });
		expect(calls).toBe(1);
	});

	it("compares the way Object.is does", () => {
		const store = createStore(Number.NaN);
		let calls = 0;
		store.subscribe(() => calls++);

		store.set(Number.NaN);
		expect(calls).toBe(0);

		store.set(0);
		store.set(-0);
		expect(calls).toBe(2);
	});

	it("stops telling a listener that unsubscribed", () => {
		const store = createStore("draft");
		let kept = 0;
		let left = 0;
		store.subscribe(() => kept++);
		const unsubscribe = store.subscribe(() => left++);

		store.set("published");
		unsubscribe();
		store.set("hidden");
		// Unsubscribing twice is harmless.
		unsubscribe();

		expect(left).toBe(1);
		expect(kept).toBe(2);
	});

	it("counts the same listener once however often it subscribed", () => {
		const store = createStore(0);
		let calls = 0;
		const listener = () => {
			calls++;
		};
		store.subscribe(listener);
		store.subscribe(listener);
		store.set(1);
		expect(calls).toBe(1);
	});

	it("keeps stores apart", () => {
		const first = createStore(1);
		const second = createStore(1);
		let calls = 0;
		second.subscribe(() => calls++);
		first.set(2);
		expect(second.get()).toBe(1);
		expect(calls).toBe(0);
	});
});
