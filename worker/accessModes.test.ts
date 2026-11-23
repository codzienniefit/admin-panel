import { describe, expect, it } from "vitest";
import type { PanelEnv } from "./env";
import { PUBLIC_FILES } from "./gate";
import {
	bare,
	bodyOf,
	fromOwnMedia,
	fromPanel,
	inJar,
	makeWorld,
	navigation,
	PASS_COOKIE,
	SESSION_COOKIE,
	signedIn,
} from "./testSupport";

// Leak tests between the two modes of access (docs/ACCESS-MODES.md).
//
// Signed out: the Worker's sign-in page, robots.txt, the icons, /api/health and /auth/*, and
// nothing else. No request of a browser without a pass may reach the static files, whatever its
// address, method or headers. Signed in (a pass): the panel's files, never in a shared cache, and
// still no data without the session. Not configured: everything as the static files answer it.
//
// The fake static files (testSupport.ts) answer every request with something recognisable as the
// panel, an ETag and a public cache header; none of it may show up in a signed-out answer.

/** What only the panel itself says: route names, section names, the fake build's own marks. */
const PANEL_ONLY = [
	"manageChallenges",
	"manageUsers",
	"Wyzwania",
	"Treningi",
	"Wiadomości",
	"Odznaki",
	"Oferty",
	"Użytkownicy",
	"Ustawienia",
	"Komponenty",
	"Produkcja",
	"/assets/",
	"index-fake",
	"the panel's code",
	"modulepreload",
];

/** Addresses that ask for a file. Every one is 404 to a browser without a pass. */
const FILES = [
	"/assets/index-abc.js",
	"/assets/index-abc.css",
	"/assets/codziennie-fit-abc.svg",
	"/assets/index-abc.js.map",
	"/assets/",
	"/assets/x.js/",
	"/assets/x.js?v=1",
	"/assets/x.js#fragment",
	"/index.html",
	"/index.html?x=1",
	"/%61ssets/x.js",
	"/assets/%2e%2e/index.html",
	"/assets/.%2e/index.html",
	"/assets/../index.html",
	"/%2e%2e/assets/x.js",
	"/./assets/x.js",
	"//assets/x.js",
	"/ASSETS/x.js",
	"/robots.txt/../assets/x.js",
	"/favicon.ico/../assets/x.js",
	"/assets%2fx.js",
	"/challenges/x.js",
	"/manifest.webmanifest",
	"/_headers.txt",
];

/** Page addresses. Every one is the Worker's own sign-in page to a browser without a pass. */
const PAGES = [
	"/",
	"/challenges",
	"/challenges/",
	"/challenges/C1/plan/p1",
	"/login",
	"/login?redirect=/users",
	"/login?error=forbidden",
	"/users?search=x#top",
	"/index.html/",
	"/%61ssets/",
	"/robots.txt/",
	"/favicon.ico/",
	"/api",
	"/auth",
];

/** Headers a browser sends to revalidate what it has in its cache. */
const CONDITIONAL = {
	"if-none-match": '"fake-asset"',
	"if-modified-since": "Thu, 12 Nov 2026 10:00:00 GMT",
};

const label = (method: string, path: string, extra = "") =>
	`${method} ${path}${extra}`;

async function expectNothingOfThePanel(response: Response, what: string) {
	expect(response.headers.get("etag"), what).toBeNull();
	expect(response.headers.get("last-modified"), what).toBeNull();
	expect(response.headers.get("set-cookie"), what).toBeNull();
	expect(response.headers.get("cache-control"), what).toBe("no-store");
	const text = await response.clone().text();
	expect(text.toLowerCase(), what).not.toContain("<script");
	for (const word of PANEL_ONLY)
		expect(text, `${what}: ${word}`).not.toContain(word);
}

describe("signed out, with sign-in configured", () => {
	it("no file of the panel reaches the browser, however it is asked for", async () => {
		const world = makeWorld();
		for (const path of FILES) {
			for (const method of ["GET", "HEAD"]) {
				for (const [extra, headers] of [
					["", {}],
					[" (conditional)", CONDITIONAL],
				] as const) {
					const what = label(method, path, extra);
					const response = await world.send(
						navigation(path, { method, headers: { ...headers } }),
					);
					expect(response.status, what).toBe(404);
					if (method === "GET") {
						expect((await bodyOf(response)).errorCode, what).toBe("NOT_FOUND");
					}
					await expectNothingOfThePanel(response, what);
				}
			}
		}
		expect(world.assets.requests).toEqual([]);
		expect(world.calls).toEqual([]);
	});

	it("every page address is the sign-in page and nothing more", async () => {
		const world = makeWorld();
		for (const path of PAGES) {
			for (const method of ["GET", "HEAD"]) {
				for (const [extra, headers] of [
					["", {}],
					[" (conditional)", CONDITIONAL],
				] as const) {
					const what = label(method, path, extra);
					const response = await world.send(
						navigation(path, { method, headers: { ...headers } }),
					);
					expect(response.status, what).toBe(200);
					expect(response.headers.get("content-type"), what).toBe(
						"text/html; charset=utf-8",
					);
					await expectNothingOfThePanel(response, what);
					if (method === "GET") {
						expect(await response.text(), what).toContain(
							">Zaloguj się przez Google</a>",
						);
					}
				}
			}
		}
		expect(world.assets.requests).toEqual([]);
		expect(world.calls).toEqual([]);
	});

	it("any other method is 404, for files and pages alike", async () => {
		const world = makeWorld();
		for (const path of ["/", "/challenges", "/assets/x.js", "/index.html"]) {
			for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
				const what = label(method, path);
				const response = await world.send(bare(path, { method }));
				expect(response.status, what).toBe(404);
				await expectNothingOfThePanel(response, what);
			}
		}
		expect(world.assets.requests).toEqual([]);
	});

	it("a session cookie without a pass (signed in before the pass existed) gets the sign-in page, not the panel", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const sessionOnly = `${SESSION_COOKIE}=${inJar(cookies, SESSION_COOKIE)}`;
		for (const path of ["/", "/challenges", "/assets/x.js"]) {
			const response = await world.send(
				navigation(path, { cookies: sessionOnly }),
			);
			expect(response.status, path).toBe(path.endsWith(".js") ? 404 : 200);
			await expectNothingOfThePanel(response, path);
		}
		expect(world.assets.requests).toEqual([]);
		// The session itself still works where it always did.
		const data = await world.send(
			fromPanel("/api/manageUsers", { cookies: sessionOnly }),
		);
		expect(data.status).toBe(200);
	});

	it("only the always-public files reach the static files, exactly as named", async () => {
		const world = makeWorld();
		for (const path of PUBLIC_FILES) {
			await world.send(bare(path));
		}
		expect(
			world.assets.requests.map((request) => new URL(request.url).pathname),
		).toEqual([...PUBLIC_FILES]);
	});
});

describe("signed in (a valid pass)", () => {
	it("every answer from the static files is private: no shared cache may keep it", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const path of [...FILES, ...PAGES]) {
			if (/^\/(api|auth)$/.test(path)) continue;
			for (const method of ["GET", "HEAD"]) {
				const what = label(method, path);
				world.forget();
				const response = await world.send(
					navigation(path, { method, cookies }),
				);
				expect(world.assets.requests, what).toHaveLength(1);
				const cache = response.headers.get("cache-control") ?? "";
				expect(cache, what).toMatch(/^private, (no-store|no-cache)$/);
				expect(cache, what).not.toContain("public");
			}
		}
	});

	it("a pass alone opens no data: every /api call still wants the real session", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const passOnly = `${PASS_COOKIE}=${inJar(cookies, PASS_COOKIE)}`;
		for (const request of [
			fromPanel("/api/manageUsers", { cookies: passOnly }),
			fromPanel("/api/manageChallenges", { cookies: passOnly }),
			fromPanel("/api/accounts/abc-123", { cookies: passOnly }),
			fromOwnMedia("/api/files?path=covers/spring.png", { cookies: passOnly }),
		]) {
			const response = await world.send(request);
			expect(response.status, request.url).toBe(401);
			expect((await bodyOf(response)).errorCode, request.url).toBe(
				"SIGNED_OUT",
			);
		}
		const status = await world.send(
			fromPanel("/auth/session", { cookies: passOnly }),
		);
		expect(await bodyOf(status)).toMatchObject({ status: "signedOut" });
		expect(world.backend.accepted).toEqual([]);
	});
});

describe("not configured (this machine, the UI tests, an unset Worker)", () => {
	it("everything goes to the static files unchanged", async () => {
		// only a Worker without its own address: this machine, the UI tests
		const unset: Partial<PanelEnv>[] = [
			{ PANEL_ORIGIN: undefined },
			{ PANEL_ORIGIN: undefined, FIREBASE_API_KEY: undefined },
		];
		for (const overrides of unset) {
			const world = makeWorld(overrides);
			for (const path of [...FILES, ...PAGES]) {
				if (/^\/(api|auth)$/.test(path)) continue;
				world.forget();
				const response = await world.send(navigation(path));
				expect(world.assets.requests, path).toHaveLength(1);
				expect(response.headers.get("cache-control"), path).toBe(
					"public, max-age=0, must-revalidate",
				);
				expect(response.headers.get("etag"), path).toBe('"fake-asset"');
			}
		}
	});
});

describe("deployed but not fully set up: closed, never open (fail-closed)", () => {
	for (const [label, overrides] of [
		["no Firebase key", { FIREBASE_API_KEY: undefined }],
		["no signing secret", { PANEL_SIGNING_SECRET: undefined }],
		["no Google secret", { GOOGLE_CLIENT_SECRET: undefined }],
		["a cookie key that is not a key", { SIGN_IN_COOKIE_KEY: "change-me" }],
		["no backend address", { API_ORIGIN: undefined }],
	] as const) {
		it(`${label}: no file reaches the static files, pages name what is missing, with or without a pass`, async () => {
			const configured = makeWorld();
			const pass = await signedIn(configured);
			const world = makeWorld(overrides);
			for (const cookies of ["", pass]) {
				for (const path of FILES) {
					if (/^\/(api|auth)/.test(path)) continue;
					world.forget();
					const response = await world.send(navigation(path, { cookies }));
					expect(world.assets.requests, `${label} ${path}`).toEqual([]);
					expect(response.status, `${label} ${path}`).toBe(404);
				}
				for (const path of PAGES) {
					if (/^\/(api|auth)/.test(path)) continue;
					world.forget();
					const response = await world.send(navigation(path, { cookies }));
					expect(world.assets.requests, `${label} ${path}`).toEqual([]);
					const body = await response.text();
					expect(body, `${label} ${path}`).toContain(
						"Logowanie do Produkcji nie jest jeszcze skonfigurowane",
					);
					expect(body, `${label} ${path}`).not.toContain(
						"Zaloguj się przez Google",
					);
					expect(body, `${label} ${path}`).not.toContain("<script");
				}
			}
		});
	}
});
