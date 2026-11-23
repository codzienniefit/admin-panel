import { describe, expect, it } from "vitest";
import {
	ALL_CAPABILITIES,
	PRODUCTION_CAPABILITIES,
} from "@/data/api/capabilities";
import { cacheArea } from "./cache";
import {
	type FakeBackend,
	failure,
	fakeBackend,
	json,
	production,
} from "./testSupport";

// `POST panel/manageCache/purge` as the backend answers it
// (src/handlers/admin/panelCacheHandler.ts): 200 with the moment, or one of
// three refusals, each with its own code and message.

const PURGE = "manageCache/purge";

const area = (backend: FakeBackend, caps = PRODUCTION_CAPABILITIES) =>
	cacheArea(backend.transport, caps);

const refusal = (status: number, errorCode: string, error: string) => ({
	status,
	body: { error, errorCode },
});

describe("cache.purge", () => {
	it("works in Produkcja as it is, where nothing else may be written", async () => {
		const backend = fakeBackend().on(
			"POST",
			PURGE,
			json({ purgedAtUtc: "2026-11-16T10:00:00.000Z" }),
		);
		expect(await area(backend).purge()).toEqual({
			purgedAtUtc: "2026-11-16T10:00:00.000Z",
		});
		const request = backend.only("POST", PURGE);
		expect(request.body).toBeUndefined();
		expect(request.headers["content-type"]).toBeUndefined();
		expect(backend.calls()).toEqual([`POST ${PURGE}`]);
	});

	it("keeps only the moment from the answer, and refuses an answer without one", async () => {
		const backend = fakeBackend().on(
			"POST",
			PURGE,
			json({ purgedAtUtc: "2026-11-16T10:00:00.000Z", extra: 1 }),
			json({ ok: true }),
		);
		expect(await area(backend, ALL_CAPABILITIES).purge()).toEqual({
			purgedAtUtc: "2026-11-16T10:00:00.000Z",
		});
		const error = await failure(area(backend, ALL_CAPABILITIES).purge());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Czyszczenie cache backendu");
	});

	it.each([
		[502, "CDN_PURGE_FAILED", "server"],
		[503, "CDN_NOT_CONFIGURED", "server"],
		[429, "CDN_PURGE_TOO_SOON", "validation"],
	])(
		"shows the backend's own message for %i %s",
		async (status, errorCode, kind) => {
			const said = `Komunikat backendu dla ${errorCode}.`;
			const backend = fakeBackend().on(
				"POST",
				PURGE,
				refusal(status, errorCode, said),
			);
			const error = await failure(area(backend).purge());
			expect(error.kind).toBe(kind);
			expect(error.status).toBe(status);
			expect(error.message).toBe(said);
		},
	);

	it("has general words for a failure that says nothing, with its status", async () => {
		for (const status of [502, 503, 429]) {
			const backend = fakeBackend().on("POST", PURGE, { status, text: "" });
			const error = await failure(area(backend).purge());
			expect(error.kind, String(status)).toBe("server");
			expect(error.message, String(status)).toBe(
				`Backend jest chwilowo niedostępny. Spróbuj za chwilę. (Szczegóły: HTTP ${status}, odpowiedź bez treści)`,
			);
			expect(error.details, String(status)).toBe(
				`HTTP ${status}, odpowiedź bez treści`,
			);
		}
	});

	it("is not sent at all where the cache is switched off", async () => {
		const backend = fakeBackend();
		const error = await failure(
			area(backend, production({ writes: { cache: "off" } })).purge(),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Pamięć podręczna backendu”");
		expect(backend.requests).toEqual([]);
	});
});
