import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/data/api/errors";
import { failure } from "./testSupport";
import {
	buildUrl,
	createTransport,
	DEFAULT_TIMEOUT_MS,
	fetchSender,
	PANEL_HEADER,
	parseBody,
	type Sender,
	type TransportOptions,
	UPLOAD_TIMEOUT_MS,
	type WireAnswer,
	type WireRequest,
	xhrSender,
} from "./transport";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ─── Senders that only remember ─────────────────────────────────────────────

const ok = (body: unknown = {}, etag: string | null = null): WireAnswer => ({
	status: 200,
	text: JSON.stringify(body),
	etag,
});

const status = (code: number, body?: unknown): WireAnswer => ({
	status: code,
	text: body === undefined ? "" : JSON.stringify(body),
	etag: null,
});

/** A sender that gives its answers one after another; the last one stays. */
function recorder(...answers: (WireAnswer | Error | object)[]) {
	const seen: WireRequest[] = [];
	const sender: Sender = async (request) => {
		seen.push(request);
		const next = answers.length > 1 ? answers.shift() : answers[0];
		if (next && "status" in next && "text" in next) return next as WireAnswer;
		throw next;
	};
	const first = (): WireRequest => {
		const [request] = seen;
		if (!request) throw new Error("test: no request was sent");
		return request;
	};
	return { seen, sender, first };
}

function transportWith(
	send: Sender,
	more: Partial<TransportOptions> = {},
): ReturnType<typeof createTransport> {
	return createTransport({
		baseUrl: "/api",
		getToken: async () => null,
		send,
		upload: async () => {
			throw new Error("test: the upload sender was not expected");
		},
		...more,
	});
}

// ─── buildUrl ───────────────────────────────────────────────────────────────

describe("buildUrl", () => {
	it("joins the base and the segments", () => {
		expect(buildUrl("/api", ["manageChallenges"])).toBe(
			"/api/manageChallenges",
		);
		expect(buildUrl("/api", ["manageUserBadges", "u1", "grants"])).toBe(
			"/api/manageUserBadges/u1/grants",
		);
	});

	it("ignores slashes at the end of the base", () => {
		expect(buildUrl("/api/", ["workoutsConfig"])).toBe("/api/workoutsConfig");
		expect(buildUrl("/api///", ["workoutsConfig"])).toBe("/api/workoutsConfig");
		expect(buildUrl("https://panel.example/api/", ["wakeup"])).toBe(
			"https://panel.example/api/wakeup",
		);
	});

	it("does not let an id change which endpoint is called", () => {
		expect(buildUrl("/api", ["manageChallenges", "a/b?c"])).toBe(
			"/api/manageChallenges/a%2Fb%3Fc",
		);
		expect(buildUrl("/api", ["accounts", "../manageBadges/grantManual"])).toBe(
			"/api/accounts/..%2FmanageBadges%2FgrantManual",
		);
		expect(buildUrl("/api", ["accounts", "u1#x&y=1"])).toBe(
			"/api/accounts/u1%23x%26y%3D1",
		);
		expect(buildUrl("/api", ["accounts", "100%"])).toBe("/api/accounts/100%25");
		expect(buildUrl("/api", ["accounts", "a\\b c"])).toBe(
			"/api/accounts/a%5Cb%20c",
		);
	});

	it("keeps an encoded id one path segment for the server", () => {
		const url = new URL(
			buildUrl("/api", ["manageChallenges", "a/b?c#d"]),
			"https://panel.example",
		);
		expect(url.pathname.split("/")).toEqual([
			"",
			"api",
			"manageChallenges",
			"a%2Fb%3Fc%23d",
		]);
		expect(url.search).toBe("");
		expect(url.hash).toBe("");
	});

	it.each(["", ".", ".."])(
		"refuses the segment %j, which no encoding can keep in place",
		(segment) => {
			// A browser resolves dot segments away, written as %2e too, so the
			// request would go to another endpoint.
			for (const path of [
				["accounts", segment],
				["manageUserBadges", segment, "grants"],
				[segment],
			]) {
				let thrown: unknown;
				try {
					buildUrl("/api", path);
				} catch (error) {
					thrown = error;
				}
				expect(thrown).toBeInstanceOf(ApiError);
				expect((thrown as ApiError).kind).toBe("notFound");
			}
		},
	);

	it("shows why those segments have to be refused", () => {
		const resolved = (path: string) =>
			new URL(path, "https://panel.example").pathname;
		expect(resolved("/api/accounts/..")).toBe("/api/");
		expect(resolved("/api/accounts/%2e%2e")).toBe("/api/");
		expect(resolved("/api/manageUserBadges/%2E/grants")).toBe(
			"/api/manageUserBadges/grants",
		);
	});

	it("leaves dots alone when they are only part of a segment", () => {
		expect(buildUrl("/api", ["accounts", "..."])).toBe("/api/accounts/...");
		expect(buildUrl("/api", ["accounts", ".a"])).toBe("/api/accounts/.a");
		expect(buildUrl("/api", ["accounts", "a.."])).toBe("/api/accounts/a..");
		expect(buildUrl("/api", ["accounts", " "])).toBe("/api/accounts/%20");
		expect(buildUrl("/api", ["accounts", "%2e%2e"])).toBe(
			"/api/accounts/%252e%252e",
		);
	});

	it("encodes letters outside ASCII", () => {
		expect(buildUrl("/api", ["accounts", "żółw"])).toBe(
			"/api/accounts/%C5%BC%C3%B3%C5%82w",
		);
	});

	it("adds the query", () => {
		expect(
			buildUrl("/api", ["manageUsers"], { query: "anna", limit: 20 }),
		).toBe("/api/manageUsers?query=anna&limit=20");
		expect(
			buildUrl("/api", ["manage", "panelDocs", "challengePlanning"], {
				bodies: true,
			}),
		).toBe("/api/manage/panelDocs/challengePlanning?bodies=true");
	});

	it("drops query values that are null or undefined", () => {
		expect(
			buildUrl("/api", ["manageUsers"], {
				query: "anna",
				email: null,
				name: undefined,
			}),
		).toBe("/api/manageUsers?query=anna");
		expect(buildUrl("/api", ["manageUsers"], { email: null })).toBe(
			"/api/manageUsers",
		);
		expect(buildUrl("/api", ["manageUsers"], {})).toBe("/api/manageUsers");
	});

	it("keeps query values that are empty, false or zero", () => {
		expect(buildUrl("/api", ["x"], { text: "", refresh: false, page: 0 })).toBe(
			"/api/x?text=&refresh=false&page=0",
		);
	});

	it("encodes query values, so one cannot add a parameter", () => {
		const url = buildUrl("/api", ["manageMedia", "files"], {
			relativePath: "workouts/a b&x=1#y.webp",
		});
		expect(url).toBe(
			"/api/manageMedia/files?relativePath=workouts%2Fa+b%26x%3D1%23y.webp",
		);
		const read = new URL(url, "https://panel.example");
		expect([...read.searchParams.keys()]).toEqual(["relativePath"]);
		expect(read.searchParams.get("relativePath")).toBe(
			"workouts/a b&x=1#y.webp",
		);
	});
});

// ─── parseBody ──────────────────────────────────────────────────────────────

describe("createTransport: the developer's record of each exchange", () => {
	it("is told about the request as it leaves and about the answer", async () => {
		const seen: unknown[] = [];
		const wire = recorder({
			status: 200,
			text: "[]",
			etag: '"1"',
			headers: { "content-type": "application/json", "cf-ray": "r1" },
		});
		await transportWith(wire.sender, {
			record: (request) => {
				seen.push({ request });
				return (outcome) => seen.push(outcome);
			},
		}).request({
			method: "POST",
			path: ["manageWorkouts"],
			body: { title: "x" },
		});
		expect(seen).toEqual([
			{
				request: {
					method: "POST",
					url: "/api/manageWorkouts",
					headers: {
						accept: "application/json",
						"x-cf-panel": "1",
						"content-type": "application/json",
					},
					body: '{"title":"x"}',
				},
			},
			{
				response: {
					status: 200,
					headers: { "content-type": "application/json", "cf-ray": "r1" },
					body: "[]",
				},
			},
		]);
	});

	it("is told why there was no answer, and the failure still comes through", async () => {
		const outcomes: unknown[] = [];
		const wire = recorder(new TypeError("Failed to fetch"));
		await expect(
			transportWith(wire.sender, {
				record: () => (outcome) => outcomes.push(outcome),
			}).request({ path: ["x"] }),
		).rejects.toMatchObject({ kind: "network" });
		expect(outcomes).toEqual([{ error: "TypeError: Failed to fetch" }]);
	});

	it("describes a file instead of carrying it, and a 4xx is recorded too", async () => {
		const requests: unknown[] = [];
		const outcomes: unknown[] = [];
		const upload: Sender = async () => status(422, { error: "zły plik" });
		await expect(
			transportWith(async () => ok(), {
				upload,
				record: (request) => {
					requests.push(request);
					return (outcome) => outcomes.push(outcome);
				},
			}).request({
				method: "POST",
				path: ["manageMedia", "files"],
				file: new File(["abc"], "a.png", { type: "image/png" }),
				onProgress: () => {},
			}),
		).rejects.toBeInstanceOf(ApiError);
		expect(requests[0]).toMatchObject({
			body: { file: "a.png", type: "image/png", size: 3 },
		});
		expect(outcomes[0]).toMatchObject({ response: { status: 422 } });
	});

	it("an answer the panel cannot read is marked unexpected, not a server error", async () => {
		const wire = recorder(ok({ notAList: true }));
		const error = await transportWith(wire.sender)
			.request({
				path: ["manageWorkouts"],
				schema: z.array(z.string()),
				what: "Treningi",
			})
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			kind: "server",
			unexpected: true,
			status: 200,
		});
	});
});

describe("parseBody", () => {
	it("parses JSON", () => {
		expect(parseBody('{"result":"Workout W12 updated"}')).toEqual({
			result: "Workout W12 updated",
		});
		expect(parseBody("[]")).toEqual([]);
		expect(parseBody(' "text" ')).toBe("text");
		expect(parseBody("null")).toBeNull();
	});

	it.each([
		"",
		"   ",
		"\n",
		"<html><body>Bad Gateway</body></html>",
		"Internal Server Error",
		'{"error":',
	])("reads %j as no body", (text) => {
		expect(parseBody(text)).toBeUndefined();
	});
});

// ─── What is put on the wire ────────────────────────────────────────────────

describe("createTransport: the request", () => {
	it("sends a GET with the panel's header and nothing else", async () => {
		const wire = recorder(ok([]));
		await transportWith(wire.sender).request({ path: ["manageChallenges"] });
		expect(wire.seen).toEqual([
			{
				method: "GET",
				url: "/api/manageChallenges",
				headers: { accept: "application/json", "x-cf-panel": "1" },
				body: undefined,
				timeoutMs: 30_000,
				onProgress: undefined,
			},
		]);
	});

	it("names its header x-cf-panel and waits 30 seconds by default", () => {
		expect(PANEL_HEADER).toBe("x-cf-panel");
		expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
		expect(UPLOAD_TIMEOUT_MS).toBe(300_000);
	});

	it("builds the address from the path and the query", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({
			path: ["manageChallenges", "a/b?c"],
			query: { view: "summary", status: null },
		});
		expect(wire.first().url).toBe(
			"/api/manageChallenges/a%2Fb%3Fc?view=summary",
		);
	});

	it("sends a body as JSON", async () => {
		const wire = recorder(ok({}));
		const body = { id: null, title: "Żółw", paths: [{ levelId: "x" }] };
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["manageChallenges"],
			body,
		});
		const sent = wire.first();
		expect(sent.method).toBe("POST");
		expect(sent.headers).toEqual({
			accept: "application/json",
			"x-cf-panel": "1",
			"content-type": "application/json",
		});
		expect(sent.body).toBe(JSON.stringify(body));
		expect(sent.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
	});

	it("sends null and false as bodies, and no body for undefined", async () => {
		const wire = recorder(ok({}));
		const transport = transportWith(wire.sender);
		await transport.request({ method: "POST", path: ["a"], body: null });
		await transport.request({ method: "POST", path: ["a"], body: false });
		await transport.request({ method: "POST", path: ["a"], body: undefined });
		expect(wire.seen.map((request) => request.body)).toEqual([
			"null",
			"false",
			undefined,
		]);
		expect(wire.seen[2]?.headers).not.toHaveProperty("content-type");
	});

	it("adds the caller's headers", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["manageChallenges"],
			body: {},
			headers: { "if-match": 'W/"7"' },
		});
		expect(wire.first().headers).toEqual({
			accept: "application/json",
			"x-cf-panel": "1",
			"if-match": 'W/"7"',
			"content-type": "application/json",
		});
	});

	it("sends nothing for a path it cannot address safely", async () => {
		const wire = recorder(ok({}));
		const transport = transportWith(wire.sender);
		for (const id of ["", ".", ".."]) {
			const error = await failure(
				transport.request({
					method: "PUT",
					path: ["accounts", id],
					body: { email: "a@example.com" },
				}),
			);
			expect(error.kind).toBe("notFound");
		}
		expect(wire.seen).toEqual([]);
	});

	it("uses the time limit it is given", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({ path: ["a"], timeoutMs: 1234 });
		expect(wire.first().timeoutMs).toBe(1234);
	});

	it("gives the address of a path without sending anything", () => {
		const wire = recorder(ok({}));
		const transport = transportWith(wire.sender);
		expect(transport.url(["files"], { path: "workouts/a b.webp" })).toBe(
			"/api/files?path=workouts%2Fa+b.webp",
		);
		expect(transport.url(["files"])).toBe("/api/files");
		expect(wire.seen).toEqual([]);
	});
});

// ─── Token ──────────────────────────────────────────────────────────────────

describe("createTransport: the token", () => {
	it("sends none when nobody handed the page one", async () => {
		const wire = recorder(ok({}));
		const getToken = vi.fn(async () => null);
		await transportWith(wire.sender, { getToken }).request({ path: ["a"] });
		expect(wire.first().headers).not.toHaveProperty("authorization");
		expect(getToken).toHaveBeenCalledTimes(1);
		expect(getToken).toHaveBeenCalledWith();
	});

	it("sends the token as a bearer", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender, {
			getToken: async () => "tok-1",
		}).request({ path: ["a"] });
		expect(wire.first().headers.authorization).toBe("Bearer tok-1");
	});

	it("does not let a caller's header replace the token", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender, {
			getToken: async () => "tok-1",
		}).request({ path: ["a"], headers: { authorization: "Bearer other" } });
		expect(wire.first().headers.authorization).toBe("Bearer tok-1");
	});

	it("asks for a fresh token once after a 401 and tries again", async () => {
		const wire = recorder(status(401), ok({ fine: true }));
		const getToken = vi.fn(async (options?: { forceRefresh?: boolean }) =>
			options?.forceRefresh ? "tok-fresh" : "tok-old",
		);
		const onUnauthorized = vi.fn();
		const data = await transportWith(wire.sender, {
			getToken,
			onUnauthorized,
		}).request({ method: "POST", path: ["a"], body: { x: 1 } });

		expect(data).toEqual({ fine: true });
		expect(getToken.mock.calls).toEqual([[], [{ forceRefresh: true }]]);
		expect(wire.seen.map((request) => request.headers.authorization)).toEqual([
			"Bearer tok-old",
			"Bearer tok-fresh",
		]);
		// The second try is the same request.
		expect(wire.seen[1]).toMatchObject({
			method: "POST",
			url: "/api/a",
			body: '{"x":1}',
		});
		expect(onUnauthorized).not.toHaveBeenCalled();
	});

	it("gives up after the fresh token is refused too", async () => {
		const wire = recorder(status(401));
		const getToken = vi.fn(async () => "tok");
		const onUnauthorized = vi.fn();
		const error = await failure(
			transportWith(wire.sender, { getToken, onUnauthorized }).request({
				path: ["a"],
			}),
		);
		expect(error.kind).toBe("unauthorized");
		expect(error.status).toBe(401);
		expect(wire.seen).toHaveLength(2);
		expect(getToken).toHaveBeenCalledTimes(2);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("does not try again when there is no fresh token to try with", async () => {
		const wire = recorder(status(401));
		const getToken = vi.fn(async (options?: { forceRefresh?: boolean }) =>
			options?.forceRefresh ? null : "tok-old",
		);
		const onUnauthorized = vi.fn();
		const error = await failure(
			transportWith(wire.sender, { getToken, onUnauthorized }).request({
				path: ["a"],
			}),
		);
		expect(error.kind).toBe("unauthorized");
		expect(wire.seen).toHaveLength(1);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("does not try again when it had no token in the first place", async () => {
		const wire = recorder(status(401));
		const getToken = vi.fn(async () => null);
		const onUnauthorized = vi.fn();
		const error = await failure(
			transportWith(wire.sender, { getToken, onUnauthorized }).request({
				path: ["a"],
			}),
		);
		expect(error.kind).toBe("unauthorized");
		expect(wire.seen).toHaveLength(1);
		expect(getToken).toHaveBeenCalledTimes(1);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("works without anyone listening for a sign-out", async () => {
		const wire = recorder(status(401));
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"] }),
		);
		expect(error.kind).toBe("unauthorized");
	});

	it("does not refresh the token for a 403", async () => {
		const wire = recorder(status(403, { error: "Brak dostępu" }));
		const getToken = vi.fn(async () => "tok");
		const onUnauthorized = vi.fn();
		const error = await failure(
			transportWith(wire.sender, { getToken, onUnauthorized }).request({
				path: ["a"],
			}),
		);
		expect(error.kind).toBe("forbidden");
		expect(wire.seen).toHaveLength(1);
		expect(getToken).toHaveBeenCalledTimes(1);
		expect(onUnauthorized).not.toHaveBeenCalled();
	});
});

// ─── The answer ─────────────────────────────────────────────────────────────

describe("createTransport: the answer", () => {
	const schema = z.looseObject({
		files: z.array(z.looseObject({ path: z.string() })),
		total: z.number().default(0),
	});

	it("returns the body unchecked when no schema is given", async () => {
		const wire = recorder(ok({ result: "Workout W12 updated" }));
		expect(await transportWith(wire.sender).request({ path: ["a"] })).toEqual({
			result: "Workout W12 updated",
		});
	});

	it("returns the body as the schema reads it", async () => {
		const wire = recorder(ok({ files: [{ path: "a.webp", extra: 1 }] }));
		expect(
			await transportWith(wire.sender).request({ path: ["a"], schema }),
		).toEqual({ files: [{ path: "a.webp", extra: 1 }], total: 0 });
	});

	it("returns the status and the ETag with the body from `send`", async () => {
		const wire = recorder({
			status: 201,
			text: '{"id":"C1"}',
			etag: 'W/"8"',
		});
		expect(await transportWith(wire.sender).send({ path: ["a"] })).toEqual({
			data: { id: "C1" },
			status: 201,
			etag: 'W/"8"',
		});
	});

	it("has no ETag when the backend sent none", async () => {
		const wire = recorder(ok({ files: [] }));
		const answer = await transportWith(wire.sender).send({
			path: ["a"],
			schema,
		});
		expect(answer).toEqual({
			data: { files: [], total: 0 },
			status: 200,
			etag: null,
		});
	});

	it("refuses a body that does not fit the schema, naming the fields", async () => {
		const wire = recorder(ok({ files: [{ path: "a" }, { path: 7 }, {}] }));
		const error = await failure(
			transportWith(wire.sender).request({
				path: ["manageMedia", "files"],
				schema,
				what: "Lista plików",
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(200);
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"files.1.path",
			"files.2.path",
		]);
		expect(error.message).toContain("Lista plików: dane nie pasują");
		expect(error.message).toContain("files.1.path");
	});

	it("names the answer by its path when it was given no name", async () => {
		const wire = recorder(ok([]));
		const error = await failure(
			transportWith(wire.sender).request({
				path: ["manageMedia", "files"],
				schema,
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("manageMedia/files: dane nie pasują");
	});

	it("lists at most twenty problems of one answer", async () => {
		const wire = recorder(
			ok({ files: Array.from({ length: 50 }, () => ({ path: null })) }),
		);
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"], schema }),
		);
		expect(error.issues).toHaveLength(20);
	});

	it("refuses a success that is not JSON when a schema is expected", async () => {
		const wire = recorder({
			status: 200,
			text: "<!doctype html><title>Panel</title>",
			etag: null,
		});
		const error = await failure(
			transportWith(wire.sender).request({
				path: ["workoutsConfig"],
				schema,
				what: "Konfiguracja treningów",
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(200);
		expect(error.message).toBe(
			"Backend odpowiedział w nieoczekiwany sposób. Konfiguracja treningów: to nie jest JSON.",
		);
	});

	it("reads an empty success as no data", async () => {
		const wire = recorder({ status: 204, text: "", etag: null });
		expect(
			await transportWith(wire.sender).send({
				method: "DELETE",
				path: ["manageBadges", "n_1"],
			}),
		).toEqual({ data: undefined, status: 204, etag: null });
	});

	it("refuses an empty success where the schema needs a body", async () => {
		const wire = recorder({ status: 204, text: "", etag: null });
		const error = await failure(
			transportWith(wire.sender).request({
				path: ["a"],
				schema,
				what: "Pliki",
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(204);
		expect(error.message).toContain("Pliki: dane nie pasują");
	});

	it("accepts an empty success where the schema allows none", async () => {
		const wire = recorder({ status: 204, text: "  ", etag: null });
		expect(
			await transportWith(wire.sender).request({
				path: ["a"],
				schema: schema.optional(),
			}),
		).toBeUndefined();
	});
});

// ─── Failures ───────────────────────────────────────────────────────────────

describe("createTransport: failures", () => {
	it("turns a failure status into an ApiError with that status", async () => {
		const wire = recorder(
			status(404, { error: "Challenge C99 not found", errorCode: null }),
		);
		const error = await failure(
			transportWith(wire.sender).request({ path: ["manageChallenges", "C99"] }),
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Challenge C99 not found");
		expect(error.status).toBe(404);
	});

	it("reads a 500 as the backend failing, on a read and on a write", async () => {
		for (const method of ["GET", "POST"] as const) {
			const wire = recorder(
				status(500, { error: "Nieznana categoryId: sila" }),
			);
			const error = await failure(
				transportWith(wire.sender).request({
					method,
					path: ["manageChallenges"],
				}),
			);
			expect(error.kind).toBe("server");
			expect(error.status).toBe(500);
		}
	});

	it("hands a conflict's current entity on", async () => {
		const current = { id: "C1", etag: 'W/"9"' };
		const wire = recorder(status(409, { error: "Conflict", current }));
		const error = await failure(
			transportWith(wire.sender).request({
				method: "POST",
				path: ["manageChallenges"],
				body: {},
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(current);
		expect(error.status).toBe(409);
	});

	it("reads a gateway's HTML page as the backend being unavailable", async () => {
		const wire = recorder({
			status: 502,
			text: "<html><body>Bad Gateway</body></html>",
			etag: null,
		});
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"] }),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(502);
		expect(error.message).toBe(
			"Backend jest chwilowo niedostępny. Spróbuj za chwilę. (Szczegóły: HTTP 502, odpowiedź: „Bad Gateway”)",
		);
		expect(error.details).toBe("HTTP 502, odpowiedź: „Bad Gateway”");
	});

	it("does not check a failure against the schema", async () => {
		const wire = recorder(status(500, { error: "Failed to return files: x" }));
		const error = await failure(
			transportWith(wire.sender).request({
				path: ["a"],
				schema: z.array(z.string()),
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
		expect(error.issues).toEqual([]);
	});

	it("reads a status below 200 or from 300 up as a failure", async () => {
		for (const code of [199, 300, 304]) {
			const wire = recorder(status(code));
			const error = await failure(
				transportWith(wire.sender).request({ path: ["a"] }),
			);
			expect(error.kind).toBe("server");
			expect(error.status).toBe(code);
		}
	});

	it("turns a request that got no answer into a network error", async () => {
		const wire = recorder(new TypeError("Failed to fetch"));
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"] }),
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.kind).toBe("network");
		expect(error.message).toBe(
			"Brak połączenia z backendem. Sprawdź internet i spróbuj ponownie. (Szczegóły: TypeError: „Failed to fetch”)",
		);
		expect(error.details).toBe("TypeError: „Failed to fetch”");
		expect(error.status).toBeUndefined();
	});

	it("says so when the time limit passed", async () => {
		const wire = recorder(
			new DOMException("The operation timed out.", "TimeoutError"),
		);
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"] }),
		);
		expect(error.kind).toBe("network");
		expect(error.message).toBe(
			"Backend nie odpowiedział na czas. Spróbuj ponownie. (Szczegóły: TimeoutError: „The operation timed out.”)",
		);
		expect(error.details).toBe("TimeoutError: „The operation timed out.”");
	});

	it("does not ask for a new token when the request got no answer", async () => {
		const wire = recorder(new TypeError("Failed to fetch"));
		const getToken = vi.fn(async () => "tok");
		const onUnauthorized = vi.fn();
		await failure(
			transportWith(wire.sender, { getToken, onUnauthorized }).request({
				path: ["a"],
			}),
		);
		expect(wire.seen).toHaveLength(1);
		expect(getToken).toHaveBeenCalledTimes(1);
		expect(onUnauthorized).not.toHaveBeenCalled();
	});

	it("passes on an ApiError a sender threw itself", async () => {
		const thrown = new ApiError("forbidden", "Nie tędy");
		const wire = recorder(thrown);
		const error = await failure(
			transportWith(wire.sender).request({ path: ["a"] }),
		);
		expect(error).toBe(thrown);
	});
});

// ─── Files ──────────────────────────────────────────────────────────────────

describe("createTransport: a file", () => {
	const file = new Blob(["abc"], { type: "image/webp" });

	it("sends the file itself, with its own type and the longer limit", async () => {
		const wire = recorder(ok({ relativePath: "test/a.webp" }));
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["manageMedia", "files"],
			query: { relativePath: "test/a.webp" },
			file,
		});
		const sent = wire.first();
		expect(sent.url).toBe("/api/manageMedia/files?relativePath=test%2Fa.webp");
		expect(sent.body).toBe(file);
		expect(sent.headers).toEqual({
			accept: "application/json",
			"x-cf-panel": "1",
			"content-type": "image/webp",
		});
		expect(sent.timeoutMs).toBe(UPLOAD_TIMEOUT_MS);
		expect(sent.onProgress).toBeUndefined();
	});

	it("calls a file of unknown type a stream of bytes", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["manageMedia", "files"],
			file: new Blob(["abc"]),
		});
		expect(wire.first().headers["content-type"]).toBe(
			"application/octet-stream",
		);
	});

	it("prefers the file when a JSON body is given as well", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["a"],
			file,
			body: { ignored: true },
		});
		expect(wire.first().body).toBe(file);
		expect(wire.first().headers["content-type"]).toBe("image/webp");
	});

	it("uses the upload sender only when progress is wanted", async () => {
		const plain = recorder(ok({ via: "send" }));
		const withProgress = recorder(ok({ via: "upload" }));
		const transport = transportWith(plain.sender, {
			upload: withProgress.sender,
		});
		const onProgress = vi.fn();

		expect(
			await transport.request({ method: "POST", path: ["a"], file }),
		).toEqual({ via: "send" });
		expect(withProgress.seen).toHaveLength(0);

		expect(
			await transport.request({
				method: "POST",
				path: ["a"],
				file,
				onProgress,
			}),
		).toEqual({ via: "upload" });
		expect(plain.seen).toHaveLength(1);
		expect(withProgress.seen).toHaveLength(1);
		expect(withProgress.first().onProgress).toBe(onProgress);
		expect(withProgress.first().timeoutMs).toBe(UPLOAD_TIMEOUT_MS);
		expect(withProgress.first().body).toBe(file);
	});

	it("lets a time limit of its own win over the upload's", async () => {
		const wire = recorder(ok({}));
		await transportWith(wire.sender).request({
			method: "POST",
			path: ["a"],
			file,
			timeoutMs: 5_000,
		});
		expect(wire.first().timeoutMs).toBe(5_000);
	});

	it("turns a failed upload into the same errors as any request", async () => {
		const upload = recorder(
			status(500, {
				error: "Failed to upload file: Error: Failed to get blob content type",
			}),
		);
		const error = await failure(
			transportWith(recorder(ok({})).sender, {
				upload: upload.sender,
			}).request({ method: "POST", path: ["a"], file, onProgress: () => {} }),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

// ─── fetchSender ────────────────────────────────────────────────────────────

describe("fetchSender", () => {
	const request: WireRequest = {
		method: "POST",
		url: "/api/manageChallenges",
		headers: { accept: "application/json", "x-cf-panel": "1" },
		body: '{"id":null}',
		timeoutMs: 4321,
	};

	it("asks fetch for exactly what it was given, kept to the panel's own address", async () => {
		const fetchStub = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response('{"result":"ok"}', {
					status: 200,
					headers: { etag: 'W/"5"' },
				}),
		);
		vi.stubGlobal("fetch", fetchStub);
		const signal = new AbortController().signal;
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);

		const answer = await fetchSender(request);

		expect(answer).toEqual({
			status: 200,
			text: '{"result":"ok"}',
			etag: 'W/"5"',
			headers: { "content-type": "text/plain;charset=UTF-8", etag: 'W/"5"' },
		});
		expect(fetchStub).toHaveBeenCalledTimes(1);
		expect(fetchStub).toHaveBeenCalledWith("/api/manageChallenges", {
			method: "POST",
			headers: { accept: "application/json", "x-cf-panel": "1" },
			body: '{"id":null}',
			signal,
			credentials: "same-origin",
			cache: "no-store",
			redirect: "error",
		});
		expect(timeout).toHaveBeenCalledWith(4321);
	});

	it("gives the request a real time limit", async () => {
		const fetchStub = vi.fn(
			async (_url: string, _init: RequestInit) => new Response("{}"),
		);
		vi.stubGlobal("fetch", fetchStub);
		await fetchSender({ ...request, timeoutMs: 60_000 });
		const init = fetchStub.mock.calls[0]?.[1];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.signal?.aborted).toBe(false);
	});

	it("returns a failure status as an answer, not as an exception", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response('{"error":"Challenge C99 not found"}', { status: 404 }),
			),
		);
		expect(await fetchSender({ ...request, method: "GET" })).toEqual({
			status: 404,
			text: '{"error":"Challenge C99 not found"}',
			etag: null,
			headers: { "content-type": "text/plain;charset=UTF-8" },
		});
	});

	it("returns an empty body as empty text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 204 })),
		);
		expect(await fetchSender(request)).toEqual({
			status: 204,
			text: "",
			etag: null,
			headers: {},
		});
	});

	it("rejects when fetch does", async () => {
		const cause = new TypeError("Failed to fetch");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw cause;
			}),
		);
		await expect(fetchSender(request)).rejects.toBe(cause);
	});

	it("is what the transport sends with unless told otherwise", async () => {
		const fetchStub = vi.fn(
			async (_url: string, _init: RequestInit) => new Response("[1,2]"),
		);
		vi.stubGlobal("fetch", fetchStub);
		const transport = createTransport({
			baseUrl: "/api",
			getToken: async () => null,
		});
		expect(await transport.request({ path: ["manageWorkouts"] })).toEqual([
			1, 2,
		]);
		expect(fetchStub.mock.calls[0]?.[0]).toBe("/api/manageWorkouts");
		expect(fetchStub.mock.calls[0]?.[1]).toMatchObject({
			method: "GET",
			credentials: "same-origin",
			redirect: "error",
			headers: { "x-cf-panel": "1" },
		});
	});

	it("becomes a network error in the transport when fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		const transport = createTransport({
			baseUrl: "/api",
			getToken: async () => null,
		});
		const error = await failure(transport.request({ path: ["a"] }));
		expect(error.kind).toBe("network");
	});
});

// ─── xhrSender ──────────────────────────────────────────────────────────────

/** As much of XMLHttpRequest as the sender uses, driven by the test. */
class FakeXhr {
	static last: FakeXhr | undefined;

	opened: [string, string] | undefined;
	sent: unknown = "nothing was sent";
	requestHeaders: Record<string, string> = {};
	timeout = 0;
	withCredentials = true;
	status = 0;
	responseText = "";
	responseHeaders: Record<string, string> = {};
	upload: {
		onprogress:
			| ((event: {
					lengthComputable: boolean;
					loaded: number;
					total: number;
			  }) => void)
			| null;
	} = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;

	constructor() {
		FakeXhr.last = this;
	}

	open(method: string, url: string) {
		this.opened = [method, url];
	}

	setRequestHeader(headerName: string, value: string) {
		this.requestHeaders[headerName] = value;
	}

	getResponseHeader(headerName: string): string | null {
		return this.responseHeaders[headerName.toLowerCase()] ?? null;
	}

	getAllResponseHeaders(): string {
		return Object.entries(this.responseHeaders)
			.map(([name, value]) => `${name}: ${value}\r\n`)
			.join("");
	}

	send(body: unknown) {
		this.sent = body;
	}
}

describe("xhrSender", () => {
	const file = new Blob(["abcdef"], { type: "video/mp4" });
	const request = (more: Partial<WireRequest> = {}): WireRequest => ({
		method: "POST",
		url: "/api/manageMedia/files?relativePath=test%2Fa.mp4",
		headers: { "x-cf-panel": "1", "content-type": "video/mp4" },
		body: file,
		timeoutMs: UPLOAD_TIMEOUT_MS,
		...more,
	});

	function start(more: Partial<WireRequest> = {}) {
		vi.stubGlobal("XMLHttpRequest", FakeXhr);
		FakeXhr.last = undefined;
		const pending = xhrSender(request(more));
		const xhr = FakeXhr.last as FakeXhr | undefined;
		if (!xhr) throw new Error("test: no XMLHttpRequest was made");
		return { pending, xhr };
	}

	it("opens the request and sends the body with its headers and limit", async () => {
		const { pending, xhr } = start();
		expect(xhr.opened).toEqual([
			"POST",
			"/api/manageMedia/files?relativePath=test%2Fa.mp4",
		]);
		expect(xhr.requestHeaders).toEqual({
			"x-cf-panel": "1",
			"content-type": "video/mp4",
		});
		expect(xhr.timeout).toBe(UPLOAD_TIMEOUT_MS);
		expect(xhr.withCredentials).toBe(false);
		expect(xhr.sent).toBe(file);

		xhr.status = 200;
		xhr.responseText = '{"relativePath":"test/a.mp4"}';
		xhr.responseHeaders = { etag: '"abc"' };
		xhr.onload?.();
		expect(await pending).toEqual({
			status: 200,
			text: '{"relativePath":"test/a.mp4"}',
			etag: '"abc"',
			headers: { etag: '"abc"' },
		});
	});

	it("sends null when there is no body", async () => {
		const { pending, xhr } = start({ method: "GET", body: undefined });
		expect(xhr.sent).toBeNull();
		xhr.status = 204;
		xhr.onload?.();
		expect(await pending).toEqual({
			status: 204,
			text: "",
			etag: null,
			headers: {},
		});
	});

	it("resolves with a failure status; judging it is the transport's job", async () => {
		const { pending, xhr } = start();
		xhr.status = 500;
		xhr.responseText = '{"error":"Failed to upload file: Error"}';
		xhr.onload?.();
		expect(await pending).toEqual({
			status: 500,
			text: '{"error":"Failed to upload file: Error"}',
			etag: null,
			headers: {},
		});
	});

	it("reports how much has been sent, as a fraction", async () => {
		const onProgress = vi.fn();
		const { pending, xhr } = start({ onProgress });
		const progress = xhr.upload.onprogress;
		progress?.({ lengthComputable: true, loaded: 0, total: 200 });
		progress?.({ lengthComputable: true, loaded: 50, total: 200 });
		progress?.({ lengthComputable: true, loaded: 200, total: 200 });
		expect(onProgress.mock.calls).toEqual([[0], [0.25], [1]]);
		xhr.onload?.();
		await pending;
	});

	it("never reports more than the whole, nor a size it does not know", async () => {
		const onProgress = vi.fn();
		const { pending, xhr } = start({ onProgress });
		const progress = xhr.upload.onprogress;
		progress?.({ lengthComputable: false, loaded: 50, total: 0 });
		progress?.({ lengthComputable: true, loaded: 50, total: 0 });
		expect(onProgress).not.toHaveBeenCalled();
		progress?.({ lengthComputable: true, loaded: 300, total: 200 });
		expect(onProgress.mock.calls).toEqual([[1]]);
		xhr.onload?.();
		await pending;
	});

	it("does not mind progress nobody listens to", async () => {
		const { pending, xhr } = start();
		expect(() =>
			xhr.upload.onprogress?.({
				lengthComputable: true,
				loaded: 1,
				total: 2,
			}),
		).not.toThrow();
		xhr.onload?.();
		await pending;
	});

	it("rejects when the connection fails", async () => {
		const { pending, xhr } = start();
		xhr.onerror?.();
		await expect(pending).rejects.toBeInstanceOf(TypeError);
	});

	it("rejects with a timeout when the limit passes", async () => {
		const { pending, xhr } = start();
		xhr.ontimeout?.();
		await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
	});

	it("rejects with an abort when the request is cancelled", async () => {
		const { pending, xhr } = start();
		xhr.onabort?.();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	it("is what the transport uploads with, and its failures read as network errors", async () => {
		vi.stubGlobal("XMLHttpRequest", FakeXhr);
		FakeXhr.last = undefined;
		const transport = createTransport({
			baseUrl: "/api",
			getToken: async () => null,
			send: async () => {
				throw new Error("test: fetch was not expected");
			},
		});
		const pending = failure(
			transport.request({
				method: "POST",
				path: ["manageMedia", "files"],
				query: { relativePath: "test/a.mp4" },
				file,
				onProgress: () => {},
			}),
		);
		// The token is asked for first, so the request starts a moment later.
		await vi.waitFor(() => expect(FakeXhr.last).toBeDefined());
		const xhr = FakeXhr.last as FakeXhr | undefined;
		expect(xhr?.opened).toEqual([
			"POST",
			"/api/manageMedia/files?relativePath=test%2Fa.mp4",
		]);
		expect(xhr?.requestHeaders).toMatchObject({
			"x-cf-panel": "1",
			"content-type": "video/mp4",
		});
		xhr?.ontimeout?.();
		const error = await pending;
		expect(error.kind).toBe("network");
		expect(error.message).toBe(
			"Backend nie odpowiedział na czas. Spróbuj ponownie. (Szczegóły: TimeoutError: „Timed out”)",
		);
	});
});

describe("createTransport: refusals come through as the backend wrote them", () => {
	it("keeps a 422's message and its issues", async () => {
		const transport = transportWith(
			recorder(
				status(422, {
					error: "Ten adres e-mail ma już inne konto.",
					errorCode: "VALIDATION",
					issues: [
						{
							path: "email",
							code: "EMAIL_TAKEN",
							message: "Ten adres e-mail ma już inne konto.",
						},
					],
				}),
			).sender,
		);
		const error = await failure(
			transport.request({
				method: "PUT",
				path: ["accounts", "u1"],
				body: { email: "a@example.test" },
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Ten adres e-mail ma już inne konto.");
		expect(error.issues).toEqual([
			{ path: "email", message: "Ten adres e-mail ma już inne konto." },
		]);
	});

	it("keeps a 409 refusal's message, and offers nothing to merge", async () => {
		const transport = transportWith(
			recorder(
				status(409, {
					error: "Ta odznaka jest w użyciu: przyznaje ją trening W1.",
					errorCode: "BADGE_IN_USE",
					current: { id: "n_1" },
				}),
			).sender,
		);
		const error = await failure(
			transport.request({ method: "DELETE", path: ["manageBadges", "n_1"] }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			"Ta odznaka jest w użyciu: przyznaje ją trening W1.",
		);
		expect(error.current).toBeUndefined();
	});
});
