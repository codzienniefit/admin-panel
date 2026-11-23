import { describe, expect, it } from "vitest";
import { cookieKey, seal } from "./codec";
import type { PanelEnv } from "./env";
import { isFile, PUBLIC_FILES } from "./gate";
import { escapeHtml, LOGIN_PAGE_POLICY, loginPageHtml } from "./loginPage";
import {
	ATTEMPT_COOKIE,
	bare,
	bodyOf,
	COUNTING_KEY,
	clears,
	fromOwnMedia,
	fromPanel,
	inJar,
	jar,
	makeWorld,
	navigation,
	ORIGIN,
	PASS_COOKIE,
	REFUSED_COOKIE,
	randomKey,
	SESSION_COOKIE,
	SESSION_S,
	STRANGER,
	signedIn,
	signInWithGoogle,
	type World,
} from "./testSupport";

// Before sign-in, nothing of the panel's code: the Worker's own sign-in page for a page address,
// 404 for a file, and the icons and robots.txt for anyone.

const NO_INDEX =
	"noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai";

/** The pass alone, out of the cookies a signed-in browser holds. */
function passOnly(cookies: string): string {
	const pass = inJar(cookies, PASS_COOKIE);
	if (!pass) throw new Error("no pass in the jar");
	return `${PASS_COOKIE}=${pass}`;
}

/** A pass sealed as the Worker seals one, or with something changed. */
async function forgedPass(
	value: unknown,
	options: { key?: string; purpose?: string } = {},
): Promise<string> {
	const key = await cookieKey(options.key ?? COUNTING_KEY);
	if (!key) throw new Error("test key refused");
	const sealed = await seal(
		key,
		options.purpose ?? PASS_COOKIE,
		value,
		(size) => crypto.getRandomValues(new Uint8Array(size)),
	);
	return `${PASS_COOKIE}=${sealed}`;
}

/** The sign-in page's link to Google, as the page spells it. */
const startLink = (redirect: string) =>
	`href="/auth/google/start?${escapeHtml(new URLSearchParams({ redirect }).toString())}"`;

async function expectNotFound(response: Response, label = ""): Promise<void> {
	expect(response.status, label).toBe(404);
	expect((await bodyOf(response)).errorCode, label).toBe("NOT_FOUND");
	expect(response.headers.get("cache-control"), label).toBe("no-store");
	expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
	expect(response.headers.get("x-robots-tag"), label).toBe(NO_INDEX);
	expect(await response.clone().text(), label).not.toContain("panel's code");
}

async function expectSignInPage(
	response: Response,
	label = "",
): Promise<string> {
	expect(response.status, label).toBe(200);
	expect(response.headers.get("content-type"), label).toBe(
		"text/html; charset=utf-8",
	);
	expect(response.headers.get("cache-control"), label).toBe("no-store");
	expect(response.headers.get("content-security-policy"), label).toBe(
		LOGIN_PAGE_POLICY,
	);
	expect(response.headers.get("x-robots-tag"), label).toBe(NO_INDEX);
	expect(response.headers.get("x-frame-options"), label).toBe("DENY");
	expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
	expect(response.headers.get("set-cookie"), label).toBeNull();
	return response.text();
}

describe("before sign-in (no pass)", () => {
	it("the panel's code is 404, never asked of the static files, with one quiet line in the log", async () => {
		const world = makeWorld();
		for (const path of [
			"/assets/index-abc123.js",
			"/assets/index-abc123.css",
			"/assets/x.js",
			"/assets/",
		]) {
			world.forget();
			await expectNotFound(await world.send(navigation(path)), path);
			expect(world.assets.requests, path).toEqual([]);
			expect(world.calls, path).toEqual([]);
			expect(world.logs, path).toEqual([
				{
					event: "refused",
					method: "GET",
					route: "/assets/*",
					reason: "noPass",
					ray: null,
				},
			]);
		}
	});

	it("any other file is 404 too, without a line in the log", async () => {
		const world = makeWorld();
		for (const path of [
			"/index.html",
			"/wp-login.php",
			"/.env",
			"/config.json",
			"/challenges/sourcemap.js.map",
		]) {
			await expectNotFound(await world.send(navigation(path)), path);
		}
		expect(world.assets.requests).toEqual([]);
		expect(world.logs).toEqual([]);
	});

	it("a page address is the Worker's own sign-in page, with no script and nothing that says what is behind it", async () => {
		const world = makeWorld();
		for (const path of [
			"/",
			"/challenges",
			"/challenges/abc-123/plan",
			"/settings/app",
		]) {
			const html = await expectSignInPage(
				await world.send(navigation(path)),
				path,
			);
			expect(html, path).toMatch(/^<!doctype html>\n<html lang="pl">/);
			expect(html, path).toContain("<title>Logowanie</title>");
			expect(html, path).toContain(
				`<meta name="robots" content="${NO_INDEX}">`,
			);
			expect(html, path).toContain(startLink(path));
			expect(html, path).toContain(">Zaloguj się przez Google</a>");
			expect(html.toLowerCase(), path).not.toContain("<script");
			expect(html.toLowerCase(), path).not.toMatch(/panel|admin/);
			// Nothing to load but the icons: no stylesheet, no image, no font.
			expect(html, path).not.toMatch(
				/<link rel="stylesheet"|<img|@import|url\(/,
			);
			expect(html, path).not.toContain("Nie udało się zalogować");
		}
		expect(world.assets.requests).toEqual([]);
		expect(world.calls).toEqual([]);
		expect(world.logs).toEqual([]);
	});

	it("keeps the query of the page asked for, to come back to it", async () => {
		const world = makeWorld();
		const html = await expectSignInPage(
			await world.send(navigation("/users?search=ada&page=2")),
		);
		expect(html).toContain(startLink("/users?search=ada&page=2"));
	});

	it("on /login, goes back to the page in `redirect`, and only to a page inside the panel", async () => {
		const world = makeWorld();
		for (const [query, redirect] of [
			["", "/"],
			["?redirect=%2Fworkouts%2Fw-1", "/workouts/w-1"],
			["?redirect=/challenges?tab=plan", "/challenges?tab=plan"],
			["?redirect=//evil.example.test/x", "/"],
			["?redirect=https://evil.example.test/", "/"],
			["?redirect=/login", "/"],
			["?redirect=/auth/signout", "/"],
			["?redirect=/x/../api/manageUsers", "/"],
			["?redirect=%2F%252e%252e%2Fx", "/"],
		] as const) {
			const html = await expectSignInPage(
				await world.send(navigation(`/login${query}`)),
				query,
			);
			expect(html, query).toContain(startLink(redirect));
		}
	});

	it("leads to the very address the panel's own page starts a sign-in with", async () => {
		const world = makeWorld();
		const html = await expectSignInPage(
			await world.send(navigation("/login?redirect=%2Fbadges")),
		);
		const href = /href="(\/auth\/google\/start[^"]*)"/.exec(html)?.[1] ?? "";
		// As src/auth/server.ts builds it.
		expect(href.replace(/&amp;/g, "&")).toBe(
			`/auth/google/start?${new URLSearchParams({ redirect: "/badges" })}`,
		);
		// And the Worker starts the sign-in from it, heading back there.
		const start = await world.send(
			navigation(href.replace(/&amp;/g, "&"), { site: "same-origin" }),
		);
		expect(start.status).toBe(303);
		expect(start.headers.get("location")).toContain(
			"https://accounts.google.com/",
		);
	});

	it("answers HEAD with the page's headers and no body, and any other method with 404", async () => {
		const world = makeWorld();
		const head = await world.send(bare("/challenges", { method: "HEAD" }));
		expect(head.status).toBe(200);
		expect(head.headers.get("content-security-policy")).toBe(LOGIN_PAGE_POLICY);
		expect(await head.text()).toBe("");
		for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
			await expectNotFound(
				await world.send(bare("/challenges", { method })),
				method,
			);
		}
		expect(world.assets.requests).toEqual([]);
	});

	it("serves the icons and robots.txt to anyone, as the static files answer them", async () => {
		const world = makeWorld();
		expect([...PUBLIC_FILES]).toEqual([
			"/robots.txt",
			"/favicon.ico",
			"/favicon-32.png",
			"/favicon-192.png",
			"/apple-touch-icon.png",
		]);
		for (const path of PUBLIC_FILES) {
			world.forget();
			const response = await world.send(bare(path));
			expect(response.status, path).toBe(200);
			// Untouched: public files may be cached anywhere.
			expect(response.headers.get("cache-control"), path).toBe(
				"public, max-age=0, must-revalidate",
			);
			expect(
				world.assets.requests.map((request) => request.url),
				path,
			).toEqual([`${ORIGIN}${path}`]);
		}
		expect(world.logs).toEqual([]);
	});
});

describe("the sign-in page after a refused sign-in", () => {
	it("says why, with the refused person's own user id from the sealed note", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		expect(run.end.headers.get("location")).toBe("/login?error=forbidden");
		const html = await expectSignInPage(
			await world.send(
				navigation("/login?error=forbidden", {
					cookies: run.cookies,
					site: "cross-site",
				}),
			),
		);
		expect(html).toContain('<div class="notice" role="alert">');
		expect(html).toContain("<h2>Nie udało się zalogować</h2>");
		expect(html).toContain("<p>To konto nie ma dostępu.</p>");
		expect(html).toContain(
			`Żeby dostać dostęp, przekaż ten identyfikator osobie, która go nadaje: <span class="uid">${STRANGER.uid}</span>`,
		);
		expect(html).toContain(startLink("/"));
	});

	it("escapes the user id", async () => {
		const world = makeWorld();
		const uid = `<img src=x onerror=alert(1)>"'&`;
		const note = await forgedPass(
			{ v: 1, uid, exp: world.nowS() + 600 },
			{ purpose: REFUSED_COOKIE },
		);
		const html = await expectSignInPage(
			await world.send(
				navigation("/login?error=forbidden", {
					cookies: note.replace(PASS_COOKIE, REFUSED_COOKIE),
				}),
			),
		);
		expect(html).toContain(
			'<span class="uid">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</span>',
		);
		expect(html).not.toContain("<img");
	});

	it("shows the user id only with `forbidden`, and only while the note is good", async () => {
		const world = makeWorld();
		const { cookies } = await signInWithGoogle(world, STRANGER);
		const cancelled = await expectSignInPage(
			await world.send(navigation("/login?error=cancelled", { cookies })),
		);
		expect(cancelled).toContain("<p>Logowanie zostało przerwane.</p>");
		expect(cancelled).not.toContain(STRANGER.uid);

		const elsewhere = await expectSignInPage(
			await world.send(navigation("/challenges?error=forbidden", { cookies })),
		);
		expect(elsewhere).not.toContain('role="alert"');

		world.advance(600);
		const later = await expectSignInPage(
			await world.send(navigation("/login?error=forbidden", { cookies })),
		);
		expect(later).toContain("<p>To konto nie ma dostępu.</p>");
		expect(later).not.toContain(STRANGER.uid);
		expect(later).not.toContain("identyfikator");
	});

	it("words every code the Worker sends back with, and a code it does not know with the general text", async () => {
		const world = makeWorld();
		for (const [code, text] of [
			["cancelled", "Logowanie zostało przerwane."],
			["disabled", "To konto jest zablokowane."],
			["tooManyAttempts", "Za dużo prób. Spróbuj ponownie za kilka minut."],
			[
				"unavailable",
				"Logowanie jest chwilowo niedostępne. Spróbuj za chwilę.",
			],
			[
				"misconfigured",
				"Logowanie nie jest poprawnie skonfigurowane. Daj znać administratorowi.",
			],
			["failed", "Nie udało się zalogować."],
			["whatever", "Nie udało się zalogować."],
			["constructor", "Nie udało się zalogować."],
			["toString", "Nie udało się zalogować."],
		] as const) {
			const html = await expectSignInPage(
				await world.send(navigation(`/login?error=${code}`)),
				code,
			);
			expect(html, code).toContain(`<p>${text}</p>`);
			expect(html, code).toContain("<h2>Nie udało się zalogować</h2>");
		}
	});

	it("drops a code that is not a short word, and escapes or drops whatever the address holds", async () => {
		const world = makeWorld();
		for (const path of [
			"/login?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
			"/login?error=a%22%3E%3Cb%3E",
			`/login?error=${"a".repeat(33)}`,
			"/login?redirect=%2Fx%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E",
			"/login?redirect=%2Fx%27onmouseover%3Dalert(1)",
			'/x"><script>alert(1)</script>',
			"/x?q=%22%3E%3Cscript%3Ealert(1)%3C/script%3E",
			"/x?q=\"'><svg onload=alert(1)>",
		]) {
			const html = await expectSignInPage(
				await world.send(navigation(path)),
				path,
			);
			expect(html.toLowerCase(), path).not.toContain("<script");
			expect(html, path).not.toContain("onload=alert");
			expect(html, path).not.toContain("<b>");
			expect(html, path).not.toContain('role="alert"');
			// One attribute, one quote pair: nothing broke out of the link.
			expect(html.match(/<a /g), path).toHaveLength(1);
			const link = /<a class="button" href="([^"]*)">/.exec(html)?.[1];
			expect(link, path).toMatch(/^\/auth\/google\/start\?redirect=[^"<>']*$/);
		}
	});
});

describe("after sign-in (a valid pass)", () => {
	it("gets the panel's code and pages from the static files, kept out of every shared cache", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const script = await world.send(
			fromOwnMedia("/assets/index-abc123.js", { cookies }),
		);
		expect(script.status).toBe(200);
		expect(await script.text()).toBe(
			"/* the panel's code: /assets/index-abc123.js */",
		);
		expect(script.headers.get("cache-control")).toBe("private, no-cache");
		// What the static files said otherwise is kept.
		expect(script.headers.get("etag")).toBe('"fake-asset"');
		expect(script.headers.get("x-robots-tag")).toBe("noindex");

		for (const path of ["/", "/challenges/abc-123", "/login?redirect=%2F"]) {
			const page = await world.send(navigation(path, { cookies }));
			expect(page.status, path).toBe(200);
			expect(await page.text(), path).toContain("/assets/index-fake.js");
			expect(page.headers.get("cache-control"), path).toBe("private, no-store");
		}
		expect(world.assets.requests.map((request) => request.url)).toEqual([
			`${ORIGIN}/assets/index-abc123.js`,
			`${ORIGIN}/`,
			`${ORIGIN}/challenges/abc-123`,
			`${ORIGIN}/login?redirect=%2F`,
		]);
		// The request is handed over as it came, cookies and all, and asks nobody else.
		expect(world.assets.requests[0]?.headers.get("cookie")).toBe(cookies);
		expect(world.calls).toEqual([]);
		expect(world.logs).toEqual([]);
	});

	it("the pass alone is enough for the code, and is checked without asking the backend", async () => {
		const world = makeWorld();
		const pass = passOnly(await signedIn(world));
		const response = await world.send(
			navigation("/assets/x.js", { cookies: pass }),
		);
		expect(response.status).toBe(200);
		expect(world.calls).toEqual([]);
	});

	it("the pass alone opens no data: /api and /auth still want the session", async () => {
		const world = makeWorld();
		const pass = passOnly(await signedIn(world));
		for (const path of ["/api/manageUsers", "/api/manageBadges"]) {
			const response = await world.send(fromPanel(path, { cookies: pass }));
			expect(response.status, path).toBe(401);
			expect((await bodyOf(response)).errorCode, path).toBe("SIGNED_OUT");
		}
		const file = await world.send(
			fromOwnMedia("/api/files?path=covers/spring.png", { cookies: pass }),
		);
		expect(file.status).toBe(401);
		const status = await world.send(
			fromPanel("/auth/session", { cookies: pass }),
		);
		expect(await bodyOf(status)).toMatchObject({ status: "signedOut" });
		expect(world.backend.accepted).toEqual([]);
		expect(world.callsTo("https://api.example.test/")).toEqual([]);
	});

	it("is treated as none when it is expired, changed, sealed for something else or with another key", async () => {
		const world = makeWorld();
		const real = passOnly(await signedIn(world));
		const value = real.slice(PASS_COOKIE.length + 1);
		const middle = Math.floor(value.length / 2);
		const changed = `${value.slice(0, middle)}${value[middle] === "A" ? "B" : "A"}${value.slice(middle + 1)}`;
		const good = { v: 1, uid: "uid-admin-0001", exp: world.nowS() + 3600 };
		const { cookies: refusedJar } = await signInWithGoogle(
			makeWorld(),
			STRANGER,
		);
		const refusedNote = inJar(refusedJar, REFUSED_COOKIE) ?? "";
		const cases: [string, string][] = [
			["changed", `${PASS_COOKIE}=${changed}`],
			["cut short", `${PASS_COOKIE}=${value.slice(0, 20)}`],
			["empty", `${PASS_COOKIE}=`],
			["not sealed", `${PASS_COOKIE}=${btoa(JSON.stringify(good))}`],
			["another key", await forgedPass(good, { key: randomKey() })],
			[
				"sealed as the refusal note",
				await forgedPass(good, { purpose: REFUSED_COOKIE }),
			],
			[
				"sealed as a sign-in attempt",
				await forgedPass(good, { purpose: ATTEMPT_COOKIE }),
			],
			["a refusal note in its place", `${PASS_COOKIE}=${refusedNote}`],
			["expired", await forgedPass({ ...good, exp: world.nowS() })],
			["no end", await forgedPass({ v: 1, uid: good.uid })],
			[
				"an end that is not a number",
				await forgedPass({ ...good, exp: "later" }),
			],
			["another version", await forgedPass({ ...good, v: 2 })],
			["no uid", await forgedPass({ v: 1, exp: good.exp })],
			["not an object", await forgedPass("pass")],
			["null", await forgedPass(null)],
			[
				"the session in its place",
				`${PASS_COOKIE}=${inJar(await signedIn(makeWorld()), SESSION_COOKIE)}`,
			],
		];
		expect(
			(
				await world.send(
					navigation("/assets/x.js", { cookies: await forgedPass(good) }),
				)
			).status,
			"the forger's control case",
		).toBe(200);
		for (const [label, cookies] of cases) {
			world.forget();
			await expectNotFound(
				await world.send(navigation("/assets/x.js", { cookies })),
				label,
			);
			await expectSignInPage(
				await world.send(navigation("/challenges", { cookies })),
				label,
			);
			expect(world.assets.requests, label).toEqual([]);
		}
	});

	it("ends with the session: 48 hours after sign-in it is no longer good", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.advance(SESSION_S - 1);
		expect(
			(await world.send(navigation("/assets/x.js", { cookies }))).status,
		).toBe(200);
		world.advance(1);
		await expectNotFound(
			await world.send(navigation("/assets/x.js", { cookies })),
		);
	});

	it("is opened only with SIGN_IN_COOKIE_KEY: a new key turns every pass away", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const rotated = makeWorld({ SIGN_IN_COOKIE_KEY: randomKey() });
		await expectNotFound(
			await rotated.send(navigation("/assets/x.js", { cookies })),
		);
	});
});

describe("the pass goes with the session", () => {
	it("signing out forgets it, and the next page is the sign-in page", async () => {
		const world = makeWorld();
		let cookies = await signedIn(world);
		const out = await world.send(
			fromPanel("/auth/signout", { method: "POST", cookies }),
		);
		expect(clears(out, PASS_COOKIE)).toBe(true);
		cookies = jar(cookies, out);
		expect(inJar(cookies, PASS_COOKIE)).toBeNull();
		await expectSignInPage(
			await world.send(navigation("/challenges", { cookies })),
		);
	});

	it("a session the backend no longer accepts forgets it, at /auth/session and at /api", async () => {
		for (const ask of ["/auth/session", "/api/manageUsers"]) {
			const world = makeWorld();
			let cookies = await signedIn(world);
			world.backend.sessions.clear();
			const response = await world.send(fromPanel(ask, { cookies }));
			expect(clears(response, PASS_COOKIE), ask).toBe(true);
			expect(clears(response, SESSION_COOKIE), ask).toBe(true);
			cookies = jar(cookies, response);
			await expectNotFound(
				await world.send(navigation("/assets/x.js", { cookies })),
				ask,
			);
		}
	});
});

describe("on another address, or before sign-in is configured", () => {
	it("a configured Worker answers no file or page on another host, pass or not", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const path of ["/", "/assets/x.js", "/favicon.ico"]) {
			world.forget();
			const response = await world.send(
				navigation(path, {
					cookies,
					at: "https://admin-panel.someone.workers.dev",
				}),
			);
			await expectNotFound(response, path);
			expect(world.assets.requests, path).toEqual([]);
			expect(world.logs, path).toEqual([
				{ event: "refused", reason: "host", ray: null },
			]);
		}
	});

	it("serves every file and page as the static files answer it, as before, while sign-in is not configured", async () => {
		const unset: [string, Partial<PanelEnv>][] = [
			[
				"nothing set",
				{
					PANEL_ORIGIN: undefined,
					API_ORIGIN: undefined,
					MEDIA_ORIGINS: undefined,
					FIREBASE_API_KEY: undefined,
					GOOGLE_CLIENT_ID: undefined,
					GOOGLE_CLIENT_SECRET: undefined,
					SIGN_IN_COOKIE_KEY: undefined,
					PANEL_SIGNING_SECRET: undefined,
				},
			],
			["no PANEL_ORIGIN", { PANEL_ORIGIN: undefined }],
			[
				"PANEL_ORIGIN not a valid address",
				{ PANEL_ORIGIN: "panel.example.test" },
			],
		];
		for (const [label, overrides] of unset) {
			const world: World = makeWorld(overrides);
			for (const [path, at] of [
				["/", undefined],
				["/challenges", undefined],
				["/assets/index-abc123.js", undefined],
				["/index.html", undefined],
				["/login?error=forbidden", undefined],
				["/assets/x.js", "http://localhost:5173"],
			] as const) {
				world.forget();
				const response = await world.send(navigation(path, { at }));
				expect(response.status, `${label} ${path}`).toBe(200);
				expect(response.headers.get("cache-control"), `${label} ${path}`).toBe(
					"public, max-age=0, must-revalidate",
				);
				expect(response.headers.get("content-security-policy")).toBeNull();
				expect(world.assets.requests, `${label} ${path}`).toHaveLength(1);
				expect(world.logs, `${label} ${path}`).toEqual([]);
			}
		}
	});

	it("without the static files at all, a file or a page is 404", async () => {
		const world = makeWorld({ PANEL_ORIGIN: undefined, ASSETS: undefined });
		await expectNotFound(await world.send(navigation("/")));
		await expectNotFound(await world.send(navigation("/assets/x.js")));
	});
});

describe("the parts", () => {
	it("tells a file from a page", () => {
		for (const path of [
			"/assets/index.js",
			"/assets/",
			"/assets/fonts/x",
			"/index.html",
			"/robots.txt",
			"/x/y.map",
			"/.env",
		]) {
			expect(isFile(path), path).toBe(true);
		}
		for (const path of [
			"/",
			"/login",
			"/challenges/abc-123",
			"/challenges/abc-123/plan/p1",
			"/users/uid_0001",
			"/assetsx",
		]) {
			expect(isFile(path), path).toBe(false);
		}
	});

	it("escapes everything HTML gives a meaning to", () => {
		expect(escapeHtml(`<a href="x" title='y'>&amp;</a>`)).toBe(
			"&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;",
		);
	});

	it("builds the page from what it is given, escaping every part", () => {
		const html = loginPageHtml({
			redirect: `/x"><script>`,
			problem: "forbidden",
			refusedUid: "</span><script>",
		});
		expect(html.toLowerCase()).not.toContain("<script");
		expect(html).toContain("&lt;/span&gt;&lt;script&gt;");
	});
});
