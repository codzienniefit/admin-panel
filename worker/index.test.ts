import { afterEach, describe, expect, it, vi } from "vitest";
import type { PanelEnv } from "./env";
import worker, { handle } from "./index";
import {
	ATTEMPT_COOKIE,
	bare,
	bodyOf,
	fromGoogle,
	fromOwnMedia,
	fromPanel,
	GOOGLE_AUTHORIZE_URL,
	makeWorld,
	navigation,
	ORIGIN,
	type RequestOptions,
	SESSION_COOKIE,
	setCookies,
	signedIn,
	type World,
} from "./testSupport";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function expectFailure(
	response: Response,
	status: number,
	errorCode: string,
	label = "",
): Promise<void> {
	expect(response.status, label).toBe(status);
	expect((await bodyOf(response)).errorCode, label).toBe(errorCode);
	expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
	expect(response.headers.get("cache-control"), label).toBe("no-store");
	expect(response.headers.get("content-security-policy"), label).toBe(
		"default-src 'none'; frame-ancestors 'none'",
	);
}

/** One request of every kind the Worker knows, as the panel's page would send it. */
const everyKind = (cookies: string, at?: string): [string, Request][] => {
	const options: RequestOptions = { cookies, at };
	return [
		["GET /auth/session", fromPanel("/auth/session", options)],
		["GET /auth/google/start", navigation("/auth/google/start", options)],
		[
			"GET /auth/google/callback",
			fromGoogle(
				`${at ?? ORIGIN}/auth/google/callback?state=made-up&code=made-up`,
				options,
			),
		],
		[
			"POST /auth/signout",
			fromPanel("/auth/signout", { ...options, method: "POST" }),
		],
		["GET /auth/anything", fromPanel("/auth/anything", options)],
		["GET /api/manageUsers", fromPanel("/api/manageUsers", options)],
		["GET /api/accounts/:id", fromPanel("/api/accounts/abc-123", options)],
		["GET /api/internalConfig", fromPanel("/api/internalConfig", options)],
		[
			"GET /api/files",
			fromOwnMedia("/api/files?path=covers/spring.png", options),
		],
		[
			"POST /api/manageChallenges",
			fromPanel("/api/manageChallenges", {
				...options,
				method: "POST",
				json: { title: "[TEST] made up" },
			}),
		],
		["GET /api/anything", fromPanel("/api/anything", options)],
	];
};

describe("GET /api/health", () => {
	it("says the Worker is up, to anyone, asking nobody", async () => {
		const world = makeWorld();
		for (const request of [
			bare("/api/health"),
			fromPanel("/api/health"),
			navigation("/api/health", { site: "cross-site" }),
		]) {
			const response = await world.send(request);
			expect(response.status).toBe(200);
			expect(await bodyOf(response)).toEqual({ ok: true });
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(setCookies(response)).toEqual([]);
		}
		expect(world.calls).toEqual([]);
		expect(world.logs).toEqual([]);
	});

	it("says so before anything is configured", async () => {
		const response = await handle(bare("/api/health"), {}, makeWorld().deps);
		expect(await bodyOf(response)).toEqual({ ok: true });
	});

	it("says nothing about the configuration or the session", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const response = await world.send(fromPanel("/api/health", { cookies }));
		expect(await response.text()).toBe('{"ok":true}');
	});

	it("is the one address answered on a host that is not the panel's", async () => {
		// Rule 14 says a foreign host is refused "before anything else"; the
		// health answer comes first (index.ts:24). It is a constant, so nothing
		// is learned from it, but it is an exception to the rule as written.
		const world = makeWorld();
		const response = await world.send(
			bare("/api/health", { at: "https://admin-panel.someone.workers.dev" }),
		);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({ ok: true });
	});

	it("is that address exactly", async () => {
		const world = makeWorld();
		for (const path of [
			"/api/health/",
			"/api/health/x",
			"/api/healthz",
			"/health",
		]) {
			expect((await world.send(fromPanel(path))).status, path).toBe(404);
		}
	});
});

describe("a host that is not PANEL_ORIGIN", () => {
	const FOREIGN = [
		"https://admin-panel.someone.workers.dev",
		"https://0123abcd-admin-panel.someone.workers.dev",
		"https://evil.example.test",
		"https://sub.panel.example.test",
		"https://example.test",
		"https://panel.example.test.evil.example.test",
		"https://panel.example.test:8443",
		"http://panel.example.test",
		"https://panel.example.test.",
		"https://203.0.113.7",
		"http://localhost:8787",
	];

	it("gets 404 on every /auth and /api address, and nothing is done", async () => {
		const cookies = await signedIn(makeWorld());
		for (const host of FOREIGN) {
			const world = makeWorld();
			for (const [label, request] of everyKind(cookies, host)) {
				world.forget();
				const response = await world.send(request);
				await expectFailure(response, 404, "NOT_FOUND", `${host} ${label}`);
				expect(setCookies(response), `${host} ${label}`).toEqual([]);
				expect(response.headers.has("location"), `${host} ${label}`).toBe(
					false,
				);
				expect(world.calls, `${host} ${label}`).toEqual([]);
				expect(world.logs, `${host} ${label}`).toEqual([
					{ event: "refused", reason: "host", ray: null },
				]);
			}
		}
	});

	it("is judged by the address the request arrived at, not by what its headers claim", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		// At a foreign address, dressed as the panel.
		const dressed = await world.send(
			fromPanel("/api/manageUsers", {
				cookies,
				at: "https://evil.example.test",
				headers: {
					host: "panel.example.test",
					origin: ORIGIN,
					"x-forwarded-host": "panel.example.test",
				},
			}),
		);
		expect(dressed.status).toBe(404);
		expect(world.calls).toEqual([]);

		// At the panel's address, with a Host header saying otherwise.
		const served = await world.send(
			fromPanel("/api/manageUsers", {
				cookies,
				headers: { host: "evil.example.test" },
			}),
		);
		expect(served.status).toBe(200);
	});

	it("the same requests are served at the panel's own address", async () => {
		// So the 404s above are about the host and nothing else.
		const world = makeWorld();
		const cookies = await signedIn(world);
		const statuses: Record<string, number> = {};
		for (const [label, request] of everyKind(cookies)) {
			statuses[label] = (await world.send(request)).status;
		}
		expect(statuses).toEqual({
			"GET /auth/session": 200,
			"GET /auth/google/start": 303,
			"GET /auth/google/callback": 303,
			"POST /auth/signout": 200,
			"GET /auth/anything": 404,
			// Signed out by the step above.
			"GET /api/manageUsers": 401,
			"GET /api/accounts/:id": 401,
			"GET /api/internalConfig": 200,
			// A file needs a session cookie to be there, not to be good.
			"GET /api/files": 200,
			"POST /api/manageChallenges": 403,
			"GET /api/anything": 404,
		});
	});

	it("is the panel's own address however the host is capitalised", async () => {
		const world = makeWorld();
		const response = await world.send(
			fromPanel("/auth/session", {
				at: "https://PANEL.Example.Test",
				// A browser writes the origin in lower case.
				headers: { origin: ORIGIN },
			}),
		);
		expect(response.status).toBe(200);
	});

	it("is compared with PANEL_ORIGIN as an origin, however that is written", async () => {
		const world = makeWorld({
			PANEL_ORIGIN: "  https://PANEL.example.test/\n",
		});
		expect((await world.send(fromPanel("/auth/session"))).status).toBe(200);
		expect(
			(
				await world.send(
					fromPanel("/auth/session", { at: "https://evil.example.test" }),
				)
			).status,
		).toBe(404);
	});
});

describe("while PANEL_ORIGIN is not set", () => {
	const UNSET: Partial<PanelEnv>[] = [
		{ PANEL_ORIGIN: undefined },
		{ PANEL_ORIGIN: "" },
		{ PANEL_ORIGIN: "   " },
		// Set, but not an origin: the same as not set.
		{ PANEL_ORIGIN: "panel.example.test" },
		{ PANEL_ORIGIN: "http://panel.example.test" },
		{ PANEL_ORIGIN: "https://panel.example.test/panel" },
		{ PANEL_ORIGIN: "*" },
	];

	it("only `GET /auth/session` answers: signed out, and no way in", async () => {
		const cookies = await signedIn(makeWorld());
		for (const overrides of UNSET) {
			const world = makeWorld(overrides);
			for (const request of [
				bare("/auth/session"),
				fromPanel("/auth/session"),
				fromPanel("/auth/session", { cookies }),
				bare("/auth/session", { at: "https://anywhere.example.test" }),
			]) {
				const response = await world.send(request);
				expect(response.status, JSON.stringify(overrides)).toBe(200);
				expect(await bodyOf(response)).toEqual({
					status: "signedOut",
					methods: [],
					missing: ["PANEL_ORIGIN"],
				});
				expect(setCookies(response)).toEqual([]);
			}
			expect(world.calls).toEqual([]);
		}
	});

	it("everything else is 503 and nothing is done, with every other setting in place", async () => {
		const cookies = await signedIn(makeWorld());
		for (const overrides of UNSET) {
			const world = makeWorld(overrides);
			for (const [label, request] of everyKind(cookies)) {
				if (label === "GET /auth/session") continue;
				const response = await world.send(request);
				await expectFailure(
					response,
					503,
					"NOT_CONFIGURED",
					`${JSON.stringify(overrides)} ${label}`,
				);
				expect(setCookies(response), label).toEqual([]);
				expect(response.headers.has("location"), label).toBe(false);
			}
			expect(world.calls).toEqual([]);
		}
	});

	it("nothing is configured in an empty environment either", async () => {
		const world = makeWorld();
		for (const [label, request] of everyKind("")) {
			const response = await handle(request, {}, world.deps);
			if (label === "GET /auth/session") {
				expect(await bodyOf(response)).toEqual({
					status: "signedOut",
					methods: [],
					missing: [
						"PANEL_ORIGIN",
						"API_ORIGIN",
						"MEDIA_ORIGINS",
						"FIREBASE_API_KEY",
						"GOOGLE_CLIENT_ID",
						"GOOGLE_CLIENT_SECRET",
						"SIGN_IN_COOKIE_KEY",
						"PANEL_SIGNING_SECRET",
					],
				});
			} else {
				await expectFailure(response, 503, "NOT_CONFIGURED", label);
			}
		}
		expect(world.calls).toEqual([]);
	});
});

describe("addresses that are neither /auth/ nor /api/", () => {
	it("are 404: the Worker serves no pages", async () => {
		const world = makeWorld();
		for (const path of [
			"/",
			"/login",
			"/challenges",
			"/auth",
			"/api",
			"/apix/manageUsers",
			"/authx/session",
			"/AUTH/session",
			"/Api/manageUsers",
			"/x/api/manageUsers",
			"/x/auth/session",
			"//api/manageUsers",
			"/index.html",
		]) {
			const response = await world.send(fromPanel(path));
			await expectFailure(response, 404, "NOT_FOUND", path);
		}
		expect(world.calls).toEqual([]);
	});
});

describe("handing over", () => {
	const seen = async (world: World, request: Request) => {
		await world.send(request);
		return world.calls.map((call) => new URL(call.url).pathname);
	};

	it("/auth goes to the sign-in code and /api to the proxy", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		expect(await seen(world, fromPanel("/auth/session", { cookies }))).toEqual([
			"/api/panel/me",
		]);
		world.forget();
		expect(
			await seen(world, fromPanel("/api/manageBadges", { cookies })),
		).toEqual(["/api/panel/manageBadges"]);
	});

	it("a sign-in can be started at the panel's own address", async () => {
		const world = makeWorld();
		const response = await world.send(navigation("/auth/google/start"));
		expect(response.headers.get("location")).toContain(GOOGLE_AUTHORIZE_URL);
		expect(setCookies(response).map((cookie) => cookie.name)).toContain(
			ATTEMPT_COOKIE,
		);
	});
});

describe("the Worker as Cloudflare calls it", () => {
	const fetchOf = (request: Request, env: PanelEnv) =>
		worker.fetch(request as Parameters<typeof worker.fetch>[0], env);

	it("answers with the real clock, random bytes and log", async () => {
		const response = await fetchOf(bare("/api/health"), {});
		expect(await bodyOf(response)).toEqual({ ok: true });
		const status = await fetchOf(bare("/auth/session"), {});
		expect(await bodyOf(status)).toEqual({
			status: "signedOut",
			methods: [],
			missing: [
				"PANEL_ORIGIN",
				"API_ORIGIN",
				"MEDIA_ORIGINS",
				"FIREBASE_API_KEY",
				"GOOGLE_CLIENT_ID",
				"GOOGLE_CLIENT_SECRET",
				"SIGN_IN_COOKIE_KEY",
				"PANEL_SIGNING_SECRET",
			],
		});
	});

	it("logs a refusal as one line of JSON", async () => {
		const written = vi.spyOn(console, "warn").mockImplementation(() => {});
		const response = await fetchOf(
			bare("/api/manageUsers", { at: "https://evil.example.test" }),
			makeWorld().env,
		);
		expect(response.status).toBe(404);
		expect(written.mock.calls).toEqual([
			[
				'{"message":"[SECURITY_ALERT] Refused a request to an address other than PANEL_ORIGIN","level":"warn","event":"refused","reason":"host","ray":null}',
			],
		]);
	});

	it("starts a sign-in with random values that differ every time", async () => {
		const env = makeWorld().env;
		const states = new Set<string | null>();
		for (let i = 0; i < 3; i++) {
			const response = await fetchOf(navigation("/auth/google/start"), env);
			states.add(
				new URL(response.headers.get("location") ?? "").searchParams.get(
					"state",
				),
			);
		}
		expect(states.size).toBe(3);
	});

	it("turns anything that goes wrong inside into a 500 that says nothing, and logs the kind of error only", async () => {
		const written = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
			throw new TypeError(
				"a detail that could quote something: made-up-detail",
			);
		});
		const response = await fetchOf(
			navigation("/auth/google/start"),
			makeWorld().env,
		);
		await expectFailure(response, 500, "WORKER_ERROR");
		expect(await response.text()).not.toContain("made-up-detail");
		expect(setCookies(response)).toEqual([]);
		expect(written.mock.calls).toEqual([
			[
				'{"message":"Worker error: TypeError","level":"error","event":"error","name":"TypeError"}',
			],
		]);
	});

	it("names what was thrown `unknown` when it was not an error", async () => {
		const written = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
			throw { toString: () => "made-up-detail" };
		});
		const response = await fetchOf(
			navigation("/auth/google/start"),
			makeWorld().env,
		);
		await expectFailure(response, 500, "WORKER_ERROR");
		expect(written.mock.calls).toEqual([
			[
				'{"message":"Worker error: unknown","level":"error","event":"error","name":"unknown"}',
			],
		]);
	});

	it("reaches the network through the runtime's fetch", async () => {
		const stand = vi.fn(
			async (_input: unknown, _init?: unknown) =>
				new Response(null, { status: 500 }),
		);
		vi.stubGlobal("fetch", stand);
		const env = makeWorld().env;
		const response = await fetchOf(
			fromPanel("/auth/session", { cookies: `${SESSION_COOKIE}=made-up` }),
			env,
		);
		expect(response.status).toBe(503);
		expect(stand).toHaveBeenCalledTimes(1);
		expect(String(stand.mock.calls[0]?.[0])).toBe(
			"https://api.example.test/api/panel/me",
		);
	});
});
