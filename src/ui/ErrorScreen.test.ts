import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/data/api/errors";
import { failureFrom, networkFailure } from "@/data/api/http/failures";
import { ErrorScreen } from "./ErrorScreen";

// Tests run without a DOM: the screen is rendered to markup and its
// technical details are read from the <pre> that holds them.

const NOW = new Date("2026-11-23T10:00:00.000Z");
const HREF = "https://panel.example.test/wyzwania/C1";

/** The lines of the technical details, up to the stack. */
function detailLines(error: unknown): string[] {
	const markup = renderToStaticMarkup(createElement(ErrorScreen, { error }));
	const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(markup)?.[1];
	if (pre === undefined) throw new Error("no technical details rendered");
	const lines = pre.split("\n");
	const blank = lines.indexOf("");
	return blank === -1 ? lines : lines.slice(0, blank);
}

describe("ErrorScreen technical details", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubGlobal("window", { location: { href: HREF } });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("lists the HTTP status, the kind and the details of an ApiError", () => {
		const error = failureFrom(500, { error: "Failed to load challenge C1" });
		expect(detailLines(error)).toEqual([
			"Czas: 2026-11-23T10:00:00.000Z",
			`Adres: ${HREF}`,
			"Status HTTP: 500",
			"Rodzaj: server",
			"Szczegóły: HTTP 500, backend: „Failed to load challenge C1”",
			"Błąd: ApiError: Backend napotkał błąd. Spróbuj ponownie za chwilę. (Szczegóły: HTTP 500, backend: „Failed to load challenge C1”)",
		]);
	});

	it("lists the browser's reason for a request that got no answer, without a status", () => {
		const error = networkFailure(new TypeError("Failed to fetch"));
		expect(detailLines(error)).toEqual([
			"Czas: 2026-11-23T10:00:00.000Z",
			`Adres: ${HREF}`,
			"Rodzaj: network",
			"Szczegóły: TypeError: „Failed to fetch”",
			"Błąd: ApiError: Brak połączenia z backendem. Sprawdź internet i spróbuj ponownie. (Szczegóły: TypeError: „Failed to fetch”)",
		]);
	});

	it("leaves out what an ApiError does not carry", () => {
		expect(detailLines(new ApiError("notFound", "Nie ma wyzwania C1"))).toEqual(
			[
				"Czas: 2026-11-23T10:00:00.000Z",
				`Adres: ${HREF}`,
				"Rodzaj: notFound",
				"Błąd: ApiError: Nie ma wyzwania C1",
			],
		);
	});

	it("shows any other error by its name and text alone", () => {
		expect(detailLines(new RangeError("Invalid time value"))).toEqual([
			"Czas: 2026-11-23T10:00:00.000Z",
			`Adres: ${HREF}`,
			"Błąd: RangeError: Invalid time value",
		]);
		expect(detailLines("coś pękło")).toEqual([
			"Czas: 2026-11-23T10:00:00.000Z",
			`Adres: ${HREF}`,
			"Błąd: coś pękło",
		]);
	});
});
