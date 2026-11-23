import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/lib/storage";
import {
	currentEnvironment,
	DEFAULT_ENVIRONMENT,
	ENVIRONMENTS,
	STORAGE_KEY,
	switchEnvironment,
} from "./environment";

// The choice of environment is remembered in the browser. What must hold:
// the panel starts on sample data, only the two known values are ever
// accepted, and a switch reloads the page so nothing from one environment
// stays on screen in the other. Picking Produkcja grants nothing by itself;
// that is the Worker's session and the backend (worker/, docs/SECURITY.md).

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the list of environments", () => {
	it("starts in Test", () => {
		expect(DEFAULT_ENVIRONMENT).toBe("test");
	});

	it("offers Test and Produkcja", () => {
		const available = ENVIRONMENTS.filter((e) => e.available);
		expect(available.map((e) => e.value)).toEqual(["test", "production"]);
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

	it("reads a stored Produkcja", () => {
		vi.stubGlobal(
			"localStorage",
			memoryStorage({ "cf.environment": "production" }),
		);
		expect(currentEnvironment()).toBe("production");
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
	it("switches to Produkcja: stores the choice and reloads", () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("production");

		expect([...storage.data]).toEqual([[STORAGE_KEY, "production"]]);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(currentEnvironment()).toBe("production");
	});

	it("switches back to Test and reloads", () => {
		const storage = memoryStorage({ [STORAGE_KEY]: "production" });
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("test");

		expect([...storage.data]).toEqual([[STORAGE_KEY, "test"]]);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does not reload when the choice could not be stored", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {},
		});
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("production");

		expect(reload).not.toHaveBeenCalled();
	});

	it("ignores a value that is not an environment", () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		switchEnvironment("staging" as never);

		expect(storage.data.size).toBe(0);
		expect(reload).not.toHaveBeenCalled();
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
