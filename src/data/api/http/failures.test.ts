import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import {
	failureDetails,
	failureFrom,
	networkFailure,
	unexpectedAnswer,
} from "./failures";

// The bodies below are the ones the panel's routes send (the backend's
// src/common/handlers/panelContract.ts) and the Worker's own refusals.

describe("failureFrom", () => {
	describe("401", () => {
		it("is unauthorized, in the panel's own words, with what the backend said", () => {
			const error = failureFrom(401, {
				error: "Nie jesteśmy w stanie zweryfikować Twojej tożsamości.",
			});
			expect(error).toBeInstanceOf(ApiError);
			expect(error.kind).toBe("unauthorized");
			expect(error.message).toBe(
				"Sesja wygasła albo nie masz logowania. Zaloguj się ponownie. (Szczegóły: HTTP 401, backend: „Nie jesteśmy w stanie zweryfikować Twojej tożsamości.”)",
			);
			expect(error.details).toBe(
				"HTTP 401, backend: „Nie jesteśmy w stanie zweryfikować Twojej tożsamości.”",
			);
			expect(error.status).toBe(401);
		});

		it("is the same without a body, as the platform answers", () => {
			const error = failureFrom(401, undefined);
			expect(error.kind).toBe("unauthorized");
			expect(error.message).toBe(
				"Sesja wygasła albo nie masz logowania. Zaloguj się ponownie. (Szczegóły: HTTP 401, odpowiedź bez treści)",
			);
			expect(error.status).toBe(401);
		});
	});

	describe("403", () => {
		it("says a section is closed when the Worker refuses a write to it", () => {
			const said =
				"Produkcja jest tylko do odczytu: ta część panelu nie jest jeszcze otwarta do zapisu.";
			const failure = failureFrom(403, { error: said, errorCode: "READ_ONLY" });
			expect(failure.kind).toBe("validation");
			expect(failure.status).toBe(403);
			expect(failure.message).toBe(said);
			expect(failure.issues).toEqual([{ path: "", message: said }]);
			expect(failure.details).toBe(
				`HTTP 403, kod READ_ONLY, backend: „${said}”`,
			);
		});

		it("reads any other 403 as no access, with what the backend said", () => {
			for (const [errorCode, details] of [
				["FOREIGN_REQUEST", "HTTP 403, kod FOREIGN_REQUEST, backend: „Nie”"],
				["NOT_PANEL_ADMIN", "HTTP 403, kod NOT_PANEL_ADMIN, backend: „Nie”"],
				[null, "HTTP 403, backend: „Nie”"],
			] as const) {
				const failure = failureFrom(403, { error: "Nie", errorCode });
				expect(failure.kind).toBe("forbidden");
				expect(failure.message).toBe(
					`To konto nie ma dostępu. (Szczegóły: ${details})`,
				);
				expect(failure.details).toBe(details);
				expect(failure.status).toBe(403);
			}
			// The code alone, with nothing to show, is not enough.
			const codeOnly = failureFrom(403, { errorCode: "READ_ONLY" });
			expect(codeOnly.kind).toBe("forbidden");
			expect(codeOnly.message).toBe(
				"To konto nie ma dostępu. (Szczegóły: HTTP 403, kod READ_ONLY, odpowiedź bez treści)",
			);
		});
	});

	describe("404", () => {
		it("carries what the backend said was missing", () => {
			const error = failureFrom(404, {
				error: "Nie ma odznaki n_9",
				errorCode: "NOT_FOUND",
			});
			expect(error.kind).toBe("notFound");
			expect(error.message).toBe("Nie ma odznaki n_9");
			expect(error.details).toBe(
				"HTTP 404, kod NOT_FOUND, backend: „Nie ma odznaki n_9”",
			);
			expect(error.status).toBe(404);
		});

		// The transport passes the parsed JSON as the body and the answer's
		// text as the raw answer; a page that is not JSON has no body.
		it.each([
			["no answer", undefined, undefined, "HTTP 404, odpowiedź bez treści"],
			[
				"a page that is not JSON",
				undefined,
				"<html>Not Found</html>",
				"HTTP 404, odpowiedź: „Not Found”",
			],
			["an empty object", {}, "{}", "HTTP 404, odpowiedź bez treści"],
		])(
			"has a text of its own, with the details, for %s",
			(_what, body, raw, details) => {
				const error = failureFrom(404, body, raw);
				expect(error.kind).toBe("notFound");
				expect(error.message).toBe(
					`Nie znaleziono tego w backendzie. (Szczegóły: ${details})`,
				);
				expect(error.details).toBe(details);
			},
		);
	});

	describe("409 and 412", () => {
		const current = { id: "C1", etag: 'W/"2"', title: "Ktoś inny zdążył" };

		it.each([
			["CONFLICT", "Wyzwanie zostało zmienione w międzyczasie"],
			["PANEL_DOC_CONFLICT", "Ktoś zmienił ten dokument w międzyczasie."],
			[null, "Zmienione"],
		])(
			"reads %s as changed meanwhile, with the stored version",
			(errorCode, error) => {
				const failure = failureFrom(409, { error, errorCode, current });
				expect(failure.kind).toBe("conflict");
				expect(failure.message).toBe(error);
				expect(failure.current).toBe(current);
				expect(failure.status).toBe(409);
				expect(failure.issues).toEqual([]);
			},
		);

		it("is a conflict without a stored version when the body has none", () => {
			for (const body of [undefined, {}, { error: null }]) {
				const failure = failureFrom(409, body);
				expect(failure.kind).toBe("conflict");
				expect(failure.message).toBe(
					"Ktoś zmienił to w międzyczasie. (Szczegóły: HTTP 409, odpowiedź bez treści)",
				);
				expect(failure.current).toBeUndefined();
			}
		});

		it("keeps a stored document that is gone as null", () => {
			const failure = failureFrom(409, {
				error: "Ktoś zmienił ten dokument w międzyczasie.",
				errorCode: "PANEL_DOC_CONFLICT",
				current: null,
			});
			expect(failure.kind).toBe("conflict");
			expect(failure.current).toBeNull();
		});

		it.each([
			"IN_USE",
			"WORKOUT_EXISTS",
			"BADGE_IN_USE",
			"ALREADY_EXISTS",
			"SENDING_IN_PROGRESS",
			"SOMETHING_NEW",
		])(
			"reads %s as a refusal with the backend's message, not as a conflict",
			(errorCode) => {
				const said =
					"Trening jest używany w wyzwaniach: „Plan A” (C1, opublikowane)";
				const failure = failureFrom(409, { error: said, errorCode, current });
				expect(failure.kind).toBe("validation");
				expect(failure.status).toBe(409);
				expect(failure.message).toBe(said);
				expect(failure.issues).toEqual([{ path: "", message: said }]);
				// Nothing to merge with: the stored entity is not offered as "theirs".
				expect(failure.current).toBeUndefined();
			},
		);

		it("keeps the issues a refusal lists", () => {
			const issues = [
				{ path: "inUse.workouts.W1", message: "Przyznaje ją trening W1" },
			];
			const failure = failureFrom(409, {
				error: "Ta odznaka jest w użyciu",
				errorCode: "BADGE_IN_USE",
				issues: issues.map((issue) => ({ ...issue, code: "IN_USE" })),
			});
			expect(failure.message).toBe("Ta odznaka jest w użyciu");
			expect(failure.issues).toEqual(issues);
		});

		it("has a text of its own for a coded refusal that says nothing", () => {
			const failure = failureFrom(409, { errorCode: "IN_USE" });
			expect(failure.kind).toBe("validation");
			expect(failure.message).toBe(
				"Backend odmówił: coś stoi temu na przeszkodzie. (Szczegóły: HTTP 409, kod IN_USE, odpowiedź bez treści)",
			);
			expect(failure.issues).toEqual([{ path: "", message: failure.message }]);
		});

		it("still reads a 412 as a conflict whatever code it carries", () => {
			const failure = failureFrom(412, {
				error: "Precondition failed",
				errorCode: "IN_USE",
				current,
			});
			expect(failure.kind).toBe("conflict");
			expect(failure.current).toBe(current);
			expect(failure.status).toBe(412);
		});
	});

	describe.each([400, 422])("%i", (status) => {
		it("passes the backend's issues and message through as they are", () => {
			const body = {
				error: "Nazwa musi mieć co najmniej 3 znaki; Wybierz grafikę odznaki",
				errorCode: "VALIDATION",
				issues: [
					{
						path: "name",
						code: "TOO_SHORT",
						message: "Nazwa musi mieć co najmniej 3 znaki",
					},
					{
						path: "imageRelativePath",
						code: "REQUIRED",
						message: " Wybierz grafikę odznaki ",
					},
				],
			};
			const failure = failureFrom(status, body);
			expect(failure.kind).toBe("validation");
			expect(failure.status).toBe(status);
			expect(failure.message).toBe(body.error);
			expect(failure.issues).toEqual([
				{ path: "name", message: "Nazwa musi mieć co najmniej 3 znaki" },
				{ path: "imageRelativePath", message: "Wybierz grafikę odznaki" },
			]);
		});

		it("joins the issues when there is no `error`", () => {
			const failure = failureFrom(status, {
				issues: [
					{ path: "title", message: "Opis jest wymagany" },
					{ path: "from", message: "Nadawca jest wymagany" },
				],
			});
			expect(failure.message).toBe("Opis jest wymagany\nNadawca jest wymagany");
		});

		it("drops issues without a message and reads a path that is not text as none", () => {
			const failure = failureFrom(status, {
				error: "Źle",
				issues: [
					{ path: "paths.0.levelId", message: "Nieznany poziom" },
					{ code: "NO_PATHS", message: "Dodaj ścieżkę" },
					{ path: 3, message: "Liczba jako ścieżka" },
					{ path: "title", message: "" },
					{ path: "title" },
					"tekst",
					null,
				],
			});
			expect(failure.issues).toEqual([
				{ path: "paths.0.levelId", message: "Nieznany poziom" },
				{ path: "", message: "Dodaj ścieżkę" },
				{ path: "", message: "Liczba jako ścieżka" },
			]);
		});

		it("lists the message itself when there are no issues", () => {
			const failure = failureFrom(status, {
				error: "Nieprawidłowy parametr: limit.",
				errorCode: "PANEL_AUDIT_BAD_QUERY",
			});
			expect(failure.message).toBe("Nieprawidłowy parametr: limit.");
			expect(failure.issues).toEqual([
				{ path: "", message: "Nieprawidłowy parametr: limit." },
			]);
		});

		it("takes `message` where a handler uses it instead of `error`", () => {
			expect(failureFrom(status, { message: "Złe zapytanie" }).message).toBe(
				"Złe zapytanie",
			);
			expect(failureFrom(status, { error: "A", message: "B" }).message).toBe(
				"A",
			);
			expect(failureFrom(status, { error: "  ", message: "B" }).message).toBe(
				"B",
			);
		});

		it("has a text of its own, with the details, when the body says nothing", () => {
			for (const [body, raw, details] of [
				[undefined, undefined, `HTTP ${status}, odpowiedź bez treści`],
				[{}, "{}", `HTTP ${status}, odpowiedź bez treści`],
				[undefined, "Bad Request", `HTTP ${status}, odpowiedź: „Bad Request”`],
				[
					{ error: 500 },
					'{"error":500}',
					`HTTP ${status}, odpowiedź: „{"error":500}”`,
				],
			] as const) {
				const failure = failureFrom(status, body, raw);
				const message = `Backend odrzucił zapis. (Szczegóły: ${details})`;
				expect(failure.kind).toBe("validation");
				expect(failure.message).toBe(message);
				expect(failure.details).toBe(details);
				expect(failure.issues).toEqual([{ path: "", message }]);
			}
		});
	});

	describe("413", () => {
		it("shows the backend's message", () => {
			const said = "Plik jest za duży: w tym folderze limit to 2 MB.";
			const failure = failureFrom(413, {
				error: said,
				errorCode: "FILE_TOO_LARGE",
				maxBytes: 2_000_000,
			});
			expect(failure.kind).toBe("validation");
			expect(failure.status).toBe(413);
			expect(failure.message).toBe(said);
			expect(failure.issues).toEqual([{ path: "", message: said }]);
		});

		it("has its own text for a 413 without one, with the details", () => {
			for (const [body, raw, details] of [
				[undefined, undefined, "HTTP 413, odpowiedź bez treści"],
				[undefined, "<html>413</html>", "HTTP 413, odpowiedź: „413”"],
				[{}, "{}", "HTTP 413, odpowiedź bez treści"],
			] as const) {
				expect(failureFrom(413, body, raw).message).toBe(
					`Plik jest za duży, żeby go wysłać. (Szczegóły: ${details})`,
				);
			}
		});
	});

	describe("428", () => {
		it("is a refusal with the backend's message, never a conflict", () => {
			const said =
				"Wyzwanie C12 już istnieje, a zapis nie podał wersji, na której się opiera. Odśwież stronę i spróbuj ponownie";
			const failure = failureFrom(428, {
				error: said,
				errorCode: "VERSION_REQUIRED",
			});
			expect(failure.kind).toBe("validation");
			expect(failure.status).toBe(428);
			expect(failure.message).toBe(said);
			expect(failure.issues).toEqual([{ path: "", message: said }]);
			expect(failure.current).toBeUndefined();
		});

		it("has its own text for a 428 without a body", () => {
			const failure = failureFrom(428, undefined);
			expect(failure.kind).toBe("validation");
			expect(failure.message).toContain("nie podał wersji");
		});
	});

	describe("429", () => {
		it("is a refusal the person can wait out, in the backend's words", () => {
			const said =
				"Cache był czyszczony przed chwilą. Spróbuj ponownie za pół minuty.";
			const failure = failureFrom(429, {
				error: said,
				errorCode: "CDN_PURGE_TOO_SOON",
			});
			expect(failure.kind).toBe("validation");
			expect(failure.message).toBe(said);
			expect(failure.issues).toEqual([{ path: "", message: said }]);
		});

		it("is a rate limit on the way when nothing says why", () => {
			const failure = failureFrom(429, undefined);
			expect(failure.kind).toBe("server");
			expect(failure.message).toBe(
				"Za dużo zapytań w krótkim czasie: Cloudflare albo backend chwilowo je blokuje. Poczekaj minutę i odśwież stronę. (Szczegóły: HTTP 429, odpowiedź bez treści)",
			);
		});

		it("explains Cloudflare's English 429 in Polish and keeps its words in the details", () => {
			const failure = failureFrom(429, {
				error: "Too many requests, slow down",
			});
			expect(failure.kind).toBe("server");
			expect(failure.message).toMatch(/^Za dużo zapytań w krótkim czasie/);
			expect(failure.details).toContain("Too many requests, slow down");
		});
	});

	describe.each([502, 503, 504])("%i", (status) => {
		it("is a failure with the backend's message", () => {
			const said = "Cloudflare nie wyczyścił cache. Spróbuj ponownie.";
			const failure = failureFrom(status, {
				error: said,
				errorCode: "CDN_PURGE_FAILED",
			});
			expect(failure.kind).toBe("server");
			expect(failure.status).toBe(status);
			expect(failure.message).toBe(said);
		});

		it("says to try again in a moment when nothing says why, with the details", () => {
			for (const [body, raw, details] of [
				[undefined, undefined, `HTTP ${status}, odpowiedź bez treści`],
				[
					undefined,
					"<html>Bad gateway</html>",
					`HTTP ${status}, odpowiedź: „Bad gateway”`,
				],
				[{}, "{}", `HTTP ${status}, odpowiedź bez treści`],
			] as const) {
				const failure = failureFrom(status, body, raw);
				expect(failure.kind).toBe("server");
				expect(failure.message).toBe(
					`Backend jest chwilowo niedostępny. Spróbuj za chwilę. (Szczegóły: ${details})`,
				);
				expect(failure.details).toBe(details);
			}
		});
	});

	it("reads 500 as the backend failing, in the panel's words, with what the backend said", () => {
		for (const [body, details] of [
			[
				{ error: "Failed to save challenge: TypeError: x is undefined" },
				"HTTP 500, backend: „Failed to save challenge: TypeError: x is undefined”",
			],
			[
				{ error: "Nazwa jest wymagana" },
				"HTTP 500, backend: „Nazwa jest wymagana”",
			],
			[undefined, "HTTP 500, odpowiedź bez treści"],
		] as const) {
			const failure = failureFrom(500, body);
			expect(failure.kind).toBe("server");
			expect(failure.status).toBe(500);
			expect(failure.message).toBe(
				`Backend napotkał błąd. Spróbuj ponownie za chwilę. (Szczegóły: ${details})`,
			);
			expect(failure.details).toBe(details);
			expect(failure.issues).toEqual([]);
		}
	});

	it("shows the backend's own Polish 500 sentence, and only that one", () => {
		const said =
			"Wysyłka przerwała się w połowie: część wiadomości mogła już trafić do użytkowników, więc nie można jej już zmienić";
		const failure = failureFrom(500, {
			error: said,
			errorCode: "SERVER_ERROR",
		});
		expect(failure.kind).toBe("server");
		expect(failure.status).toBe(500);
		expect(failure.message).toBe(said);
		expect(failure.details).toBe(
			`HTTP 500, kod SERVER_ERROR, backend: „${said}”`,
		);
		expect(failure.issues).toEqual([]);

		// any other 500 may carry raw exception text: the panel's own words,
		// with that text only in the details
		for (const [body, details] of [
			[
				{ error: "Failed to save: TypeError", errorCode: "SOMETHING" },
				"HTTP 500, kod SOMETHING, backend: „Failed to save: TypeError”",
			],
			[
				{ error: "Failed to save: TypeError" },
				"HTTP 500, backend: „Failed to save: TypeError”",
			],
			[
				{ errorCode: "SERVER_ERROR" },
				"HTTP 500, kod SERVER_ERROR, odpowiedź bez treści",
			],
			[
				{ error: "   ", errorCode: "SERVER_ERROR" },
				"HTTP 500, kod SERVER_ERROR, odpowiedź bez treści",
			],
		] as const) {
			expect(failureFrom(500, body).message).toBe(
				`Backend napotkał błąd. Spróbuj ponownie za chwilę. (Szczegóły: ${details})`,
			);
		}
	});

	it("reads any other status as the backend failing", () => {
		const notImplemented = failureFrom(501, { error: "Not implemented" });
		expect(notImplemented.kind).toBe("server");
		expect(notImplemented.message).toBe("Not implemented");
		expect(notImplemented.status).toBe(501);

		const teapot = failureFrom(418, undefined);
		expect(teapot.kind).toBe("server");
		expect(teapot.message).toBe(
			"Backend odpowiedział w nieoczekiwany sposób. (Szczegóły: HTTP 418, odpowiedź bez treści)",
		);
	});
});

describe("failureFrom: nothing the backend answered is lost", () => {
	const FAILED = "Backend napotkał błąd. Spróbuj ponownie za chwilę.";
	const UNAVAILABLE = "Backend jest chwilowo niedostępny. Spróbuj za chwilę.";

	it("shows a raw English 500 in the panel's words, with the English in the details", () => {
		const english =
			"Failed to save challenge: TypeError: Cannot read properties of undefined (reading 'paths')";
		const failure = failureFrom(500, { error: english });
		expect(failure.kind).toBe("server");
		expect(failure.status).toBe(500);
		expect(failure.message).toBe(
			`${FAILED} (Szczegóły: HTTP 500, backend: „${english}”)`,
		);
		expect(failure.details).toBe(`HTTP 500, backend: „${english}”`);
	});

	it("shows a 500 that is not JSON in the panel's words, with its text in the details", () => {
		const failure = failureFrom(500, undefined, "Internal Server Error");
		expect(failure.message).toBe(
			`${FAILED} (Szczegóły: HTTP 500, odpowiedź: „Internal Server Error”)`,
		);
		expect(failure.details).toBe(
			"HTTP 500, odpowiedź: „Internal Server Error”",
		);
	});

	it("puts the start of a proxy's HTML page, without its tags, in the details", () => {
		const page = [
			"<!DOCTYPE html>",
			"<html>",
			"<head><title>502 Bad Gateway</title></head>",
			"<body>",
			"<center><h1>502 Bad Gateway</h1></center>",
			"<hr><center>nginx</center>",
			"</body>",
			"</html>",
		].join("\n");
		const failure = failureFrom(502, undefined, page);
		expect(failure.kind).toBe("server");
		expect(failure.message).toBe(
			`${UNAVAILABLE} (Szczegóły: HTTP 502, odpowiedź: „502 Bad Gateway 502 Bad Gateway nginx”)`,
		);
		expect(failure.details).toBe(
			"HTTP 502, odpowiedź: „502 Bad Gateway 502 Bad Gateway nginx”",
		);
	});

	it("cuts a long HTML page at 300 characters of its text", () => {
		const page = `<html><body><p>${"abcdefghij".repeat(40)}</p></body></html>`;
		const failure = failureFrom(503, undefined, page);
		expect(failure.details).toBe(
			`HTTP 503, odpowiedź: „${"abcdefghij".repeat(30)}…”`,
		);
		expect(failure.message).toBe(
			`${UNAVAILABLE} (Szczegóły: HTTP 503, odpowiedź: „${"abcdefghij".repeat(30)}…”)`,
		);
	});

	it("says the answer had nothing in it when the body says nothing", () => {
		for (const [body, raw] of [
			[undefined, undefined],
			[undefined, ""],
			[undefined, "  \n\t "],
			[{}, "{}"],
			[{ error: "  " }, '{"error":"  "}'],
		] as const) {
			const failure = failureFrom(503, body, raw);
			expect(failure.details).toBe("HTTP 503, odpowiedź bez treści");
			expect(failure.message).toBe(
				`${UNAVAILABLE} (Szczegóły: HTTP 503, odpowiedź bez treści)`,
			);
		}
	});

	it("does not repeat an answer whose content is already in the details", () => {
		const failure = failureFrom(500, { errorCode: "X" }, '{"errorCode":"X"}');
		expect(failure.details).toBe("HTTP 500, kod X, odpowiedź bez treści");
		expect(failureFrom(404, {}, "{}").details).toBe(
			"HTTP 404, odpowiedź bez treści",
		);
	});

	it("keeps an answer that is JSON but not the usual envelope", () => {
		expect(failureFrom(400, "Bad Request", '"Bad Request"').details).toBe(
			'HTTP 400, odpowiedź: „"Bad Request"”',
		);
		expect(failureFrom(500, ["a", "b"], '["a","b"]').details).toBe(
			'HTTP 500, odpowiedź: „["a","b"]”',
		);
		expect(failureFrom(500, { error: 500 }, '{"error":500}').details).toBe(
			'HTTP 500, odpowiedź: „{"error":500}”',
		);
		expect(
			failureFrom(502, { message: { why: "x" } }, '{"message":{"why":"x"}}')
				.message,
		).toBe(
			`${UNAVAILABLE} (Szczegóły: HTTP 502, odpowiedź: „{"message":{"why":"x"}}”)`,
		);
	});

	it("cuts a long backend text at 300 characters with an ellipsis", () => {
		const said = `${"x".repeat(299)}yz${"w".repeat(50)}`;
		const failure = failureFrom(500, { error: said });
		expect(failure.details).toBe(`HTTP 500, backend: „${"x".repeat(299)}y…”`);
		expect(failure.message).toBe(
			`${FAILED} (Szczegóły: HTTP 500, backend: „${"x".repeat(299)}y…”)`,
		);
	});

	it("keeps a backend text of exactly 300 characters whole, on one line", () => {
		const said = "x".repeat(300);
		expect(failureFrom(500, { error: said }).details).toBe(
			`HTTP 500, backend: „${said}”`,
		);
		expect(
			failureFrom(500, { error: "Failed\n   at save\n   at handle" }).details,
		).toBe("HTTP 500, backend: „Failed at save at handle”");
	});

	it.each([
		[404, "NOT_FOUND", "notFound"],
		[409, "IN_USE", "validation"],
		[409, "CONFLICT", "conflict"],
		[422, "VALIDATION", "validation"],
		[413, "FILE_TOO_LARGE", "validation"],
		[428, "VERSION_REQUIRED", "validation"],
		[429, "CDN_PURGE_TOO_SOON", "validation"],
		[503, "CDN_NOT_CONFIGURED", "server"],
		[500, "SERVER_ERROR", "server"],
	])(
		"shows the backend's own Polish text for %i %s unchanged, and still keeps the details",
		(status, errorCode, kind) => {
			const said = "Nazwa musi mieć co najmniej 3 znaki.";
			const failure = failureFrom(status, { error: said, errorCode });
			expect(failure.kind).toBe(kind);
			expect(failure.message).toBe(said);
			expect(failure.details).toBe(
				`HTTP ${status}, kod ${errorCode}, backend: „${said}”`,
			);
		},
	);

	it("shows a SERVER_ERROR 500's sentence as it is, with the details kept apart", () => {
		const said =
			"Nie udało się zapisać wyzwania. Spróbuj ponownie za chwilę; jeśli to się powtarza, zgłoś to.";
		const failure = failureFrom(500, {
			error: said,
			errorCode: "SERVER_ERROR",
		});
		expect(failure.kind).toBe("server");
		expect(failure.message).toBe(said);
		expect(failure.details).toBe(
			`HTTP 500, kod SERVER_ERROR, backend: „${said}”`,
		);
	});
});

describe("failureDetails", () => {
	it("lists the status, the code and what the backend said, in that order", () => {
		expect(failureDetails(500, "SERVER_ERROR", "Coś", "ignored")).toBe(
			"HTTP 500, kod SERVER_ERROR, backend: „Coś”",
		);
	});

	it("falls back to the raw answer, then to saying there was nothing", () => {
		expect(failureDetails(502, null, null, "<b>Bad</b> gateway")).toBe(
			"HTTP 502, odpowiedź: „Bad gateway”",
		);
		expect(failureDetails(502, null, null)).toBe(
			"HTTP 502, odpowiedź bez treści",
		);
	});

	it("is empty when there was no answer and nothing to say", () => {
		expect(failureDetails(undefined, null, null)).toBe("");
	});
});

describe("networkFailure", () => {
	const NETWORK =
		"Brak połączenia z backendem. Sprawdź internet i spróbuj ponownie.";
	const TIMEOUT = "Backend nie odpowiedział na czas. Spróbuj ponownie.";

	it("says there is no connection when the request never left, with the browser's reason", () => {
		for (const [cause, details] of [
			[new TypeError("Failed to fetch"), "TypeError: „Failed to fetch”"],
			[new Error("boom"), "Error: „boom”"],
			["offline", "„offline”"],
			[
				{ name: "TypeError", message: "Load failed" },
				"TypeError: „Load failed”",
			],
		] as const) {
			const error = networkFailure(cause);
			expect(error.kind).toBe("network");
			expect(error.message).toBe(`${NETWORK} (Szczegóły: ${details})`);
			expect(error.details).toBe(details);
			// No answer, so no status.
			expect(error.status).toBeUndefined();
		}
	});

	it("names the error alone when the browser gave no reason", () => {
		const error = networkFailure(new Error(""));
		expect(error.message).toBe(`${NETWORK} (Szczegóły: Error)`);
		expect(error.details).toBe("Error");
	});

	it("says only that there is no connection when nothing says why", () => {
		for (const cause of [undefined, null, { name: 7 }, ""]) {
			const error = networkFailure(cause);
			expect(error.kind).toBe("network");
			expect(error.message).toBe(NETWORK);
			expect(error.details).toBeUndefined();
			expect(error.status).toBeUndefined();
		}
	});

	it("says the backend was too slow when the time limit passed, with the browser's reason", () => {
		for (const [cause, details] of [
			[
				new DOMException("The operation timed out.", "TimeoutError"),
				"TimeoutError: „The operation timed out.”",
			],
			[
				new DOMException("The operation was aborted.", "AbortError"),
				"AbortError: „The operation was aborted.”",
			],
			[
				Object.assign(new Error("Timed out"), { name: "TimeoutError" }),
				"TimeoutError: „Timed out”",
			],
			[{ name: "AbortError" }, "AbortError"],
		] as const) {
			const error = networkFailure(cause);
			expect(error.kind).toBe("network");
			expect(error.message).toBe(`${TIMEOUT} (Szczegóły: ${details})`);
			expect(error.details).toBe(details);
			expect(error.status).toBeUndefined();
		}
	});
});

describe("unexpectedAnswer", () => {
	it("is a server error that names what was wrong", () => {
		const error = unexpectedAnswer("Lista wyzwań: to nie jest JSON.");
		expect(error.kind).toBe("server");
		expect(error.message).toBe(
			"Backend odpowiedział w nieoczekiwany sposób. Lista wyzwań: to nie jest JSON.",
		);
		expect(error.issues).toEqual([]);
		expect(error.status).toBeUndefined();
	});

	it("shows the first problem and keeps them all", () => {
		const problems = [
			{ path: "0.id", message: "Invalid input: expected string" },
			{ path: "3.paths", message: "Invalid input: expected array" },
		];
		const error = unexpectedAnswer("Lista wyzwań:", problems, 200);
		expect(error.message).toBe(
			"Backend odpowiedział w nieoczekiwany sposób. Lista wyzwań: (0.id: Invalid input: expected string)",
		);
		expect(error.issues).toEqual(problems);
		expect(error.status).toBe(200);
	});

	it("shows a problem about the whole answer without a path", () => {
		const error = unexpectedAnswer("Konto:", [
			{ path: "", message: "Invalid input: expected object" },
		]);
		expect(error.message).toBe(
			"Backend odpowiedział w nieoczekiwany sposób. Konto: (Invalid input: expected object)",
		);
	});
});
