import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/lib/storage";
import {
	currentEnvironment,
	DEFAULT_ENVIRONMENT,
	ENVIRONMENTS,
	STORAGE_KEY,
	switchEnvironment,
} from "./environment";

// The guard that matters here: until the live slices exist, nothing a browser
// can hold in its storage may point the panel at production.

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the list of environments", () => {
	it("starts in Test", () => {
		expect(DEFAULT_ENVIRONMENT).toBe("test");
	});

	it("offers exactly one environment, and it is not production", () => {
		const available = ENVIRONMENTS.filter((e) => e.available);
		expect(available.map((e) => e.value)).toEqual(["test"]);
		expect(ENVIRONMENTS.find((e) => e.value === "production")).toMatchObject({
			available: false,
		});
	});

	it("has the default among the available ones", () => {
		expect(
			ENVIRONMENTS.find((e) => e.value === DEFAULT_ENVIRONMENT)?.available,
		).toBe(true);
	});

	it("names every environment once, with a label", () => {
		const values = ENVIRONMENTS.map((e) => e.value);
		expect(new Set(values).size).toBe(values.length);
		for (const environment of ENVIRONMENTS) {
			expect(environment.label).not.toBe("");
			expect(environment.hint).not.toBe("");
		}
	});

	it("remembers the choice under its own key", () => {
		expect(STORAGE_KEY).toBe("cf.environment");
	});
});

describe("currentEnvironment", () => {
	it("is Test where there is no storage", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(currentEnvironment()).toBe("test");
	});

	it("is Test in a plain Node process", () => {
		expect(currentEnvironment()).toBe("test");
	});

	it("is Test with an empty storage", () => {
		vi.stubGlobal("localStorage", memoryStorage());
		expect(currentEnvironment()).toBe("test");
	});

	it("reads a stored available environment", () => {
		vi.stubGlobal("localStorage", memoryStorage({ [STORAGE_KEY]: "test" }));
		expect(currentEnvironment()).toBe("test");
	});

	it("ignores a stored environment that cannot be picked", () => {
		vi.stubGlobal(
			"localStorage",
			memoryStorage({ "cf.environment": "production" }),
		);
		expect(currentEnvironment()).toBe("test");
	});

	it.each(["Production", "prod", "", "null", '"production"'])(
		"ignores the tampered value %j",
		(stored) => {
			vi.stubGlobal("localStorage", memoryStorage({ [STORAGE_KEY]: stored }));
			expect(currentEnvironment()).toBe("test");
		},
	);

	it("is Test when the storage refuses to be read", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {},
			removeItem: () => {},
		});
		expect(currentEnvironment()).toBe("test");
	});
});

describe("switchEnvironment", () => {
	it("does not switch to production: nothing is stored, nothing reloads", () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("production");

		expect(storage.data.size).toBe(0);
		expect(reload).not.toHaveBeenCalled();
		expect(currentEnvironment()).toBe("test");
	});

	it("leaves a tampered value as it found it", () => {
		const storage = memoryStorage({ [STORAGE_KEY]: "production" });
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("production");

		expect([...storage.data]).toEqual([[STORAGE_KEY, "production"]]);
		expect(reload).not.toHaveBeenCalled();
		expect(currentEnvironment()).toBe("test");
	});

	it("does nothing when asked for the environment already in use", () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("test");

		expect(storage.data.size).toBe(0);
		expect(reload).not.toHaveBeenCalled();
	});

	it("does not throw without a browser around it", () => {
		expect(() => switchEnvironment("production")).not.toThrow();
		expect(() => switchEnvironment("test")).not.toThrow();
	});
});
