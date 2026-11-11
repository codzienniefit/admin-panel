import { describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";
import {
	CALL_LOG_LIMIT,
	type CallLog,
	clearCallLog,
	markCallsSeen,
	severityOf,
	snapshot,
	statusOf,
	withCallLog,
} from "./callLog";
import { ApiError } from "./errors";

function setup() {
	const log = createStore<CallLog>({ entries: [], unseenFailures: 0 });
	let time = 1000;
	const saved: unknown[] = [];
	const client = withCallLog(
		{
			challenges: {
				async list() {
					time += 120;
					return [{ id: "C1", title: "Wiosenny start" }];
				},
				async save(
					challenge: { id: string; title: string },
					options: { etag: string },
				) {
					time += 80;
					saved.push([challenge, options]);
					if (options.etag === "stary") {
						throw new ApiError("conflict", "Ktoś inny zapisał", {
							current: { id: challenge.id, etag: "8" },
						});
					}
					if (!challenge.title) {
						throw new ApiError("validation", "Nazwa jest wymagana", {
							issues: [{ path: "title", message: "Nazwa jest wymagana" }],
						});
					}
					return { ...challenge, etag: "8" };
				},
				async remove() {
					throw new ApiError("server", "Błąd serwera");
				},
				async ping() {
					throw new ApiError("network", "Brak połączenia");
				},
				async broken() {
					throw new TypeError("x is not a function");
				},
				async nothing() {},
			},
			media: {
				urlFor: (path: string) => `https://media.example/${path}`,
				async upload(
					file: Blob,
					options: { relativePath: string; onProgress?: () => void },
				) {
					return { relativePath: options.relativePath, size: file.size };
				},
			},
		},
		{ log, now: () => time },
	);
	return { client, log, saved, entries: () => log.get().entries };
}

describe("a call that works", () => {
	it("is written down with what it was given and what came back", async () => {
		const { client, entries } = setup();
		const result = await client.challenges.save(
			{ id: "C1", title: "Wiosenny start 2027" },
			{ etag: "7" },
		);
		expect(result).toEqual({
			id: "C1",
			title: "Wiosenny start 2027",
			etag: "8",
		});
		expect(entries()).toEqual([
			{
				id: 1,
				at: 1000,
				name: "challenges.save",
				args: [{ id: "C1", title: "Wiosenny start 2027" }, { etag: "7" }],
				state: "ok",
				status: 200,
				durationMs: 80,
				result: { id: "C1", title: "Wiosenny start 2027", etag: "8" },
			},
		]);
	});

	it("is there as 'pending' while it runs", () => {
		const { client, entries } = setup();
		void client.challenges.list();
		expect(entries()).toMatchObject([
			{
				name: "challenges.list",
				state: "pending",
				status: null,
				durationMs: null,
			},
		]);
	});

	it("does not change what the caller gets or what the server is sent", async () => {
		const { client, saved } = setup();
		const challenge = { id: "C1", title: "Bez zmian" };
		const options = { etag: "7" };
		await client.challenges.save(challenge, options);
		expect(saved[0]).toEqual([challenge, options]);
		// The very same objects, not copies.
		expect((saved[0] as unknown[])[0]).toBe(challenge);
	});

	it("keeps the newest call first", async () => {
		const { client, entries } = setup();
		await client.challenges.list();
		await client.challenges.save({ id: "C1", title: "A" }, { etag: "7" });
		expect(entries().map((entry) => entry.name)).toEqual([
			"challenges.save",
			"challenges.list",
		]);
	});

	it("records a call that answers with nothing", async () => {
		const { client, entries } = setup();
		await client.challenges.nothing();
		expect(entries()[0]).toMatchObject({ state: "ok", status: 200 });
		expect(entries()[0]?.result).toBeUndefined();
	});
});

describe("a call that fails", () => {
	it("still throws the same error to the caller", async () => {
		const { client } = setup();
		const call = client.challenges.save(
			{ id: "C1", title: "A" },
			{ etag: "stary" },
		);
		await expect(call).rejects.toBeInstanceOf(ApiError);
		await expect(call).rejects.toMatchObject({ kind: "conflict" });
	});

	it("is written down with its status and what the server said", async () => {
		const { client, entries, log } = setup();
		await client.challenges
			.save({ id: "C1", title: "" }, { etag: "7" })
			.catch(() => undefined);
		expect(entries()[0]).toMatchObject({
			state: "failed",
			status: 422,
			kind: "validation",
			result: {
				kind: "validation",
				message: "Nazwa jest wymagana",
				issues: [{ path: "title", message: "Nazwa jest wymagana" }],
			},
		});
		expect(log.get().unseenFailures).toBe(1);
	});

	it("keeps the server's version that came with a conflict", async () => {
		const { client, entries } = setup();
		await client.challenges
			.save({ id: "C1", title: "A" }, { etag: "stary" })
			.catch(() => undefined);
		expect(entries()[0]).toMatchObject({
			status: 409,
			kind: "conflict",
			result: { current: { id: "C1", etag: "8" } },
		});
	});

	it("has no status when there was no answer or the panel itself broke", async () => {
		const { client, entries } = setup();
		await client.challenges.ping().catch(() => undefined);
		await client.challenges.broken().catch(() => undefined);
		expect(entries()).toMatchObject([
			{
				name: "challenges.broken",
				status: null,
				kind: "unknown",
				result: { message: "x is not a function" },
			},
			{ name: "challenges.ping", status: null, kind: "network" },
		]);
	});

	it("counts failures until someone looks", async () => {
		const { client, log } = setup();
		await client.challenges.remove().catch(() => undefined);
		await client.challenges.ping().catch(() => undefined);
		await client.challenges.list();
		expect(log.get().unseenFailures).toBe(2);

		markCallsSeen(log);
		expect(log.get().unseenFailures).toBe(0);
		// The calls themselves stay.
		expect(log.get().entries).toHaveLength(3);

		await client.challenges.remove().catch(() => undefined);
		expect(log.get().unseenFailures).toBe(1);
	});
});

describe("what is and is not a call", () => {
	it("leaves alone a method that answers at once", () => {
		const { client, entries } = setup();
		expect(client.media.urlFor("workouts/a.webp")).toBe(
			"https://media.example/workouts/a.webp",
		);
		expect(entries()).toEqual([]);
	});

	it("describes a file instead of holding it, and marks a function", async () => {
		const { client, entries } = setup();
		const file = new File(["12345"], "okladka.webp", { type: "image/webp" });
		await client.media.upload(file, {
			relativePath: "workouts/okladka.webp",
			onProgress: () => {},
		});
		expect(entries()[0]?.args).toEqual([
			{ plik: "okladka.webp", typ: "image/webp", rozmiar: 5 },
			{ relativePath: "workouts/okladka.webp", onProgress: "[funkcja]" },
		]);
	});

	it("keeps the arguments as they were when the call was made", async () => {
		const { client, entries } = setup();
		const challenge = { id: "C1", title: "Przed" };
		await client.challenges.save(challenge, { etag: "7" });
		challenge.title = "Zmienione potem";
		expect(entries()[0]?.args[0]).toEqual({ id: "C1", title: "Przed" });
	});
});

describe("the size of the register", () => {
	it("keeps only the latest calls", async () => {
		const { client, entries } = setup();
		for (let call = 0; call < CALL_LOG_LIMIT + 5; call++) {
			await client.challenges.list();
		}
		expect(entries()).toHaveLength(CALL_LOG_LIMIT);
		expect(entries()[0]?.id).toBe(CALL_LOG_LIMIT + 5);
		expect(entries().at(-1)?.id).toBe(6);
	});

	it("can be emptied", async () => {
		const { client, log } = setup();
		await client.challenges.remove().catch(() => undefined);
		clearCallLog(log);
		expect(log.get()).toEqual({ entries: [], unseenFailures: 0 });
	});
});

describe("statuses and colours", () => {
	it.each([
		["validation", 422],
		["conflict", 409],
		["unauthorized", 401],
		["forbidden", 403],
		["notFound", 404],
		["server", 500],
		["network", null],
	] as const)("%s stands for %s", (kind, status) => {
		expect(statusOf(new ApiError(kind, "x"))).toEqual({ status, kind });
	});

	it("has no status for an error that is not the server's", () => {
		expect(statusOf(new Error("x"))).toEqual({ status: null, kind: "unknown" });
		expect(statusOf("tekst")).toEqual({ status: null, kind: "unknown" });
	});

	it("is green for a success, amber for a refusal, red for a breakdown", () => {
		expect(severityOf({ state: "pending", status: null })).toBe("pending");
		expect(severityOf({ state: "ok", status: 200 })).toBe("ok");
		for (const status of [401, 403, 404, 409, 422]) {
			expect(severityOf({ state: "failed", status })).toBe("refused");
		}
		expect(severityOf({ state: "failed", status: 500 })).toBe("broken");
		expect(severityOf({ state: "failed", status: null })).toBe("broken");
	});
});

describe("snapshot", () => {
	it("copies nested data", () => {
		const original = { paths: [{ days: [{ workoutIds: ["W1"] }] }], n: null };
		const copy = snapshot(original);
		expect(copy).toEqual(original);
		expect(copy).not.toBe(original);
	});

	it("stops at a depth no real request has", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(JSON.stringify(snapshot(loop))).toContain("[zbyt głęboko]");
	});
});
