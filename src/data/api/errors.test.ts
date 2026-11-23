import { describe, expect, it } from "vitest";
import {
	ApiError,
	type ApiErrorKind,
	errorMessage,
	failureText,
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

	it("has no issues, no current version, no status and no details unless given", () => {
		const error = new ApiError("network", "Brak połączenia");
		expect(error.issues).toEqual([]);
		expect(error.current).toBeUndefined();
		expect(error.status).toBeUndefined();
		expect(error.details).toBeUndefined();
	});

	it("carries the status and what the backend really answered", () => {
		const error = new ApiError("server", "Backend napotkał błąd.", {
			status: 500,
			details: "HTTP 500, backend: „Failed to save”",
		});
		expect(error.status).toBe(500);
		expect(error.details).toBe("HTTP 500, backend: „Failed to save”");
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

	it("falls back for an error without a text, naming the error", () => {
		expect(errorMessage(new Error(""), fallback)).toBe(
			`${fallback} (Szczegóły: Error)`,
		);
		expect(errorMessage(new Error(), fallback)).toBe(
			`${fallback} (Szczegóły: Error)`,
		);
		expect(errorMessage(new TypeError(""), fallback)).toBe(
			`${fallback} (Szczegóły: TypeError)`,
		);
		// an ApiError with nothing to add is just the fallback
		expect(errorMessage(new ApiError("server", ""), fallback)).toBe(fallback);
	});

	it("falls back for an ApiError without a text, with its details", () => {
		const error = new ApiError("network", "", {
			details: "TypeError: „Failed to fetch”",
		});
		expect(errorMessage(error, fallback)).toBe(
			`${fallback} (Szczegóły: TypeError: „Failed to fetch”)`,
		);
	});

	it.each([
		["a text", "Brak połączenia", `${fallback} (Szczegóły: „Brak połączenia”)`],
		[
			"an object with a message",
			{ message: "Brak połączenia" },
			`${fallback} (Szczegóły: {"message":"Brak połączenia"})`,
		],
		["a number", 500, `${fallback} (Szczegóły: 500)`],
	])("falls back for %s, with what was thrown", (_what, thrown, expected) => {
		expect(errorMessage(thrown, fallback)).toBe(expected);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["an empty text", ""],
	])("falls back alone for %s", (_what, thrown) => {
		expect(errorMessage(thrown, fallback)).toBe(fallback);
	});
});

describe("failureText", () => {
	const own = "Nie udało się zapisać wyzwania";

	it("adds an ApiError's details to the screen's own words", () => {
		const error = new ApiError(
			"server",
			"Backend napotkał błąd. Spróbuj ponownie za chwilę. (Szczegóły: HTTP 500, backend: „Failed to save: TypeError”)",
			{
				status: 500,
				details: "HTTP 500, backend: „Failed to save: TypeError”",
			},
		);
		expect(failureText(error, own)).toBe(
			`${own} (Szczegóły: HTTP 500, backend: „Failed to save: TypeError”)`,
		);
	});

	it("keeps the backend's own words of a refusal through its details", () => {
		const error = new ApiError(
			"validation",
			"Trening jest używany w wyzwaniach",
			{
				status: 409,
				details:
					"HTTP 409, kod IN_USE, backend: „Trening jest używany w wyzwaniach”",
			},
		);
		expect(failureText(error, own)).toBe(
			`${own} (Szczegóły: HTTP 409, kod IN_USE, backend: „Trening jest używany w wyzwaniach”)`,
		);
	});

	it("adds the message of an ApiError without details", () => {
		const error = new ApiError(
			"server",
			"Backend odpowiedział w nieoczekiwany sposób. Konto: (Invalid input: expected object)",
		);
		expect(failureText(error, own)).toBe(
			`${own} (Szczegóły: Backend odpowiedział w nieoczekiwany sposób. Konto: (Invalid input: expected object))`,
		);
	});

	it("adds nothing for an ApiError that says only the screen's own words, or nothing", () => {
		expect(failureText(new ApiError("server", own), own)).toBe(own);
		expect(failureText(new ApiError("server", ""), own)).toBe(own);
	});

	it("names a plain Error and quotes its text", () => {
		expect(
			failureText(
				new TypeError("Cannot read properties of undefined (reading 'id')"),
				own,
			),
		).toBe(
			`${own} (Szczegóły: TypeError: „Cannot read properties of undefined (reading 'id')”)`,
		);
		expect(failureText(new Error("boom"), own)).toBe(
			`${own} (Szczegóły: Error: „boom”)`,
		);
	});

	it("names an Error alone when its message is empty", () => {
		expect(failureText(new Error(""), own)).toBe(`${own} (Szczegóły: Error)`);
		expect(failureText(new RangeError(), own)).toBe(
			`${own} (Szczegóły: RangeError)`,
		);
	});

	it("puts a thrown text on one line and cuts it at 300 characters", () => {
		expect(failureText(new Error("a\n   b"), own)).toBe(
			`${own} (Szczegóły: Error: „a b”)`,
		);
		expect(failureText(`${"x".repeat(300)}yz`, own)).toBe(
			`${own} (Szczegóły: „${"x".repeat(300)}…”)`,
		);
	});

	it("quotes a thrown text", () => {
		expect(failureText("coś pękło", own)).toBe(
			`${own} (Szczegóły: „coś pękło”)`,
		);
		expect(failureText("  coś pękło  ", own)).toBe(
			`${own} (Szczegóły: „coś pękło”)`,
		);
	});

	it("shows any other thrown value as JSON", () => {
		expect(failureText({ code: "E_FAIL", retry: false }, own)).toBe(
			`${own} (Szczegóły: {"code":"E_FAIL","retry":false})`,
		);
		expect(failureText([1, 2], own)).toBe(`${own} (Szczegóły: [1,2])`);
		expect(failureText(0, own)).toBe(`${own} (Szczegóły: 0)`);
		expect(failureText(false, own)).toBe(`${own} (Szczegóły: false)`);
	});

	it("shows a value that is not JSON as text", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(failureText(circular, own)).toBe(
			`${own} (Szczegóły: [object Object])`,
		);
		expect(failureText(Symbol("x"), own)).toBe(`${own} (Szczegóły: Symbol(x))`);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["an empty text", ""],
		["a blank text", "   "],
	])("is the screen's own words alone for %s", (_what, thrown) => {
		expect(failureText(thrown, own)).toBe(own);
	});
});
