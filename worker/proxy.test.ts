import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf } from "./backend";
import {
	handleApi,
	isFilePath,
	MAX_BODY_BYTES,
	OPEN_FOR_WRITING,
	ROUTES,
	type Route,
	routeFor,
	type WriteArea,
} from "./proxy";
import {
	ADMIN,
	API,
	backendError,
	bare,
	bodyOf,
	type Call,
	clears,
	expectedSignature,
	fakeIdToken,
	fromOwnMedia,
	fromPanel,
	jsonAnswer,
	MEDIA,
	makeWorld,
	navigation,
	SESSION_COOKIE,
	SESSION_S,
	SIGNING_SECRET,
	sessionOf,
	setCookies,
	signedIn,
	type World,
} from "./testSupport";

const SAMPLE_ID = "abc-123";
/** A row's address with an identifier filled in. */
const concrete = (route: Route) =>
	`/api/${route.path.replaceAll(":id", SAMPLE_ID)}`;

const READS = ROUTES.filter((route) => !route.writes && route.to === "panel");
const PUBLIC = ROUTES.filter((route) => route.to === "public");
const WRITES = ROUTES.filter((route) => route.writes);
/** The areas open in the code, as shipped; tests that open more put these back. */
const OPEN_AS_SHIPPED: readonly WriteArea[] = [...OPEN_FOR_WRITING];
/** Write rows whose area is closed in the code as shipped. */
const CLOSED_WRITES = WRITES.filter(
	(route) => route.writes && !OPEN_AS_SHIPPED.includes(route.writes),
);

const DATA_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** The headers every answer that is data must carry (rule 26). */
function expectDataHeaders(response: Response, label = ""): void {
	expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
	expect(response.headers.get("cross-origin-resource-policy"), label).toBe(
		"same-origin",
	);
	expect(response.headers.get("referrer-policy"), label).toBe("no-referrer");
	expect(response.headers.get("cache-control"), label).toBe("no-store");
	expect(response.headers.get("content-security-policy"), label).toBe(
		DATA_POLICY,
	);
	expect(response.headers.get("x-frame-options"), label).toBe("DENY");
}

async function expectFailure(
	response: Response,
	status: number,
	errorCode: string,
	label = "",
): Promise<void> {
	expect(response.status, label).toBe(status);
	expect((await bodyOf(response)).errorCode, label).toBe(errorCode);
	expectDataHeaders(response, label);
}

/** A world with an admin signed in, and their cookies. */
async function withAdmin(): Promise<{ world: World; cookies: string }> {
	const world = makeWorld();
	return { world, cookies: await signedIn(world) };
}

const only = (world: World): Call => {
	expect(world.calls).toHaveLength(1);
	return world.calls[0] as Call;
};

// ─── The table ──────────────────────────────────────────────────────────────

describe("the table of allowed calls", () => {
	// Adding, removing or changing a row changes this list: that is the
	// point. A new row is a decision, and it is reviewed here.
	it("is exactly this", () => {
		expect(
			ROUTES.map(
				(route) =>
					`${route.method} /api/${route.path} → ${route.to}${
						route.writes ? ` (writes: ${route.writes})` : ""
					}`,
			),
		).toEqual([
			"GET /api/manageChallenges → panel",
			"GET /api/manageChallenges/:id → panel",
			"GET /api/manageWorkouts → panel",
			"GET /api/manageWorkouts/:id → panel",
			"GET /api/manageBadges → panel",
			"GET /api/manageBadges/:id → panel",
			"GET /api/manageMessageDrafts/list → panel",
			"GET /api/manageUsers → panel",
			"GET /api/accounts/:id → panel",
			"GET /api/manageUserBadges/:id → panel",
			"GET /api/manageUserBadges/:id/grants → panel",
			"GET /api/manageUserProgress/:id → panel",
			"GET /api/manageMedia/files → panel",
			"GET /api/manageOffers → panel",
			"GET /api/manageOffers/:id → panel",
			"GET /api/manageOfferChoices → panel",
			"GET /api/manage/panelDocs/:id → panel",
			"GET /api/manage/panelDocs/:id/:id → panel",
			"GET /api/manageAudit → panel",
			"GET /api/internalConfig → public",
			"GET /api/workoutsConfig → public",
			"POST /api/manageChallenges → panel (writes: challenges)",
			"POST /api/manageChallenges/promotedChallenge → panel (writes: promotedChallenge)",
			"POST /api/manageChallenges/:id/status → panel (writes: challenges)",
			"POST /api/manageWorkouts → panel (writes: workouts)",
			"POST /api/manageWorkouts/:id/status → panel (writes: workouts)",
			"POST /api/manageBadges → panel (writes: badges)",
			"DELETE /api/manageBadges/:id → panel (writes: badges)",
			"POST /api/manageBadges/grantManual → panel (writes: userBadges)",
			"POST /api/manageBadges/revokeManual → panel (writes: userBadges)",
			"POST /api/manageMessageDrafts/upsert → panel (writes: messages)",
			"POST /api/manageMessageDrafts/archive → panel (writes: messages)",
			"POST /api/manageMessageDrafts/unarchive → panel (writes: messages)",
			"POST /api/manageMessageDrafts/publish → panel (writes: sendMessage)",
			"PUT /api/accounts/:id → panel (writes: users)",
			"POST /api/manageMedia/files → panel (writes: media)",
			"PUT /api/manage/panelDocs/:id/:id → panel (writes: planning)",
			"DELETE /api/manage/panelDocs/:id/:id → panel (writes: planning)",
			"POST /api/manageOffers → panel (writes: offers)",
			"POST /api/manageOffers/:id/status → panel (writes: offers)",
			"POST /api/manageCache/purge → panel (writes: cache)",
		]);
	});

	// Opening an area for writing is a commit of its own; this test changes
	// in that commit. Clearing the app's CDN cache changes no data, so it is
	// the one area open while Produkcja is otherwise read-only.
	it("has only the cache open for writing", () => {
		expect([...OPEN_FOR_WRITING]).toEqual(["cache"]);
	});

	it("opens no row but the cache purge, and that one has its own area", () => {
		expect(
			WRITES.filter((route) => !CLOSED_WRITES.includes(route)).map(
				(route) => `${route.method} ${route.path} (${route.writes})`,
			),
		).toEqual(["POST manageCache/purge (cache)"]);
		expect(
			ROUTES.filter((route) => route.writes === "cache").map(
				(route) => `${route.method} ${route.path}`,
			),
		).toEqual(["POST manageCache/purge"]);
	});

	it("names what every call that is not a GET writes to, and no GET writes", () => {
		for (const route of ROUTES) {
			const label = `${route.method} ${route.path}`;
			if (route.method === "GET") expect(route.writes, label).toBeUndefined();
			else expect(route.writes, label).toEqual(expect.any(String));
		}
	});

	it("sends only the two configuration documents to a public address, and only to read", () => {
		expect(PUBLIC.map((route) => `${route.method} ${route.path}`)).toEqual([
			"GET internalConfig",
			"GET workoutsConfig",
		]);
	});

	it("has no row twice", () => {
		const rows = ROUTES.map((route) => `${route.method} ${route.path}`);
		expect(new Set(rows).size).toBe(rows.length);
	});

	it("has no row for the session routes, for files or for anything with a wildcard", () => {
		for (const route of ROUTES) {
			expect(route.path).not.toMatch(/^(panel|files|health)(\/|$)/);
			expect(route.path).toMatch(/^[A-Za-z]+(\/([A-Za-z]+|:id))*$/);
		}
	});
});

describe("routeFor", () => {
	it("finds every row by its own address", () => {
		for (const route of ROUTES) {
			expect(routeFor(route.method, concrete(route)), concrete(route)).toBe(
				route,
			);
		}
	});

	it("takes the method as it is written", () => {
		expect(routeFor("GET", "/api/manageUsers")).not.toBeNull();
		for (const method of [
			"get",
			"Get",
			"HEAD",
			"OPTIONS",
			"PATCH",
			"DELETE",
			"",
		]) {
			expect(routeFor(method, "/api/manageUsers"), method).toBeNull();
		}
	});

	it("matches the whole address and nothing around it", () => {
		for (const path of [
			"/api/manageUsers/",
			"/api//manageUsers",
			"/api/manageUsers/x",
			"/api/manageUsersx",
			"/api/xmanageUsers",
			"/x/api/manageUsers",
			"/manageUsers",
			"api/manageUsers",
			"/api/manageusers",
			"/API/manageUsers",
			"/api/manageUsers?x=1",
			"/api/manageUsers#x",
			"/api/manageUsers\n",
			"/api/manageUsers;x=1",
			"/api/panel/manageUsers",
			"",
		]) {
			expect(routeFor("GET", path), JSON.stringify(path)).toBeNull();
		}
	});

	it("takes as an identifier what an identifier looks like", () => {
		for (const id of [
			"a",
			"7",
			"abc-123",
			"A1b2C3d4E5f6G7h8I9j0K1l2M3n4",
			"with_underscore",
			"-starts-with-dash",
			"_starts_with_underscore",
			"has.dot",
			"has~tilde",
			"ends.",
			"x".repeat(128),
		]) {
			expect(routeFor("GET", `/api/accounts/${id}`), id).not.toBeNull();
		}
	});

	it("refuses an identifier that is not one", () => {
		for (const id of [
			"",
			".",
			"..",
			"...",
			".hidden",
			"~home",
			"a..b",
			"a/b",
			"a\\b",
			"a b",
			"a%20b",
			"a%2Fb",
			"a%2fb",
			"%2e%2e",
			"a%00",
			"a?b",
			"a#b",
			"a;b",
			"a,b",
			"a:b",
			"a@b",
			"a=b",
			"a&b",
			"a+b",
			"a*b",
			"a'b",
			"(a)",
			"a\n",
			"\ta",
			"żółw",
			"%C5%BC",
			"x".repeat(129),
		]) {
			for (const path of [
				`/api/accounts/${id}`,
				`/api/manageUserBadges/${id}/grants`,
				`/api/manageChallenges/${id}`,
			]) {
				expect(routeFor("GET", path), JSON.stringify(path)).toBeNull();
			}
			expect(routeFor("PUT", `/api/accounts/${id}`), id).toBeNull();
		}
	});

	it("refuses any address with `..` in it, wherever it is", () => {
		for (const path of [
			"/api/..",
			"/api/../api/manageUsers",
			"/api/accounts/..",
			"/api/accounts/../manageUsers",
			"/api/manageUserBadges/../grants",
			"/api/manageUserBadges/a..b/grants",
			"/api/accounts/a..",
			"/api/accounts/..a",
		]) {
			expect(routeFor("GET", path), path).toBeNull();
		}
	});
});

// ─── Reading ────────────────────────────────────────────────────────────────

describe("a read by a signed-in admin", () => {
	it("goes to the same address under /api/panel on the backend, for every read row", async () => {
		const { world, cookies } = await withAdmin();
		for (const route of READS) {
			world.forget();
			const path = concrete(route);
			const response = await world.send(fromPanel(path, { cookies }));
			expect(response.status, path).toBe(200);
			const call = only(world);
			expect(`${call.method} ${call.url}`, path).toBe(
				`GET ${API}/api/panel${path.slice("/api".length)}`,
			);
			expect(call.redirect, path).toBe("manual");
			expect(call.raw, path).toBeNull();
			// The backend checked the signature and the session itself.
			expect(world.backend.accepted, path).toEqual([call]);
			expect(world.backend.refused, path).toEqual([]);
		}
	});

	it("carries the session from the cookie and the Worker's signature over it", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(fromPanel("/api/manageUsers?limit=20", { cookies }));
		const call = only(world);
		const session = sessionOf(cookies);
		expect(call.headers.get("x-panel-session")).toBe(session);
		expect(call.headers.get("x-panel-timestamp")).toBe(String(world.nowS()));
		expect(call.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"GET",
				call.url,
				session,
			),
		);
	});

	it("passes the query on in its canonical spelling, and the backend's check agrees", async () => {
		const { world, cookies } = await withAdmin();
		const sentFor = async (query: string) => {
			world.forget();
			const response = await world.send(
				fromPanel(`/api/manageUsers${query}`, { cookies }),
			);
			expect(response.status, query).toBe(200);
			expect(world.backend.refused, query).toEqual([]);
			return only(world).url.slice(`${API}/api/panel/manageUsers`.length);
		};
		expect(await sentFor("")).toBe("");
		expect(await sentFor("?")).toBe("");
		expect(await sentFor("?query=ada+l&limit=20")).toBe(
			"?limit=20&query=ada%20l",
		);
		expect(await sentFor("?limit=20&query=ada%20l")).toBe(
			"?limit=20&query=ada%20l",
		);
		expect(await sentFor("?query=%C5%BCaneta&cursor=a%2Fb%3D%3D")).toBe(
			"?cursor=a%2Fb%3D%3D&query=%C5%BCaneta",
		);
		expect(await sentFor("?query=a%26admin%3Dtrue")).toBe(
			"?query=a%26admin%3Dtrue",
		);
		expect(await sentFor("?tag=b&tag=a&empty=&flag")).toBe(
			"?empty=&flag=&tag=a&tag=b",
		);
		expect(await sentFor("?query=50%25+%2B+1#fragment")).toBe(
			"?query=50%25%20%2B%201",
		);
	});

	it("sends only the listed request headers, and never the browser's cookies or authorization", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			fromPanel("/api/manageChallenges/abc-123", {
				cookies: `${cookies}; other=cookie-of-the-browser`,
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					"if-match": 'W/"3"',
					"if-none-match": 'W/"4"',
					authorization: "Bearer token-from-the-browser",
					"x-functions-key": "key-from-the-browser",
					"x-panel-session": "someone-elses-session",
					"x-panel-signature": "v1=forged",
					"x-panel-timestamp": "1",
					"x-forwarded-for": "203.0.113.7",
					"x-forwarded-host": "evil.example.test",
					"user-agent": "made-up-browser",
					referer: "https://panel.example.test/challenges",
					"accept-language": "pl",
					"cf-connecting-ip": "203.0.113.7",
					"x-anything-else": "x",
				},
			}),
		);
		const call = only(world);
		expect([...call.headers.keys()].sort()).toEqual([
			"accept",
			"content-type",
			"if-match",
			"if-none-match",
			"x-panel-session",
			"x-panel-signature",
			"x-panel-timestamp",
		]);
		expect(call.headers.get("accept")).toBe("application/json");
		expect(call.headers.get("if-match")).toBe('W/"3"');
		expect(call.headers.get("if-none-match")).toBe('W/"4"');
		// The signing headers are the Worker's own, not the ones sent along.
		expect(call.headers.get("x-panel-session")).toBe(sessionOf(cookies));
		expect(call.headers.get("x-panel-timestamp")).toBe(String(world.nowS()));
		expect(world.backend.refused).toEqual([]);
	});

	it("passes back the status, the body, the type and the etag, and nothing else of the backend's", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.data = () =>
			new Response('{"items":[1,2,3]}', {
				status: 200,
				headers: {
					"content-type": "application/json; charset=utf-8",
					etag: 'W/"9"',
					"set-cookie": "backend=cookie; Path=/",
					location: "https://elsewhere.example.test/",
					"access-control-allow-origin": "*",
					"cache-control": "public, max-age=3600",
					"content-security-policy": "default-src *",
					"x-powered-by": "made-up",
					"www-authenticate": "Bearer",
				},
			});
		const response = await world.send(
			fromPanel("/api/manageBadges", { cookies }),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('{"items":[1,2,3]}');
		expect(Object.fromEntries(response.headers)).toEqual({
			"content-type": "application/json; charset=utf-8",
			etag: 'W/"9"',
			"cache-control": "no-store",
			"content-security-policy": DATA_POLICY,
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		});
	});

	it("passes back what the backend answers when it is not about who is asking", async () => {
		const { world, cookies } = await withAdmin();
		for (const [status, body] of [
			[200, { ok: true }],
			[400, { error: "bad", errorCode: "VALIDATION" }],
			[404, { error: "none", errorCode: "NOT_FOUND" }],
			[409, { error: "conflict", errorCode: "CONFLICT" }],
			[412, { error: "stale", errorCode: "PRECONDITION_FAILED" }],
			[429, { error: "slow down", errorCode: "RATE_LIMITED" }],
			[500, { error: "oops" }],
			[503, { error: "busy", errorCode: "BUSY" }],
		] as const) {
			world.backend.data = () => jsonAnswer(body, status);
			const response = await world.send(
				fromPanel("/api/manageWorkouts", { cookies }),
			);
			expect(response.status, String(status)).toBe(status);
			expect(await bodyOf(response), String(status)).toEqual(body);
			expect(setCookies(response), String(status)).toEqual([]);
			expectDataHeaders(response, String(status));
		}
		world.backend.data = () => new Response(null, { status: 204 });
		const empty = await world.send(
			fromPanel("/api/manageWorkouts", { cookies }),
		);
		expect(empty.status).toBe(204);
		expectDataHeaders(empty);
	});

	it("writes no log line for a read that went through", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(fromPanel("/api/manageUsers?query=ada", { cookies }));
		expect(world.logs).toEqual([]);
	});

	it("the panel's own documents go to /api/panel/manage/panelDocs", async () => {
		const { world, cookies } = await withAdmin();
		for (const [path, sent] of [
			["/api/manage/panelDocs/planner", "/api/panel/manage/panelDocs/planner"],
			[
				"/api/manage/panelDocs/planning/2026-W46",
				"/api/panel/manage/panelDocs/planning/2026-W46",
			],
			[
				"/api/manage/panelDocs/planning?from=2026-11-09&limit=20",
				"/api/panel/manage/panelDocs/planning?from=2026-11-09&limit=20",
			],
		] as const) {
			world.forget();
			const response = await world.send(fromPanel(path, { cookies }));
			expect(response.status, path).toBe(200);
			const call = only(world);
			expect(`${call.method} ${call.url}`, path).toBe(`GET ${API}${sent}`);
			expect(world.backend.accepted, path).toEqual([call]);
		}
	});

	it("a document is read with If-None-Match going out and the etag coming back", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.data = (call) =>
			call.headers.get("if-none-match") === 'W/"12"'
				? new Response(null, { status: 304, headers: { etag: 'W/"12"' } })
				: jsonAnswer({ notes: "[TEST] made up" }, 200, { etag: 'W/"12"' });

		const first = await world.send(
			fromPanel("/api/manage/panelDocs/planning/2026-W46", { cookies }),
		);
		expect(first.status).toBe(200);
		expect(first.headers.get("etag")).toBe('W/"12"');
		expect(await bodyOf(first)).toEqual({ notes: "[TEST] made up" });

		world.forget();
		const again = await world.send(
			fromPanel("/api/manage/panelDocs/planning/2026-W46", {
				cookies,
				headers: { "if-none-match": 'W/"12"', "if-match": 'W/"11"' },
			}),
		);
		const call = only(world);
		expect(call.headers.get("if-none-match")).toBe('W/"12"');
		expect(call.headers.get("if-match")).toBe('W/"11"');
		expect(again.status).toBe(304);
		expect(again.headers.get("etag")).toBe('W/"12"');
		expect(await again.text()).toBe("");
		expectDataHeaders(again);
	});

	it("the record of changes is read with its query", async () => {
		const { world, cookies } = await withAdmin();
		const response = await world.send(
			fromPanel("/api/manageAudit?uid=abc-123&limit=50&before=2026-11-13", {
				cookies,
			}),
		);
		expect(response.status).toBe(200);
		const call = only(world);
		expect(call.url).toBe(
			`${API}/api/panel/manageAudit?before=2026-11-13&limit=50&uid=abc-123`,
		);
		expect(world.backend.accepted).toEqual([call]);
		// It is read only: there is no row to write to it.
		expect(ROUTES.filter((route) => route.path === "manageAudit")).toEqual([
			{ method: "GET", path: "manageAudit", to: "panel" },
		]);
	});

	it("a document's name and key are identifiers and nothing else", async () => {
		const { world, cookies } = await withAdmin();
		for (const path of [
			"/api/manage/panelDocs",
			"/api/manage/panelDocs/",
			"/api/manage/panelDocs/planning/",
			"/api/manage/panelDocs/planning/a/b",
			"/api/manage/panelDocs/.hidden",
			"/api/manage/panelDocs/planning/a..b",
			"/api/manage/panelDocs/planning/a%2Fb",
			"/api/manage/panelDocs/planning/a%20b",
			"/api/manage/panelDocs/%2e%2e/manageUsers",
			"/api/manage/panelDocs/planning/..%2f..%2fmanageUsers",
			"/api/manage/panelDocs/a;b",
			"/api/manage/PanelDocs/planning",
			"/api/Manage/panelDocs/planning",
			"/api/manage/planning",
			"/api/manage",
			"/api/manage/",
		]) {
			for (const method of ["GET", "PUT", "DELETE"]) {
				await expectFailure(
					await world.send(fromPanel(path, { method, cookies })),
					404,
					"NOT_FOUND",
					`${method} ${path}`,
				);
			}
		}
		expect(world.calls).toEqual([]);
	});

	it("is judged as the address it resolves to", async () => {
		// The runtime resolves dot segments before the Worker sees the
		// address; what is forwarded is the resolved one, from the table.
		const { world, cookies } = await withAdmin();
		await world.send(
			fromPanel("/api/accounts/../manageUserBadges/./abc-123", { cookies }),
		);
		expect(only(world).url).toBe(`${API}/api/panel/manageUserBadges/abc-123`);
	});
});

describe("the two public documents", () => {
	it("are fetched from the backend's public address, unsigned and without the session", async () => {
		const { world, cookies } = await withAdmin();
		for (const route of PUBLIC) {
			world.forget();
			const path = concrete(route);
			const response = await world.send(
				fromPanel(`${path}?x=1`, {
					cookies,
					headers: { authorization: "Bearer token-from-the-browser" },
				}),
			);
			expect(response.status).toBe(200);
			expect(await bodyOf(response)).toEqual({ document: route.path });
			expect(response.headers.get("etag")).toBe('W/"config-1"');
			expectDataHeaders(response);
			const call = only(world);
			// Not even the query goes along.
			expect(`${call.method} ${call.url}`).toBe(`GET ${API}${path}`);
			expect(Object.fromEntries(call.headers)).toEqual({
				accept: "application/json",
			});
			expect(call.redirect).toBe("manual");
		}
	});

	it("need no session, but do need to be asked by the panel's own page", async () => {
		const world = makeWorld();
		const asked = await world.send(fromPanel("/api/internalConfig"));
		expect(asked.status).toBe(200);
		world.forget();
		await expectFailure(
			await world.send(bare("/api/internalConfig")),
			403,
			"FOREIGN_REQUEST",
		);
		expect(world.calls).toEqual([]);
	});

	it("need the backend's address and nothing else", async () => {
		const unsigned = makeWorld({ PANEL_SIGNING_SECRET: undefined });
		expect((await unsigned.send(fromPanel("/api/workoutsConfig"))).status).toBe(
			200,
		);
		const nowhere = makeWorld({ API_ORIGIN: undefined });
		await expectFailure(
			await nowhere.send(fromPanel("/api/workoutsConfig")),
			503,
			"NOT_CONFIGURED",
		);
		expect(nowhere.calls).toEqual([]);
	});

	it("answer 502 when the backend is down", async () => {
		const world = makeWorld();
		world.backend.down = true;
		await expectFailure(
			await world.send(fromPanel("/api/internalConfig")),
			502,
			"BACKEND_UNREACHABLE",
		);
	});

	it("are refused with 502 when the backend redirects, and the target goes nowhere", async () => {
		for (const status of [301, 302, 303, 304, 307, 308]) {
			const world = makeWorld();
			world.on(
				`${API}/api/internalConfig`,
				() =>
					new Response(null, {
						status,
						headers: { location: "https://elsewhere.example.test/config" },
					}),
			);
			const response = await world.send(fromPanel("/api/internalConfig"));
			await expectFailure(response, 502, "BACKEND_UNREACHABLE", String(status));
			expect(response.headers.has("location")).toBe(false);
			expect(world.calls).toHaveLength(1);
			expect(world.callsTo("https://elsewhere.example.test")).toEqual([]);
			expect(world.logs).toEqual([
				{
					event: "refused",
					method: "GET",
					route: "/api/internalConfig",
					status: 502,
					reason: "BACKEND_UNREACHABLE",
					ray: null,
				},
			]);
		}
	});
});

// ─── Who may ask ────────────────────────────────────────────────────────────

describe("the checks every call passes", () => {
	const rows = [...READS, ...PUBLIC];

	it("refuses a call without the panel's header", async () => {
		const { world, cookies } = await withAdmin();
		for (const route of rows) {
			world.forget();
			const path = concrete(route);
			for (const headers of [
				{ "x-cf-panel": null },
				{ "x-cf-panel": "0" },
				{ "x-cf-panel": "true" },
			]) {
				await expectFailure(
					await world.send(fromPanel(path, { cookies, headers })),
					403,
					"FOREIGN_REQUEST",
					path,
				);
			}
			expect(world.calls, path).toEqual([]);
			expect(world.logs[0], path).toEqual({
				event: "refused",
				method: "GET",
				route: `/api/${route.path}`,
				status: 403,
				reason: "FOREIGN_REQUEST",
				ray: null,
			});
		}
	});

	it("refuses a call the browser says came from somewhere else", async () => {
		const { world, cookies } = await withAdmin();
		for (const site of ["cross-site", "same-site", "none", ""]) {
			await expectFailure(
				await world.send(
					fromPanel("/api/manageUsers", {
						cookies,
						headers: { "sec-fetch-site": site },
					}),
				),
				403,
				"FOREIGN_REQUEST",
				site,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("refuses a call with an Origin that is not the panel's", async () => {
		const { world, cookies } = await withAdmin();
		for (const sent of [
			"https://evil.example.test",
			"null",
			"https://panel.example.test.evil.example.test",
			"http://panel.example.test",
			"https://panel.example.test:8443",
			"https://sub.panel.example.test",
			API,
		]) {
			await expectFailure(
				await world.send(
					fromPanel("/api/manageUsers", { cookies, headers: { origin: sent } }),
				),
				403,
				"FOREIGN_REQUEST",
				sent,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("lets a GET through without Origin, and without Sec-Fetch-Site when the header is there", async () => {
		// Rule 15 reads as if every /api call must carry Sec-Fetch-Site; the
		// code requires it only of calls that change something. A GET without
		// it still needs the panel's header, which another site cannot set.
		const { world, cookies } = await withAdmin();
		const left: Record<string, string | null>[] = [
			{ origin: null },
			{ "sec-fetch-site": null },
			{ "sec-fetch-site": null, origin: null },
		];
		for (const headers of left) {
			const response = await world.send(
				fromPanel("/api/manageUsers", { cookies, headers }),
			);
			expect(response.status).toBe(200);
		}
		expect(world.calls).toHaveLength(3);
	});

	it("a plain navigation to an API address gets nothing", async () => {
		const { world, cookies } = await withAdmin();
		for (const site of ["none", "same-origin", "cross-site"]) {
			await expectFailure(
				await world.send(navigation("/api/manageUsers", { cookies, site })),
				403,
				"FOREIGN_REQUEST",
				site,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("answers 401 to an admin call without a session, asking nobody", async () => {
		const world = makeWorld();
		for (const route of READS) {
			world.forget();
			const path = concrete(route);
			for (const cookies of ["", `${SESSION_COOKIE}=`, "other=1"]) {
				const response = await world.send(fromPanel(path, { cookies }));
				await expectFailure(response, 401, "SIGNED_OUT", path);
				expect(setCookies(response), path).toEqual([]);
			}
			expect(world.calls, path).toEqual([]);
			expect(world.logs[0], path).toEqual({
				event: "refused",
				method: "GET",
				route: `/api/${route.path}`,
				status: 401,
				reason: "SIGNED_OUT",
				ray: null,
			});
		}
	});

	it("does not take a session cookie by another name", async () => {
		const { world, cookies } = await withAdmin();
		const session = sessionOf(cookies);
		for (const jar of [
			`cf_session=${session}`,
			`__Secure-cf_session=${session}`,
			`__host-cf_session=${session}`,
			`__Host-cf_token=${session}`,
			`session=${session}`,
		]) {
			await expectFailure(
				await world.send(fromPanel("/api/manageUsers", { cookies: jar })),
				401,
				"SIGNED_OUT",
				jar.split("=")[0],
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("answers 503 while the backend's address or the secret is missing, asking nobody", async () => {
		const cookies = await signedIn(makeWorld());
		for (const overrides of [
			{ API_ORIGIN: undefined },
			{ API_ORIGIN: "not an address" },
			{ PANEL_SIGNING_SECRET: undefined },
			{ PANEL_SIGNING_SECRET: "x".repeat(31) },
		]) {
			const world = makeWorld(overrides);
			const response = await world.send(
				fromPanel("/api/manageUsers", { cookies }),
			);
			await expectFailure(
				response,
				503,
				"NOT_CONFIGURED",
				JSON.stringify(overrides),
			);
			expect(setCookies(response)).toEqual([]);
			expect(world.calls).toEqual([]);
		}
	});

	it("answers 502 when the backend cannot be reached, and keeps the session", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.down = true;
		const response = await world.send(
			fromPanel("/api/manageUsers", { cookies }),
		);
		await expectFailure(response, 502, "BACKEND_UNREACHABLE");
		expect(setCookies(response)).toEqual([]);
		expect(world.logs).toEqual([
			{
				event: "refused",
				method: "GET",
				route: "/api/manageUsers",
				status: 502,
				reason: "BACKEND_UNREACHABLE",
				ray: null,
			},
		]);
	});
});

// ─── Outside the table ──────────────────────────────────────────────────────

describe("a call that is not in the table", () => {
	const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
	const EXTRA = [
		"",
		"manage",
		"manageUsers/abc-123",
		"manageUsers/abc-123/abc-123",
		"manageWorkouts/abc-123",
		"manageBadges/abc-123",
		"manageBadges/grantManual/abc-123",
		"manageChallenges/abc-123/abc-123",
		"manageMessageDrafts",
		"manageMessageDrafts/abc-123",
		"manageMessageDrafts/send",
		"manageMessageDrafts/delete",
		"manageMedia",
		"manageMedia/files/abc-123",
		"manageUserProgress",
		"manageUserProgress/abc-123/abc-123",
		"manageUserBadges",
		"manageUserBadges/abc-123/grants/abc-123",
		"accounts",
		"accounts/abc-123/abc-123",
		"accounts/abc-123/password",
		"manageTrainers",
		"manageEverything",
		"manage/panelDocs",
		"manage/panelDocs/",
		"manage/panelDocs/abc-123/abc-123/abc-123",
		"manage/other/abc-123",
		"manage/abc-123",
		"manageAudit/abc-123",
		"manage/audit",
		"panelDocs/abc-123",
		"admin",
		"users",
		// The backend's own session routes are the Worker's to call, not the page's.
		"panel/session",
		"panel/me",
		"panel/signOut",
		"panel/manageUsers",
		"files/abc-123",
		"files/",
		"health/abc-123",
		"internalConfig/abc-123",
		"workoutsConfig/",
		"manageusers",
		"ManageUsers",
		"manageUsers.json",
		"manageUsers/",
	];
	// Written out apart from the Worker's own matching: `:id` is one segment.
	const inTable = (method: string, path: string) =>
		ROUTES.some(
			(route) =>
				route.method === method &&
				new RegExp(`^${route.path.replaceAll(":id", "[^/]+")}$`).test(path),
		);
	const outside: [string, string][] = [];
	for (const method of METHODS) {
		for (const path of [
			...new Set([
				...ROUTES.map((route) => route.path.replaceAll(":id", SAMPLE_ID)),
				...EXTRA,
			]),
		]) {
			if (!inTable(method, path)) outside.push([method, path]);
		}
	}

	it("covers every method against every address, in and out of the table", () => {
		// 7 methods × (every table address + the extras), less the rows.
		expect(outside.length).toBeGreaterThan(300);
		expect(outside).toContainEqual(["DELETE", "accounts/abc-123"]);
		expect(outside).toContainEqual(["DELETE", "manage/panelDocs/abc-123"]);
		expect(outside).toContainEqual(["PUT", "manage/panelDocs/abc-123"]);
		expect(outside).toContainEqual([
			"POST",
			"manage/panelDocs/abc-123/abc-123",
		]);
		expect(outside).toContainEqual(["POST", "manageAudit"]);
		expect(outside).not.toContainEqual([
			"DELETE",
			"manage/panelDocs/abc-123/abc-123",
		]);
		expect(outside).toContainEqual(["DELETE", "manageChallenges/abc-123"]);
		expect(outside).toContainEqual(["PATCH", "accounts/abc-123"]);
		expect(outside).toContainEqual(["POST", "manageUsers"]);
		expect(outside).toContainEqual(["PUT", "manageChallenges"]);
		expect(outside).toContainEqual(["POST", "internalConfig"]);
		expect(outside).toContainEqual(["POST", "panel/session"]);
		expect(outside).not.toContainEqual(["GET", "manageUsers"]);
		expect(outside).not.toContainEqual(["PUT", "accounts/abc-123"]);
	});

	it("is 404 and reaches nothing, for a signed-in admin on the panel's own page", async () => {
		const { world, cookies } = await withAdmin();
		for (const [method, path] of outside) {
			const label = `${method} /api/${path}`;
			world.forget();
			const response = await world.send(
				fromPanel(`/api/${path}`, { method, cookies }),
			);
			expect(response.status, label).toBe(404);
			expect((await bodyOf(response)).errorCode, label).toBe("NOT_FOUND");
			expect(setCookies(response), label).toEqual([]);
			expectDataHeaders(response, label);
			expect(world.calls, label).toEqual([]);
			expect(world.logs, label).toEqual([
				{ event: "refused", method, reason: "notInTable", ray: null },
			]);
		}
	});

	it("is 404 for anyone else too: what exists is not told to a stranger", async () => {
		const world = makeWorld();
		for (const [method, path] of outside) {
			const response = await world.send(bare(`/api/${path}`, { method }));
			expect(response.status, `${method} /api/${path}`).toBe(404);
		}
		expect(world.calls).toEqual([]);
	});

	it("is 404 for an identifier that is not one", async () => {
		const { world, cookies } = await withAdmin();
		for (const id of [
			".hidden",
			"~home",
			"a..b",
			"a%20b",
			"a%2Fb",
			"a%5Cb",
			"%2e%2e%2fmanageUsers",
			"..%2fmanageUsers",
			"a;b",
			"a,b",
			"a:b",
			"a@b",
			"a=b",
			"a+b",
			"a*b",
			"%C5%BC",
			"a%00",
			"a%0d%0ab",
			"x".repeat(129),
		]) {
			for (const path of [
				`/api/accounts/${id}`,
				`/api/manageUserBadges/${id}/grants`,
				`/api/manageUserProgress/${id}`,
			]) {
				await expectFailure(
					await world.send(fromPanel(path, { cookies })),
					404,
					"NOT_FOUND",
					path,
				);
			}
		}
		expect(world.calls).toEqual([]);
	});

	it("is 404 for a dot segment that leads out of the table", async () => {
		const { world, cookies } = await withAdmin();
		for (const path of [
			"/api/accounts/..",
			"/api/accounts/../..",
			"/api/accounts/%2e%2e",
			"/api/accounts/.%2E/panel/me",
			"/api/accounts/abc-123/../../panel/session",
			"/api/manageUsers/../files/x",
			"/api/accounts/.",
			"/api/accounts/%2e",
		]) {
			await expectFailure(
				await world.send(fromPanel(path, { cookies })),
				404,
				"NOT_FOUND",
				path,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("never writes the address or the query of such a call into the log", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			fromPanel("/api/somewhere/secret-path?token=secret-query", {
				method: "POST",
				cookies,
				body: "secret-body",
			}),
		);
		expect(world.logs).toEqual([
			{ event: "refused", method: "POST", reason: "notInTable", ray: null },
		]);
	});
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("a write while its area is closed", () => {
	it("is refused with READ_ONLY and reaches nothing, for every write row of a closed area", async () => {
		const { world, cookies } = await withAdmin();
		expect(CLOSED_WRITES.length).toBe(WRITES.length - 1);
		for (const route of CLOSED_WRITES) {
			world.forget();
			const path = concrete(route);
			const response = await world.send(
				fromPanel(path, {
					method: route.method,
					cookies,
					json: { title: "[TEST] made up" },
				}),
			);
			await expectFailure(response, 403, "READ_ONLY", path);
			expect(setCookies(response), path).toEqual([]);
			expect(world.calls, path).toEqual([]);
			expect(world.logs, path).toEqual([
				{
					event: "refused",
					method: route.method,
					route: `/api/${route.path}`,
					status: 403,
					reason: "READ_ONLY",
					ray: null,
				},
			]);
		}
	});

	it("is refused the same without a session", async () => {
		const world = makeWorld();
		for (const route of CLOSED_WRITES) {
			await expectFailure(
				await world.send(
					fromPanel(concrete(route), { method: route.method, json: {} }),
				),
				403,
				"READ_ONLY",
				concrete(route),
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("is refused as foreign first when it did not come from the panel's page", async () => {
		const { world, cookies } = await withAdmin();
		for (const route of WRITES) {
			await expectFailure(
				await world.send(
					bare(concrete(route), { method: route.method, cookies, json: {} }),
				),
				403,
				"FOREIGN_REQUEST",
				concrete(route),
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("does not read the body it refuses", async () => {
		const { world, cookies } = await withAdmin();
		const request = fromPanel("/api/manageChallenges", {
			method: "POST",
			cookies,
			body: "x".repeat(1024),
		});
		await world.send(request);
		expect(request.bodyUsed).toBe(false);
	});
});

// No data area is open in the code. These tests open one by hand (the set
// is an ordinary Set at run time) to reach the code a write will go through:
// the body, its size limit and the log line. They say nothing about which
// area should be opened, or when.
describe("a write once its area is open", () => {
	const open = OPEN_FOR_WRITING as Set<WriteArea>;
	beforeEach(() => {
		open.add("challenges");
	});
	afterEach(() => {
		open.clear();
		for (const area of OPEN_AS_SHIPPED) open.add(area);
	});

	const post = (
		cookies: string,
		options: Parameters<typeof fromPanel>[1] = {},
	) =>
		fromPanel("/api/manageChallenges", { method: "POST", cookies, ...options });

	it("is forwarded with its body, signed, and the backend accepts it", async () => {
		const { world, cookies } = await withAdmin();
		const response = await world.send(
			post(cookies, {
				json: { title: "[TEST] made up", days: 7 },
				headers: { "if-match": 'W/"3"' },
			}),
		);
		expect(response.status).toBe(200);
		expectDataHeaders(response);
		const call = only(world);
		expect(`${call.method} ${call.url}`).toBe(
			`POST ${API}/api/panel/manageChallenges`,
		);
		expect(JSON.parse(call.body ?? "")).toEqual({
			title: "[TEST] made up",
			days: 7,
		});
		expect([...call.headers.keys()].sort()).toEqual([
			"content-type",
			"if-match",
			"x-panel-session",
			"x-panel-signature",
			"x-panel-timestamp",
		]);
		expect(call.redirect).toBe("manual");
		expect(world.backend.accepted).toEqual([call]);
	});

	it("is forwarded byte for byte", async () => {
		const { world, cookies } = await withAdmin();
		const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
		await world.send(
			post(cookies, {
				body: bytes,
				headers: { "content-type": "image/png" },
			}),
		);
		const call = only(world);
		expect(call.raw).toEqual(bytes);
		expect(call.headers.get("content-type")).toBe("image/png");
	});

	it("may have no body", async () => {
		const { world, cookies } = await withAdmin();
		const response = await world.send(post(cookies));
		expect(response.status).toBe(200);
		expect(only(world).raw).toBeNull();
	});

	it("arrives with a signature over its exact bytes", async () => {
		const binary = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) % 256);
		const bodies: [string, BodyInit | undefined, string][] = [
			["JSON", '{"title":"[TEST] made up","days":7}', "application/json"],
			[
				"letters outside ASCII",
				'{"title":"[TEST] Zażółć gęślą jaźń — 7 dni 💪"}',
				"application/json; charset=utf-8",
			],
			["binary", binary, "image/png"],
			[
				"a form",
				"title=%5BTEST%5D+made+up&days=7",
				"application/x-www-form-urlencoded",
			],
			["an empty text", "", "text/plain"],
			["none", undefined, "application/json"],
		];
		for (const [label, body, type] of bodies) {
			const { world, cookies } = await withAdmin();
			const response = await world.send(
				post(cookies, { body, headers: { "content-type": type } }),
			);
			expect(response.status, label).toBe(200);
			const call = only(world);
			expect(call.headers.get("x-panel-signature"), label).toBe(
				await expectedSignature(
					SIGNING_SECRET,
					String(world.nowS()),
					"POST",
					call.url,
					sessionOf(cookies),
					call.raw,
				),
			);
			// What was signed is what the browser sent, byte for byte.
			const sent =
				body === undefined
					? new Uint8Array(0)
					: new Uint8Array(await new Response(body).arrayBuffer());
			expect(call.raw ?? new Uint8Array(0), label).toEqual(sent);
			expect(world.backend.accepted, label).toEqual([call]);
		}
	});

	it("is signed with its body: the same call with another body would not be let in", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			post(cookies, { json: { audience: "one", text: "[TEST] made up" } }),
		);
		const call = only(world);
		world.forget();
		const replay = async (body: string | undefined) =>
			errorCodeOf(
				await world.deps.fetch(call.url, {
					method: call.method,
					headers: call.headers,
					body,
				}),
			);
		expect(await replay('{"audience":"all","text":"[TEST] made up"}')).toBe(
			"BAD_SIGNATURE",
		);
		expect(await replay(undefined)).toBe("BAD_SIGNATURE");
		expect(await replay(call.body ?? "")).toBeNull();
		expect(world.backend.accepted).toHaveLength(1);
	});

	it("a read is signed over no body at all", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(fromPanel("/api/manageChallenges?limit=5", { cookies }));
		const call = only(world);
		expect(call.raw).toBeNull();
		expect(call.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"GET",
				call.url,
				sessionOf(cookies),
				"",
			),
		);
	});

	it("writes a log line: who, what, how it ended, Cloudflare's request id", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			post(cookies, {
				json: { a: 1 },
				headers: { "cf-ray": "made-up-ray-id" },
			}),
		);
		expect(world.logs).toEqual([
			{
				event: "forwarded",
				method: "POST",
				route: "/api/manageChallenges",
				status: 200,
				uid: ADMIN.uid,
				ray: "made-up-ray-id",
			},
		]);
	});

	it("logs a write the backend did not carry out with its status and without a name", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.data = () => backendError(422, "VALIDATION");
		const response = await world.send(post(cookies, { json: { a: 1 } }));
		expect(response.status).toBe(422);
		expect(world.logs).toEqual([
			{
				event: "forwarded",
				method: "POST",
				route: "/api/manageChallenges",
				status: 422,
				uid: null,
				ray: null,
			},
		]);
	});

	it("never logs the body or the query", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			fromPanel("/api/manageChallenges?note=secret-query-text", {
				method: "POST",
				cookies,
				json: { title: "secret-body-text" },
			}),
		);
		const text = JSON.stringify(world.logs);
		expect(world.logs).toHaveLength(1);
		expect(text).not.toContain("secret-body-text");
		expect(text).not.toContain("secret-query-text");
		expect(text).not.toContain(sessionOf(cookies));
	});

	it("leaves every other area closed", async () => {
		const { world, cookies } = await withAdmin();
		for (const route of WRITES.filter(
			(row) => row.writes && !open.has(row.writes),
		)) {
			await expectFailure(
				await world.send(
					fromPanel(concrete(route), {
						method: route.method,
						cookies,
						json: {},
					}),
				),
				403,
				"READ_ONLY",
				concrete(route),
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("a document is saved with If-Match going out and the new etag coming back", async () => {
		open.add("planning");
		const { world, cookies } = await withAdmin();
		world.backend.data = () =>
			jsonAnswer({ saved: true }, 200, { etag: 'W/"13"' });
		const response = await world.send(
			fromPanel("/api/manage/panelDocs/planning/2026-W46", {
				method: "PUT",
				cookies,
				json: { notes: "[TEST] made up" },
				headers: { "if-match": 'W/"12"', "cf-ray": "made-up-ray-id" },
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"13"');
		const call = only(world);
		expect(`${call.method} ${call.url}`).toBe(
			`PUT ${API}/api/panel/manage/panelDocs/planning/2026-W46`,
		);
		expect(call.headers.get("if-match")).toBe('W/"12"');
		expect(JSON.parse(call.body ?? "")).toEqual({ notes: "[TEST] made up" });
		expect(world.backend.accepted).toEqual([call]);
		expect(world.logs).toEqual([
			{
				event: "forwarded",
				method: "PUT",
				route: "/api/manage/panelDocs/:id/:id",
				status: 200,
				uid: ADMIN.uid,
				ray: "made-up-ray-id",
			},
		]);
	});

	it("a save that lost the race is passed back as the backend's 412", async () => {
		open.add("planning");
		const { world, cookies } = await withAdmin();
		world.backend.data = () => backendError(412, "PRECONDITION_FAILED");
		const response = await world.send(
			fromPanel("/api/manage/panelDocs/planning/2026-W46", {
				method: "PUT",
				cookies,
				json: {},
				headers: { "if-match": 'W/"11"' },
			}),
		);
		expect(response.status).toBe(412);
		expect((await bodyOf(response)).errorCode).toBe("PRECONDITION_FAILED");
	});

	it("a document is deleted with If-Match going out, and the delete is logged", async () => {
		open.add("planning");
		const { world, cookies } = await withAdmin();
		world.backend.data = () => new Response(null, { status: 204 });
		const response = await world.send(
			fromPanel("/api/manage/panelDocs/planning/2026-W46", {
				method: "DELETE",
				cookies,
				headers: { "if-match": 'W/"13"' },
			}),
		);
		expect(response.status).toBe(204);
		const call = only(world);
		expect(`${call.method} ${call.url}`).toBe(
			`DELETE ${API}/api/panel/manage/panelDocs/planning/2026-W46`,
		);
		expect(call.headers.get("if-match")).toBe('W/"13"');
		expect(call.raw).toBeNull();
		expect(world.backend.accepted).toEqual([call]);
		expect(world.logs).toEqual([
			{
				event: "forwarded",
				method: "DELETE",
				route: "/api/manage/panelDocs/:id/:id",
				status: 204,
				uid: ADMIN.uid,
				ray: null,
			},
		]);
	});

	it("opening the planner's store opens nothing but its two rows", async () => {
		open.clear();
		open.add("planning");
		const { world, cookies } = await withAdmin();
		for (const route of WRITES.filter((row) => row.writes !== "planning")) {
			await expectFailure(
				await world.send(
					fromPanel(concrete(route), {
						method: route.method,
						cookies,
						json: {},
					}),
				),
				403,
				"READ_ONLY",
				concrete(route),
			);
		}
		// And no way to write to a whole collection or to the record of changes.
		for (const [method, path] of [
			["PUT", "/api/manage/panelDocs/planning"],
			["DELETE", "/api/manage/panelDocs/planning"],
			["POST", "/api/manage/panelDocs/planning/2026-W46"],
			["POST", "/api/manageAudit"],
			["DELETE", "/api/manageAudit"],
		] as const) {
			await expectFailure(
				await world.send(fromPanel(path, { method, cookies })),
				404,
				"NOT_FOUND",
				`${method} ${path}`,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("is refused without Sec-Fetch-Site, even with the header and the right Origin", async () => {
		const { world, cookies } = await withAdmin();
		const response = await world.send(
			post(cookies, { json: {}, headers: { "sec-fetch-site": null } }),
		);
		await expectFailure(response, 403, "FOREIGN_REQUEST");
		expect(world.calls).toEqual([]);
	});

	it("is refused without a session", async () => {
		const world = makeWorld();
		await expectFailure(
			await world.send(post("", { json: {} })),
			401,
			"SIGNED_OUT",
		);
		expect(world.calls).toEqual([]);
	});

	it("is refused, and the cookie cleared, once the person is off the list", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.admins.delete(ADMIN.uid);
		const response = await world.send(post(cookies, { json: {} }));
		await expectFailure(response, 401, "SIGNED_OUT");
		expect(clears(response, SESSION_COOKIE)).toBe(true);
		expect(world.backend.accepted).toEqual([]);
		// Refused, not forwarded.
		expect(world.logs.map((entry) => entry.event)).toEqual(["refused"]);
	});

	it("refuses a body the request says is over the limit, before reading it", async () => {
		const { world, cookies } = await withAdmin();
		const request = post(cookies, {
			body: "small",
			headers: { "content-length": String(MAX_BODY_BYTES + 1) },
		});
		const response = await world.send(request);
		await expectFailure(response, 413, "TOO_LARGE");
		expect(request.bodyUsed).toBe(false);
		expect(world.calls).toEqual([]);
		expect(world.logs).toEqual([
			{
				event: "refused",
				method: "POST",
				route: "/api/manageChallenges",
				status: 413,
				reason: "TOO_LARGE",
				ray: null,
			},
		]);
	});

	it("refuses a body that is over the limit whatever the request says", async () => {
		const { world, cookies } = await withAdmin();
		for (const declared of [null, "5", "not a number"]) {
			const response = await world.send(
				post(cookies, {
					body: new Uint8Array(MAX_BODY_BYTES + 1),
					headers: { "content-length": declared },
				}),
			);
			await expectFailure(response, 413, "TOO_LARGE", String(declared));
		}
		expect(world.calls).toEqual([]);
	});

	it("forwards a body of exactly the limit", async () => {
		expect(MAX_BODY_BYTES).toBe(32 * 1024 * 1024);
		const { world, cookies } = await withAdmin();
		const response = await world.send(
			post(cookies, { body: new Uint8Array(MAX_BODY_BYTES) }),
		);
		expect(response.status).toBe(200);
		expect(only(world).raw?.byteLength).toBe(MAX_BODY_BYTES);
	});
});

// ─── Clearing the app's cache ───────────────────────────────────────────────

// Open in the code as shipped: it changes no data, so it works while
// Produkcja is otherwise read-only.
describe("clearing the app's CDN cache", () => {
	const purge = (
		cookies: string,
		options: Parameters<typeof fromPanel>[1] = {},
	) =>
		fromPanel("/api/manageCache/purge", {
			method: "POST",
			cookies,
			...options,
		});

	it("is forwarded to the panel's purge route, signed over an empty body, and the answer comes back", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.data = () =>
			jsonAnswer({ purgedAtUtc: "2026-11-16T10:00:00.000Z" });
		const response = await world.send(
			purge(cookies, { headers: { "cf-ray": "made-up-ray-id" } }),
		);
		expect(response.status).toBe(200);
		expectDataHeaders(response);
		expect(await bodyOf(response)).toEqual({
			purgedAtUtc: "2026-11-16T10:00:00.000Z",
		});
		const call = only(world);
		expect(`${call.method} ${call.url}`).toBe(
			`POST ${API}/api/panel/manageCache/purge`,
		);
		expect(call.raw).toBeNull();
		expect([...call.headers.keys()].sort()).toEqual([
			"x-panel-session",
			"x-panel-signature",
			"x-panel-timestamp",
		]);
		expect(call.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"POST",
				call.url,
				sessionOf(cookies),
				"",
			),
		);
		expect(world.backend.accepted).toEqual([call]);
		expect(world.logs).toEqual([
			{
				event: "forwarded",
				method: "POST",
				route: "/api/manageCache/purge",
				status: 200,
				uid: ADMIN.uid,
				ray: "made-up-ray-id",
			},
		]);
	});

	it("passes the backend's refusals back as they are", async () => {
		for (const [status, errorCode] of [
			[502, "CDN_PURGE_FAILED"],
			[503, "CDN_NOT_CONFIGURED"],
			[429, "CDN_PURGE_TOO_SOON"],
		] as const) {
			const { world, cookies } = await withAdmin();
			world.backend.data = () => backendError(status, errorCode);
			const response = await world.send(purge(cookies));
			expect(response.status, errorCode).toBe(status);
			expect(await bodyOf(response), errorCode).toEqual({
				error: `refused: ${errorCode}`,
				errorCode,
			});
			expectDataHeaders(response, errorCode);
			expect(setCookies(response), errorCode).toEqual([]);
		}
	});

	it("still needs the panel's page and a session", async () => {
		const { world, cookies } = await withAdmin();
		await expectFailure(
			await world.send(
				bare("/api/manageCache/purge", { method: "POST", cookies }),
			),
			403,
			"FOREIGN_REQUEST",
		);
		await expectFailure(
			await world.send(fromPanel("/api/manageCache/purge", { method: "POST" })),
			401,
			"SIGNED_OUT",
		);
		expect(world.calls).toEqual([]);
	});

	it("is refused like any write once its area is closed", async () => {
		const open = OPEN_FOR_WRITING as Set<WriteArea>;
		open.delete("cache");
		try {
			const { world, cookies } = await withAdmin();
			await expectFailure(await world.send(purge(cookies)), 403, "READ_ONLY");
			expect(world.calls).toEqual([]);
		} finally {
			for (const area of OPEN_AS_SHIPPED) open.add(area);
		}
	});

	it("is a POST only: no other method reaches it", async () => {
		const { world, cookies } = await withAdmin();
		for (const method of ["GET", "PUT", "DELETE"]) {
			await expectFailure(
				await world.send(
					fromPanel("/api/manageCache/purge", { method, cookies }),
				),
				404,
				"NOT_FOUND",
				method,
			);
		}
		expect(world.calls).toEqual([]);
	});
});

// ─── The backend says no ────────────────────────────────────────────────────

describe("the backend's refusals", () => {
	const answered = async (answer: () => Response) => {
		const { world, cookies } = await withAdmin();
		world.on(`${API}/api/panel/manageUsers`, answer);
		const response = await world.send(
			fromPanel("/api/manageUsers", { cookies }),
		);
		return { world, response };
	};

	it("the session is over or the person is off the list: 401, and the cookie is cleared", async () => {
		for (const [status, code] of [
			[401, "SESSION_INVALID"],
			[403, "NOT_PANEL_ADMIN"],
			[403, "WRONG_SIGN_IN_METHOD"],
			// The code decides, not the status it came with.
			[503, "SESSION_INVALID"],
		] as const) {
			const { world, response } = await answered(() =>
				backendError(status, code, { uid: "uid-in-the-backends-answer" }),
			);
			await expectFailure(response, 401, "SIGNED_OUT", code);
			expect(
				setCookies(response).map((cookie) => cookie.raw),
				code,
			).toEqual([
				`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
			]);
			// The Worker's own words, not the backend's.
			expect(await response.text(), code).not.toContain("uid-in-the-backends");
			expect(world.logs, code).toEqual([
				{
					event: "refused",
					method: "GET",
					route: "/api/manageUsers",
					status: 401,
					reason: "SIGNED_OUT",
					ray: null,
				},
			]);
		}
	});

	it("the backend refuses the Worker itself: 502, the cookie is kept, and it is logged", async () => {
		for (const [status, code] of [
			[401, "BAD_SIGNATURE"],
			[503, "PANEL_NOT_CONFIGURED"],
			[403, "BAD_SIGNATURE"],
		] as const) {
			const { world, response } = await answered(() =>
				backendError(status, code),
			);
			await expectFailure(response, 502, "BACKEND_REFUSED_PANEL", code);
			expect(setCookies(response), code).toEqual([]);
			expect(world.logs, code).toEqual([
				{
					event: "backendRefusedWorker",
					route: "/api/manageUsers",
					reason: code,
				},
			]);
		}
	});

	it("any other 401, 403 or 503 is passed back as it is, and the cookie is kept", async () => {
		for (const [status, body] of [
			[401, { error: "x", errorCode: "TOKEN_INVALID" }],
			[401, { error: "x", errorCode: "SIGN_IN_TOO_OLD" }],
			[403, { error: "x", errorCode: "SOMETHING_NEW" }],
			[403, { error: "no code" }],
			[503, { error: "busy" }],
			[401, { errorCode: 7 }],
		] as const) {
			const { response } = await answered(() => jsonAnswer(body, status));
			expect(response.status).toBe(status);
			expect(await bodyOf(response)).toEqual(body);
			expect(setCookies(response)).toEqual([]);
			expectDataHeaders(response);
		}
		const { response } = await answered(
			() => new Response("<html>Forbidden</html>", { status: 403 }),
		);
		expect(response.status).toBe(403);
		expect(setCookies(response)).toEqual([]);
	});

	it("a refusal code under another status is not acted on", async () => {
		// Only a 401, 403 or 503 is read as a refusal.
		for (const status of [200, 400, 404, 500]) {
			const { response } = await answered(() =>
				jsonAnswer({ errorCode: "SESSION_INVALID" }, status),
			);
			expect(response.status).toBe(status);
			expect(setCookies(response)).toEqual([]);
		}
	});

	it("with the real check: a Worker whose secret the backend does not share gets 502", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.signingKey = "another made up secret, also long enough";
		const response = await world.send(
			fromPanel("/api/manageUsers", { cookies }),
		);
		await expectFailure(response, 502, "BACKEND_REFUSED_PANEL");
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"BAD_SIGNATURE",
		]);
		expect(setCookies(response)).toEqual([]);
	});

	it("with the real check: a session of 48 hours ago gets 401 and is cleared", async () => {
		const { world, cookies } = await withAdmin();
		world.advance(SESSION_S - 1);
		expect(
			(await world.send(fromPanel("/api/manageUsers", { cookies }))).status,
		).toBe(200);
		world.advance(1);
		const response = await world.send(
			fromPanel("/api/manageUsers", { cookies }),
		);
		await expectFailure(response, 401, "SIGNED_OUT");
		expect(clears(response, SESSION_COOKIE)).toBe(true);
	});

	it("with the real check: a session nobody issued gets 401 and is cleared", async () => {
		const world = makeWorld();
		const forged = fakeIdToken({
			sub: ADMIN.uid,
			exp: world.nowS() + SESSION_S,
			firebase: { sign_in_provider: "google.com" },
		});
		const response = await world.send(
			fromPanel("/api/manageUsers", {
				cookies: `${SESSION_COOKIE}=${forged}`,
			}),
		);
		await expectFailure(response, 401, "SIGNED_OUT");
		expect(clears(response, SESSION_COOKIE)).toBe(true);
		expect(world.backend.accepted).toEqual([]);
	});

	it("a redirect from the backend is never followed and never passed on", async () => {
		for (const status of [301, 302, 303, 307, 308]) {
			const { world, response } = await answered(
				() =>
					new Response(null, {
						status,
						headers: { location: "https://elsewhere.example.test/api/panel/x" },
					}),
			);
			await expectFailure(response, 502, "BACKEND_UNREACHABLE", String(status));
			expect(response.headers.has("location")).toBe(false);
			expect(setCookies(response)).toEqual([]);
			expect(world.calls).toHaveLength(1);
			expect(world.callsTo("https://elsewhere.example.test")).toEqual([]);
			expect(world.logs).toEqual([
				{
					event: "refused",
					method: "GET",
					route: "/api/manageUsers",
					status: 502,
					reason: "BACKEND_UNREACHABLE",
					ray: null,
				},
			]);
		}
	});

	it('"not changed" is an answer, not a redirect: a 304 is passed back as it is', async () => {
		const { world, response } = await answered(
			() =>
				new Response(null, {
					status: 304,
					headers: {
						etag: 'W/"9"',
						location: "https://elsewhere.example.test/",
						"set-cookie": "backend=cookie",
					},
				}),
		);
		expect(response.status).toBe(304);
		expect(await response.text()).toBe("");
		expect(response.headers.get("etag")).toBe('W/"9"');
		expect(response.headers.has("location")).toBe(false);
		expect(setCookies(response)).toEqual([]);
		expectDataHeaders(response);
		expect(world.logs).toEqual([]);
	});

	it("a 304 comes back to a read that asked with If-None-Match", async () => {
		const { world, cookies } = await withAdmin();
		world.backend.data = (call) =>
			call.headers.get("if-none-match") === 'W/"7"'
				? new Response(null, { status: 304, headers: { etag: 'W/"7"' } })
				: jsonAnswer({ items: [] }, 200, { etag: 'W/"7"' });
		const first = await world.send(fromPanel("/api/manageBadges", { cookies }));
		expect(first.status).toBe(200);
		const again = await world.send(
			fromPanel("/api/manageBadges", {
				cookies,
				headers: { "if-none-match": first.headers.get("etag") },
			}),
		);
		expect(again.status).toBe(304);
		expect(again.headers.get("etag")).toBe('W/"7"');
		expect(world.backend.accepted).toHaveLength(2);
	});
});

// ─── Files ──────────────────────────────────────────────────────────────────

describe("GET /api/files", () => {
	const FILE = "/api/files?path=covers%2Fspring.png";
	const file = (
		world: World,
		cookies: string,
		path = FILE,
		headers: Record<string, string> = {},
	) => world.send(fromOwnMedia(path, { cookies, headers }));

	it("serves a picture to the panel's own page", async () => {
		const { world, cookies } = await withAdmin();
		const response = await file(world, cookies);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("bytes of covers/spring.png");
		expect(Object.fromEntries(response.headers)).toEqual({
			"content-type": "image/png",
			etag: '"0x8DFAKE"',
			"accept-ranges": "bytes",
			"last-modified": "Thu, 12 Nov 2026 10:00:00 GMT",
			// Kept by this browser for a few minutes; rule 26 excepts media
			// from no-store.
			"cache-control": "private, max-age=300",
			"content-disposition": "inline",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; sandbox",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		});
		expect(world.logs).toEqual([]);
	});

	it("asks the backend where the file is, then fetches it from the store, with nothing of the admin's", async () => {
		const { world, cookies } = await withAdmin();
		await world.send(
			fromOwnMedia(FILE, {
				cookies,
				headers: {
					authorization: "Bearer token-from-the-browser",
					"x-cf-panel": "1",
					"if-none-match": '"x"',
					accept: "image/*",
				},
			}),
		);
		expect(world.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/api/files?path=covers%2Fspring.png`,
			`GET ${MEDIA}/public/covers/spring.png`,
		]);
		for (const call of world.calls) {
			// No session, no signature, no cookie: the files are public there.
			// Only the question "has it changed?" travels on.
			expect([...call.headers.keys()]).toEqual(["if-none-match"]);
			expect(call.redirect).toBe("manual");
			expect(call.raw).toBeNull();
		}
	});

	it("passes a range request on and the part of the file back", async () => {
		const { world, cookies } = await withAdmin();
		world.media.put("audio/intro.mp3", "audio/mpeg", "0123456789");
		const response = await file(
			world,
			cookies,
			"/api/files?path=audio/intro.mp3",
			{
				range: "bytes=2-5",
				"if-range": '"0x8DFAKE"',
			},
		);
		expect(response.status).toBe(206);
		expect(await response.text()).toBe("2345");
		expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(response.headers.get("content-type")).toBe("audio/mpeg");
		for (const call of world.calls) {
			expect(Object.fromEntries(call.headers)).toEqual({
				range: "bytes=2-5",
				"if-range": '"0x8DFAKE"',
			});
		}
	});

	it("serves what the backend answers itself, when it does not redirect", async () => {
		const { world, cookies } = await withAdmin();
		world.on(
			`${API}/api/files`,
			() =>
				new Response("direct", {
					headers: { "content-type": "image/webp", "set-cookie": "a=1" },
				}),
		);
		const response = await file(world, cookies);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("direct");
		expect(setCookies(response)).toEqual([]);
		expect(world.calls).toHaveLength(1);
	});

	it("is only for the panel's own page", async () => {
		const { world, cookies } = await withAdmin();
		for (const [label, request] of [
			["no word from the browser", bare(FILE, { cookies })],
			["typed into the address bar", navigation(FILE, { cookies })],
			[
				"a picture on another site",
				fromOwnMedia(FILE, {
					cookies,
					headers: { "sec-fetch-site": "cross-site" },
				}),
			],
			[
				"a picture on a sibling site",
				fromOwnMedia(FILE, {
					cookies,
					headers: { "sec-fetch-site": "same-site" },
				}),
			],
			[
				"the panel's header without the browser's word",
				fromPanel(FILE, { cookies, headers: { "sec-fetch-site": null } }),
			],
		] as const) {
			await expectFailure(
				await world.send(request),
				403,
				"FOREIGN_REQUEST",
				label,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("is not for the signed-out", async () => {
		const world = makeWorld();
		for (const cookies of ["", `${SESSION_COOKIE}=`, "other=1"]) {
			await expectFailure(await file(world, cookies), 401, "SIGNED_OUT");
		}
		expect(world.calls).toEqual([]);
	});

	it("looks only at whether there is a session, and sends it nowhere", async () => {
		// Not a check of who: the files are public on the backend. Only that
		// the panel's address is not a file server for everyone.
		const world = makeWorld();
		const response = await file(world, `${SESSION_COOKIE}=made-up-value`);
		expect(response.status).toBe(200);
		for (const call of world.calls) {
			expect(
				`${call.url}\n${[...call.headers.values()].join("\n")}`,
			).not.toContain("made-up-value");
		}
	});

	it("takes exactly one parameter, `path`", async () => {
		const { world, cookies } = await withAdmin();
		for (const query of [
			"",
			"?",
			"?path=",
			"?path",
			"?Path=covers/spring.png",
			"?PATH=covers/spring.png",
			"?file=covers/spring.png",
			"?path=covers/spring.png&path=covers/spring.png",
			"?path=covers/spring.png&path=other.js",
			"?path=covers/spring.png&x=1",
			"?x=1&path=covers/spring.png",
			"?path=covers/spring.png&code=made-up",
			"?path=covers/spring.png&=",
			"?path=covers/spring.png&=x",
			"?path=covers/spring.png&path",
			"?path[]=covers/spring.png",
			"?path=covers/spring.png&container=private",
		]) {
			await expectFailure(
				await file(world, cookies, `/api/files${query}`),
				404,
				"NOT_FOUND",
				query,
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("refuses a path that could point anywhere but into the container", async () => {
		const { world, cookies } = await withAdmin();
		for (const path of [
			"/covers/spring.png",
			"//evil.example.test/x.png",
			"../private/x.png",
			"covers/../../private/x.png",
			"covers/..",
			"..",
			".",
			"covers/./spring.png",
			"covers\\spring.png",
			"..\\private\\x.png",
			"https://evil.example.test/x.png",
			"http://evil.example.test/x.png",
			"ftp://evil.example.test/x.png",
			"x://y",
			// A `%` left after decoding: it would mean something to a server
			// that decodes once more.
			"covers%2Fspring.png",
			"%2e%2e/private/x.png",
			"..%2fprivate",
			"100%.png",
			"a%00.png",
			"a\u0000.png",
			"a\nb.png",
			"a\rb.png",
			"a\tb.png",
			"a\u001fb.png",
			"x".repeat(1025),
		]) {
			await expectFailure(
				await file(
					world,
					cookies,
					`/api/files?path=${encodeURIComponent(path)}`,
				),
				404,
				"NOT_FOUND",
				JSON.stringify(path),
			);
		}
		expect(world.calls).toEqual([]);
	});

	it("rebuilds the address it asks the backend for from that one checked value", async () => {
		const { world, cookies } = await withAdmin();
		for (const path of [
			"covers/spring.png",
			"a b.png",
			"żółw.png",
			"a?x=1&container=private#y.png",
			"a&path=other.js",
			"a+b=c.png",
			"a;b,c.png",
			"x".repeat(1024),
		]) {
			world.forget();
			world.media.put(path, "image/png");
			const response = await file(
				world,
				cookies,
				`/api/files?path=${encodeURIComponent(path)}`,
			);
			expect(response.status, path).toBe(200);
			const asked = new URL((world.calls[0] as Call).url);
			expect(`${asked.origin}${asked.pathname}`, path).toBe(`${API}/api/files`);
			expect([...asked.searchParams.entries()], path).toEqual([["path", path]]);
		}
	});

	it("has no addresses below it", async () => {
		const { world, cookies } = await withAdmin();
		for (const [method, path] of [
			["GET", "/api/files/x"],
			["GET", "/api/files/"],
			["GET", "/api/files/x?path=covers/spring.png"],
			["GET", "/api/files/covers/spring.png"],
			["GET", "/api/Files?path=covers/spring.png"],
			["GET", "/api/files.png?path=covers/spring.png"],
			["POST", "/api/files?path=covers/spring.png"],
			["PUT", "/api/files?path=covers/spring.png"],
			["DELETE", "/api/files?path=covers/spring.png"],
			["HEAD", "/api/files?path=covers/spring.png"],
		] as const) {
			for (const request of [
				fromOwnMedia(path, { method, cookies }),
				fromPanel(path, { method, cookies }),
			]) {
				await expectFailure(
					await world.send(request),
					404,
					"NOT_FOUND",
					`${method} ${path}`,
				);
			}
		}
		expect(world.calls).toEqual([]);
	});

	it("follows the backend's redirect only to an address in MEDIA_ORIGINS", async () => {
		for (const location of [
			"https://evil.example.test/public/covers/spring.png",
			"http://files.example.test/public/covers/spring.png",
			"https://files.example.test:8443/public/covers/spring.png",
			"https://files.example.test.evil.example.test/x.png",
			"https://files.example.test@evil.example.test/x.png",
			"https://sub.files.example.test/x.png",
			`${API}/api/panel/manageUsers`,
			"https://panel.example.test/api/manageUsers",
			"//files.example.test/public/covers/spring.png",
			"/public/covers/spring.png",
			"public/covers/spring.png",
			"javascript:alert(1)",
			"data:image/png;base64,AAAA",
			"file:///etc/hosts",
			"",
			null,
		]) {
			const { world, cookies } = await withAdmin();
			world.on(
				`${API}/api/files`,
				() =>
					new Response(null, {
						status: 302,
						headers: location === null ? {} : { location },
					}),
			);
			const response = await file(world, cookies);
			await expectFailure(
				response,
				502,
				"FILE_REDIRECT_REFUSED",
				String(location),
			);
			expect(response.headers.has("location")).toBe(false);
			// The backend was asked; where it pointed was not.
			expect(world.calls, String(location)).toHaveLength(1);
			expect(world.logs, String(location)).toEqual([
				{
					event: "refused",
					method: "GET",
					route: "/api/files",
					status: 502,
					reason: "FILE_REDIRECT_REFUSED",
					ray: null,
				},
			]);
		}
	});

	it("follows no redirect at all while MEDIA_ORIGINS is not set", async () => {
		for (const value of [undefined, "", "files.example.test", "*"]) {
			const cookies = await signedIn(makeWorld());
			const world = makeWorld({ MEDIA_ORIGINS: value });
			await expectFailure(
				await file(world, cookies),
				502,
				"FILE_REDIRECT_REFUSED",
				String(value),
			);
			expect(world.calls).toHaveLength(1);
		}
	});

	it("knows several stores when several are set", async () => {
		const cookies = await signedIn(makeWorld());
		const world = makeWorld({
			MEDIA_ORIGINS: `https://old.example.test, ${MEDIA}`,
		});
		expect((await file(world, cookies)).status).toBe(200);
	});

	it("follows a redirect once: a second one is refused, wherever it points", async () => {
		for (const location of [
			`${MEDIA}/public/other.png`,
			"https://evil.example.test/x.png",
		]) {
			const { world, cookies } = await withAdmin();
			world.on(
				`${MEDIA}/`,
				() => new Response(null, { status: 302, headers: { location } }),
			);
			const response = await file(world, cookies);
			await expectFailure(response, 502, "FILE_REDIRECT_REFUSED", location);
			expect(response.headers.has("location")).toBe(false);
			expect(world.calls.map((call) => call.url)).toEqual([
				`${API}/api/files?path=covers%2Fspring.png`,
				`${MEDIA}/public/covers/spring.png`,
			]);
		}
	});

	it("serves pictures, sound, film and PDF", async () => {
		const { world, cookies } = await withAdmin();
		for (const type of [
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif",
			"image/avif",
			"image/heic",
			"image/x-icon",
			"IMAGE/PNG",
			"audio/mpeg",
			"audio/mp4",
			"audio/ogg",
			"video/mp4",
			"video/webm",
			"video/quicktime",
			"video/mp4; codecs=avc1.42E01E",
			" image/png",
			"image/png ",
			"application/pdf",
			"application/pdf; charset=binary",
		]) {
			world.media.put("f", type);
			const response = await file(world, cookies, "/api/files?path=f");
			expect(response.status, type).toBe(200);
			expect(response.headers.get("x-content-type-options"), type).toBe(
				"nosniff",
			);
		}
	});

	it("refuses with 415 anything a browser could run or read as a page, and a file with no type", async () => {
		const { world, cookies } = await withAdmin();
		for (const type of [
			"application/javascript",
			"text/javascript",
			"application/x-javascript",
			"application/ecmascript",
			"module",
			"text/html",
			"text/html; charset=utf-8",
			"application/xhtml+xml",
			"image/svg+xml",
			"IMAGE/SVG+XML",
			"image/svg",
			"image/svg+xml; charset=utf-8",
			"application/xml",
			"text/xml",
			"text/xsl",
			"application/rss+xml",
			"text/css",
			"text/plain",
			"application/json",
			"application/octet-stream",
			"application/wasm",
			"application/zip",
			"application/pdfx",
			"application/pdf+xml",
			"font/woff2",
			"multipart/form-data",
			"message/rfc822",
			"image",
			"image/",
			"image/png, text/html",
			"text/html, image/png",
			"x-image/png",
			"*/*",
			"",
			null,
		]) {
			world.forget();
			world.media.put("f", type, "<script>alert(1)</script>");
			const response = await file(world, cookies, "/api/files?path=f");
			await expectFailure(response, 415, "FILE_TYPE_REFUSED", String(type));
			expect(await response.text(), String(type)).not.toContain("<script>");
		}
	});

	it("writes a line for everything it refuses", async () => {
		const { world, cookies } = await withAdmin();
		world.media.put("evil.js", "application/javascript");
		const line = (
			status: number,
			reason: string,
			ray: string | null = null,
		) => ({
			event: "refused",
			method: "GET",
			route: "/api/files",
			status,
			reason,
			ray,
		});
		const cases: [Request, ReturnType<typeof line>][] = [
			[
				fromOwnMedia(FILE, {
					cookies,
					headers: { "sec-fetch-site": "cross-site" },
				}),
				line(403, "FOREIGN_REQUEST"),
			],
			[
				fromOwnMedia("/api/files?path=..%2Fprivate%2Fkeys.json", { cookies }),
				line(404, "NOT_FOUND"),
			],
			[
				fromOwnMedia(`${FILE}&container=private`, { cookies }),
				line(404, "NOT_FOUND"),
			],
			[fromOwnMedia(FILE), line(401, "SIGNED_OUT")],
			[
				fromOwnMedia("/api/files?path=evil.js", { cookies }),
				line(415, "FILE_TYPE_REFUSED"),
			],
		];
		for (const [request, expected] of cases) {
			world.forget();
			const response = await world.send(request);
			expect(response.status).toBe(expected.status);
			expect(world.logs).toEqual([expected]);
		}

		// The path, the query and the cookie are in none of them.
		world.forget();
		await world.send(
			fromOwnMedia(
				"/api/files?path=..%2Fmarker-in-a-path&x=marker-in-a-query",
				{
					cookies,
					headers: { "cf-ray": "made-up-ray-id" },
				},
			),
		);
		expect(world.logs).toEqual([line(404, "NOT_FOUND", "made-up-ray-id")]);
	});

	it("writes a line for a second redirect and for a backend that is down", async () => {
		const redirected = await withAdmin();
		redirected.world.on(
			`${MEDIA}/`,
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "https://evil.example.test/x.png" },
				}),
		);
		await file(redirected.world, redirected.cookies);
		expect(redirected.world.logs).toEqual([
			{
				event: "refused",
				method: "GET",
				route: "/api/files",
				status: 502,
				reason: "FILE_REDIRECT_REFUSED",
				ray: null,
			},
		]);

		const down = await withAdmin();
		down.world.backend.down = true;
		await file(down.world, down.cookies);
		expect(down.world.logs).toEqual([
			{
				event: "refused",
				method: "GET",
				route: "/api/files",
				status: 502,
				reason: "BACKEND_UNREACHABLE",
				ray: null,
			},
		]);
	});

	it("answers 304 when the store says the file has not changed", async () => {
		const { world, cookies } = await withAdmin();
		world.on(
			`${MEDIA}/`,
			() =>
				new Response(null, {
					status: 304,
					headers: {
						etag: '"0x8DFAKE"',
						location: "https://elsewhere.example.test/",
						"x-ms-request-id": "fake-request-id",
					},
				}),
		);
		const response = await file(world, cookies);
		expect(response.status).toBe(304);
		expect(await response.text()).toBe("");
		expect(Object.fromEntries(response.headers)).toEqual({
			"cache-control": "private, max-age=300",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		});
		expect(world.logs).toEqual([]);
	});

	// FINDING (worker/proxy.ts:142, FILE_REQUEST_HEADERS). The 304 answer
	// above cannot happen in use: a browser that kept a file for its five
	// minutes asks again with If-None-Match (or If-Modified-Since), and
	// neither is passed on, so the store never has a reason to say "not
	// changed" and every file is downloaded whole again. Not a security
	// matter: the 304 branch at proxy.ts:273 is unreachable until the two
	// headers are on the list.
	it("passes a revalidation on, so the store can answer 304", async () => {
		const { world, cookies } = await withAdmin();
		const first = await file(world, cookies);
		expect(first.status).toBe(200);
		const etag = first.headers.get("etag") ?? "";
		expect(etag).not.toBe("");
		const again = await file(world, cookies, FILE, { "if-none-match": etag });
		expect(again.status).toBe(304);
	});

	it("answers 404 for a file that is not there and 502 for any other trouble", async () => {
		const { world, cookies } = await withAdmin();
		await expectFailure(
			await file(world, cookies, "/api/files?path=nothing.png"),
			404,
			"NOT_FOUND",
		);

		const cases: [string, (prepared: World) => void, number, string][] = [
			[
				"backend: 404",
				(prepared) =>
					prepared.on(
						`${API}/api/files`,
						() => new Response(null, { status: 404 }),
					),
				404,
				"NOT_FOUND",
			],
			[
				"backend: 500",
				(prepared) =>
					prepared.on(
						`${API}/api/files`,
						() => new Response("x", { status: 500 }),
					),
				502,
				"BACKEND_UNREACHABLE",
			],
			[
				"backend: 403",
				(prepared) =>
					prepared.on(
						`${API}/api/files`,
						() => new Response("x", { status: 403 }),
					),
				502,
				"BACKEND_UNREACHABLE",
			],
			[
				"backend down",
				(prepared) => {
					prepared.backend.down = true;
				},
				502,
				"BACKEND_UNREACHABLE",
			],
			[
				"store: 500",
				(prepared) =>
					prepared.on(`${MEDIA}/`, () => new Response("x", { status: 500 })),
				502,
				"BACKEND_UNREACHABLE",
			],
			[
				"store down",
				(prepared) =>
					prepared.on(`${MEDIA}/`, () => {
						throw new TypeError("fetch failed");
					}),
				502,
				"BACKEND_UNREACHABLE",
			],
		];
		for (const [label, prepare, status, code] of cases) {
			const other = await withAdmin();
			prepare(other.world);
			await expectFailure(
				await file(other.world, other.cookies),
				status,
				code,
				label,
			);
		}
	});

	it("needs the backend's address, and no signing secret", async () => {
		const cookies = await signedIn(makeWorld());
		const nowhere = makeWorld({ API_ORIGIN: undefined });
		await expectFailure(await file(nowhere, cookies), 503, "NOT_CONFIGURED");
		expect(nowhere.calls).toEqual([]);
		const unsigned = makeWorld({ PANEL_SIGNING_SECRET: undefined });
		expect((await file(unsigned, cookies)).status).toBe(200);
	});
});

describe("isFilePath", () => {
	it("accepts a path inside the container", () => {
		for (const path of [
			"a.png",
			"covers/spring.png",
			"a/b/c/d.mp4",
			"a b.png",
			"żółw.png",
			"a..b.png",
			"...",
			".hidden",
			"a/.hidden/b",
			"a//b",
			"a/",
			"a?b=c",
			"a#b",
			"a:b",
			"a:/b",
			"x".repeat(1024),
		]) {
			expect(isFilePath(path), path).toBe(true);
		}
	});

	it("refuses everything else", () => {
		for (const path of [
			null,
			"",
			"/a",
			"//a",
			"..",
			".",
			"../a",
			"a/..",
			"a/../b",
			"a/./b",
			"./a",
			"a/.",
			"a\\b",
			"\\a",
			"a://b",
			"://",
			"a%2Fb",
			"%",
			"a\u0000",
			"a\u001f",
			"\ta",
			"x".repeat(1025),
		]) {
			expect(isFilePath(path), JSON.stringify(path)).toBe(false);
		}
	});
});

// ─── Not configured ─────────────────────────────────────────────────────────

describe("while the panel's own address is not set", () => {
	it("nothing is forwarded: every /api call is 503", async () => {
		const cookies = await signedIn(makeWorld());
		const world = makeWorld();
		for (const request of [
			fromPanel("/api/manageUsers", { cookies }),
			fromPanel("/api/internalConfig", { cookies }),
			fromOwnMedia("/api/files?path=covers/spring.png", { cookies }),
			fromPanel("/api/manageChallenges", { method: "POST", cookies, json: {} }),
			fromPanel("/api/not-in-the-table", { cookies }),
		]) {
			const response = await handleApi(request, world.env, world.deps, null);
			await expectFailure(response, 503, "NOT_CONFIGURED");
		}
		expect(world.calls).toEqual([]);
	});
});
