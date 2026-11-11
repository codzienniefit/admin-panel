import { describe, expect, it } from "vitest";
import {
	ApiError,
	type ApiErrorKind,
	errorMessage,
	isApiError,
	isConflict,
} from "./errors";

const KINDS: ApiErrorKind[] = [
	"validation",
	"conflict",
	"unauthorized",
	"forbidden",
	"notFound",
	"network",
	"server",
];

describe("ApiError", () => {
	it("is an Error with a kind and a message", () => {
		const error = new ApiError("server", "Serwer nie odpowiada");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.name).toBe("ApiError");
		expect(error.kind).toBe("server");
		expect(error.message).toBe("Serwer nie odpowiada");
		expect(String(error)).toBe("ApiError: Serwer nie odpowiada");
	});

	it("has no issues and no current version unless given", () => {
		const error = new ApiError("network", "Brak połączenia");
		expect(error.issues).toEqual([]);
		expect(error.current).toBeUndefined();
	});

	it("carries the problems of a validation refusal", () => {
		const issues = [
			{ path: "title", message: "Nazwa jest wymagana" },
			{ path: "paths.0.days.3", message: "Nieznany trening" },
		];
		const error = new ApiError("validation", "Popraw formularz", { issues });
		expect(error.issues).toEqual(issues);
		expect(error.current).toBeUndefined();
	});

	it("carries the server's version of a conflict", () => {
		const current = { id: "C1", etag: "7", title: "Tytuł Patryka" };
		const error = new ApiError("conflict", "Ktoś inny zapisał", { current });
		expect(error.current).toBe(current);
		expect(error.issues).toEqual([]);
	});

	it.each(KINDS)("keeps the kind %s", (kind) => {
		expect(new ApiError(kind, "x").kind).toBe(kind);
	});
});

describe("isApiError", () => {
	it("recognises an ApiError of any kind", () => {
		for (const kind of KINDS) {
			expect(isApiError(new ApiError(kind, "x"))).toBe(true);
		}
	});

	it.each([
		["a plain Error", new Error("Brak połączenia")],
		["an object that only looks like one", { kind: "conflict", message: "x" }],
		["a text", "conflict"],
		["null", null],
		["undefined", undefined],
	])("refuses %s", (_what, value) => {
		expect(isApiError(value)).toBe(false);
	});
});

describe("isConflict", () => {
	it("is true for a conflict, with or without the current version", () => {
		expect(isConflict(new ApiError("conflict", "x"))).toBe(true);
		expect(
			isConflict(new ApiError("conflict", "x", { current: { id: "C1" } })),
		).toBe(true);
	});

	it("is false for every other kind", () => {
		for (const kind of KINDS.filter((k) => k !== "conflict")) {
			expect(isConflict(new ApiError(kind, "x"))).toBe(false);
		}
	});

	it.each([
		["a plain Error", new Error("conflict")],
		["an object that only looks like one", { kind: "conflict" }],
		["null", null],
	])("is false for %s", (_what, value) => {
		expect(isConflict(value)).toBe(false);
	});

	it("lets the caller read the current version with its type", () => {
		const thrown: unknown = new ApiError("conflict", "x", {
			current: { id: "C1", title: "Tytuł Patryka" },
		});
		if (!isConflict<{ id: string; title: string }>(thrown)) {
			throw new Error("a conflict was not recognised");
		}
		expect(thrown.current?.title).toBe("Tytuł Patryka");
	});
});

describe("errorMessage", () => {
	const fallback = "Nie udało się zapisać";

	it("uses the error's own text", () => {
		expect(errorMessage(new Error("Brak połączenia"), fallback)).toBe(
			"Brak połączenia",
		);
		expect(
			errorMessage(new ApiError("forbidden", "Brak uprawnień"), fallback),
		).toBe("Brak uprawnień");
	});

	it("falls back for an error without a text", () => {
		expect(errorMessage(new Error(""), fallback)).toBe(fallback);
		expect(errorMessage(new Error(), fallback)).toBe(fallback);
		expect(errorMessage(new ApiError("server", ""), fallback)).toBe(fallback);
	});

	it.each([
		["a text", "Brak połączenia"],
		["an object with a message", { message: "Brak połączenia" }],
		["a number", 500],
		["null", null],
		["undefined", undefined],
	])("falls back for %s", (_what, thrown) => {
		expect(errorMessage(thrown, fallback)).toBe(fallback);
	});
});
