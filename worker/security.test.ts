import { describe, expect, it } from "vitest";
import { cookieKey, seal } from "./codec";
import { ROUTES } from "./proxy";
import {
	ADMIN,
	API,
	ATTEMPT_COOKIE,
	bare,
	bodyOf,
	COUNTING_KEY,
	clears,
	cookieNamed,
	FIREBASE_KEY,
	fakeIdToken,
	fromGoogle,
	fromOwnMedia,
	fromPanel,
	GOOGLE_SECRET,
	GOOGLE_TOKEN_URL,
	googleAccessTokenOf,
	IDP_URL,
	inJar,
	jar,
	jsonAnswer,
	MEDIA,
	makeWorld,
	navigation,
	ORIGIN,
	REFUSED_COOKIE,
	refreshTokenOf,
	SECOND_ADMIN,
	SESSION_COOKIE,
	SESSION_S,
	SIGNING_SECRET,
	STRANGER,
	sessionOf,
	setCookies,
	signedIn,
	signInWithGoogle,
	type World,
} from "./testSupport";

// The Worker from the outside, as someone who wants in or wants more.
//
// The first six blocks are the six attacks of the review of 2026-11-13
// (docs/AUTH-HARDENING.md, sections 1 and 3). Each worked against the
// previous Worker; each is written here as the attacker would try it, and
// passes because it no longer works.

const WRITES = ROUTES.filter((route) => route.writes);
/**
 * Writes to data. The cache purge is open on purpose (it changes no data;
 * worker/proxy.test.ts holds it to that one row) and is left out here.
 */
const DATA_WRITES = WRITES.filter((route) => route.writes !== "cache");
const concrete = (path: string) => `/api/${path.replaceAll(":id", "abc-123")}`;

/** A cookie value sealed with the Worker's own cookie key, as the Worker seals one. */
async function sealedWithTheRealKey(
	name: string,
	value: unknown,
): Promise<string> {
	const key = await cookieKey(COUNTING_KEY);
	if (!key) throw new Error("test key refused");
	return seal(key, name, value, (size) =>
		crypto.getRandomValues(new Uint8Array(size)),
	);
}

// ─── (a) Finding 1 ──────────────────────────────────────────────────────────

describe("attack (a): a script in an admin's tab writes, although the page is read-only", () => {
	// The script has everything the page has: the admin's session cookie
	// goes along by itself, and it can set the panel's header.
	it("nothing it sends is forwarded: every write to data is refused by the Worker", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		expect(DATA_WRITES.length).toBe(WRITES.length - 1);
		for (const route of DATA_WRITES) {
			const response = await world.send(
				fromPanel(concrete(route.path), {
					method: route.method,
					cookies,
					json: { title: "[TEST] sent by a script", toAllUsers: true },
				}),
			);
			expect(response.status, route.path).toBe(403);
			expect((await bodyOf(response)).errorCode, route.path).toBe("READ_ONLY");
		}
		expect(world.calls).toEqual([]);
		expect(world.backend.accepted).toEqual([]);
	});

	it("the two actions the review named do not leave the Worker", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const send = await world.send(
			fromPanel("/api/manageMessageDrafts/publish", {
				cookies,
				json: { draftId: "abc-123", audience: "all", dryRun: false },
			}),
		);
		const email = await world.send(
			fromPanel("/api/accounts/abc-123", {
				method: "PUT",
				cookies,
				json: { email: "attacker@evil.example.test" },
			}),
		);
		expect([send.status, email.status]).toEqual([403, 403]);
		expect(world.calls).toEqual([]);
	});

	it("a write cannot be dressed as a read", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		// A method override, in a header and in the query, on a GET.
		await world.send(
			fromPanel("/api/manageChallenges?_method=POST", {
				cookies,
				headers: {
					"x-http-method-override": "POST",
					"x-http-method": "DELETE",
					"x-method-override": "PUT",
				},
			}),
		);
		expect(world.calls).toHaveLength(1);
		const call = world.calls[0];
		expect(call?.method).toBe("GET");
		expect(
			[...(call?.headers.keys() ?? [])].filter((name) =>
				name.includes("method"),
			),
		).toEqual([]);
	});

	it("no other method opens a read row for writing", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const method of ["DELETE", "PATCH", "PUT", "POST"]) {
			for (const path of [
				"/api/manageUsers",
				"/api/manageUserBadges/abc-123",
			]) {
				const response = await world.send(
					fromPanel(path, { method, cookies, json: {} }),
				);
				expect(response.status, `${method} ${path}`).toBe(404);
			}
		}
		expect(world.calls).toEqual([]);
	});

	it("the backend's own addresses cannot be reached through the proxy", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const token = world.firebase.issued[0] as string;
		for (const [method, path] of [
			["POST", "/api/panel/session"],
			["GET", "/api/panel/me"],
			["POST", "/api/panel/signOut"],
			["POST", "/api/panel/manageChallenges"],
		] as const) {
			const response = await world.send(
				fromPanel(path, {
					method,
					cookies,
					json: method === "GET" ? undefined : { idToken: token },
				}),
			);
			expect(response.status, path).toBe(404);
		}
		expect(world.calls).toEqual([]);
	});
});

// ─── (b) Finding 4 ──────────────────────────────────────────────────────────

describe("attack (b): a removed admin keeps their cookies", () => {
	it("is refused on the very next call, and the cookie is cleared", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		expect(
			(await world.send(fromPanel("/api/manageUsers", { cookies }))).status,
		).toBe(200);

		world.backend.admins.delete(ADMIN.uid);

		const data = await world.send(fromPanel("/api/manageUsers", { cookies }));
		expect(data.status).toBe(401);
		expect((await bodyOf(data)).errorCode).toBe("SIGNED_OUT");
		expect(clears(data, SESSION_COOKIE)).toBe(true);

		const status = await world.send(fromPanel("/auth/session", { cookies }));
		expect(await bodyOf(status)).toEqual({
			status: "signedOut",
			methods: ["google"],
		});
		expect(clears(status, SESSION_COOKIE)).toBe(true);
	});

	it("stays refused for as long as they keep trying, with the cookie saved by hand", async () => {
		// The review's proof ran for 20 simulated days against the old Worker.
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.backend.admins.delete(ADMIN.uid);
		for (let day = 0; day < 20; day++) {
			const response = await world.send(
				fromPanel("/api/manageUsers", { cookies }),
			);
			expect(response.status, `day ${day}`).toBe(401);
			world.advance(24 * 3600);
		}
		expect(world.backend.accepted).toEqual([]);
	});

	it("has nothing to mix: there is one cookie, and nothing in it the Worker decides by", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const session = sessionOf(cookies);
		world.backend.admins.delete(ADMIN.uid);
		for (const extra of [
			// The cookies of the previous design, and a few hopeful ones.
			`__Host-cf_token=${world.firebase.issued[0]}`,
			`__Host-cf_token=${session}`,
			"__Host-cf_admin=1",
			"admin=true",
			`${SESSION_COOKIE}=${session}`,
		]) {
			for (const jarText of [`${cookies}; ${extra}`, `${extra}; ${cookies}`]) {
				const response = await world.send(
					fromPanel("/api/manageUsers", { cookies: jarText }),
				);
				expect(response.status, extra).toBe(401);
			}
		}
		expect(world.backend.accepted).toEqual([]);
	});

	it("cannot sign in again either", async () => {
		const world = makeWorld();
		await signedIn(world);
		world.backend.admins.delete(ADMIN.uid);
		const run = await signInWithGoogle(world, ADMIN);
		expect(run.end.headers.get("location")).toBe("/login?error=forbidden");
		expect(inJar(run.cookies, SESSION_COOKIE)).toBeNull();
	});

	it("leaves the other admins as they were", async () => {
		const world = makeWorld();
		const removed = await signedIn(world, ADMIN);
		const other = await signedIn(world, SECOND_ADMIN);
		world.backend.admins.delete(ADMIN.uid);
		expect(
			(await world.send(fromPanel("/api/manageUsers", { cookies: removed })))
				.status,
		).toBe(401);
		expect(
			(await world.send(fromPanel("/api/manageUsers", { cookies: other })))
				.status,
		).toBe(200);
	});

	it("an admin's session cannot be stretched past its 48 hours by the Worker", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		// Used all along, right up to the end: nothing renews it.
		for (let hour = 1; hour < 48; hour++) {
			world.advance(3600);
			const response = await world.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect((await bodyOf(response)).status, `hour ${hour}`).toBe("admin");
			expect(setCookies(response), `hour ${hour}`).toEqual([]);
		}
		world.advance(3600);
		const response = await world.send(
			fromPanel("/api/manageUsers", { cookies }),
		);
		expect(response.status).toBe(401);
	});
});

// ─── (c) Finding 5 ──────────────────────────────────────────────────────────

describe("attack (c): someone has the Worker's cookie key", () => {
	// With the old Worker that key made an admin session for a made-up user.
	// Now it seals the sign-in attempt and the refusal note, and neither can
	// become a session.

	it("a sealed `session` of their own making is not a session", async () => {
		const world = makeWorld();
		for (const value of [
			// What the old design kept in this cookie.
			{ v: 1, uid: ADMIN.uid, admin: true, exp: world.nowS() + SESSION_S },
			{ v: 1, uid: "uid-made-up", email: ADMIN.email, admin: true },
		]) {
			const forged = await sealedWithTheRealKey(SESSION_COOKIE, value);
			const cookies = `${SESSION_COOKIE}=${forged}`;
			const data = await world.send(fromPanel("/api/manageUsers", { cookies }));
			expect(data.status).toBe(401);
			expect(clears(data, SESSION_COOKIE)).toBe(true);
			const status = await world.send(fromPanel("/auth/session", { cookies }));
			expect((await bodyOf(status)).status).toBe("signedOut");
		}
		expect(world.backend.accepted).toEqual([]);
		expect(
			world.backend.refused.every((entry) => entry.code === "SESSION_INVALID"),
		).toBe(true);
	});

	it("a forged sign-in attempt gets as far as Google, which never issued the code", async () => {
		const world = makeWorld();
		const attempt = {
			v: 1,
			state: "s".repeat(43),
			nonce: "n".repeat(43),
			verifier: "v".repeat(43),
			redirect: "/",
			exp: world.nowS() + 600,
		};
		const cookies = `${ATTEMPT_COOKIE}=${await sealedWithTheRealKey(ATTEMPT_COOKIE, attempt)}`;
		const end = await world.send(
			fromGoogle(`/auth/google/callback?state=${attempt.state}&code=made-up`, {
				cookies,
			}),
		);
		expect(end.headers.get("location")).toBe("/login?error=failed");
		expect(cookieNamed(end, SESSION_COOKIE)).toBeUndefined();
		expect(world.calls.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
		expect(world.backend.sessions.size).toBe(0);
	});

	it("a forged attempt finished with their own Google account is refused by the backend's list", async () => {
		// The furthest the key takes anyone: a genuine sign-in as themselves.
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		expect(run.end.headers.get("location")).toBe("/login?error=forbidden");
		expect(inJar(run.cookies, SESSION_COOKIE)).toBeNull();
		expect(world.backend.sessions.size).toBe(0);
	});

	it("a forged attempt with a token Google issued to another client never reaches Firebase", async () => {
		// With the key they choose the nonce, so a token an admin was tricked
		// into getting for the attacker's own Google client would carry the
		// right one. It was not issued for the panel's client, and stops here.
		const world = makeWorld();
		const attempt = {
			v: 1,
			state: "s".repeat(43),
			nonce: "n".repeat(43),
			verifier: "v".repeat(43),
			redirect: "/",
			exp: world.nowS() + 600,
		};
		// Google, as the attacker would like it to answer.
		world.on(GOOGLE_TOKEN_URL, () =>
			jsonAnswer({
				id_token: fakeIdToken({
					iss: "https://accounts.google.com",
					aud: "the-attackers-own-client.apps.example.test",
					sub: ADMIN.googleSub,
					email: ADMIN.email,
					email_verified: true,
					nonce: attempt.nonce,
					exp: world.nowS() + 3600,
				}),
			}),
		);
		const end = await world.send(
			fromGoogle(`/auth/google/callback?state=${attempt.state}&code=made-up`, {
				cookies: `${ATTEMPT_COOKIE}=${await sealedWithTheRealKey(ATTEMPT_COOKIE, attempt)}`,
			}),
		);
		expect(end.headers.get("location")).toBe("/login?error=failed");
		expect(world.callsTo(IDP_URL)).toEqual([]);
		expect(world.callsTo(API)).toEqual([]);
	});

	it("a forged refusal note shows a user id on the sign-in page and opens nothing", async () => {
		const world = makeWorld();
		const note = await sealedWithTheRealKey(REFUSED_COOKIE, {
			v: 1,
			uid: ADMIN.uid,
			exp: world.nowS() + 600,
		});
		const status = await world.send(
			fromPanel("/auth/session", { cookies: `${REFUSED_COOKIE}=${note}` }),
		);
		expect(await bodyOf(status)).toEqual({
			status: "signedOut",
			methods: ["google"],
			refusedUid: ADMIN.uid,
		});
		for (const cookies of [
			`${REFUSED_COOKIE}=${note}`,
			`${SESSION_COOKIE}=${note}`,
		]) {
			const data = await world.send(fromPanel("/api/manageUsers", { cookies }));
			expect(data.status).toBe(401);
		}
		expect(world.backend.accepted).toEqual([]);
	});

	it("the cookie key is not the key the backend trusts", async () => {
		// Nothing sealed or signed with the cookie key is what the backend
		// checks: its signature is made with another secret.
		const world = makeWorld({ PANEL_SIGNING_SECRET: COUNTING_KEY });
		const response = await world.send(
			fromPanel("/api/manageUsers", {
				cookies: `${SESSION_COOKIE}=made-up-session`,
			}),
		);
		expect(response.status).toBe(502);
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"BAD_SIGNATURE",
		]);
	});
});

// ─── (d) Finding 3 ──────────────────────────────────────────────────────────

describe("attack (d): the Worker is reached at an address that is not the panel's", () => {
	const ELSEWHERE = "https://admin-panel.someone.workers.dev";

	it("an admin's cookie, replayed there, gets nothing", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const request of [
			fromPanel("/api/manageUsers", { cookies, at: ELSEWHERE }),
			fromPanel("/api/accounts/abc-123", { cookies, at: ELSEWHERE }),
			fromPanel("/auth/session", { cookies, at: ELSEWHERE }),
			fromOwnMedia("/api/files?path=covers/spring.png", {
				cookies,
				at: ELSEWHERE,
			}),
		]) {
			const response = await world.send(request);
			expect(response.status).toBe(404);
			expect(await bodyOf(response)).toEqual({
				error: "Not found",
				errorCode: "NOT_FOUND",
			});
		}
		expect(world.calls).toEqual([]);
	});

	it("a sign-in cannot be started or finished there", async () => {
		const world = makeWorld();
		const start = await world.send(
			navigation("/auth/google/start", { at: ELSEWHERE }),
		);
		expect(start.status).toBe(404);
		expect(start.headers.has("location")).toBe(false);
		expect(setCookies(start)).toEqual([]);

		// An attempt begun at the right address, finished at the wrong one.
		const begun = await world.send(navigation("/auth/google/start"));
		const back = world.google.approve(begun.headers.get("location"), ADMIN);
		const end = await world.send(
			fromGoogle(back.replace(ORIGIN, ELSEWHERE), { cookies: jar("", begun) }),
		);
		expect(end.status).toBe(404);
		expect(setCookies(end)).toEqual([]);
		expect(world.calls).toEqual([]);
	});

	it("Google is never told to send anyone to another address", async () => {
		const world = makeWorld();
		const start = await world.send(
			navigation("/auth/google/start", {
				headers: {
					host: "admin-panel.someone.workers.dev",
					"x-forwarded-host": "admin-panel.someone.workers.dev",
				},
			}),
		);
		expect(
			new URL(start.headers.get("location") ?? "").searchParams.get(
				"redirect_uri",
			),
		).toBe(`${ORIGIN}/auth/google/callback`);
	});
});

// ─── (e) Finding 8 ──────────────────────────────────────────────────────────

describe("attack (e): /api/files as a way to run or reach something", () => {
	const get = (world: World, cookies: string, path: string) =>
		world.send(fromOwnMedia(path, { cookies }));

	it("a script stored as a file is not served from the panel's address", async () => {
		// `script-src 'self'` trusts exactly this address.
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.media.put(
			"evil.js",
			"application/javascript",
			"alert(document.cookie)",
		);
		world.media.put("evil.html", "text/html", "<script>alert(1)</script>");
		world.media.put("evil.svg", "image/svg+xml", "<svg onload=alert(1)>");
		world.media.put("evil.xml", "application/xml", "<x/>");
		world.media.put("evil.bin", null, "alert(1)");
		for (const name of [
			"evil.js",
			"evil.html",
			"evil.svg",
			"evil.xml",
			"evil.bin",
		]) {
			const response = await get(world, cookies, `/api/files?path=${name}`);
			expect(response.status, name).toBe(415);
			expect(response.headers.get("content-type"), name).toBe(
				"application/json; charset=utf-8",
			);
			expect(await response.text(), name).not.toContain("alert");
		}
	});

	it("a script stored under a picture's name and type cannot run where it is shown", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.media.put("looks-like.png", "image/png", "alert(1)");
		const response = await get(
			world,
			cookies,
			"/api/files?path=looks-like.png",
		);
		expect(response.status).toBe(200);
		// The browser may not guess another type, and opened on its own the
		// file is shut in a sandbox.
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toContain(
			"sandbox",
		);
		expect(response.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
	});

	it("extra and repeated parameters are refused, not passed on", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const query of [
			"?path=covers/spring.png&path=evil.js",
			"?path=evil.js&path=covers/spring.png",
			"?path=covers/spring.png&container=private",
			"?path=covers/spring.png&sv=2024&sig=made-up",
			"?path=covers/spring.png&redirect=https://evil.example.test",
			"?container=private&path=covers/spring.png",
		]) {
			const response = await get(world, cookies, `/api/files${query}`);
			expect(response.status, query).toBe(404);
		}
		expect(world.calls).toEqual([]);
	});

	it("/api/files/x is not an admin call, and not anything else", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const path of [
			"/api/files/x",
			"/api/files/manageUsers",
			"/api/files/../panel/me",
			"/api/files/x?path=covers/spring.png",
		]) {
			for (const request of [
				fromPanel(path, { cookies }),
				fromOwnMedia(path, { cookies }),
			]) {
				expect((await world.send(request)).status, path).toBe(404);
			}
		}
		expect(world.calls).toEqual([]);
	});

	it("a path cannot climb out of the container or name another host", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const path of [
			"../private/keys.json",
			"covers/../../private/keys.json",
			"..%2Fprivate%2Fkeys.json",
			"%2e%2e/private/keys.json",
			"..\\private\\keys.json",
			"/private/keys.json",
			"https://evil.example.test/x.png",
			"//evil.example.test/x.png",
		]) {
			const response = await get(
				world,
				cookies,
				`/api/files?path=${encodeURIComponent(path)}`,
			);
			expect(response.status, path).toBe(404);
		}
		expect(world.calls).toEqual([]);
	});

	it("the backend's redirect is not followed to a host that is not the store", async () => {
		// With the old Worker a redirect went anywhere, the Worker's own
		// network position included.
		for (const location of [
			"https://evil.example.test/x.png",
			"http://169.254.169.254/latest/meta-data/",
			"http://localhost:8787/api/manageUsers",
			`${API}/api/panel/manageUsers`,
			`${ORIGIN}/api/manageUsers`,
		]) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			world.on(
				`${API}/api/files`,
				() => new Response(null, { status: 302, headers: { location } }),
			);
			const response = await get(
				world,
				cookies,
				"/api/files?path=covers/spring.png",
			);
			expect(response.status, location).toBe(502);
			expect(response.headers.has("location"), location).toBe(false);
			expect(world.calls, location).toHaveLength(1);
		}
	});

	it("a file request carries nothing of the admin's to the backend or the store", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		await get(world, cookies, "/api/files?path=covers/spring.png");
		expect(world.calls.map((call) => new URL(call.url).origin)).toEqual([
			API,
			MEDIA,
		]);
		for (const call of world.calls) {
			expect([...call.headers.keys()]).toEqual([]);
			expect(call.url).not.toContain(sessionOf(cookies));
		}
	});

	it("another site cannot use the panel's address to load files with an admin's cookie", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const site of ["cross-site", "same-site", "none"]) {
			const response = await world.send(
				fromOwnMedia("/api/files?path=covers/spring.png", {
					cookies,
					headers: { "sec-fetch-site": site },
				}),
			);
			expect(response.status, site).toBe(403);
		}
		expect(world.calls).toEqual([]);
	});
});

// ─── (f) Finding 13 ─────────────────────────────────────────────────────────

describe("attack (f): dot segments in the return address", () => {
	it("a sign-in does not end at one of the Worker's own addresses", async () => {
		for (const redirect of [
			"/x/../api/files?path=evil.js",
			"/x/../api/manageUsers",
			"/./auth/google/start",
			"/./auth/signout",
			"/a/b/../../auth/google/start?redirect=/x",
			"/%2e%2e/api/files",
			"/x/%2E%2E/auth/google/start",
			"/x/..%2fapi/files",
			"/challenges/../login",
		]) {
			const world = makeWorld();
			const run = await signInWithGoogle(world, ADMIN, { redirect });
			expect(inJar(run.cookies, SESSION_COOKIE), redirect).not.toBeNull();
			expect(run.end.headers.get("location"), redirect).toBe("/");
		}
	});

	it("a sign-in does not end on another site, however the address is spelled", async () => {
		for (const redirect of [
			"https://evil.example.test/",
			"//evil.example.test/",
			"/\\evil.example.test/",
			"\\\\evil.example.test/",
			"/\t/evil.example.test/",
			"/%2f%2fevil.example.test/",
			"/%5cevil.example.test/",
			"https:evil.example.test",
			"javascript:alert(1)",
			// And the one the review did not try, found while these tests were
			// written: a dot step in front of an empty segment resolves to
			// `//host` on the panel's own origin.
			"/.//evil.example.test/",
			"/x/..//evil.example.test/",
			"/..//evil.example.test/",
		]) {
			const world = makeWorld();
			const run = await signInWithGoogle(world, ADMIN, { redirect });
			const location = run.end.headers.get("location") ?? "";
			expect(new URL(location, ORIGIN).origin, redirect).toBe(ORIGIN);
			expect(location, redirect).toBe("/");
		}
	});

	it("what the browser is sent to is the resolved address, in plain ASCII", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN, {
			redirect: "/users/./x/../żaneta?tab=a b",
		});
		expect(run.end.headers.get("location")).toBe(
			"/users/%C5%BCaneta?tab=a%20b",
		);
	});
});

// ─── Other ways in ──────────────────────────────────────────────────────────

describe("other things someone might try", () => {
	it("a Firebase token from the mobile app, used as the session, opens nothing", async () => {
		// Every admin's phone holds one for the same account.
		const world = makeWorld();
		await signedIn(world);
		const appToken = world.firebase.issued[0] as string;
		const response = await world.send(
			fromPanel("/api/manageUsers", {
				cookies: `${SESSION_COOKIE}=${appToken}`,
			}),
		);
		expect(response.status).toBe(401);
		expect(world.backend.accepted).toEqual([]);
		// Nor does it as a bearer token: the Worker forwards no such header.
		world.forget();
		const bearer = await world.send(
			fromPanel("/api/manageUsers", {
				headers: { authorization: `Bearer ${appToken}` },
			}),
		);
		expect(bearer.status).toBe(401);
		expect(world.calls).toEqual([]);
	});

	it("a session cannot be planted from the request: only the cookie counts", async () => {
		const world = makeWorld();
		const session = sessionOf(await signedIn(world));
		const response = await world.send(
			fromPanel(`/api/manageUsers?session=${session}`, {
				headers: {
					"x-panel-session": session,
					authorization: `Bearer ${session}`,
					"x-session": session,
				},
			}),
		);
		expect(response.status).toBe(401);
		expect(world.calls).toEqual([]);
	});

	it("an attacker cannot sign a victim's browser into the attacker's own account", async () => {
		// The attacker starts a sign-in in their own browser and sends the
		// victim the address Google would have sent them back to.
		const world = makeWorld();
		const attacker = await world.send(navigation("/auth/google/start"));
		const back = world.google.approve(
			attacker.headers.get("location"),
			SECOND_ADMIN,
		);
		world.forget();

		// A victim with no sign-in under way, and one in the middle of theirs.
		const victimStart = await world.send(navigation("/auth/google/start"));
		for (const cookies of ["", jar("", victimStart)]) {
			const end = await world.send(fromGoogle(back, { cookies }));
			expect(end.headers.get("location")).toBe("/login?error=failed");
			expect(setCookies(end)).toEqual([]);
		}
		expect(world.calls).toEqual([]);
	});

	it("another site cannot read, write or sign out with an admin's cookie", async () => {
		// SameSite=Strict keeps the cookie at home; these are the checks
		// behind it, for a browser that sent it anyway.
		const world = makeWorld();
		const cookies = await signedIn(world);
		const foreign = {
			origin: "https://evil.example.test",
			"sec-fetch-site": "cross-site",
		};
		for (const request of [
			bare("/api/manageUsers", { cookies, headers: foreign }),
			bare("/api/accounts/abc-123", { cookies, headers: foreign }),
			bare("/auth/session", { cookies, headers: foreign }),
			bare("/auth/signout", { method: "POST", cookies, headers: foreign }),
			// Even with the header only the panel's code sets.
			fromPanel("/api/manageUsers", { cookies, headers: foreign }),
			fromPanel("/auth/signout", { method: "POST", cookies, headers: foreign }),
		]) {
			const response = await world.send(request);
			expect(response.status).toBe(403);
			expect(setCookies(response)).toEqual([]);
			expect(response.headers.has("access-control-allow-origin")).toBe(false);
		}
		expect(world.calls).toEqual([]);
	});

	it("no answer invites another site in", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const request of [
			bare("/api/manageUsers", {
				method: "OPTIONS",
				headers: {
					origin: "https://evil.example.test",
					"access-control-request-method": "GET",
					"access-control-request-headers": "x-cf-panel",
				},
			}),
			fromPanel("/api/manageUsers", { cookies }),
			fromPanel("/auth/session", { cookies }),
			bare("/api/health"),
		]) {
			const response = await world.send(request);
			for (const name of response.headers.keys()) {
				expect(name).not.toMatch(/^access-control-/);
			}
			expect(response.headers.get("cross-origin-resource-policy")).toBe(
				"same-origin",
			);
		}
	});

	it("a session value with odd characters in it is the backend's to refuse, and breaks nothing on the way", async () => {
		const world = makeWorld();
		for (const value of [
			'a"b',
			"a,b",
			"a b",
			"a\\b",
			"<script>",
			"caf\u00e9",
			"a%0d%0aX-Injected:1",
			"x".repeat(8000),
		]) {
			const response = await world.send(
				fromPanel("/api/manageUsers", {
					cookies: `${SESSION_COOKIE}=${value}`,
				}),
			);
			expect(response.status, value.slice(0, 20)).toBe(401);
			expect(clears(response, SESSION_COOKIE)).toBe(true);
		}
		expect(world.backend.accepted).toEqual([]);
		for (const call of world.calls) {
			expect(call.headers.has("x-injected")).toBe(false);
		}
	});

	it("nothing a request says is repeated in a refusal", async () => {
		const world = makeWorld();
		for (const request of [
			fromPanel("/api/made-up-marker?made-up-marker=made-up-marker"),
			fromPanel("/auth/made-up-marker"),
			bare("/api/manageUsers?q=made-up-marker", {
				headers: { "x-cf-panel": "made-up-marker" },
			}),
			fromOwnMedia("/api/files?path=../made-up-marker", {
				cookies: `${SESSION_COOKIE}=made-up-marker`,
			}),
			navigation("/auth/google/start?redirect=made-up-marker", {
				site: "cross-site",
			}),
			fromGoogle(
				"/auth/google/callback?state=made-up-marker&error=made-up-marker",
			),
		]) {
			const response = await world.send(request);
			const headers = [...response.headers].flat().join("\n");
			expect(`${headers}\n${await response.text()}`).not.toContain(
				"made-up-marker",
			);
		}
	});
});

// ─── The log ────────────────────────────────────────────────────────────────

describe("the log", () => {
	it("has a line for each refusal that names its reason", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const logged = async (request: Request) => {
			world.forget();
			await world.send(request);
			return world.logs;
		};
		expect(
			await logged(
				fromPanel("/auth/session", { at: "https://evil.example.test" }),
			),
		).toEqual([{ event: "refused", reason: "host", ray: null }]);
		expect(
			await logged(navigation("/auth/google/start", { site: "cross-site" })),
		).toEqual([
			{
				event: "refused",
				route: "/auth/google/start",
				reason: "foreign",
				ray: null,
			},
		]);
		expect(await logged(bare("/auth/session"))).toEqual([
			{ event: "refused", route: "/auth", reason: "foreign", ray: null },
		]);
		expect(await logged(bare("/auth/signout", { method: "POST" }))).toEqual([
			{ event: "refused", route: "/auth", reason: "foreign", ray: null },
		]);
		expect(
			await logged(fromPanel("/api/somewhere/abc-123", { method: "DELETE" })),
		).toEqual([
			{ event: "refused", method: "DELETE", reason: "notInTable", ray: null },
		]);
		expect(await logged(bare("/api/accounts/abc-123", { cookies }))).toEqual([
			{
				event: "refused",
				method: "GET",
				route: "/api/accounts/:id",
				status: 403,
				reason: "FOREIGN_REQUEST",
				ray: null,
			},
		]);
		expect(await logged(fromPanel("/api/accounts/abc-123"))).toEqual([
			{
				event: "refused",
				method: "GET",
				route: "/api/accounts/:id",
				status: 401,
				reason: "SIGNED_OUT",
				ray: null,
			},
		]);
		expect(
			await logged(
				fromPanel("/api/accounts/abc-123", {
					method: "PUT",
					cookies,
					json: { email: "x@example.test" },
				}),
			),
		).toEqual([
			{
				event: "refused",
				method: "PUT",
				route: "/api/accounts/:id",
				status: 403,
				reason: "READ_ONLY",
				ray: null,
			},
		]);
	});

	it("carries Cloudflare's request id on a refusal, to find it in Cloudflare's records", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const ray = { "cf-ray": "made-up-ray-id" };
		for (const request of [
			fromPanel("/api/manageUsers", { headers: ray }),
			bare("/api/manageUsers", { cookies, headers: ray }),
			fromPanel("/api/not-in-the-table", { cookies, headers: ray }),
			fromPanel("/api/manageChallenges", {
				method: "POST",
				cookies,
				json: {},
				headers: ray,
			}),
			navigation("/auth/google/start", { site: "cross-site", headers: ray }),
			bare("/auth/signout", { method: "POST", cookies, headers: ray }),
		]) {
			world.forget();
			await world.send(request);
			expect(world.logs).toHaveLength(1);
			expect(world.logs[0]).toMatchObject({
				event: "refused",
				ray: "made-up-ray-id",
			});
		}
	});

	it("has a line for each way a sign-in can end", async () => {
		const outcome = async (prepare: (world: World) => void, person = ADMIN) => {
			const world = makeWorld();
			prepare(world);
			await signInWithGoogle(world, person);
			return world.logs.filter((entry) => entry.event === "signIn");
		};
		expect(await outcome(() => {})).toEqual([
			{ event: "signIn", outcome: "admin", uid: ADMIN.uid, ray: null },
		]);
		expect(await outcome(() => {}, STRANGER)).toEqual([
			{ event: "signIn", outcome: "forbidden", uid: STRANGER.uid, ray: null },
		]);
		expect(
			await outcome((world) => {
				world.on(GOOGLE_TOKEN_URL, () => new Response(null, { status: 500 }));
			}),
		).toEqual([{ event: "signIn", outcome: "failed", uid: null, ray: null }]);
		expect(
			await outcome((world) => {
				world.on(IDP_URL, () => new Response(null, { status: 500 }));
			}),
		).toEqual([
			{ event: "signIn", outcome: "unavailable", uid: null, ray: null },
		]);
		expect(
			await outcome((world) => {
				world.backend.configured = false;
			}),
		).toEqual([
			{ event: "signIn", outcome: "misconfigured", uid: null, ray: null },
		]);

		const cancelled = makeWorld();
		const start = await cancelled.send(navigation("/auth/google/start"));
		await cancelled.send(
			fromGoogle(cancelled.google.decline(start.headers.get("location")), {
				cookies: jar("", start),
			}),
		);
		expect(cancelled.logs).toEqual([
			{ event: "signIn", outcome: "cancelled", uid: null, ray: null },
		]);
	});

	it("never holds a cookie, a token, a query, a body, a secret or an e-mail address, across a whole day at the panel", async () => {
		const world = makeWorld();
		const secrets = new Set<string>([
			GOOGLE_SECRET,
			SIGNING_SECRET,
			COUNTING_KEY,
			FIREBASE_KEY,
			ADMIN.email,
			STRANGER.email,
			refreshTokenOf(ADMIN),
			refreshTokenOf(STRANGER),
			googleAccessTokenOf(ADMIN),
			"marker-in-a-query",
			"marker-in-a-body",
			"marker-in-a-path",
		]);
		const keep = (response: Response) => {
			for (const cookie of setCookies(response)) {
				if (cookie.value !== "") secrets.add(cookie.value);
			}
			return response;
		};

		// A stranger tries, and looks at the refusal page.
		const stranger = await signInWithGoogle(world, STRANGER);
		keep(stranger.start);
		keep(stranger.end);
		await world.send(fromPanel("/auth/session", { cookies: stranger.cookies }));

		// An admin cancels once, then signs in.
		const first = keep(await world.send(navigation("/auth/google/start")));
		await world.send(
			fromGoogle(world.google.decline(first.headers.get("location")), {
				cookies: jar("", first),
			}),
		);
		const run = await signInWithGoogle(world, ADMIN, {
			redirect: "/users?query=marker-in-a-query",
		});
		keep(run.start);
		keep(run.end);
		const cookies = run.cookies;
		for (const name of ["state", "nonce", "code_challenge"]) {
			secrets.add(run.authorize.searchParams.get(name) ?? "");
		}
		secrets.add(new URL(run.back).searchParams.get("code") ?? "");

		// They read, look at a file, and try what is not allowed.
		await world.send(fromPanel("/auth/session", { cookies }));
		await world.send(
			fromPanel("/api/manageUsers?query=marker-in-a-query&limit=20", {
				cookies,
			}),
		);
		await world.send(fromPanel("/api/accounts/marker-in-a-path", { cookies }));
		await world.send(
			fromOwnMedia("/api/files?path=covers/spring.png", { cookies }),
		);
		await world.send(
			fromOwnMedia("/api/files?path=../marker-in-a-query", { cookies }),
		);
		await world.send(
			fromPanel("/api/manageChallenges?note=marker-in-a-query", {
				method: "POST",
				cookies,
				json: { title: "marker-in-a-body" },
			}),
		);
		await world.send(
			fromPanel("/api/marker-in-a-path?x=marker-in-a-query", {
				method: "DELETE",
				cookies,
				body: "marker-in-a-body",
			}),
		);
		await world.send(
			bare("/api/manageUsers?query=marker-in-a-query", { cookies }),
		);
		await world.send(fromPanel("/api/manageUsers?query=marker-in-a-query"));
		await world.send(
			navigation("/auth/google/start?redirect=/marker-in-a-query", {
				site: "cross-site",
				cookies,
			}),
		);
		await world.send(
			fromPanel("/api/manageUsers?query=marker-in-a-query", {
				cookies,
				at: "https://evil.example.test",
			}),
		);

		// The backend stops trusting the Worker for a moment; then the
		// admin is taken off the list, and signs out.
		world.backend.signingKey = "another made up secret, also long enough";
		await world.send(
			fromPanel("/api/manageUsers?query=marker-in-a-query", { cookies }),
		);
		await world.send(fromPanel("/auth/session", { cookies }));
		world.backend.signingKey = SIGNING_SECRET;
		world.backend.admins.delete(ADMIN.uid);
		await world.send(
			fromPanel("/api/manageUsers?query=marker-in-a-query", { cookies }),
		);
		await world.send(fromPanel("/auth/signout", { method: "POST", cookies }));

		// Everything that went out or came in, and must not be in the log.
		for (const token of [...world.google.issued, ...world.firebase.issued]) {
			secrets.add(token);
		}
		for (const call of world.calls) {
			for (const name of ["x-panel-session", "x-panel-signature"]) {
				secrets.add(call.headers.get(name) ?? "");
			}
			const form = new URLSearchParams(call.body ?? "");
			secrets.add(form.get("code_verifier") ?? "");
		}
		secrets.delete("");

		// The scenario did happen, and was logged.
		expect(world.logs.length).toBeGreaterThanOrEqual(12);
		expect(new Set(world.logs.map((entry) => entry.event))).toEqual(
			new Set(["signIn", "refused", "backendRefusedWorker", "signOut"]),
		);
		expect(secrets.size).toBeGreaterThan(25);

		const text = JSON.stringify(world.logs);
		for (const secret of secrets) {
			expect(
				text.includes(secret),
				`the log holds: ${secret.slice(0, 24)}…`,
			).toBe(false);
		}
		// Nothing shaped like a token or a query either.
		expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
		expect(text).not.toMatch(/[?&=]/);
		expect(text).not.toContain("@");
	});

	it("says only these things, and names addresses by their pattern", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		await world.send(fromPanel("/api/accounts/uid-of-a-customer"));
		await world.send(
			fromPanel("/api/manageUserBadges/uid-of-a-customer/grants", {
				cookies,
				headers: { "x-cf-panel": null },
			}),
		);
		await world.send(
			fromPanel("/api/accounts/uid-of-a-customer", {
				method: "PUT",
				cookies,
				json: {},
			}),
		);
		await world.send(fromPanel("/api/unknown/uid-of-a-customer", { cookies }));
		await world.send(
			navigation("/auth/google/start", { site: "cross-site", cookies }),
		);
		await world.send(fromPanel("/auth/signout", { method: "POST", cookies }));
		expect(world.logs).toHaveLength(6);
		for (const entry of world.logs) {
			for (const [key, value] of Object.entries(entry)) {
				expect([
					"event",
					"reason",
					"route",
					"method",
					"status",
					"outcome",
					"uid",
					"ended",
					"ray",
				]).toContain(key);
				expect(String(value)).not.toContain("uid-of-a-customer");
			}
			if (typeof entry.route === "string") {
				expect(entry.route).toMatch(/^\/(api|auth)\/[A-Za-z/:]+$/);
			}
		}
	});

	// Rule 36: "one structured log line for every refused request". The first
	// version of the Worker wrote none for these seven; each has its own test
	// so that a line going missing again names which.
	describe("has a line for the refusals that once had none", () => {
		const fileLine = (status: number, reason: string) => ({
			event: "refused",
			method: "GET",
			route: "/api/files",
			status,
			reason,
			ray: "made-up-ray-id",
		});
		const ray = { "cf-ray": "made-up-ray-id" };
		const cases: [
			string,
			(world: World, cookies: string) => Request,
			Record<string, unknown>,
		][] = [
			[
				"a file asked for by another site (403)",
				(_, cookies) =>
					fromOwnMedia("/api/files?path=covers/spring.png", {
						cookies,
						headers: { ...ray, "sec-fetch-site": "cross-site" },
					}),
				fileLine(403, "FOREIGN_REQUEST"),
			],
			[
				"a file path that points out of the container (404)",
				(_, cookies) =>
					fromOwnMedia("/api/files?path=..%2Fprivate%2Fkeys.json", {
						cookies,
						headers: ray,
					}),
				fileLine(404, "NOT_FOUND"),
			],
			[
				"a file asked for without a session (401)",
				() =>
					fromOwnMedia("/api/files?path=covers/spring.png", { headers: ray }),
				fileLine(401, "SIGNED_OUT"),
			],
			[
				"a file of a type that is not served (415)",
				(world, cookies) => {
					world.media.put("evil.js", "application/javascript");
					return fromOwnMedia("/api/files?path=evil.js", {
						cookies,
						headers: ray,
					});
				},
				fileLine(415, "FILE_TYPE_REFUSED"),
			],
			[
				"a second redirect on the way to a file (502)",
				(world, cookies) => {
					world.on(
						`${MEDIA}/`,
						() =>
							new Response(null, {
								status: 302,
								headers: { location: "https://evil.example.test/x.png" },
							}),
					);
					return fromOwnMedia("/api/files?path=covers/spring.png", {
						cookies,
						headers: ray,
					});
				},
				fileLine(502, "FILE_REDIRECT_REFUSED"),
			],
			[
				"an answer from Google that belongs to no sign-in attempt",
				() =>
					fromGoogle("/auth/google/callback?state=made-up&code=made-up", {
						headers: ray,
					}),
				{
					event: "refused",
					route: "/auth/google/callback",
					reason: "noAttempt",
					ray: "made-up-ray-id",
				},
			],
			[
				"an address under /auth that does not exist (404)",
				(_, cookies) =>
					fromPanel("/auth/password", {
						method: "POST",
						cookies,
						json: {},
						headers: ray,
					}),
				{
					event: "refused",
					route: "/auth",
					reason: "notFound",
					ray: "made-up-ray-id",
				},
			],
		];
		for (const [label, make, line] of cases) {
			it(label, async () => {
				const world = makeWorld();
				const cookies = await signedIn(world);
				const response = await world.send(make(world, cookies));
				expect(response.status).toBeGreaterThanOrEqual(300);
				expect(world.logs).toEqual([line]);
			});
		}
	});
});
