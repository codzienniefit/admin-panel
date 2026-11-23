import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import type { ContentStatus } from "@/data/schemas/common";
import {
	addedAt,
	checkSave,
	conflict,
	conform,
	exactIds,
	exactText,
	exactTitle,
	fingerprint,
	isBackendEtag,
	isoInstantOrNull,
	isoOrNull,
	READ_ONLY_FIELDS,
	readWarnings,
	type SaveCheck,
	savedId,
	sentUpdatedAt,
	sharedLoad,
	statusFields,
	statusFrom,
	statusWatch,
	versionOf,
	wholeNumber,
	withCurrent,
} from "./shared";
import { capabilities, failure, SWITCHED_OFF } from "./testSupport";

// ─── Versions ───────────────────────────────────────────────────────────────

describe("fingerprint", () => {
	it("is eight hex digits", () => {
		expect(fingerprint({ id: "C1", title: "Wiosna" })).toMatch(/^[0-9a-f]{8}$/);
		expect(fingerprint("")).toMatch(/^[0-9a-f]{8}$/);
		expect(fingerprint(null)).toMatch(/^[0-9a-f]{8}$/);
	});

	it("is the same for the same content", () => {
		const row = { id: "C1", paths: [{ levelId: "x", days: [1, 2] }] };
		expect(fingerprint(row)).toBe(fingerprint(structuredClone(row)));
	});

	it("changes with any change to the content", () => {
		const base = fingerprint({ id: "C1", title: "Wiosna", days: [1, 2] });
		expect(fingerprint({ id: "C1", title: "Wiosna!", days: [1, 2] })).not.toBe(
			base,
		);
		expect(fingerprint({ id: "C1", title: "Wiosna", days: [2, 1] })).not.toBe(
			base,
		);
		expect(
			fingerprint({ id: "C1", title: "Wiosna", days: [1, 2], pro: null }),
		).not.toBe(base);
	});

	it("is FNV-1a over the JSON text", () => {
		// Worked out again here with whole-number arithmetic that cannot overflow.
		const reference = (text: string): string => {
			let hash = 0x811c9dc5n;
			for (let i = 0; i < text.length; i++) {
				hash =
					((hash ^ BigInt(text.charCodeAt(i))) * 0x01000193n) % 0x100000000n;
			}
			return hash.toString(16).padStart(8, "0");
		};
		for (const value of [
			1,
			"a",
			{ id: "C1", title: "Żółw 🐢", days: [1, 2, 3] },
			[null, true, { x: "y" }],
		]) {
			expect(fingerprint(value)).toBe(reference(JSON.stringify(value)));
		}
		// The offset basis: what the hash of no text at all is.
		expect(fingerprint(undefined)).toBe("811c9dc5");
	});
});

/** A row of the backend: its version fields, and whatever else it has. */
type Row = Parameters<typeof versionOf>[0] & Record<string, unknown>;

describe("versionOf", () => {
	it("is the backend's own etag when it sends one", () => {
		expect(
			versionOf({
				etag: "W/\"datetime'2026-11-03T12%3A00%3A00.1234567Z'\"",
				updatedAtUtc: "2026-11-03T12:00:00.000Z",
			}),
		).toBe("W/\"datetime'2026-11-03T12%3A00%3A00.1234567Z'\"");
	});

	it("is the time of the last change when there is no etag", () => {
		for (const etag of [undefined, null, ""]) {
			expect(
				versionOf({ etag, updatedAtUtc: "2026-11-03T12:00:00.000Z" }),
			).toBe("t:2026-11-03T12:00:00.000Z");
		}
	});

	it("is a fingerprint of the whole row when it has neither", () => {
		const row: Row = { id: "m1", title: "Nowy plan" };
		expect(versionOf(row)).toBe(`h:${fingerprint(row)}`);
		expect(versionOf({ ...row, updatedAtUtc: null })).toMatch(
			/^h:[0-9a-f]{8}$/,
		);
		expect(versionOf({ ...row, updatedAtUtc: "" })).toMatch(/^h:[0-9a-f]{8}$/);
	});

	it("gives a changed row another version, whichever kind it is", () => {
		expect(versionOf({ etag: "a" })).not.toBe(versionOf({ etag: "b" }));
		expect(versionOf({ updatedAtUtc: "2026-11-03T12:00:00.000Z" })).not.toBe(
			versionOf({ updatedAtUtc: "2026-11-03T12:00:00.001Z" }),
		);
		const row: Row = { id: "m1", title: "Nowy plan" };
		const changed: Row = { ...row, title: "Nowy plan!" };
		expect(versionOf(row)).not.toBe(versionOf(changed));
	});
});

describe("isBackendEtag", () => {
	it.each([
		"W/\"datetime'2026-11-03T12%3A00%3A00.1234567Z'\"",
		'"0x8DC1234"',
		"7",
	])("is true for %j", (etag) => {
		expect(isBackendEtag(etag)).toBe(true);
	});

	it.each(["", "t:2026-11-03T12:00:00.000Z", "h:811c9dc5"])(
		"is false for %j, which the panel worked out itself",
		(etag) => {
			expect(isBackendEtag(etag)).toBe(false);
		},
	);

	it("tells apart every version versionOf can give", () => {
		expect(isBackendEtag(versionOf({ etag: 'W/"1"' }))).toBe(true);
		expect(isBackendEtag(versionOf({ updatedAtUtc: "2026-11-03" }))).toBe(
			false,
		);
		expect(isBackendEtag(versionOf({}))).toBe(false);
	});
});

// ─── Status ─────────────────────────────────────────────────────────────────

describe("statusFrom", () => {
	it("reads a row from before statuses by whether it is hidden", () => {
		expect(statusFrom({ hidden: false })).toBe("published");
		expect(statusFrom({ hidden: true })).toBe("hidden");
		expect(statusFrom({ hidden: null })).toBe("published");
		expect(statusFrom({})).toBe("published");
		expect(statusFrom({ status: null, hidden: true })).toBe("hidden");
	});

	it.each(["draft", "published", "hidden", "deleted"] as const)(
		"takes the status %s when the backend sends it",
		(status) => {
			expect(statusFrom({ status, hidden: status !== "published" })).toBe(
				status,
			);
		},
	);

	it("trusts the status over `hidden`", () => {
		// The backend keeps emitting `hidden = status !== 'published'` (B1).
		expect(statusFrom({ status: "draft", hidden: true })).toBe("draft");
		expect(statusFrom({ status: "deleted", hidden: true })).toBe("deleted");
		expect(statusFrom({ status: "published", hidden: true })).toBe("published");
	});

	it("falls back to `hidden` for a status it does not know", () => {
		expect(statusFrom({ status: "archived", hidden: true })).toBe("hidden");
		expect(statusFrom({ status: "archived", hidden: false })).toBe("published");
		expect(statusFrom({ status: "" })).toBe("published");
	});
});

describe("statusFields", () => {
	const statuses: ContentStatus[] = ["draft", "published", "hidden", "deleted"];

	it("sends the status and the matching `hidden` to a backend with statuses", () => {
		const withStatus = capabilities({ status: true });
		expect(statuses.map((status) => statusFields(status, withStatus))).toEqual([
			{ hidden: true, status: "draft" },
			{ hidden: false, status: "published" },
			{ hidden: true, status: "hidden" },
			{ hidden: true, status: "deleted" },
		]);
	});

	it("sends only `hidden` to a backend without statuses", () => {
		expect(statusFields("published", SWITCHED_OFF)).toEqual({
			hidden: false,
		});
		expect(statusFields("hidden", SWITCHED_OFF)).toEqual({
			hidden: true,
		});
	});

	it("stores a draft as hidden there, never as published", () => {
		expect(statusFields("draft", SWITCHED_OFF)).toEqual({
			hidden: true,
		});
	});

	it("refuses to delete there", () => {
		let thrown: unknown;
		try {
			statusFields("deleted", SWITCHED_OFF);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ApiError);
		const error = thrown as ApiError;
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("nie ma jeszcze kosza");
		expect(error.issues).toEqual([{ path: "status", message: error.message }]);
	});
});

// ─── Fitting answers ────────────────────────────────────────────────────────

describe("conform", () => {
	const schema = z.looseObject({
		id: z.string(),
		days: z.array(z.looseObject({ dayIndex: z.number() })).default([]),
	});

	it("returns the value as the schema reads it, unknown fields kept", () => {
		expect(conform(schema, { id: "C1", future: true }, "Wyzwanie")).toEqual({
			id: "C1",
			days: [],
			future: true,
		});
	});

	it("fails loudly with the name and the field", () => {
		let thrown: unknown;
		try {
			conform(schema, { id: "C1", days: [{ dayIndex: "1" }] }, "Wyzwanie C1");
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ApiError);
		const error = thrown as ApiError;
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Wyzwanie C1: dane nie pasują");
		expect(error.message).toContain("days.0.dayIndex");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"days.0.dayIndex",
		]);
	});

	it("fails for something that is not an entity at all", () => {
		for (const value of [undefined, null, "tekst", []]) {
			expect(() => conform(schema, value, "Wyzwanie")).toThrow(ApiError);
		}
	});

	it("lists at most twenty problems", () => {
		const days = Array.from({ length: 40 }, () => ({ dayIndex: "x" }));
		let thrown: unknown;
		try {
			conform(schema, { id: "C1", days }, "Wyzwanie");
		} catch (error) {
			thrown = error;
		}
		expect((thrown as ApiError).issues).toHaveLength(20);
	});
});

describe("wholeNumber", () => {
	it("keeps a whole number", () => {
		expect(wholeNumber(28, 1)).toBe(28);
		expect(wholeNumber(0, 5)).toBe(0);
	});

	it("cuts a fraction off", () => {
		expect(wholeNumber(28.9, 1)).toBe(28);
		expect(wholeNumber(0.5, 5)).toBe(0);
	});

	it("raises a number below the minimum to it", () => {
		expect(wholeNumber(-3, 5)).toBe(0);
		expect(wholeNumber(0, 5, 1)).toBe(1);
		expect(wholeNumber(0.9, 5, 1)).toBe(1);
	});

	it.each([
		null,
		undefined,
		"28",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		true,
		[28],
	])("uses the fallback for %j", (value) => {
		expect(wholeNumber(value, 7)).toBe(7);
	});
});

describe("isoOrNull", () => {
	it("turns Firebase's dates into ISO", () => {
		expect(isoOrNull("Tue, 03 Nov 2026 12:00:00 GMT")).toBe(
			"2026-11-03T12:00:00.000Z",
		);
		expect(isoOrNull("Mon, 05 Jan 2026 08:30:15 GMT")).toBe(
			"2026-01-05T08:30:15.000Z",
		);
	});

	it("keeps an ISO date as it is", () => {
		expect(isoOrNull("2026-11-03T12:00:00.000Z")).toBe(
			"2026-11-03T12:00:00.000Z",
		);
	});

	it.each(["", "   ", "wczoraj", null, undefined, 1762171200000, new Date(0)])(
		"is null for %j",
		(value) => {
			expect(isoOrNull(value)).toBeNull();
		},
	);
});

// ─── Saving ─────────────────────────────────────────────────────────────────

describe("conflict", () => {
	it("is a conflict that carries the stored entity and the status", () => {
		const current = { id: "C1", etag: "t:2" };
		const error = conflict(current, 409);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.kind).toBe("conflict");
		expect(error.message).toBe("Ktoś zmienił to w międzyczasie.");
		expect(error.current).toBe(current);
		expect(error.status).toBe(409);
	});

	it("can be one the panel found itself, without a status", () => {
		const error = conflict(undefined);
		expect(error.kind).toBe("conflict");
		expect(error.current).toBeUndefined();
		expect(error.status).toBeUndefined();
	});
});

interface Item {
	id: string;
	etag: string;
	comment: string | null;
}

describe("checkSave", () => {
	const BACKEND_ETAG = "W/\"datetime'2026-11-03T12%3A00%3A00.1234567Z'\"";

	function setup(options: {
		capabilities: SaveCheck<Item>["capabilities"];
		incoming?: Partial<Item>;
		stored?: Partial<Item> | Error;
		etag?: string;
	}) {
		const incoming: Item = {
			id: "W1",
			etag: "t:1",
			comment: "[TEST] nowe",
			...options.incoming,
		};
		const stored =
			options.stored instanceof Error
				? options.stored
				: {
						id: "W1",
						etag: "t:1",
						comment: "[TEST] zapisane",
						...options.stored,
					};
		const readStored = vi.fn(async () => {
			if (stored instanceof Error) throw stored;
			return stored;
		});
		const check: SaveCheck<Item> = {
			capabilities: options.capabilities,
			area: "workouts",
			incoming,
			etag: options.etag ?? incoming.etag,
			readStored,
			markOf: (item) => item.comment,
			field: "Komentarz wewnętrzny",
			path: "internalTitle",
		};
		return { check, readStored, stored, incoming };
	}

	describe("off", () => {
		it("refuses without a single request", async () => {
			const { check, readStored } = setup({
				capabilities: SWITCHED_OFF,
			});
			const error = await failure(checkSave(check));
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("tylko do odczytu");
			expect(error.message).toContain("„Treningi”");
			expect(readStored).not.toHaveBeenCalled();
		});

		it("refuses even when the backend has etags", async () => {
			const { check, readStored } = setup({
				capabilities: capabilities({ etag: true }),
				etag: BACKEND_ETAG,
			});
			expect((await failure(checkSave(check))).kind).toBe("validation");
			expect(readStored).not.toHaveBeenCalled();
		});
	});

	describe("test-only", () => {
		const testOnly = capabilities({ writes: { workouts: "test-only" } });

		it("refuses an unmarked change before reading anything", async () => {
			const { check, readStored } = setup({
				capabilities: testOnly,
				incoming: { comment: "bez znaku" },
			});
			const error = await failure(checkSave(check));
			expect(error.kind).toBe("validation");
			expect(error.issues).toEqual([
				{ path: "internalTitle", message: error.message },
			]);
			expect(error.message).toContain("„Komentarz wewnętrzny”");
			expect(readStored).not.toHaveBeenCalled();
		});

		it("reads the stored item once and lets a test item through", async () => {
			const { check, readStored } = setup({ capabilities: testOnly });
			expect(await checkSave(check)).toEqual({});
			expect(readStored).toHaveBeenCalledTimes(1);
		});

		it("refuses when the stored item is not a test item", async () => {
			// Otherwise adding the mark would be a way to change real content.
			const { check, readStored } = setup({
				capabilities: testOnly,
				stored: { comment: "prawdziwy trening" },
			});
			const error = await failure(checkSave(check));
			expect(error.kind).toBe("validation");
			expect(error.issues).toEqual([
				{ path: "internalTitle", message: error.message },
			]);
			expect(error.message).toContain("także w wersji już zapisanej");
			expect(readStored).toHaveBeenCalledTimes(1);
		});

		it("refuses when the stored item has no comment at all", async () => {
			const { check } = setup({
				capabilities: testOnly,
				stored: { comment: null },
			});
			expect((await failure(checkSave(check))).kind).toBe("validation");
		});

		it("reports a conflict, with the stored item, when someone changed it", async () => {
			const { check, stored, readStored } = setup({
				capabilities: testOnly,
				stored: { etag: "t:2" },
			});
			const error = await failure(checkSave(check));
			expect(error.kind).toBe("conflict");
			expect(error.current).toBe(stored);
			expect(readStored).toHaveBeenCalledTimes(1);
		});

		it("checks the mark before the version", async () => {
			const { check } = setup({
				capabilities: testOnly,
				stored: { etag: "t:2", comment: "prawdziwy trening" },
			});
			expect((await failure(checkSave(check))).kind).toBe("validation");
		});

		it("also sends If-Match once the backend has etags", async () => {
			const { check, readStored } = setup({
				capabilities: capabilities({
					writes: { workouts: "test-only" },
					etag: true,
				}),
				incoming: { etag: BACKEND_ETAG },
				stored: { etag: BACKEND_ETAG },
			});
			expect(await checkSave(check)).toEqual({ "if-match": BACKEND_ETAG });
			expect(readStored).toHaveBeenCalledTimes(1);
		});

		it("passes on a failure to read the stored item", async () => {
			const gone = new ApiError("notFound", "Workout W1 not found", {
				status: 404,
			});
			const { check } = setup({ capabilities: testOnly, stored: gone });
			expect(await failure(checkSave(check))).toBe(gone);
		});
	});

	describe("on, backend without etags", () => {
		const on = capabilities({ writes: { workouts: "on" } });

		it("reads the stored item once and compares versions", async () => {
			const { check, readStored } = setup({ capabilities: on });
			expect(await checkSave(check)).toEqual({});
			expect(readStored).toHaveBeenCalledTimes(1);
		});

		it("does not ask for the test mark", async () => {
			const { check } = setup({
				capabilities: on,
				incoming: { comment: null },
				stored: { comment: "prawdziwy trening" },
			});
			expect(await checkSave(check)).toEqual({});
		});

		it("reports a conflict when the stored version is another one", async () => {
			const { check, stored } = setup({
				capabilities: on,
				stored: { etag: "t:2" },
			});
			const error = await failure(checkSave(check));
			expect(error.kind).toBe("conflict");
			expect(error.current).toBe(stored);
		});

		it("compares with the version the change is based on, not the entity's", async () => {
			const { check } = setup({
				capabilities: on,
				incoming: { etag: "t:2" },
				stored: { etag: "t:2" },
				etag: "t:1",
			});
			expect((await failure(checkSave(check))).kind).toBe("conflict");
		});

		it("sends no If-Match the backend would not understand", async () => {
			const { check } = setup({
				capabilities: on,
				incoming: { etag: BACKEND_ETAG },
				stored: { etag: BACKEND_ETAG },
			});
			expect(await checkSave(check)).toEqual({});
		});
	});

	describe("on, backend with etags", () => {
		it("reads nothing and lets the backend refuse a stale save", async () => {
			const { check, readStored } = setup({
				capabilities: ALL_CAPABILITIES,
				incoming: { etag: BACKEND_ETAG, comment: null },
			});
			expect(await checkSave(check)).toEqual({ "if-match": BACKEND_ETAG });
			expect(readStored).not.toHaveBeenCalled();
		});

		// Such a version means nothing to the backend, so it cannot refuse a
		// stale save. The stored copy is read instead, as without etags.
		it.each(["t:2026-11-03T12:00:00.000Z", "h:811c9dc5", ""])(
			"checks %j, a version the panel worked out, against a fresh read",
			async (etag) => {
				const same = setup({
					capabilities: ALL_CAPABILITIES,
					incoming: { etag },
					stored: { etag },
				});
				expect(await checkSave(same.check)).toEqual({});
				expect(same.readStored).toHaveBeenCalledTimes(1);

				const changed = setup({
					capabilities: ALL_CAPABILITIES,
					incoming: { etag },
					stored: { etag: "t:later" },
				});
				await expect(checkSave(changed.check)).rejects.toMatchObject({
					kind: "conflict",
					current: changed.stored,
				});
			},
		);
	});
});

describe("withCurrent", () => {
	const fromAnswer = (raw: unknown) => ({ mapped: raw });

	it("returns what the write returned", async () => {
		const map = vi.fn(fromAnswer);
		const reread = vi.fn(async () => ({ mapped: "reread" }));
		expect(await withCurrent(async () => "saved", map, reread)).toBe("saved");
		expect(map).not.toHaveBeenCalled();
		expect(reread).not.toHaveBeenCalled();
	});

	it("passes on any error that is not a conflict", async () => {
		const reread = vi.fn(async () => ({ mapped: "reread" }));
		for (const thrown of [
			new ApiError("validation", "Nie", { status: 500 }),
			new ApiError("network", "Brak sieci"),
			new ApiError("notFound", "Nie ma", { status: 404 }),
			new TypeError("boom"),
		]) {
			const run = withCurrent(
				async () => {
					throw thrown;
				},
				fromAnswer,
				reread,
			);
			await expect(run).rejects.toBe(thrown);
		}
		expect(reread).not.toHaveBeenCalled();
	});

	it("maps the stored entity the backend sent with the conflict", async () => {
		const reread = vi.fn(async () => ({ mapped: "reread" }));
		const error = await failure(
			withCurrent(
				async () => {
					throw new ApiError("conflict", "Conflict", {
						current: { id: "C1", etag: 'W/"2"' },
						status: 409,
					});
				},
				fromAnswer,
				reread,
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual({ mapped: { id: "C1", etag: 'W/"2"' } });
		expect(error.status).toBe(409);
		expect(reread).not.toHaveBeenCalled();
	});

	it("reads the entity again when the conflict came without it", async () => {
		const map = vi.fn(fromAnswer);
		const reread = vi.fn(async () => ({ mapped: "reread" }));
		const error = await failure(
			withCurrent(
				async () => {
					throw new ApiError("conflict", "Precondition Failed", {
						status: 412,
					});
				},
				map,
				reread,
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual({ mapped: "reread" });
		expect(error.status).toBe(412);
		expect(map).not.toHaveBeenCalled();
		expect(reread).toHaveBeenCalledTimes(1);
	});

	it("reads the entity again when what came with the conflict cannot be mapped", async () => {
		const reread = vi.fn(async () => ({ mapped: "reread" }));
		const error = await failure(
			withCurrent(
				async () => {
					throw new ApiError("conflict", "Conflict", {
						current: "not an entity",
						status: 409,
					});
				},
				() => {
					throw new ApiError("server", "dane nie pasują");
				},
				reread,
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual({ mapped: "reread" });
		expect(reread).toHaveBeenCalledTimes(1);
	});

	it("is still a conflict when the entity cannot be had either way", async () => {
		const error = await failure(
			withCurrent(
				async () => {
					throw new ApiError("conflict", "Conflict", {
						current: "not an entity",
						status: 409,
					});
				},
				() => {
					throw new Error("cannot map");
				},
				async () => {
					throw new ApiError("network", "Brak sieci");
				},
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toBeUndefined();
		expect(error.status).toBe(409);
	});

	it("keeps a conflict the panel found itself a conflict", async () => {
		const stored = { id: "C1", etag: "t:2" };
		const error = await failure(
			withCurrent(
				async () => {
					throw conflict(stored);
				},
				fromAnswer,
				async () => ({ mapped: "reread" }),
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual({ mapped: stored });
		expect(error.status).toBeUndefined();
	});
});

// ─── Small helpers ──────────────────────────────────────────────────────────

/** A load the test finishes by hand. */
function controlled<T>() {
	const pending: {
		resolve: (value: T) => void;
		reject: (error: unknown) => void;
	}[] = [];
	const load = vi.fn(
		() =>
			new Promise<T>((resolve, reject) => {
				pending.push({ resolve, reject });
			}),
	);
	const next = () => {
		const first = pending.shift();
		if (!first) throw new Error("test: no load is running");
		return first;
	};
	return { load, next };
}

describe("sharedLoad", () => {
	it("gives callers that ask at the same moment one load", async () => {
		const { load, next } = controlled<string[]>();
		const shared = sharedLoad(load);
		const first = shared.fresh();
		const second = shared.fresh();
		const third = shared.recent(10_000);
		expect(load).toHaveBeenCalledTimes(1);
		next().resolve(["C1"]);
		expect(await Promise.all([first, second, third])).toEqual([
			["C1"],
			["C1"],
			["C1"],
		]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("loads again for every `fresh` once the last load is over", async () => {
		const load = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("one")
			.mockResolvedValueOnce("two");
		const shared = sharedLoad(load);
		expect(await shared.fresh()).toBe("one");
		expect(await shared.fresh()).toBe("two");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("answers `recent` from the last result while it is young enough", async () => {
		let now = 1_000;
		const load = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("one")
			.mockResolvedValueOnce("two");
		const shared = sharedLoad(load, () => now);
		expect(await shared.fresh()).toBe("one");

		now = 10_999;
		expect(await shared.recent(10_000)).toBe("one");
		expect(load).toHaveBeenCalledTimes(1);

		now = 11_000;
		expect(await shared.recent(10_000)).toBe("two");
		expect(load).toHaveBeenCalledTimes(2);

		// The age counts from when that second load finished.
		now = 20_999;
		expect(await shared.recent(10_000)).toBe("two");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("loads for `recent` when nothing was loaded yet", async () => {
		const load = vi.fn(async () => "one");
		const shared = sharedLoad(load, () => 0);
		expect(await shared.recent(10_000)).toBe("one");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("never answers `recent` with a window of zero from memory", async () => {
		const load = vi.fn(async () => "one");
		const shared = sharedLoad(load, () => 5);
		await shared.fresh();
		await shared.recent(0);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("measures the age from the end of the load, not from its start", async () => {
		let now = 0;
		const { load, next } = controlled<string>();
		const shared = sharedLoad(load, () => now);
		const first = shared.fresh();
		now = 9_000;
		next().resolve("one");
		await first;
		now = 18_000;
		expect(await shared.recent(10_000)).toBe("one");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("fails every caller of a failed load, and does not remember it", async () => {
		const { load, next } = controlled<string>();
		const shared = sharedLoad(load, () => 0);
		const first = shared.fresh();
		const second = shared.recent(10_000);
		const down = new ApiError("network", "Brak sieci");
		next().reject(down);
		await expect(first).rejects.toBe(down);
		await expect(second).rejects.toBe(down);

		const again = shared.recent(10_000);
		expect(load).toHaveBeenCalledTimes(2);
		next().resolve("one");
		expect(await again).toBe("one");
	});

	it("keeps the last good result through a failure", async () => {
		let now = 0;
		const load = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("one")
			.mockRejectedValueOnce(new ApiError("network", "Brak sieci"))
			.mockResolvedValueOnce("three");
		const shared = sharedLoad(load, () => now);
		await shared.fresh();
		now = 1_000;
		await expect(shared.fresh()).rejects.toMatchObject({ kind: "network" });
		expect(await shared.recent(10_000)).toBe("one");
		expect(await shared.fresh()).toBe("three");
		expect(load).toHaveBeenCalledTimes(3);
	});
});

describe("savedId", () => {
	const CHALLENGE = /Challenge (\S+) updated/;
	const WORKOUT = /Workout (\S+) updated/;

	it("reads the id of the saved entity, the planned answer", () => {
		expect(
			savedId({ id: "C12", etag: 'W/"1"', title: "Wiosna" }, CHALLENGE),
		).toBe("C12");
	});

	it("reads the id of the stored row next to the sentence", () => {
		// `{ result, update: <the internal model, PascalCase> }` (audit §1a).
		expect(
			savedId(
				{
					result: "Challenge C13 updated",
					update: { Id: "C13", Title: "Wiosna", Hidden: false },
				},
				CHALLENGE,
			),
		).toBe("C13");
		expect(savedId({ update: { id: "C14" } }, CHALLENGE)).toBe("C14");
	});

	it("reads the id out of the sentence when that is all there is", () => {
		expect(savedId({ result: "Workout W12 updated" }, WORKOUT)).toBe("W12");
		expect(savedId({ result: "Workout dQw4w9WgXcQ updated" }, WORKOUT)).toBe(
			"dQw4w9WgXcQ",
		);
		expect(savedId({ result: "Workout a_b-c updated" }, WORKOUT)).toBe("a_b-c");
	});

	it("prefers the entity's id, then the stored row's, then the sentence", () => {
		expect(
			savedId(
				{ id: "A", update: { Id: "B" }, result: "Challenge C updated" },
				CHALLENGE,
			),
		).toBe("A");
		expect(
			savedId(
				{ update: { Id: "B" }, result: "Challenge C updated" },
				CHALLENGE,
			),
		).toBe("B");
		expect(
			savedId(
				{ id: "", update: { Id: "" }, result: "Challenge C updated" },
				CHALLENGE,
			),
		).toBe("C");
	});

	it.each([
		undefined,
		null,
		"Workout W12 updated",
		["W12"],
		{},
		{ result: "Saved" },
		{ result: 12 },
		{ id: 12 },
		{ update: { Id: 12 } },
		{ update: "W12" },
	])("is null for %j", (raw) => {
		expect(savedId(raw, WORKOUT)).toBeNull();
	});

	it("does not read another entity's sentence", () => {
		expect(savedId({ result: "Challenge C1 updated" }, WORKOUT)).toBeNull();
	});
});

// ─── What the backend added on 2026-11-13 ───────────────────────────────────

describe("sharedLoad: the last result", () => {
	it("has none before the first load, and makes none", () => {
		const load = vi.fn<() => Promise<string>>().mockResolvedValue("one");
		const shared = sharedLoad(load);
		expect(shared.last()).toBeUndefined();
		expect(load).not.toHaveBeenCalled();
	});

	it("is the last result however old, without loading again", async () => {
		let now = 1_000;
		const load = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("one")
			.mockResolvedValueOnce("two");
		const shared = sharedLoad(load, () => now);
		await shared.fresh();
		now = 10_000_000;
		expect(shared.last()).toBe("one");
		expect(load).toHaveBeenCalledTimes(1);
		await shared.fresh();
		expect(shared.last()).toBe("two");
	});

	it("keeps the last good result when a later load fails", async () => {
		const load = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("one")
			.mockRejectedValueOnce(new ApiError("server", "503"));
		const shared = sharedLoad(load);
		await shared.fresh();
		await expect(shared.fresh()).rejects.toBeInstanceOf(ApiError);
		expect(shared.last()).toBe("one");
	});
});

describe("readWarnings", () => {
	it("reads what a save of a draft says publishing would refuse", () => {
		// manageChallengesEditing.test.ts: a new draft that has only a title.
		expect(
			readWarnings([
				{
					path: "imageRelativePath",
					code: "REQUIRED",
					message: "Wybierz miniaturkę",
				},
				{
					path: "lengthDays",
					code: "OUT_OF_RANGE",
					message: "lengthDays musi być dodatnią liczbą całkowitą",
				},
				{
					path: "paths",
					code: "REQUIRED",
					message: "Dodaj przynajmniej jedną ścieżkę do wyzwania",
				},
			]),
		).toEqual([
			{
				path: "imageRelativePath",
				code: "REQUIRED",
				message: "Wybierz miniaturkę",
			},
			{
				path: "lengthDays",
				code: "OUT_OF_RANGE",
				message: "lengthDays musi być dodatnią liczbą całkowitą",
			},
			{
				path: "paths",
				code: "REQUIRED",
				message: "Dodaj przynajmniej jedną ścieżkę do wyzwania",
			},
		]);
	});

	it("is empty for a save that has none, or says so in any other way", () => {
		for (const raw of [[], undefined, null, "x", { path: "a" }, 3]) {
			expect(readWarnings(raw)).toEqual([]);
		}
	});

	it("drops what is not a warning and keeps the rest", () => {
		expect(
			readWarnings([
				null,
				"tekst",
				{ path: "title", code: "REQUIRED" },
				{ path: "title", code: "REQUIRED", message: "   " },
				{ code: "X", message: "bez miejsca" },
				{ path: 3, message: "liczba jako miejsce" },
				{ path: "a", message: "bez kodu" },
			]),
		).toEqual([
			{ path: "", code: "X", message: "bez miejsca" },
			{ path: "", code: "", message: "liczba jako miejsce" },
			{ path: "a", code: "", message: "bez kodu" },
		]);
	});

	it("names each place the way the caller wants it", () => {
		expect(
			readWarnings(
				[{ path: "paths.0.days", code: "REQUIRED", message: "x" }],
				(path) => path.replace("paths.0", "paths.p_1"),
			),
		).toEqual([{ path: "paths.p_1.days", code: "REQUIRED", message: "x" }]);
	});
});

describe("READ_ONLY_FIELDS", () => {
	it("lists what the backend keeps about an item itself", () => {
		expect([...READ_ONLY_FIELDS].toSorted()).toEqual([
			"deletedAtUtc",
			"deletedBy",
			"warnings",
		]);
	});
});

describe("statusWatch", () => {
	interface Item {
		id: string;
		etag: string;
		status: ContentStatus;
		title: string;
		paths?: { levelId: string; days: number[] }[];
		warnings?: unknown[];
	}
	const stored: Item = {
		id: "C1",
		etag: 'W/"1"',
		status: "draft",
		title: "Plan",
		paths: [{ levelId: "beginner", days: [1, 2] }],
	};

	it("knows a change of status and nothing else", () => {
		const watch = statusWatch<Item>();
		expect(watch.remember(stored)).toBe(stored);
		expect(
			watch.onlyStatusChanged({ ...stored, status: "published" }, 'W/"1"'),
		).toBe(true);
	});

	it("is not fooled by the order of fields or by a copy", () => {
		const watch = statusWatch<Item>();
		watch.remember(stored);
		const copy: Item = {
			paths: [{ days: [1, 2], levelId: "beginner" }],
			title: "Plan",
			status: "hidden",
			etag: 'W/"1"',
			id: "C1",
		};
		expect(watch.onlyStatusChanged(copy, 'W/"1"')).toBe(true);
	});

	it("does not count the etag the entity itself carries, or old warnings", () => {
		const watch = statusWatch<Item>();
		watch.remember({ ...stored, warnings: [{ path: "paths", message: "x" }] });
		expect(
			watch.onlyStatusChanged(
				{ ...stored, status: "published", etag: 'W/"other"' },
				'W/"1"',
			),
		).toBe(true);
	});

	it.each<[string, Item]>([
		[
			"the title changed too",
			{ ...stored, status: "published", title: "Plan!" },
		],
		[
			"a day changed too",
			{
				...stored,
				status: "published",
				paths: [{ levelId: "beginner", days: [1, 3] }],
			},
		],
		[
			"a field was added",
			{ ...stored, status: "published", ...{ categoryId: "main" } },
		],
		[
			"a field was removed",
			{ id: "C1", etag: 'W/"1"', status: "published", title: "Plan" },
		],
		["the status did not change", { ...stored }],
	])("says no when %s", (_what, incoming) => {
		const watch = statusWatch<Item>();
		watch.remember(stored);
		expect(watch.onlyStatusChanged(incoming, 'W/"1"')).toBe(false);
	});

	it("says no for a version it has not seen", () => {
		const watch = statusWatch<Item>();
		const published: Item = { ...stored, status: "published" };
		// Nothing remembered at all.
		expect(watch.onlyStatusChanged(published, 'W/"1"')).toBe(false);
		watch.remember(stored);
		// Based on another version than the one seen.
		expect(watch.onlyStatusChanged(published, 'W/"0"')).toBe(false);
		// Another item.
		expect(watch.onlyStatusChanged({ ...published, id: "C2" }, 'W/"1"')).toBe(
			false,
		);
	});

	it("says no when part of the item was made up here", () => {
		const watch = statusWatch<Item>();
		watch.remember(stored, false);
		expect(
			watch.onlyStatusChanged({ ...stored, status: "published" }, 'W/"1"'),
		).toBe(false);
		// Its stored status is still known.
		expect(watch.storedStatus("C1", 'W/"1"')).toBe("draft");
	});

	it("goes by the latest version it was shown", () => {
		const watch = statusWatch<Item>();
		watch.remember(stored);
		watch.remember({ ...stored, etag: 'W/"2"', title: "Plan 2" });
		expect(
			watch.onlyStatusChanged({ ...stored, status: "published" }, 'W/"1"'),
		).toBe(false);
		expect(
			watch.onlyStatusChanged(
				{ ...stored, etag: 'W/"2"', title: "Plan 2", status: "published" },
				'W/"2"',
			),
		).toBe(true);
	});

	it("tells the stored status of the version asked about, and of no other", () => {
		const watch = statusWatch<Item>();
		expect(watch.storedStatus("C1", 'W/"1"')).toBeUndefined();
		watch.remember({ ...stored, status: "deleted" });
		expect(watch.storedStatus("C1", 'W/"1"')).toBe("deleted");
		expect(watch.storedStatus("C1", 'W/"2"')).toBeUndefined();
		expect(watch.storedStatus("C2", 'W/"1"')).toBeUndefined();
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("exactText", () => {
	it("takes the white space off both ends of an id, a path or an address", () => {
		expect(exactText(" strength ")).toBe("strength");
		expect(exactText("challenges/c.png \n")).toBe("challenges/c.png");
		expect(exactText("b1")).toBe("b1");
	});

	it("is null when nothing is left", () => {
		expect(exactText("")).toBeNull();
		expect(exactText("  \t")).toBeNull();
	});

	it("leaves the inside of a text, and anything that is not a text, alone", () => {
		expect(exactText("dwa  słowa")).toBe("dwa  słowa");
		for (const value of [null, undefined, 5, false, ["a "]]) {
			expect(exactText(value)).toBe(value);
		}
	});
});

describe("exactIds", () => {
	it("drops an empty entry and a repeated one, and keeps the order", () => {
		// manageChallengesEditing.test.ts: "a goal named twice", "an empty goal",
		// "a difficulty level padded with spaces".
		expect(exactIds(["weightloss", "weightloss"])).toEqual(["weightloss"]);
		expect(exactIds(["weightloss", ""])).toEqual(["weightloss"]);
		expect(exactIds([" easy"])).toEqual(["easy"]);
		expect(exactIds(["b", "a", " b ", "", "c", "a"])).toEqual(["b", "a", "c"]);
		expect(exactIds([])).toEqual([]);
	});

	it("gives back a new list and does not change the one it was given", () => {
		const given = ["a", "a"];
		expect(exactIds(given)).not.toBe(given);
		expect(given).toEqual(["a", "a"]);
	});

	it("leaves what is not a text in the list, for the backend to refuse", () => {
		expect(exactIds(["a", 5, null, "a"])).toEqual(["a", 5, null]);
	});

	it("leaves what is not a list alone", () => {
		for (const value of [null, undefined, "a,b", { 0: "a" }]) {
			expect(exactIds(value)).toBe(value);
		}
	});
});

describe("exactTitle", () => {
	it("takes off the white space around a title", () => {
		expect(exactTitle("  Wiosenne wyzwanie\n")).toBe("Wiosenne wyzwanie");
		expect(exactTitle("Dwa  słowa")).toBe("Dwa  słowa");
		expect(exactTitle("   ")).toBe("");
	});

	it("takes out what nobody can see: a zero-width space, a byte order mark, control characters", () => {
		expect(exactTitle("\ufeffWiosenne\u200b wyzwanie\u0000\u0007\u009f")).toBe(
			"Wiosenne wyzwanie",
		);
		// and then the space that was hidden behind it
		expect(exactTitle("Wiosna \u200b")).toBe("Wiosna");
	});

	it("keeps an emoji written with a zero-width joiner, and every letter", () => {
		for (const title of [
			"Bieg 🏃‍♀️ wiosenny",
			"Zażółć gęślą jaźń",
			"10 × 3 — siła",
		]) {
			expect(exactTitle(title)).toBe(title);
		}
	});

	it("leaves a line break or a tab inside for the backend to refuse", () => {
		expect(exactTitle("Dwie\nlinie")).toBe("Dwie\nlinie");
		expect(exactTitle("Z\ttabulatorem")).toBe("Z\ttabulatorem");
		expect(exactTitle("Dwa\u2028akapity")).toBe("Dwa\u2028akapity");
	});

	it("leaves anything that is not a text alone", () => {
		expect(exactTitle(null)).toBeNull();
		expect(exactTitle(undefined)).toBeUndefined();
		expect(exactTitle(7)).toBe(7);
	});
});

describe("isoInstantOrNull", () => {
	it("keeps a full instant as it is", () => {
		for (const value of [
			"2026-01-31T00:00:00.000Z",
			"2026-01-31T00:00:00Z",
			"2026-01-31T01:00:00+01:00",
			"2026-01-31T00:00:00.1234567Z",
		]) {
			expect(isoInstantOrNull(value)).toBe(value);
		}
		expect(isoInstantOrNull(" 2026-01-31T00:00:00.000Z ")).toBe(
			"2026-01-31T00:00:00.000Z",
		);
	});

	it("is null for no date: the backend does not take an empty text for one", () => {
		expect(isoInstantOrNull("")).toBeNull();
		expect(isoInstantOrNull("   ")).toBeNull();
		expect(isoInstantOrNull(null)).toBeNull();
	});

	it("writes out in full a moment that names its zone another way", () => {
		expect(isoInstantOrNull("2026-01-31T00:00Z")).toBe(
			"2026-01-31T00:00:00.000Z",
		);
		expect(isoInstantOrNull("2026-01-31T01:30+01:00")).toBe(
			"2026-01-31T00:30:00.000Z",
		);
	});

	it("does not guess a moment from a date without a time or a zone", () => {
		for (const value of [
			"2026-01-31",
			"2026-01-31T10:00:00",
			"2026-01-31T10:00",
			"31.01.2026",
			"w lutym",
			"Tue, 03 Nov 2026 12:00:00 GMT",
		]) {
			expect(isoInstantOrNull(value)).toBe(value);
		}
	});

	it("leaves anything that is not a text alone", () => {
		expect(isoInstantOrNull(undefined)).toBeUndefined();
		expect(isoInstantOrNull(1767225600000)).toBe(1767225600000);
	});

	it("writes out a moment with more digits after the second than the route takes", () => {
		// Challenges and workouts take three; the storage's own times have seven.
		expect(isoInstantOrNull("2026-01-31T00:00:00.1234567Z", 3)).toBe(
			"2026-01-31T00:00:00.123Z",
		);
		expect(isoInstantOrNull("2026-01-31T00:00:00.123Z", 3)).toBe(
			"2026-01-31T00:00:00.123Z",
		);
		expect(isoInstantOrNull("2026-01-31T01:00:00+01:00", 3)).toBe(
			"2026-01-31T01:00:00+01:00",
		);
	});

	it("never turns a day that does not exist into another day", () => {
		// `new Date` would make each of these a day in March without a word.
		for (const value of [
			"2026-02-31T00:00Z",
			"2026-02-30T10:00+01:00",
			"2026-02-31T00:00:00.1234567Z",
			"2026-13-01T00:00Z",
		]) {
			expect(isoInstantOrNull(value, 3), value).toBe(value);
		}
		// A full instant of such a day is the backend's to refuse, as it is.
		expect(isoInstantOrNull("2026-02-31T00:00:00.000Z")).toBe(
			"2026-02-31T00:00:00.000Z",
		);
	});
});

describe("sentUpdatedAt", () => {
	const sent = (updatedAtUtc: unknown) => {
		const body: Record<string, unknown> = { title: "x", updatedAtUtc };
		sentUpdatedAt(body);
		return body;
	};

	it("sends back a full instant as it is", () => {
		expect(sent("2026-11-03T12:00:00.000Z").updatedAtUtc).toBe(
			"2026-11-03T12:00:00.000Z",
		);
		expect(sent("2026-11-03T12:00:00Z").updatedAtUtc).toBe(
			"2026-11-03T12:00:00Z",
		);
	});

	it("writes out in full what only differs in spelling", () => {
		expect(sent("2026-11-03T12:00:00.1234567Z").updatedAtUtc).toBe(
			"2026-11-03T12:00:00.123Z",
		);
	});

	it("leaves out what the backend would refuse at a field no form has", () => {
		for (const value of [
			"",
			null,
			undefined,
			"2026-11-03",
			"2026-11-03T12:00:00",
			"2026-02-31T12:00:00.000Z",
			"1970-01-01T00:00:00.000Z",
			"2101-01-01T00:00:00.000Z",
			"Tue, 03 Nov 2026 12:00:00 GMT",
			1767225600000,
		]) {
			expect(sent(value), String(value)).toEqual({ title: "x" });
		}
	});
});

describe("addedAt", () => {
	const now = () => "2026-11-13T10:00:00.000Z";

	it("keeps the date an item has", () => {
		const body = { addedAtUtc: "2026-03-01T08:00:00.000Z" };
		addedAt(body, false, now);
		addedAt(body, true, now);
		expect(body.addedAtUtc).toBe("2026-03-01T08:00:00.000Z");
	});

	it("gives a new item the present moment when it has none", () => {
		for (const addedAtUtc of ["", "  ", null, undefined]) {
			const body: Record<string, unknown> = { addedAtUtc };
			addedAt(body, true, now);
			expect(body.addedAtUtc).toBe("2026-11-13T10:00:00.000Z");
		}
	});

	it("leaves the field out for a stored item, so its stored date is kept", () => {
		const body: Record<string, unknown> = { addedAtUtc: "", title: "x" };
		addedAt(body, false, now);
		expect(body).toEqual({ title: "x" });
	});
});

describe("statusWatch: a version part of which was made up", () => {
	interface Item {
		id: string;
		etag: string;
		status: ContentStatus;
		title: string;
	}
	const stored: Item = {
		id: "C1",
		etag: 'W/"1"',
		status: "published",
		title: "Plan",
	};

	it("counts as a change of status alone only when asked to count it", () => {
		const watch = statusWatch<Item>();
		watch.remember(stored, false);
		const hidden: Item = { ...stored, status: "hidden" };
		expect(watch.onlyStatusChanged(hidden, 'W/"1"')).toBe(false);
		expect(watch.onlyStatusChanged(hidden, 'W/"1"', false)).toBe(false);
		expect(watch.onlyStatusChanged(hidden, 'W/"1"', true)).toBe(true);
	});

	it("still needs everything else to be untouched, and the version to be the one seen", () => {
		const watch = statusWatch<Item>();
		watch.remember(stored, false);
		expect(
			watch.onlyStatusChanged(
				{ ...stored, status: "hidden", title: "x" },
				'W/"1"',
				true,
			),
		).toBe(false);
		expect(
			watch.onlyStatusChanged({ ...stored, status: "hidden" }, 'W/"0"', true),
		).toBe(false);
		expect(statusWatch<Item>().onlyStatusChanged(stored, 'W/"1"', true)).toBe(
			false,
		);
	});
});
