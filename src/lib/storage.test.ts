import { afterEach, describe, expect, it, vi } from "vitest";
import {
	browserStorage,
	memoryStorage,
	readStored,
	readStoredJson,
	removeStored,
	type StorageLike,
	writeStored,
} from "./storage";

const KEY = "cf.recentPlans";

/** Private mode, a blocked cookie jar, a full quota: every call throws. */
const blocked: StorageLike = {
	getItem: () => {
		throw new Error("SecurityError");
	},
	setItem: () => {
		throw new Error("QuotaExceededError");
	},
	removeItem: () => {
		throw new Error("SecurityError");
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("a working storage", () => {
	it("gives back what was written", () => {
		const storage = memoryStorage();
		expect(writeStored(KEY, "Zażółć gęślą jaźń", storage)).toBe(true);
		expect(readStored(KEY, storage)).toBe("Zażółć gęślą jaźń");
	});

	it("has nothing under a key that was never written", () => {
		expect(readStored(KEY, memoryStorage())).toBeNull();
		expect(readStoredJson(KEY, memoryStorage())).toBeNull();
	});

	it("keeps an empty text apart from a missing one", () => {
		const storage = memoryStorage({ [KEY]: "" });
		expect(readStored(KEY, storage)).toBe("");
	});

	it("replaces the earlier value", () => {
		const storage = memoryStorage({ [KEY]: "stare" });
		writeStored(KEY, "nowe", storage);
		expect(readStored(KEY, storage)).toBe("nowe");
	});

	it("removes one key and leaves the others", () => {
		const storage = memoryStorage({ [KEY]: "[]", "cf.environment": "test" });
		removeStored(KEY, storage);
		expect(readStored(KEY, storage)).toBeNull();
		expect(readStored("cf.environment", storage)).toBe("test");
		// Removing what is not there is not an error.
		expect(() => removeStored(KEY, storage)).not.toThrow();
	});

	it("parses stored JSON", () => {
		const plans = [{ challengeId: "C1", pathId: "p-easy" }];
		const storage = memoryStorage({ [KEY]: JSON.stringify(plans) });
		expect(readStoredJson(KEY, storage)).toEqual(plans);
	});

	it.each([
		["a cut-off document", '{"challengeId":"C1"'],
		["plain text", "wiosna"],
		["an empty text", ""],
	])("reads %s as no JSON at all", (_what, raw) => {
		expect(readStoredJson(KEY, memoryStorage({ [KEY]: raw }))).toBeNull();
	});

	it("hands back JSON null and primitives as they are", () => {
		const storage = memoryStorage({ a: "null", b: "42", c: '"tekst"' });
		expect(readStoredJson("a", storage)).toBeNull();
		expect(readStoredJson("b", storage)).toBe(42);
		expect(readStoredJson("c", storage)).toBe("tekst");
	});
});

describe("memoryStorage", () => {
	it("starts with the given values and shows what it holds", () => {
		const storage = memoryStorage({ [KEY]: "[]" });
		storage.setItem("cf.environment", "test");
		storage.removeItem(KEY);
		expect([...storage.data]).toEqual([["cf.environment", "test"]]);
		expect(storage.getItem(KEY)).toBeNull();
	});

	it("does not share values between two storages", () => {
		const first = memoryStorage();
		const second = memoryStorage();
		first.setItem(KEY, "tylko tu");
		expect(second.getItem(KEY)).toBeNull();
	});
});

describe("no storage at all", () => {
	it("reads nothing, keeps nothing and does not throw", () => {
		expect(readStored(KEY, null)).toBeNull();
		expect(readStoredJson(KEY, null)).toBeNull();
		expect(writeStored(KEY, "x", null)).toBe(false);
		expect(() => removeStored(KEY, null)).not.toThrow();
	});
});

describe("a storage that throws on every call", () => {
	it("reads as empty", () => {
		expect(readStored(KEY, blocked)).toBeNull();
		expect(readStoredJson(KEY, blocked)).toBeNull();
	});

	it("reports that the value was not kept", () => {
		expect(writeStored(KEY, "x", blocked)).toBe(false);
	});

	it("ignores a removal", () => {
		expect(() => removeStored(KEY, blocked)).not.toThrow();
	});
});

describe("the browser's storage", () => {
	it("is used when no storage is passed", () => {
		const storage = memoryStorage({ [KEY]: "[1]" });
		vi.stubGlobal("localStorage", storage);

		expect(browserStorage()).toBe(storage);
		expect(readStored(KEY)).toBe("[1]");
		expect(readStoredJson(KEY)).toEqual([1]);
		expect(writeStored("cf.environment", "test")).toBe(true);
		expect(storage.data.get("cf.environment")).toBe("test");
		removeStored(KEY);
		expect(storage.data.has(KEY)).toBe(false);
	});

	it("is null where there is none", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(browserStorage()).toBeNull();
		expect(readStored(KEY)).toBeNull();
		expect(writeStored(KEY, "x")).toBe(false);
		expect(() => removeStored(KEY)).not.toThrow();
	});

	it("is null when even asking for it is refused", () => {
		const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get: () => {
				throw new Error("SecurityError");
			},
		});
		const found = browserStorage();
		const read = readStored(KEY);
		if (before) Object.defineProperty(globalThis, "localStorage", before);
		else Reflect.deleteProperty(globalThis, "localStorage");

		expect(found).toBeNull();
		expect(read).toBeNull();
	});
});
