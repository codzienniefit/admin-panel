import { describe, expect, it } from "vitest";
import { handleAuth, isExpectedGoogleToken, SESSION_COOKIE } from "./auth";
import { cookieKey, open, seal } from "./codec";
import {
	ADMIN,
	API,
	ATTEMPT_COOKIE,
	backendError,
	bare,
	bodyOf,
	type Call,
	COUNTING_KEY,
	callText,
	claimsOf,
	clears,
	cookieNamed,
	expectedSignature,
	FIREBASE_KEY,
	fakeIdToken,
	firebaseError,
	fromGoogle,
	fromPanel,
	GOOGLE_AUTHORIZE_URL,
	GOOGLE_CLIENT,
	GOOGLE_SECRET,
	GOOGLE_TOKEN_URL,
	googleAccessTokenOf,
	IDP_URL,
	inJar,
	jar,
	jsonAnswer,
	makeWorld,
	navigation,
	ORIGIN,
	pkceChallengeOf,
	REFUSED_COOKIE,
	randomKey,
	refreshTokenOf,
	SECOND_ADMIN,
	SESSION_S,
	SIGNING_SECRET,
	STRANGER,
	sessionOf,
	setCookies,
	signedIn,
	signInWithGoogle,
	visibleText,
	type World,
} from "./testSupport";

const CALLBACK = `${ORIGIN}/auth/google/callback`;

/** The reason a sign-in ended back at the sign-in page with. */
function loginError(response: Response): string | null {
	expect(response.status).toBe(303);
	const location = response.headers.get("location") ?? "";
	expect(location).toMatch(/^\/login\?error=[A-Za-z]+$/);
	return new URL(location, ORIGIN).searchParams.get("error");
}

async function keyOf(text: string): Promise<CryptoKey> {
	const key = await cookieKey(text);
	if (!key) throw new Error("test key refused");
	return key;
}

/** What is inside a sealed cookie of the Worker's. */
const opened = async (name: string, value: string, key = COUNTING_KEY) =>
	(await open(await keyOf(key), name, value)) as Record<string, unknown> | null;

/** A cookie value sealed as the Worker seals one. */
const sealed = async (name: string, value: unknown, key = COUNTING_KEY) =>
	seal(await keyOf(key), name, value, (size) =>
		crypto.getRandomValues(new Uint8Array(size)),
	);

interface Begun {
	start: Response;
	/** Google's sign-in address. */
	location: string;
	asked: URLSearchParams;
	cookies: string;
}

/** The first half: the browser is sent to Google and holds the attempt cookie. */
async function begin(world: World, query = ""): Promise<Begun> {
	const start = await world.send(navigation(`/auth/google/start${query}`));
	const location = start.headers.get("location") ?? "";
	return {
		start,
		location,
		asked: new URL(location, ORIGIN).searchParams,
		cookies: jar("", start),
	};
}

const finish = (world: World, back: string, cookies: string) =>
	world.send(fromGoogle(back, { cookies }));

const outcomes = (world: World) =>
	world.logs
		.filter((entry) => entry.event === "signIn")
		.map((entry) => entry.outcome);

// ─── Starting ───────────────────────────────────────────────────────────────

describe("GET /auth/google/start", () => {
	it("sends the browser to Google with exactly what an authorization-code sign-in needs", async () => {
		const world = makeWorld();
		const { start, location, asked } = await begin(world);
		expect(start.status).toBe(303);
		expect(location.split("?")[0]).toBe(GOOGLE_AUTHORIZE_URL);
		expect([...asked.keys()].sort()).toEqual([
			"client_id",
			"code_challenge",
			"code_challenge_method",
			"nonce",
			"prompt",
			"redirect_uri",
			"response_type",
			"scope",
			"state",
		]);
		expect(asked.get("client_id")).toBe(GOOGLE_CLIENT);
		expect(asked.get("redirect_uri")).toBe(CALLBACK);
		expect(asked.get("response_type")).toBe("code");
		expect(asked.get("scope")).toBe("openid email profile");
		expect(asked.get("code_challenge_method")).toBe("S256");
		expect(asked.get("prompt")).toBe("select_account");
		// Nothing has been asked of anyone yet.
		expect(world.calls).toEqual([]);
	});

	it("makes a state, a nonce and a PKCE verifier of 32 random bytes each", async () => {
		const world = makeWorld();
		const { asked, cookies } = await begin(world);
		const attempt = await opened(
			ATTEMPT_COOKIE,
			inJar(cookies, ATTEMPT_COOKIE) ?? "",
		);
		const values = [asked.get("state"), asked.get("nonce"), attempt?.verifier];
		for (const value of values) {
			// 32 bytes are 43 characters of base64url.
			expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
		}
		expect(new Set(values).size).toBe(3);
	});

	it("sends the hash of the verifier, never the verifier", async () => {
		const world = makeWorld();
		const { location, asked, cookies } = await begin(world);
		const attempt = await opened(
			ATTEMPT_COOKIE,
			inJar(cookies, ATTEMPT_COOKIE) ?? "",
		);
		const verifier = String(attempt?.verifier);
		expect(asked.get("code_challenge")).toBe(await pkceChallengeOf(verifier));
		expect(location).not.toContain(verifier);
	});

	it("remembers the attempt in a sealed cookie for ten minutes", async () => {
		const world = makeWorld();
		const { start, asked } = await begin(world);
		const cookie = cookieNamed(start, ATTEMPT_COOKIE);
		expect(cookie?.raw).toBe(
			`${ATTEMPT_COOKIE}=${cookie?.value}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
		);
		expect(await opened(ATTEMPT_COOKIE, cookie?.value ?? "")).toEqual({
			v: 1,
			state: asked.get("state"),
			nonce: asked.get("nonce"),
			verifier: expect.any(String),
			redirect: "/",
			exp: world.nowS() + 600,
		});
		// Sealed: what is in it cannot be read off the cookie.
		expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(cookie?.value).not.toContain(asked.get("state"));
		expect(cookie?.value).not.toContain(asked.get("nonce"));
	});

	it("sets nothing else, and takes away an old refusal", async () => {
		const world = makeWorld();
		const { start } = await begin(world);
		expect(setCookies(start).map((cookie) => cookie.name)).toEqual([
			ATTEMPT_COOKIE,
			REFUSED_COOKIE,
		]);
		expect(clears(start, REFUSED_COOKIE)).toBe(true);
		expect(cookieNamed(start, SESSION_COOKIE)).toBeUndefined();
	});

	it("makes a new state, nonce and verifier for every attempt", async () => {
		const world = makeWorld();
		const first = await begin(world);
		const second = await begin(world);
		for (const name of ["state", "nonce", "code_challenge"]) {
			expect(first.asked.get(name), name).not.toBe(second.asked.get(name));
		}
		expect(inJar(first.cookies, ATTEMPT_COOKIE)).not.toBe(
			inJar(second.cookies, ATTEMPT_COOKIE),
		);
	});

	it("works from a link on the panel's own page as from the address bar", async () => {
		const world = makeWorld();
		for (const site of ["none", "same-origin"]) {
			const start = await world.send(
				navigation("/auth/google/start", { site }),
			);
			expect(start.headers.get("location"), site).toContain(
				GOOGLE_AUTHORIZE_URL,
			);
		}
	});

	it("builds the return address from PANEL_ORIGIN, not from the request", async () => {
		const world = makeWorld();
		// Headers a proxy or an attacker might add.
		const spoofed = await world.send(
			navigation("/auth/google/start", {
				headers: {
					host: "evil.example.test",
					"x-forwarded-host": "evil.example.test",
					"x-forwarded-proto": "http",
					origin: "https://evil.example.test",
					referer: "https://evil.example.test/",
				},
			}),
		);
		expect(
			new URL(spoofed.headers.get("location") ?? "").searchParams.get(
				"redirect_uri",
			),
		).toBe(CALLBACK);

		// And even a request that did arrive at another address (which
		// index.ts never lets this far) is not what the address is made of.
		const elsewhere = await handleAuth(
			navigation("/auth/google/start", { at: "https://evil.example.test" }),
			world.env,
			world.deps,
			ORIGIN,
		);
		expect(
			new URL(elsewhere.headers.get("location") ?? "").searchParams.get(
				"redirect_uri",
			),
		).toBe(CALLBACK);
	});

	it("spells the return address as the origin, however PANEL_ORIGIN is written", async () => {
		const world = makeWorld({ PANEL_ORIGIN: " https://PANEL.example.test/ " });
		const { asked } = await begin(world);
		expect(asked.get("redirect_uri")).toBe(CALLBACK);
	});

	it("remembers where to go afterwards only when it is a page of the panel", async () => {
		const world = makeWorld();
		const remembered = async (target: string) => {
			const { cookies } = await begin(
				world,
				`?redirect=${encodeURIComponent(target)}`,
			);
			const attempt = await opened(
				ATTEMPT_COOKIE,
				inJar(cookies, ATTEMPT_COOKIE) ?? "",
			);
			return attempt?.redirect;
		};
		expect(await remembered("/challenges/abc?tab=plan#top")).toBe(
			"/challenges/abc?tab=plan#top",
		);
		for (const target of [
			"https://evil.example.test/",
			"//evil.example.test",
			"/\\evil.example.test",
			"/login",
			"/api/files?path=a",
			"/x/../api/files",
			"/./auth/google/start",
			"/%2e%2e/api",
			"",
		]) {
			expect(await remembered(target), target).toBe("/");
		}
	});

	it("refuses a start that another site caused, and changes nothing", async () => {
		const world = makeWorld();
		for (const headers of [
			{ "sec-fetch-site": "cross-site" },
			{ "sec-fetch-site": "same-site" },
			// A browser that does not say where the request came from.
			{ "sec-fetch-site": null },
		]) {
			world.forget();
			const response = await world.send(
				navigation("/auth/google/start?redirect=/users", { headers }),
			);
			expect(loginError(response)).toBe("failed");
			expect(setCookies(response)).toEqual([]);
			expect(world.calls).toEqual([]);
			expect(world.logs).toEqual([
				{
					event: "refused",
					route: "/auth/google/start",
					reason: "foreign",
					ray: null,
				},
			]);
		}
	});

	it("says sign-in is unavailable while any setting is missing, and sets nothing", async () => {
		for (const overrides of [
			{ API_ORIGIN: undefined },
			{ FIREBASE_API_KEY: undefined },
			{ GOOGLE_CLIENT_ID: undefined },
			{ GOOGLE_CLIENT_ID: "  " },
			{ GOOGLE_CLIENT_SECRET: undefined },
			{ SIGN_IN_COOKIE_KEY: undefined },
			{ SIGN_IN_COOKIE_KEY: "change-me" },
			{ SIGN_IN_COOKIE_KEY: btoa("only 16 bytes!!!") },
			{ PANEL_SIGNING_SECRET: undefined },
			{ PANEL_SIGNING_SECRET: "too short" },
		]) {
			const world = makeWorld(overrides);
			const { start } = await begin(world);
			expect(loginError(start), JSON.stringify(overrides)).toBe("unavailable");
			expect(setCookies(start)).toEqual([]);
			expect(world.calls).toEqual([]);
		}
	});

	it("is a GET and nothing else", async () => {
		const world = makeWorld();
		for (const method of ["POST", "PUT", "DELETE"]) {
			const response = await world.send(
				fromPanel("/auth/google/start", { method }),
			);
			expect(response.status, method).toBe(404);
			expect(setCookies(response)).toEqual([]);
		}
	});
});

// ─── The whole way ──────────────────────────────────────────────────────────

describe("signing in with Google, start to cookie", () => {
	it("ends on the panel with the backend's session in one cookie", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN);
		expect(run.end.status).toBe(303);
		expect(run.end.headers.get("location")).toBe("/");

		// The session is what the backend made, as it made it.
		const session = sessionOf(run.cookies);
		expect([...world.backend.sessions.keys()]).toEqual([session]);
		expect(run.cookies).toBe(`${SESSION_COOKIE}=${session}`);
		expect(world.logs).toEqual([
			{ event: "signIn", outcome: "admin", uid: ADMIN.uid, ray: null },
		]);
	});

	it("asks Google, then Firebase, then the backend, once each and nobody else", async () => {
		const world = makeWorld();
		await signInWithGoogle(world, ADMIN);
		expect(world.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`POST ${GOOGLE_TOKEN_URL}`,
			`POST ${IDP_URL}?key=${FIREBASE_KEY}`,
			`POST ${API}/api/panel/session`,
		]);
	});

	it("sets the session cookie HttpOnly, Secure, SameSite=Strict, for 48 hours, with no Domain", async () => {
		const world = makeWorld();
		const { end } = await signInWithGoogle(world, ADMIN);
		const cookie = cookieNamed(end, SESSION_COOKIE);
		expect(SESSION_COOKIE).toBe("__Host-cf_session");
		expect(cookie?.raw).toBe(
			`__Host-cf_session=${cookie?.value}; Path=/; Max-Age=172800; HttpOnly; Secure; SameSite=Strict`,
		);
		expect([...(cookie?.attributes.keys() ?? [])]).toEqual([
			"path",
			"max-age",
			"httponly",
			"secure",
			"samesite",
		]);
	});

	it("uses the attempt up and forgets an old refusal", async () => {
		const world = makeWorld();
		const { end } = await signInWithGoogle(world, ADMIN);
		expect(setCookies(end).map((cookie) => cookie.name)).toEqual([
			ATTEMPT_COOKIE,
			REFUSED_COOKIE,
			SESSION_COOKIE,
		]);
		expect(clears(end, ATTEMPT_COOKIE)).toBe(true);
		expect(cookieNamed(end, ATTEMPT_COOKIE)?.attributes.get("samesite")).toBe(
			"Lax",
		);
		expect(clears(end, REFUSED_COOKIE)).toBe(true);
	});

	it("keeps the cookie no longer than the backend says, and never past 48 hours", async () => {
		for (const [stated, kept] of [
			[3600, "3600"],
			[SESSION_S, "172800"],
			[30 * 24 * 3600, "172800"],
			[0, "172800"],
		] as const) {
			const world = makeWorld();
			world.backend.sessionSeconds = stated;
			const { end } = await signInWithGoogle(world, ADMIN);
			expect(
				cookieNamed(end, SESSION_COOKIE)?.attributes.get("max-age"),
				String(stated),
			).toBe(kept);
		}
	});

	it("exchanges the code at Google with the client's secret and the PKCE verifier", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN);
		const call = world.callsTo(GOOGLE_TOKEN_URL)[0] as Call;
		expect(call.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		const form = new URLSearchParams(call.body ?? "");
		expect([...form.keys()].sort()).toEqual([
			"client_id",
			"client_secret",
			"code",
			"code_verifier",
			"grant_type",
			"redirect_uri",
		]);
		expect(form.get("grant_type")).toBe("authorization_code");
		expect(form.get("code")).toBe(new URL(run.back).searchParams.get("code"));
		expect(form.get("client_id")).toBe(GOOGLE_CLIENT);
		expect(form.get("client_secret")).toBe(GOOGLE_SECRET);
		expect(form.get("redirect_uri")).toBe(CALLBACK);
		expect(await pkceChallengeOf(form.get("code_verifier") ?? "")).toBe(
			run.authorize.searchParams.get("code_challenge"),
		);
	});

	it("passes Google's token to Firebase and Firebase's token to the backend, signed", async () => {
		const world = makeWorld();
		await signInWithGoogle(world, ADMIN);
		const googleToken = world.google.issued[0] as string;
		const firebaseToken = world.firebase.issued[0] as string;

		const toFirebase = JSON.parse(
			world.callsTo(IDP_URL)[0]?.body ?? "",
		) as Record<string, unknown>;
		expect(
			new URLSearchParams(String(toFirebase.postBody)).get("id_token"),
		).toBe(googleToken);
		expect(toFirebase.requestUri).toBe(CALLBACK);

		const toBackend = world.callsTo(API)[0] as Call;
		expect(JSON.parse(toBackend.body ?? "")).toEqual({
			idToken: firebaseToken,
		});
		expect(toBackend.headers.has("x-panel-session")).toBe(false);
		expect(toBackend.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"POST",
				toBackend.url,
				firebaseToken,
				// The signature covers the body that carries the token, byte
				// for byte.
				toBackend.raw,
			),
		);
		expect(world.backend.refused).toEqual([]);
	});

	it("goes on to the page the person was on their way to", async () => {
		const world = makeWorld();
		const { end } = await signInWithGoogle(world, ADMIN, {
			redirect: "/users?query=ada#results",
		});
		expect(end.headers.get("location")).toBe("/users?query=ada#results");
	});

	it("goes to the start page when the remembered address was not a page of the panel", async () => {
		for (const redirect of [
			"https://evil.example.test/",
			"//evil.example.test",
			"/x/../api/files?path=a",
			"/./auth/signout",
			"/login",
		]) {
			const world = makeWorld();
			const { end } = await signInWithGoogle(world, ADMIN, { redirect });
			expect(end.headers.get("location"), redirect).toBe("/");
		}
	});

	it("never leaves the panel after signing in", async () => {
		// `/.//host` resolves to the path `//host` on the panel's own origin,
		// and as a `Location` that is another site. It got past the first
		// version of the check: a genuine, successful sign-in ended on a page
		// of someone else's choosing.
		for (const redirect of [
			"/.//evil.example.test/login",
			"/x/..//evil.example.test",
			"/..//evil.example.test",
			"/././/evil.example.test",
		]) {
			const world = makeWorld();
			const run = await signInWithGoogle(world, ADMIN, { redirect });
			expect(inJar(run.cookies, SESSION_COOKIE), redirect).not.toBeNull();
			const location = run.end.headers.get("location") ?? "";
			expect(location, redirect).toBe("/");
			expect(new URL(location, ORIGIN).origin, redirect).toBe(ORIGIN);
		}
	});

	it("shows the page no token: not Google's, not Firebase's, not the session", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN);
		const secrets = [
			world.google.issued[0] as string,
			world.firebase.issued[0] as string,
			refreshTokenOf(ADMIN),
			googleAccessTokenOf(ADMIN),
			sessionOf(run.cookies),
			GOOGLE_SECRET,
			SIGNING_SECRET,
		];
		const status = await world.send(
			fromPanel("/auth/session", { cookies: run.cookies }),
		);
		for (const response of [run.start, run.end, status]) {
			const text = await visibleText(response);
			for (const secret of secrets) expect(text).not.toContain(secret);
		}
	});

	it("never stores or forwards Firebase's refresh token, or Google's access token", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN);
		const status = await world.send(
			fromPanel("/auth/session", { cookies: run.cookies }),
		);
		// Firebase did send one.
		const firebaseCall = world.calls.findIndex((call) =>
			call.url.startsWith(IDP_URL),
		);
		expect(firebaseCall).toBeGreaterThanOrEqual(0);
		const everywhere = [
			...world.calls.map(callText),
			...(await Promise.all([run.start, run.end, status].map(visibleText))),
			...[run.start, run.end, status].flatMap((response) =>
				setCookies(response).map((cookie) => cookie.raw),
			),
			JSON.stringify(world.logs),
		].join("\n");
		expect(everywhere).not.toContain(refreshTokenOf(ADMIN));
		expect(everywhere).not.toContain(googleAccessTokenOf(ADMIN));
		// The only cookie left is the session, and it is the backend's value.
		expect(claimsOf(sessionOf(run.cookies))).toMatchObject({
			iss: "https://session.firebase.google.com/fake-project",
			sub: ADMIN.uid,
		});
	});

	it("needs nothing from the request that comes back but the state, the code and the cookie", async () => {
		// Google's redirect is a cross-site navigation: no panel header, no
		// same-origin mark. The sealed cookie is what ties it to this browser.
		const world = makeWorld();
		const { location, cookies } = await begin(world);
		const back = world.google.approve(location, ADMIN);
		const end = await world.send(bare(back, { cookies }));
		expect(end.headers.get("location")).toBe("/");
		expect(cookieNamed(end, SESSION_COOKIE)).toBeDefined();
	});

	it("lets two admins hold a session each", async () => {
		const world = makeWorld();
		const first = await signInWithGoogle(world, ADMIN);
		const second = await signInWithGoogle(world, SECOND_ADMIN);
		expect(sessionOf(first.cookies)).not.toBe(sessionOf(second.cookies));
		const who = async (cookies: string) =>
			(await bodyOf(await world.send(fromPanel("/auth/session", { cookies }))))
				.user;
		expect(await who(first.cookies)).toMatchObject({ uid: ADMIN.uid });
		expect(await who(second.cookies)).toMatchObject({ uid: SECOND_ADMIN.uid });
	});
});

// ─── Answers that are not let through ───────────────────────────────────────

describe("GET /auth/google/callback: the remembered attempt", () => {
	it("an answer without a remembered attempt changes nothing", async () => {
		const world = makeWorld();
		const other = await begin(makeWorld());
		for (const [query, cookies] of [
			["?state=made-up&code=made-up", ""],
			["?code=made-up", ""],
			["", ""],
			["?state=&code=made-up", ""],
			// A state, but no cookie; a cookie, but no state.
			[`?state=${other.asked.get("state")}&code=x`, ""],
			["?code=x", other.cookies],
			["?state=&code=x", other.cookies],
			["?error=access_denied", ""],
			["?error=access_denied&state=made-up", ""],
		] as const) {
			world.forget();
			const response = await world.send(
				fromGoogle(`/auth/google/callback${query}`, { cookies }),
			);
			expect(loginError(response), query).toBe("failed");
			expect(setCookies(response), query).toEqual([]);
			expect(world.calls, query).toEqual([]);
			// Refused, and written down as that; not as a sign-in that failed.
			expect(world.logs, query).toEqual([
				{
					event: "refused",
					route: "/auth/google/callback",
					reason: "noAttempt",
					ray: null,
				},
			]);
		}
	});

	it("an answer with the wrong state leaves the real attempt usable", async () => {
		// Anyone can send a browser to the callback address; that must not be
		// able to end a sign-in that is under way in another tab.
		const world = makeWorld();
		const { location, cookies } = await begin(world);
		const back = new URL(world.google.approve(location, ADMIN));
		const forged = new URL(back);
		forged.searchParams.set("state", "x".repeat(43));
		forged.searchParams.set("code", "attackers-code");

		const refused = await finish(world, forged.toString(), cookies);
		expect(loginError(refused)).toBe("failed");
		expect(setCookies(refused)).toEqual([]);
		expect(world.calls).toEqual([]);

		const end = await finish(world, back.toString(), jar(cookies, refused));
		expect(end.headers.get("location")).toBe("/");
		expect(cookieNamed(end, SESSION_COOKIE)).toBeDefined();
	});

	it("an answer does not sign out someone who is signed in", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const response = await finish(
			world,
			`${CALLBACK}?state=made-up&code=made-up`,
			cookies,
		);
		expect(loginError(response)).toBe("failed");
		expect(setCookies(response)).toEqual([]);
	});

	it("an attempt is used once: the browser is told to forget it, however it ends", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, ADMIN);
		expect(inJar(run.cookies, ATTEMPT_COOKIE)).toBeNull();
		world.forget();
		// The same answer again, from the browser as it is now.
		const again = await finish(world, run.back, run.cookies);
		expect(loginError(again)).toBe("failed");
		expect(world.calls).toEqual([]);

		for (const ending of ["error", "no code", "google refuses"]) {
			const other = makeWorld();
			const { location, cookies } = await begin(other);
			const back =
				ending === "error"
					? other.google.decline(location)
					: ending === "no code"
						? other.google.approve(location, ADMIN).replace(/&code=[^&]*/, "")
						: other.google
								.approve(location, ADMIN)
								.replace(/code=[^&]*/, "code=unknown");
			const end = await finish(other, back, cookies);
			expect(clears(end, ATTEMPT_COOKIE), ending).toBe(true);
			expect(inJar(jar(cookies, end), ATTEMPT_COOKIE), ending).toBeNull();
		}
	});

	it("an attempt cookie kept by hand opens nothing a second time: Google's code is spent", async () => {
		// The Worker keeps no list of used attempts; the sealed cookie stays
		// valid for its ten minutes. What stops a replay is Google.
		const world = makeWorld();
		const { location, cookies } = await begin(world);
		const back = world.google.approve(location, ADMIN);
		await finish(world, back, cookies);
		world.forget();

		const replay = await finish(world, back, cookies);
		expect(loginError(replay)).toBe("failed");
		expect(cookieNamed(replay, SESSION_COOKIE)).toBeUndefined();
		expect(world.calls.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
		expect(world.callsTo(IDP_URL)).toEqual([]);
		expect(world.callsTo(API)).toEqual([]);
	});

	it("an attempt lasts ten minutes and not a second longer", async () => {
		const inTime = makeWorld();
		const early = await begin(inTime);
		const earlyBack = inTime.google.approve(early.location, ADMIN);
		inTime.advance(599);
		const accepted = await finish(inTime, earlyBack, early.cookies);
		expect(accepted.headers.get("location")).toBe("/");

		const late = makeWorld();
		const begun = await begin(late);
		const lateBack = late.google.approve(begun.location, ADMIN);
		late.advance(600);
		const refused = await finish(late, lateBack, begun.cookies);
		expect(loginError(refused)).toBe("failed");
		expect(setCookies(refused)).toEqual([]);
		expect(late.calls).toEqual([]);
	});

	it("an attempt sealed with another key, for another cookie, or misshapen is no attempt", async () => {
		const world = makeWorld();
		const good = {
			v: 1,
			state: "s".repeat(43),
			nonce: "n".repeat(43),
			verifier: "v".repeat(43),
			redirect: "/",
			exp: world.nowS() + 600,
		};
		const query = `?state=${good.state}&code=made-up`;
		const send = (value: string) =>
			world.send(
				fromGoogle(`/auth/google/callback${query}`, {
					cookies: `${ATTEMPT_COOKIE}=${value}`,
				}),
			);

		const without = (name: keyof typeof good) => {
			const { [name]: _, ...rest } = good;
			return rest;
		};
		for (const [label, value] of [
			["another key", await sealed(ATTEMPT_COOKIE, good, randomKey())],
			["sealed as the refusal cookie", await sealed(REFUSED_COOKIE, good)],
			["sealed as the session cookie", await sealed(SESSION_COOKIE, good)],
			["not sealed", btoa(JSON.stringify(good))],
			["plain JSON", JSON.stringify(good)],
			["garbage", "garbage"],
			["version 2", await sealed(ATTEMPT_COOKIE, { ...good, v: 2 })],
			["no version", await sealed(ATTEMPT_COOKIE, without("v"))],
			["no nonce", await sealed(ATTEMPT_COOKIE, without("nonce"))],
			["no verifier", await sealed(ATTEMPT_COOKIE, without("verifier"))],
			["no redirect", await sealed(ATTEMPT_COOKIE, without("redirect"))],
			["no expiry", await sealed(ATTEMPT_COOKIE, without("exp"))],
			["expiry as text", await sealed(ATTEMPT_COOKIE, { ...good, exp: "9" })],
			["expired", await sealed(ATTEMPT_COOKIE, { ...good, exp: world.nowS() })],
			["a list", await sealed(ATTEMPT_COOKIE, [good])],
			["null", await sealed(ATTEMPT_COOKIE, null)],
			["a text", await sealed(ATTEMPT_COOKIE, "attempt")],
		] as const) {
			world.forget();
			const response = await send(value);
			expect(loginError(response), label).toBe("failed");
			expect(setCookies(response), label).toEqual([]);
			expect(world.calls, label).toEqual([]);
		}

		// The same shape, properly sealed, is taken as an attempt (and then
		// fails at Google, which never issued this code).
		world.forget();
		const response = await send(await sealed(ATTEMPT_COOKIE, good));
		expect(loginError(response)).toBe("failed");
		expect(world.calls.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
	});

	it("says sign-in is unavailable while a setting is missing, and changes nothing", async () => {
		const configured = makeWorld();
		const { location, cookies } = await begin(configured);
		const back = configured.google.approve(location, ADMIN);
		for (const name of [
			"FIREBASE_API_KEY",
			"GOOGLE_CLIENT_SECRET",
			"PANEL_SIGNING_SECRET",
			"API_ORIGIN",
			"SIGN_IN_COOKIE_KEY",
		] as const) {
			const world = makeWorld({ [name]: undefined });
			const response = await finish(world, back, cookies);
			expect(loginError(response), name).toBe("unavailable");
			expect(setCookies(response), name).toEqual([]);
			expect(world.calls, name).toEqual([]);
		}
	});

	it("is a GET and nothing else", async () => {
		const world = makeWorld();
		const { location, cookies } = await begin(world);
		const back = world.google.approve(location, ADMIN);
		const response = await world.send(
			fromPanel(back, { method: "POST", cookies }),
		);
		expect(response.status).toBe(404);
		expect(world.calls).toEqual([]);
	});
});

describe("GET /auth/google/callback: what Google answers", () => {
	it("`error` from Google ends the attempt as cancelled, asking nobody", async () => {
		for (const error of ["access_denied", "server_error", "anything"]) {
			const world = makeWorld();
			const { location, cookies } = await begin(world);
			const end = await finish(
				world,
				world.google.decline(location, error),
				cookies,
			);
			expect(loginError(end), error).toBe("cancelled");
			expect(setCookies(end).map((cookie) => cookie.name)).toEqual([
				ATTEMPT_COOKIE,
			]);
			expect(clears(end, ATTEMPT_COOKIE)).toBe(true);
			expect(world.calls).toEqual([]);
			expect(world.logs).toEqual([
				{ event: "signIn", outcome: "cancelled", uid: null, ray: null },
			]);
		}
	});

	it("`error` wins over a code sent along with it", async () => {
		const world = makeWorld();
		const { location, cookies } = await begin(world);
		const back = `${world.google.approve(location, ADMIN)}&error=access_denied`;
		expect(loginError(await finish(world, back, cookies))).toBe("cancelled");
		expect(world.calls).toEqual([]);
	});

	it("an answer without a code fails", async () => {
		const world = makeWorld();
		const { asked, cookies } = await begin(world);
		const end = await finish(
			world,
			`${CALLBACK}?state=${asked.get("state")}`,
			cookies,
		);
		expect(loginError(end)).toBe("failed");
		expect(world.calls).toEqual([]);
		expect(outcomes(world)).toEqual(["failed"]);
	});

	it("a code Google does not know fails before Firebase is asked", async () => {
		const world = makeWorld();
		const { asked, cookies } = await begin(world);
		const end = await finish(
			world,
			`${CALLBACK}?state=${asked.get("state")}&code=made-up`,
			cookies,
		);
		expect(loginError(end)).toBe("failed");
		expect(cookieNamed(end, SESSION_COOKIE)).toBeUndefined();
		expect(world.calls.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
		expect(outcomes(world)).toEqual(["failed"]);
	});

	it("a code issued for another attempt fails at Google: the verifier does not fit", async () => {
		// PKCE: a code stolen on its way back is useless without the cookie
		// of the browser that asked for it.
		const world = makeWorld();
		const victim = await begin(world);
		const stolen = new URL(
			world.google.approve(victim.location, ADMIN),
		).searchParams.get("code");
		const attacker = await begin(world);
		const end = await finish(
			world,
			`${CALLBACK}?state=${attacker.asked.get("state")}&code=${stolen}`,
			attacker.cookies,
		);
		expect(loginError(end)).toBe("failed");
		expect(world.callsTo(IDP_URL)).toEqual([]);
		expect(world.callsTo(API)).toEqual([]);
	});

	it("Google being down, failing or answering nonsense fails before Firebase is asked", async () => {
		const good = fakeIdToken({ sub: ADMIN.googleSub });
		for (const [label, answer] of [
			[
				"down",
				() => {
					throw new TypeError("fetch failed");
				},
			],
			["500", () => new Response("oops", { status: 500 })],
			["400", () => jsonAnswer({ error: "invalid_grant" }, 400)],
			["not JSON", () => new Response("<html></html>")],
			["no id token", () => jsonAnswer({ access_token: "made up" })],
			["id token not text", () => jsonAnswer({ id_token: 7 })],
			["id token null", () => jsonAnswer({ id_token: null })],
			["a list", () => jsonAnswer([good])],
			["null", () => jsonAnswer(null)],
			["not a token", () => jsonAnswer({ id_token: "not-a-token" })],
			["claims that are not claims", () => jsonAnswer({ id_token: "a.b.c" })],
		] as const) {
			const world = makeWorld();
			world.on(GOOGLE_TOKEN_URL, answer);
			const { location, cookies } = await begin(world);
			const end = await finish(
				world,
				world.google.approve(location, ADMIN),
				cookies,
			);
			expect(loginError(end), label).toBe("failed");
			expect(cookieNamed(end, SESSION_COOKIE), label).toBeUndefined();
			expect(world.callsTo(IDP_URL), label).toEqual([]);
			expect(world.callsTo(API), label).toEqual([]);
			expect(outcomes(world), label).toEqual(["failed"]);
		}
	});

	it("a token that is not what this attempt asked for never reaches Firebase", async () => {
		for (const [label, change] of [
			["wrong audience", { aud: "another-client.apps.example.test" }],
			["audience list without us", { aud: ["a", "b"] }],
			["no audience", { aud: undefined }],
			["audience as a number", { aud: 7 }],
			["wrong issuer", { iss: "https://accounts.example.test" }],
			[
				"issuer that only starts right",
				{ iss: "https://accounts.google.com.evil.example.test" },
			],
			[
				"Firebase as issuer",
				{ iss: "https://securetoken.google.com/fake-project" },
			],
			["no issuer", { iss: undefined }],
			["wrong nonce", { nonce: "n".repeat(43) }],
			["no nonce", { nonce: undefined }],
			["empty nonce", { nonce: "" }],
			["expired", { exp: 1_000_000_000 }],
			["no expiry", { exp: undefined }],
			["expiry as text", { exp: "9999999999" }],
			["e-mail not verified", { email_verified: false }],
			["e-mail verified as text", { email_verified: "true" }],
			["no word on the e-mail", { email_verified: undefined }],
		] as const) {
			const world = makeWorld();
			const run = await signInWithGoogle(world, ADMIN, { change });
			expect(loginError(run.end), label).toBe("failed");
			expect(inJar(run.cookies, SESSION_COOKIE), label).toBeNull();
			// Google did answer with a token; it went no further.
			expect(world.google.issued, label).toHaveLength(1);
			expect(world.callsTo(IDP_URL), label).toEqual([]);
			expect(world.callsTo(API), label).toEqual([]);
			expect(outcomes(world), label).toEqual(["failed"]);
		}
	});

	it("a token that expires this very second is expired", async () => {
		const world = makeWorld();
		const expired = await signInWithGoogle(world, ADMIN, {
			change: { exp: world.nowS() },
		});
		expect(loginError(expired.end)).toBe("failed");
		const valid = await signInWithGoogle(makeWorld(), ADMIN, {
			change: { exp: world.nowS() + 1 },
		});
		expect(valid.end.headers.get("location")).toBe("/");
	});

	it("a token in either spelling Google uses for itself is accepted", async () => {
		for (const change of [
			{ iss: "accounts.google.com" },
			{ aud: [GOOGLE_CLIENT, "another-client"] },
		]) {
			const run = await signInWithGoogle(makeWorld(), ADMIN, { change });
			expect(run.end.headers.get("location")).toBe("/");
		}
	});
});

describe("isExpectedGoogleToken", () => {
	const NOW = 1_800_000_000;
	const token = (change: Record<string, unknown> = {}) =>
		fakeIdToken({
			iss: "https://accounts.google.com",
			aud: GOOGLE_CLIENT,
			exp: NOW + 3600,
			nonce: "the-nonce",
			email_verified: true,
			...change,
		});
	const expected = (idToken: string, clientId = GOOGLE_CLIENT) =>
		isExpectedGoogleToken(idToken, clientId, "the-nonce", NOW);

	it("is true for a token made for this client and this attempt", () => {
		expect(expected(token())).toBe(true);
	});

	it("is false when any one thing is off", () => {
		for (const change of [
			{ aud: "other" },
			{ aud: `${GOOGLE_CLIENT}.evil` },
			{ aud: [] },
			{ aud: { [GOOGLE_CLIENT]: true } },
			{ iss: "accounts.google.com.evil.example.test" },
			{ iss: ["https://accounts.google.com"] },
			{ exp: NOW },
			{ exp: NOW - 1 },
			{ exp: String(NOW + 3600) },
			{ nonce: "the-nonce " },
			{ nonce: "THE-NONCE" },
			{ nonce: ["the-nonce"] },
			{ email_verified: 1 },
			{ email_verified: "true" },
			{ email_verified: null },
		]) {
			expect(expected(token(change)), JSON.stringify(change)).toBe(false);
		}
	});

	it("is false for anything that is not a token", () => {
		for (const text of [
			"",
			"garbage",
			"a.b.c",
			"..",
			`${token()}`.split(".")[0],
		]) {
			expect(expected(String(text)), String(text)).toBe(false);
		}
	});

	it("is false while no client is configured, whatever the token says", () => {
		expect(expected(token({ aud: "" }), "")).toBe(false);
		expect(expected(token({ aud: [""] }), "")).toBe(false);
	});
});

describe("Cloudflare's request id in the sign-in lines", () => {
	const RAY = { "cf-ray": "8f0a1b2c3d4e5f60-WAW" };

	it("is on the line of a sign-in, however it ends", async () => {
		const ended = async (person: typeof ADMIN) => {
			const world = makeWorld();
			const { location, cookies } = await begin(world);
			const back = world.google.approve(location, person);
			await world.send(fromGoogle(back, { cookies, headers: RAY }));
			return world.logs;
		};
		expect(await ended(ADMIN)).toEqual([
			{
				event: "signIn",
				outcome: "admin",
				uid: ADMIN.uid,
				ray: "8f0a1b2c3d4e5f60-WAW",
			},
		]);
		expect(await ended(STRANGER)).toEqual([
			{
				event: "signIn",
				outcome: "forbidden",
				uid: STRANGER.uid,
				ray: "8f0a1b2c3d4e5f60-WAW",
			},
		]);
	});

	it("is on the line of every refusal under /auth", async () => {
		const world = makeWorld();
		for (const [request, line] of [
			[
				navigation("/auth/google/start", { site: "cross-site", headers: RAY }),
				{ route: "/auth/google/start", reason: "foreign" },
			],
			[
				fromGoogle(`${CALLBACK}?state=made-up&code=made-up`, { headers: RAY }),
				{ route: "/auth/google/callback", reason: "noAttempt" },
			],
			[
				bare("/auth/session", { headers: RAY }),
				{ route: "/auth", reason: "foreign" },
			],
			[
				fromPanel("/auth/anything", { headers: RAY }),
				{ route: "/auth", reason: "notFound" },
			],
		] as const) {
			world.forget();
			await world.send(request);
			expect(world.logs).toEqual([
				{ event: "refused", ...line, ray: "8f0a1b2c3d4e5f60-WAW" },
			]);
		}
	});
});

// ─── Firebase and the backend say no ────────────────────────────────────────

describe("GET /auth/google/callback: Firebase refuses", () => {
	it("ends with the reason, without asking the backend and without a session", async () => {
		for (const [label, answer, reason] of [
			["disabled", () => firebaseError("USER_DISABLED"), "disabled"],
			[
				"too many attempts",
				() => firebaseError("TOO_MANY_ATTEMPTS_TRY_LATER"),
				"tooManyAttempts",
			],
			[
				"Google sign-in switched off",
				() => firebaseError("OPERATION_NOT_ALLOWED"),
				"misconfigured",
			],
			["token refused", () => firebaseError("INVALID_IDP_RESPONSE"), "failed"],
			["failing", () => firebaseError("INTERNAL", 500), "unavailable"],
			[
				"down",
				() => {
					throw new TypeError("fetch failed");
				},
				"unavailable",
			],
			[
				"asks to confirm the account",
				() => jsonAnswer({ needConfirmation: true }),
				"failed",
			],
			[
				"wants a second factor of its own",
				() => jsonAnswer({ mfaPendingCredential: "pending" }),
				"failed",
			],
		] as const) {
			const world = makeWorld();
			world.firebase.answer = answer;
			const run = await signInWithGoogle(world, ADMIN);
			expect(loginError(run.end), label).toBe(reason);
			expect(run.cookies, label).toBe("");
			expect(clears(run.end, ATTEMPT_COOKIE), label).toBe(true);
			expect(world.callsTo(API), label).toEqual([]);
			expect(world.logs, label).toEqual([
				{ event: "signIn", outcome: reason, uid: null, ray: null },
			]);
		}
	});
});

describe("GET /auth/google/callback: the backend refuses", () => {
	const refusedBy = async (prepare: (world: World) => void) => {
		const world = makeWorld();
		prepare(world);
		const run = await signInWithGoogle(world, ADMIN);
		return { world, run, reason: loginError(run.end) };
	};

	it("someone who is not on the list gets no session cookie", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		expect(loginError(run.end)).toBe("forbidden");
		expect(cookieNamed(run.end, SESSION_COOKIE)).toBeUndefined();
		expect(inJar(run.cookies, SESSION_COOKIE)).toBeNull();
		expect(world.backend.sessions.size).toBe(0);
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"NOT_PANEL_ADMIN",
		]);
		// Their own user id is in the line: a refused sign-in is worth an alert,
		// and whoever keeps the list can see who it was.
		expect(world.logs).toEqual([
			{ event: "signIn", outcome: "forbidden", uid: STRANGER.uid, ray: null },
		]);
	});

	it("and a sealed note of their own user id, for ten minutes", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		expect(setCookies(run.end).map((cookie) => cookie.name)).toEqual([
			ATTEMPT_COOKIE,
			REFUSED_COOKIE,
		]);
		const note = cookieNamed(run.end, REFUSED_COOKIE);
		expect(note?.raw).toBe(
			`${REFUSED_COOKIE}=${note?.value}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict`,
		);
		expect(note?.value).not.toContain(STRANGER.uid);
		expect(await opened(REFUSED_COOKIE, note?.value ?? "")).toEqual({
			v: 1,
			uid: STRANGER.uid,
			exp: world.nowS() + 600,
		});
	});

	it("the refusal page can then show them that user id", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		world.forget();
		const response = await world.send(
			fromPanel("/auth/session", { cookies: run.cookies }),
		);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			methods: ["google"],
			refusedUid: STRANGER.uid,
		});
		// Read from the cookie: nobody is asked.
		expect(world.calls).toEqual([]);
	});

	it("the user id is shown until the ten minutes are over, the next attempt, or a sign-out", async () => {
		const shown = async (world: World, cookies: string) =>
			(await bodyOf(await world.send(fromPanel("/auth/session", { cookies }))))
				.refusedUid;

		const timed = makeWorld();
		const first = await signInWithGoogle(timed, STRANGER);
		timed.advance(599);
		expect(await shown(timed, first.cookies)).toBe(STRANGER.uid);
		timed.advance(1);
		expect(await shown(timed, first.cookies)).toBeUndefined();

		const retried = makeWorld();
		const second = await signInWithGoogle(retried, STRANGER);
		const again = await begin(retried);
		expect(await shown(retried, jar(second.cookies, again.start))).toBe(
			undefined,
		);

		const left = makeWorld();
		const third = await signInWithGoogle(left, STRANGER);
		const out = await left.send(
			fromPanel("/auth/signout", { method: "POST", cookies: third.cookies }),
		);
		expect(clears(out, REFUSED_COOKIE)).toBe(true);
		expect(await shown(left, jar(third.cookies, out))).toBeUndefined();
	});

	it("a refusal note opens nothing: it is not a session", async () => {
		const world = makeWorld();
		const run = await signInWithGoogle(world, STRANGER);
		const note = inJar(run.cookies, REFUSED_COOKIE) ?? "";
		for (const cookies of [
			run.cookies,
			// The note's value passed off as the session.
			`${SESSION_COOKIE}=${note}`,
		]) {
			const response = await world.send(
				fromPanel("/api/manageUsers", { cookies }),
			);
			expect(response.status).toBe(401);
			expect(world.backend.accepted).toEqual([]);
		}
	});

	it("a refusal note of another key, shape or age shows nothing", async () => {
		const world = makeWorld();
		const good = { v: 1, uid: "uid-made-up", exp: world.nowS() + 600 };
		const shown = async (value: string) =>
			(
				await bodyOf(
					await world.send(
						fromPanel("/auth/session", {
							cookies: `${REFUSED_COOKIE}=${value}`,
						}),
					),
				)
			).refusedUid;
		expect(await shown(await sealed(REFUSED_COOKIE, good))).toBe("uid-made-up");
		for (const value of [
			await sealed(REFUSED_COOKIE, good, randomKey()),
			await sealed(ATTEMPT_COOKIE, good),
			await sealed(REFUSED_COOKIE, { ...good, v: 2 }),
			await sealed(REFUSED_COOKIE, { ...good, uid: 7 }),
			await sealed(REFUSED_COOKIE, { ...good, exp: world.nowS() }),
			await sealed(REFUSED_COOKIE, { ...good, exp: "later" }),
			await sealed(REFUSED_COOKIE, { v: 1, uid: "uid-made-up" }),
			await sealed(REFUSED_COOKIE, null),
			await sealed(REFUSED_COOKIE, "uid-made-up"),
			btoa(JSON.stringify(good)),
			"uid-made-up",
		]) {
			expect(await shown(value)).toBeUndefined();
		}
	});

	it("there is no note when the backend names no user id", async () => {
		const { run, reason } = await refusedBy((world) =>
			world.on(`${API}/api/panel/session`, () =>
				backendError(403, "NOT_PANEL_ADMIN"),
			),
		);
		expect(reason).toBe("forbidden");
		expect(setCookies(run.end).map((cookie) => cookie.name)).toEqual([
			ATTEMPT_COOKIE,
		]);
		expect(run.cookies).toBe("");
	});

	it("the log line of a refused person names nobody when the backend named nobody", async () => {
		const { world } = await refusedBy((prepared) =>
			prepared.on(`${API}/api/panel/session`, () =>
				backendError(403, "NOT_PANEL_ADMIN"),
			),
		);
		expect(world.logs).toEqual([
			{ event: "signIn", outcome: "forbidden", uid: null, ray: null },
		]);
	});

	it("any other refusal ends as failed, with no cookie at all", async () => {
		for (const [status, code] of [
			[401, "TOKEN_INVALID"],
			[401, "SIGN_IN_TOO_OLD"],
			[403, "WRONG_SIGN_IN_METHOD"],
			[403, "SOMETHING_NEW"],
			[404, "SOMETHING_NEW"],
		] as const) {
			const { world, run, reason } = await refusedBy((prepared) =>
				prepared.on(`${API}/api/panel/session`, () =>
					backendError(status, code),
				),
			);
			expect(reason, code).toBe("failed");
			expect(run.cookies, code).toBe("");
			expect(world.logs, code).toEqual([
				{ event: "signIn", outcome: "failed", uid: null, ray: null },
			]);
		}
	});

	it("the backend refusing the Worker itself ends as misconfigured, and is logged as that", async () => {
		for (const prepare of [
			(world: World) => {
				world.backend.signingKey = "another made up secret, also long enough";
			},
			(world: World) => {
				world.backend.configured = false;
			},
		]) {
			const { world, run, reason } = await refusedBy(prepare);
			expect(reason).toBe("misconfigured");
			expect(run.cookies).toBe("");
			expect(world.backend.sessions.size).toBe(0);
			expect(world.logs).toEqual([
				{ event: "backendRefusedWorker", route: "/auth/google/callback" },
				{ event: "signIn", outcome: "misconfigured", uid: null, ray: null },
			]);
		}
	});

	it("the backend being down or failing ends as unavailable", async () => {
		for (const prepare of [
			(world: World) => {
				world.backend.down = true;
			},
			(world: World) => {
				world.on(
					`${API}/api/panel/session`,
					() => new Response("oops", { status: 500 }),
				);
			},
			// a backend deployed without the panel's routes: the host's own 404, no panel code
			(world: World) => {
				world.on(
					`${API}/api/panel/session`,
					() => new Response("", { status: 404 }),
				);
			},
		]) {
			const { world, run, reason } = await refusedBy(prepare);
			expect(reason).toBe("unavailable");
			expect(run.cookies).toBe("");
			expect(world.logs).toEqual([
				{ event: "signIn", outcome: "unavailable", uid: null, ray: null },
			]);
		}
	});

	it("a session value with characters that do not belong in a cookie is not set", async () => {
		for (const session of [
			"value; Domain=example.test",
			"value\r\nSet-Cookie: __Host-cf_session=other",
			"two words",
			"value,other=1",
			'"quoted"',
			"zażółć",
		]) {
			const { run, reason } = await refusedBy((world) =>
				world.on(`${API}/api/panel/session`, () =>
					jsonAnswer({
						session,
						expiresInSeconds: SESSION_S,
						user: { uid: ADMIN.uid, email: ADMIN.email, name: ADMIN.name },
					}),
				),
			);
			expect(reason, session).toBe("unavailable");
			expect(run.cookies, session).toBe("");
			expect(
				setCookies(run.end).map((cookie) => cookie.name),
				session,
			).toEqual([ATTEMPT_COOKIE]);
		}
	});
});

// ─── Who is signed in ───────────────────────────────────────────────────────

describe("GET /auth/session", () => {
	it("never names the Worker's settings once sign-in works, also when something else is missing", async () => {
		for (const world of [
			makeWorld(),
			makeWorld({ MEDIA_ORIGINS: undefined }),
		]) {
			const body = (await bodyOf(
				await world.send(fromPanel("/auth/session")),
			)) as Record<string, unknown>;
			expect(body.methods).toEqual(["google"]);
			expect("missing" in body).toBe(false);
		}
	});

	it("names what is missing while sign-in is not set up", async () => {
		const world = makeWorld({
			GOOGLE_CLIENT_ID: undefined,
			MEDIA_ORIGINS: undefined,
		});
		expect(await bodyOf(await world.send(fromPanel("/auth/session")))).toEqual({
			status: "signedOut",
			methods: [],
			missing: ["MEDIA_ORIGINS", "GOOGLE_CLIENT_ID"],
		});
	});

	it("signed out: says so and names the ways in, asking nobody", async () => {
		const world = makeWorld();
		const response = await world.send(fromPanel("/auth/session"));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			methods: ["google"],
		});
		expect(setCookies(response)).toEqual([]);
		expect(world.calls).toEqual([]);
		expect(world.logs).toEqual([]);
	});

	it("admin: says who, as the backend says", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const response = await world.send(fromPanel("/auth/session", { cookies }));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			status: "admin",
			user: { uid: ADMIN.uid, email: ADMIN.email, displayName: ADMIN.name },
			methods: ["google"],
		});
		expect(setCookies(response)).toEqual([]);
		expect(world.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/api/panel/me`,
		]);
		expect(world.backend.accepted).toHaveLength(1);
	});

	it("admin: the answer holds neither the session nor anything else to sign in with", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const response = await world.send(fromPanel("/auth/session", { cookies }));
		const text = await visibleText(response);
		expect(text).not.toContain(sessionOf(cookies));
		expect(Object.keys(await bodyOf(response)).sort()).toEqual([
			"methods",
			"status",
			"user",
		]);
	});

	it("the backend asks itself every time: the Worker remembers nobody", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (let i = 0; i < 3; i++) {
			await world.send(fromPanel("/auth/session", { cookies }));
		}
		expect(world.callsTo(`${API}/api/panel/me`)).toHaveLength(3);
	});

	it("the backend says the session is over: signed out, and the cookie is cleared", async () => {
		const prepared: [string, (world: World) => void][] = [
			["taken off the list", (world) => world.backend.admins.delete(ADMIN.uid)],
			["48 hours later", (world) => world.advance(SESSION_S)],
			["ended at the backend", (world) => world.backend.sessions.clear()],
		];
		for (const [label, change] of prepared) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			change(world);
			const response = await world.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect(response.status, label).toBe(200);
			expect(await bodyOf(response), label).toEqual({
				status: "signedOut",
				methods: ["google"],
			});
			expect(
				setCookies(response).map((cookie) => cookie.raw),
				label,
			).toEqual([
				`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
			]);
		}
	});

	it("a session cookie nobody issued is cleared the same way", async () => {
		const world = makeWorld();
		const response = await world.send(
			fromPanel("/auth/session", {
				cookies: `${SESSION_COOKIE}=${fakeIdToken({ sub: ADMIN.uid })}`,
			}),
		);
		expect(await bodyOf(response)).toMatchObject({ status: "signedOut" });
		expect(clears(response, SESSION_COOKIE)).toBe(true);
	});

	it("the backend is down: 503, and the cookie is kept", async () => {
		const prepared: [string, (world: World) => void][] = [
			[
				"down",
				(world) => {
					world.backend.down = true;
				},
			],
			[
				"failing",
				(world) =>
					world.on(`${API}/`, () => new Response("oops", { status: 500 })),
			],
			[
				"answering nonsense",
				(world) => world.on(`${API}/`, () => jsonAnswer({ hello: "there" })),
			],
		];
		for (const [label, change] of prepared) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			change(world);
			const response = await world.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect(response.status, label).toBe(503);
			expect((await bodyOf(response)).errorCode, label).toBe(
				"AUTH_UNAVAILABLE",
			);
			expect(setCookies(response), label).toEqual([]);
		}
	});

	it("a bare 401 or 403 from the host signs nobody out: 503, and the cookie is kept", async () => {
		// Not the backend's guard speaking: the host or a gateway in front of
		// it. Taking that for "the session is over" would sign every admin
		// out for a fault.
		for (const answer of [
			() => new Response(null, { status: 401 }),
			() => new Response("Unauthorized", { status: 401 }),
			() => new Response("<html>403 Forbidden</html>", { status: 403 }),
			() => jsonAnswer({ message: "Access denied" }, 403),
			() => backendError(401, "SOMETHING_NEW"),
		]) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			world.on(`${API}/api/panel/me`, answer);
			const response = await world.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect(response.status).toBe(503);
			expect((await bodyOf(response)).errorCode).toBe("AUTH_UNAVAILABLE");
			expect(setCookies(response)).toEqual([]);
			// The session itself is untouched at the backend.
			expect(world.backend.sessions.has(sessionOf(cookies))).toBe(true);
		}
	});

	it("and when the backend is back the same cookie still works", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.backend.down = true;
		await world.send(fromPanel("/auth/session", { cookies }));
		world.backend.down = false;
		const response = await world.send(fromPanel("/auth/session", { cookies }));
		expect(await bodyOf(response)).toMatchObject({ status: "admin" });
	});

	it("the backend refuses the Worker: 503, the cookie is kept, and it is logged", async () => {
		const prepared: [string, (world: World) => void][] = [
			[
				"another secret",
				(world) => {
					world.backend.signingKey = "another made up secret, also long enough";
				},
			],
			[
				"no secret",
				(world) => {
					world.backend.configured = false;
				},
			],
		];
		for (const [label, change] of prepared) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			change(world);
			const response = await world.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect(response.status, label).toBe(503);
			expect((await bodyOf(response)).errorCode, label).toBe(
				"AUTH_MISCONFIGURED",
			);
			expect(setCookies(response), label).toEqual([]);
			expect(world.logs, label).toEqual([
				{ event: "backendRefusedWorker", route: "/auth/session" },
			]);
		}
	});

	it("a cookie left from before a setting was taken away is cleared, asking nobody", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const name of [
			"GOOGLE_CLIENT_SECRET",
			"API_ORIGIN",
			"PANEL_SIGNING_SECRET",
		] as const) {
			const unset = makeWorld({ [name]: undefined });
			const response = await unset.send(
				fromPanel("/auth/session", { cookies }),
			);
			expect(await bodyOf(response), name).toEqual({
				status: "signedOut",
				methods: [],
				// while sign-in is not set up, the page is told what is left to set
				missing: [name],
			});
			expect(clears(response, SESSION_COOKIE), name).toBe(true);
			expect(unset.calls, name).toEqual([]);
		}
	});

	it("names no way in while the cookie key is not a key", async () => {
		const world = makeWorld({ SIGN_IN_COOKIE_KEY: "change-me" });
		const response = await world.send(fromPanel("/auth/session"));
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			methods: [],
			missing: ["SIGN_IN_COOKIE_KEY"],
		});
	});

	it("an empty session cookie is no session", async () => {
		const world = makeWorld();
		const response = await world.send(
			fromPanel("/auth/session", { cookies: `${SESSION_COOKIE}=` }),
		);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			methods: ["google"],
		});
		expect(world.calls).toEqual([]);
	});

	it("is answered to the panel's own page only", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const [label, request] of [
			["no panel header", bare("/auth/session", { cookies })],
			[
				"another site",
				fromPanel("/auth/session", {
					cookies,
					headers: { "sec-fetch-site": "cross-site" },
				}),
			],
			[
				"a sibling site",
				fromPanel("/auth/session", {
					cookies,
					headers: { "sec-fetch-site": "same-site" },
				}),
			],
			[
				"another origin",
				fromPanel("/auth/session", {
					cookies,
					headers: { origin: "https://evil.example.test" },
				}),
			],
			["typed into the address bar", navigation("/auth/session", { cookies })],
		] as const) {
			world.forget();
			const response = await world.send(request);
			expect(response.status, label).toBe(403);
			expect((await bodyOf(response)).errorCode, label).toBe("FOREIGN_REQUEST");
			expect(world.calls, label).toEqual([]);
			expect(world.logs, label).toEqual([
				// The address is not written down: it is the caller's to choose.
				{ event: "refused", route: "/auth", reason: "foreign", ray: null },
			]);
		}
	});
});

// ─── Signing out ────────────────────────────────────────────────────────────

describe("POST /auth/signout", () => {
	const signOut = (world: World, cookies: string) =>
		world.send(fromPanel("/auth/signout", { method: "POST", cookies }));

	it("tells the backend and clears every cookie of the panel", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const response = await signOut(world, cookies);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			ended: true,
		});
		expect(setCookies(response).map((cookie) => cookie.raw)).toEqual([
			`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
			`${ATTEMPT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
			`${REFUSED_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
		]);
		expect(jar(cookies, response)).toBe("");

		expect(world.calls).toHaveLength(1);
		const call = world.calls[0] as Call;
		expect(`${call.method} ${call.url}`).toBe(`POST ${API}/api/panel/signOut`);
		expect(call.headers.get("x-panel-session")).toBe(sessionOf(cookies));
		expect(world.backend.accepted).toEqual([call]);
		expect(world.logs).toEqual([{ event: "signOut", ended: true }]);
	});

	it("really ends the session: the old cookie, kept by hand, opens nothing afterwards", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		await signOut(world, cookies);
		world.forget();

		const status = await world.send(fromPanel("/auth/session", { cookies }));
		expect(await bodyOf(status)).toMatchObject({ status: "signedOut" });
		const data = await world.send(fromPanel("/api/manageUsers", { cookies }));
		expect(data.status).toBe(401);
		expect(world.backend.accepted).toEqual([]);
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"SESSION_INVALID",
			"SESSION_INVALID",
		]);
	});

	it("clears the cookies even when the backend is down, and says the session was not ended", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		world.backend.down = true;
		const response = await signOut(world, cookies);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			ended: false,
		});
		expect(jar(cookies, response)).toBe("");
		expect(clears(response, SESSION_COOKIE)).toBe(true);
		expect(world.logs).toEqual([{ event: "signOut", ended: false }]);
	});

	it("clears the cookies whatever the backend answers", async () => {
		const prepared: [string, (world: World) => void][] = [
			[
				"refuses the Worker",
				(world) => {
					world.backend.signingKey = "another made up secret, also long enough";
				},
			],
			["does not know the session", (world) => world.backend.sessions.clear()],
			[
				"fails",
				(world) =>
					world.on(`${API}/`, () => new Response("oops", { status: 500 })),
			],
			[
				"redirects",
				(world) =>
					world.on(
						`${API}/`,
						() =>
							new Response(null, {
								status: 302,
								headers: { location: "https://elsewhere.example.test/" },
							}),
					),
			],
		];
		for (const [label, change] of prepared) {
			const world = makeWorld();
			const cookies = await signedIn(world);
			change(world);
			const response = await signOut(world, cookies);
			expect(await bodyOf(response), label).toEqual({
				status: "signedOut",
				ended: false,
			});
			expect(jar(cookies, response), label).toBe("");
			expect(world.calls, label).toHaveLength(1);
		}
	});

	it("without a session there is nothing to tell the backend", async () => {
		const world = makeWorld();
		const response = await signOut(world, "");
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			ended: true,
		});
		expect(setCookies(response)).toHaveLength(3);
		expect(world.calls).toEqual([]);
	});

	it("while the backend is not configured it still clears the cookies", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const unset = makeWorld({ PANEL_SIGNING_SECRET: undefined });
		const response = await signOut(unset, cookies);
		expect(await bodyOf(response)).toEqual({
			status: "signedOut",
			ended: false,
		});
		expect(jar(cookies, response)).toBe("");
		expect(unset.calls).toEqual([]);
	});

	it("cannot be caused by another site: nothing is cleared and the backend is not told", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const [label, request] of [
			[
				"a form on another site",
				bare("/auth/signout", { method: "POST", cookies }),
			],
			[
				"a script on another site",
				fromPanel("/auth/signout", {
					method: "POST",
					cookies,
					headers: {
						"sec-fetch-site": "cross-site",
						origin: "https://evil.example.test",
					},
				}),
			],
			[
				"no word from the browser",
				fromPanel("/auth/signout", {
					method: "POST",
					cookies,
					headers: { "sec-fetch-site": null },
				}),
			],
			[
				"no panel header",
				fromPanel("/auth/signout", {
					method: "POST",
					cookies,
					headers: { "x-cf-panel": null },
				}),
			],
		] as const) {
			world.forget();
			const response = await world.send(request);
			expect(response.status, label).toBe(403);
			expect(setCookies(response), label).toEqual([]);
			expect(world.calls, label).toEqual([]);
			expect(world.logs, label).toEqual([
				{ event: "refused", route: "/auth", reason: "foreign", ray: null },
			]);
		}
		// Still signed in.
		const status = await world.send(fromPanel("/auth/session", { cookies }));
		expect(await bodyOf(status)).toMatchObject({ status: "admin" });
	});

	it("is a POST and nothing else", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const method of ["GET", "PUT", "DELETE"]) {
			const response = await world.send(
				fromPanel("/auth/signout", { method, cookies }),
			);
			expect(response.status, method).toBe(404);
			expect(setCookies(response), method).toEqual([]);
		}
		expect(world.calls).toEqual([]);
	});
});

// ─── What is not there ──────────────────────────────────────────────────────

describe("everything else under /auth", () => {
	it("is 404 for the panel's own page and reaches nothing", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		for (const [method, path] of [
			// The ways in that were removed with the rebuild.
			["POST", "/auth/password"],
			["POST", "/auth/apple"],
			["POST", "/auth/apple/callback"],
			["GET", "/auth/apple/start"],
			["POST", "/auth/refresh"],
			["POST", "/auth/session"],
			["DELETE", "/auth/session"],
			["GET", "/auth/google"],
			["GET", "/auth/google/"],
			["GET", "/auth/google/start/"],
			["GET", "/auth/google/callback/x"],
			["GET", "/auth/Session"],
			["GET", "/auth/session/"],
			["GET", "/auth/"],
			["GET", "/auth/me"],
			["POST", "/auth/signOut"],
		] as const) {
			const response = await world.send(fromPanel(path, { method, cookies }));
			expect(response.status, `${method} ${path}`).toBe(404);
			expect((await bodyOf(response)).errorCode, `${method} ${path}`).toBe(
				"NOT_FOUND",
			);
			expect(setCookies(response), `${method} ${path}`).toEqual([]);
		}
		expect(world.calls).toEqual([]);
	});

	it("is logged as not found, without the address that was asked for", async () => {
		const world = makeWorld();
		for (const [method, path] of [
			["POST", "/auth/password"],
			["GET", "/auth/made-up-address?made-up=query"],
			["DELETE", "/auth/session"],
		] as const) {
			world.forget();
			await world.send(fromPanel(path, { method }));
			expect(world.logs, path).toEqual([
				{ event: "refused", route: "/auth", reason: "notFound", ray: null },
			]);
		}
	});

	it("is 403 for anyone else", async () => {
		const world = makeWorld();
		for (const path of ["/auth/password", "/auth/anything", "/auth/"]) {
			const response = await world.send(bare(path, { method: "POST" }));
			expect(response.status, path).toBe(403);
		}
		expect(world.calls).toEqual([]);
	});
});

describe("while the panel's own address is not set", () => {
	const unset = (request: Request, world = makeWorld()) =>
		handleAuth(request, world.env, world.deps, null);

	it("the sign-in page is told there is no way in, whoever asks and whatever they hold", async () => {
		for (const request of [
			bare("/auth/session"),
			fromPanel("/auth/session"),
			fromPanel("/auth/session", { cookies: `${SESSION_COOKIE}=made-up` }),
		]) {
			const world = makeWorld();
			const response = await unset(request, world);
			expect(response.status).toBe(200);
			expect(await bodyOf(response)).toEqual({
				status: "signedOut",
				methods: [],
			});
			expect(world.calls).toEqual([]);
		}
	});

	it("everything else is 503", async () => {
		for (const request of [
			navigation("/auth/google/start"),
			fromGoogle(`${CALLBACK}?state=x&code=y`),
			fromPanel("/auth/signout", { method: "POST" }),
			fromPanel("/auth/session", { method: "POST" }),
			fromPanel("/auth/anything"),
		]) {
			const world = makeWorld();
			const response = await unset(request, world);
			expect(response.status).toBe(503);
			expect((await bodyOf(response)).errorCode).toBe("NOT_CONFIGURED");
			expect(setCookies(response)).toEqual([]);
			expect(world.calls).toEqual([]);
		}
	});
});
