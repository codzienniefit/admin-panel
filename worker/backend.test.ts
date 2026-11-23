import { describe, expect, it } from "vitest";
import {
	callBackend,
	canonicalQuery,
	endSession,
	errorCodeOf,
	MAX_SESSION_S,
	PANEL_PREFIX,
	SIGNING,
	signingText,
	startSession,
	whoAmI,
} from "./backend";
import { hmacSha256Hex } from "./codec";
import {
	ADMIN,
	API,
	backendError,
	type Call,
	expectedSignature,
	fakeIdToken,
	jsonAnswer,
	makeWorld,
	SESSION_S,
	SIGNING_SECRET,
	STRANGER,
	sessionOf,
	sha256HexOf,
	signedIn,
	type World,
} from "./testSupport";

/** The one call a test expects to have gone out. */
/** A text as the bytes it is sent as. */
function bufferOf(text: string): ArrayBuffer {
	const bytes = new TextEncoder().encode(text);
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function only(world: World): Call {
	expect(world.calls).toHaveLength(1);
	return world.calls[0] as Call;
}

/** A Firebase id token the fake backend will accept, as if just signed in. */
function freshFirebaseToken(world: World, uid: string): string {
	const token = fakeIdToken({
		sub: uid,
		user_id: uid,
		auth_time: world.nowS(),
		firebase: { sign_in_provider: "google.com" },
	});
	world.firebase.issued.push(token);
	return token;
}

describe("the names both sides agree on", () => {
	it("are the backend's", () => {
		expect(PANEL_PREFIX).toBe("/api/panel");
		expect(SIGNING).toEqual({
			timestamp: "x-panel-timestamp",
			signature: "x-panel-signature",
			session: "x-panel-session",
			version: "v1",
		});
		expect(MAX_SESSION_S).toBe(48 * 60 * 60);
	});
});

describe("canonicalQuery", () => {
	const canonical = (query: string) =>
		canonicalQuery(new URLSearchParams(query));

	it("is empty for no parameters", () => {
		expect(canonical("")).toBe("");
		expect(canonicalQuery(new URLSearchParams())).toBe("");
	});

	it("is the same whatever the order", () => {
		expect(canonical("query=ada&limit=20")).toBe("limit=20&query=ada");
		expect(canonical("limit=20&query=ada")).toBe("limit=20&query=ada");
		expect(canonical("c=3&a=1&b=2")).toBe("a=1&b=2&c=3");
	});

	it("is the same whatever the encoding", () => {
		for (const query of [
			"query=ada+l",
			"query=ada%20l",
			"query=ada l",
			"%71uery=%61da%20l",
		]) {
			expect(canonical(query), query).toBe("query=ada%20l");
		}
		expect(canonical("q=%C5%BCaneta")).toBe(canonical("q=żaneta"));
		expect(canonical("q=żaneta")).toBe("q=%C5%BCaneta");
	});

	it("encodes what would change the meaning of the query", () => {
		expect(canonical("q=a%26b%3Dc")).toBe("q=a%26b%3Dc");
		expect(canonical("q=a%2Bb")).toBe("q=a%2Bb");
		expect(canonical("q=50%25")).toBe("q=50%25");
		expect(canonical("a%3Db=1")).toBe("a%3Db=1");
		expect(canonical("q=a/b?c#d".replace("#", "%23"))).toBe("q=a%2Fb%3Fc%23d");
	});

	it("keeps a repeated name and an empty value", () => {
		expect(canonical("tag=b&tag=a&empty=")).toBe("empty=&tag=a&tag=b");
		expect(canonical("flag")).toBe("flag=");
	});
});

describe("the signature", () => {
	// The same example is in the backend's
	// tests/services/panelAccessService.test.ts. If either side changes what
	// it signs, one of the two tests fails; change neither alone.
	const EXAMPLE_KEY = "panel-signing-secret-for-tests-0123456789";
	const EXAMPLE_BODY = '{"name":"Zażółć"}';
	const EXAMPLE =
		"v1=3771e9dabb9462beb6c51218e9422b0cf060b8d84854c18fd3b91073f1616b89";
	/** SHA-256 of nothing at all. */
	const EMPTY =
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

	it("matches the example shared with the backend", async () => {
		const url = new URL(
			"https://backend.example/api/panel/manageUsers?query=ada+l&limit=20",
		);
		const query = canonicalQuery(url.searchParams);
		expect(query).toBe("limit=20&query=ada%20l");
		const text = await signingText(
			"1800000000",
			"POST",
			url.pathname,
			query,
			EXAMPLE_BODY,
			"firebase-session-cookie",
		);
		expect(`v1=${await hmacSha256Hex(EXAMPLE_KEY, text)}`).toBe(EXAMPLE);
	});

	it("is the same for the body as text and as its UTF-8 bytes", async () => {
		// The Worker signs the bytes it read from the browser; the backend
		// hashes the bytes it received. Text is hashed as UTF-8.
		const bytes = bufferOf(EXAMPLE_BODY);
		// Four of its letters are two bytes each.
		expect(bytes.byteLength).toBe(EXAMPLE_BODY.length + 4);
		const text = await signingText(
			"1800000000",
			"POST",
			"/api/panel/manageUsers",
			"limit=20&query=ada%20l",
			bytes,
			"firebase-session-cookie",
		);
		expect(`v1=${await hmacSha256Hex(EXAMPLE_KEY, text)}`).toBe(EXAMPLE);
	});

	it("is what callBackend sends for the same call", async () => {
		for (const body of [EXAMPLE_BODY, bufferOf(EXAMPLE_BODY)]) {
			const world = makeWorld({ PANEL_SIGNING_SECRET: EXAMPLE_KEY });
			world.setNowS(1800000000);
			world.on(`${API}/`, () => jsonAnswer({}));
			await callBackend(world.env, world.deps, {
				method: "POST",
				path: "/api/panel/manageUsers",
				query: new URLSearchParams("query=ada+l&limit=20"),
				credential: "firebase-session-cookie",
				body,
			});
			const call = only(world);
			expect(call.url).toBe(
				`${API}/api/panel/manageUsers?limit=20&query=ada%20l`,
			);
			expect(call.body).toBe(EXAMPLE_BODY);
			expect(call.headers.get("x-panel-timestamp")).toBe("1800000000");
			expect(call.headers.get("x-panel-signature")).toBe(EXAMPLE);
			expect(call.headers.get("x-panel-session")).toBe(
				"firebase-session-cookie",
			);
		}
	});

	it("signs these seven lines and nothing else", async () => {
		expect(
			await signingText(
				"1800000000",
				"post",
				"/api/panel/x",
				"a=1",
				"the body",
				"cred",
			),
		).toBe(
			[
				"v1",
				"1800000000",
				"POST",
				"/api/panel/x",
				"a=1",
				await sha256HexOf("the body"),
				await sha256HexOf("cred"),
			].join("\n"),
		);
	});

	it("signs the hash of the empty string when there is no body", async () => {
		const lines = (
			await signingText("1800000000", "GET", "/api/panel/x", "", "", "cred")
		).split("\n");
		expect(lines).toHaveLength(7);
		expect(lines[5]).toBe(EMPTY);
		expect(
			await signingText(
				"1800000000",
				"GET",
				"/api/panel/x",
				"",
				new ArrayBuffer(0),
				"cred",
			),
		).toBe(lines.join("\n"));
	});

	it("keeps the body and the credential apart", async () => {
		// Two hashes on two lines: what is in one cannot be passed off as
		// being in the other.
		expect(
			await signingText("1", "POST", "/api/panel/x", "", "one", "two"),
		).not.toBe(
			await signingText("1", "POST", "/api/panel/x", "", "two", "one"),
		);
		expect(
			await signingText("1", "POST", "/api/panel/x", "", "", "onetwo"),
		).not.toBe(
			await signingText("1", "POST", "/api/panel/x", "", "one", "two"),
		);
	});

	it("never contains the body or the credential themselves", async () => {
		const text = await signingText(
			"1800000000",
			"POST",
			"/api/panel/x",
			"",
			"the-body-itself",
			"the-credential-itself",
		);
		expect(text).not.toContain("the-body-itself");
		expect(text).not.toContain("the-credential-itself");
	});

	it("changes with each thing that is signed", async () => {
		const sign = async (
			timestamp: string,
			method: string,
			path: string,
			query: string,
			body: string,
			credential: string,
			key = EXAMPLE_KEY,
		) =>
			hmacSha256Hex(
				key,
				await signingText(timestamp, method, path, query, body, credential),
			);
		const base = await sign(
			"1800000000",
			"PUT",
			"/api/panel/x",
			"a=1",
			"b",
			"s",
		);
		const changed = await Promise.all([
			sign("1800000001", "PUT", "/api/panel/x", "a=1", "b", "s"),
			sign("1800000000", "POST", "/api/panel/x", "a=1", "b", "s"),
			sign("1800000000", "PUT", "/api/panel/y", "a=1", "b", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "a=2", "b", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "", "b", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "a=1", "B", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "a=1", "b ", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "a=1", "", "s"),
			sign("1800000000", "PUT", "/api/panel/x", "a=1", "b", "t"),
			sign(
				"1800000000",
				"PUT",
				"/api/panel/x",
				"a=1",
				"b",
				"s",
				`${EXAMPLE_KEY}x`,
			),
		]);
		expect(new Set([base, ...changed]).size).toBe(11);
		// And not with the case of the method, which is signed in capitals.
		expect(
			await sign("1800000000", "put", "/api/panel/x", "a=1", "b", "s"),
		).toBe(base);
	});
});

describe("callBackend", () => {
	const call = (
		world: World,
		extra: Partial<Parameters<typeof callBackend>[2]>,
	) =>
		callBackend(world.env, world.deps, {
			method: "GET",
			path: "/api/panel/manageUsers",
			credential: "made-up-session",
			...extra,
		});

	it("sends the call to the backend's address with the time, the signature and the session", async () => {
		const world = makeWorld();
		world.on(`${API}/`, () => jsonAnswer({ ok: true }));
		const response = await call(world, {});
		expect(response).toBeInstanceOf(Response);
		const sent = only(world);
		expect(sent.url).toBe(`${API}/api/panel/manageUsers`);
		expect(sent.method).toBe("GET");
		expect(sent.body).toBeNull();
		expect(Object.fromEntries(sent.headers)).toEqual({
			"x-panel-timestamp": String(world.nowS()),
			"x-panel-signature": await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"GET",
				sent.url,
				"made-up-session",
			),
			"x-panel-session": "made-up-session",
		});
	});

	it("never follows a redirect", async () => {
		const world = makeWorld();
		world.on(
			`${API}/`,
			() =>
				new Response(null, {
					status: 307,
					headers: { location: "https://elsewhere.example.test/api/panel/x" },
				}),
		);
		const response = await call(world, { method: "POST", body: "{}" });
		// The redirect itself comes back; nothing went to where it points.
		expect((response as Response).status).toBe(307);
		expect(only(world).redirect).toBe("manual");
		expect(world.callsTo("https://elsewhere.example.test")).toEqual([]);
	});

	it("sends the query in its canonical spelling, whatever it was given", async () => {
		const sentFor = async (query: string) => {
			const world = makeWorld();
			world.on(`${API}/`, () => jsonAnswer({}));
			await call(world, { query: new URLSearchParams(query) });
			const sent = only(world);
			return `${sent.url} ${sent.headers.get("x-panel-signature")}`;
		};
		const first = await sentFor("query=ada+l&limit=20");
		expect(first).toContain("/api/panel/manageUsers?limit=20&query=ada%20l ");
		for (const query of [
			"limit=20&query=ada%20l",
			"limit=20&query=ada l",
			"query=ada%20l&limit=20",
			"%6Cimit=20&query=%61da+l",
		]) {
			expect(await sentFor(query), query).toBe(first);
		}
		expect(await sentFor("query=ada+l&limit=21")).not.toBe(first);
	});

	it("sends no `?` when there is no query", async () => {
		const world = makeWorld();
		world.on(`${API}/`, () => jsonAnswer({}));
		await call(world, { query: new URLSearchParams() });
		expect(only(world).url).toBe(`${API}/api/panel/manageUsers`);
	});

	it("is accepted by the backend's own check, query and all", async () => {
		const world = makeWorld();
		const cookies = await signedIn(world);
		const session = sessionOf(cookies);
		const response = await call(world, {
			credential: session,
			query: new URLSearchParams("query=ż & co/+1&limit=20&tag=b&tag=a"),
		});
		expect((response as Response).status).toBe(200);
		expect(world.backend.refused).toEqual([]);
		expect(world.backend.accepted).toHaveLength(1);
	});

	it("is refused by the backend when the time has moved more than a minute", async () => {
		// The signature is good for the moment it was made, not for later.
		const world = makeWorld();
		const cookies = await signedIn(world);
		const session = sessionOf(cookies);
		const frozen = { ...world.deps, now: () => (world.nowS() - 120) * 1000 };
		const late = await callBackend(world.env, frozen, {
			method: "GET",
			path: "/api/panel/me",
			credential: session,
		});
		expect(await errorCodeOf(late as Response)).toBe("BAD_SIGNATURE");
	});

	it("sends the caller's headers and body, and its own signing headers over any the caller set", async () => {
		const world = makeWorld();
		world.on(`${API}/`, () => jsonAnswer({}));
		await call(world, {
			method: "POST",
			headers: new Headers({
				"content-type": "application/json",
				"if-match": 'W/"3"',
				"x-panel-session": "someone-else",
				"x-panel-signature": "v1=forged",
				"x-panel-timestamp": "1",
			}),
			body: '{"a":1}',
		});
		const sent = only(world);
		expect(sent.method).toBe("POST");
		expect(sent.body).toBe('{"a":1}');
		expect(sent.headers.get("content-type")).toBe("application/json");
		expect(sent.headers.get("if-match")).toBe('W/"3"');
		expect(sent.headers.get("x-panel-session")).toBe("made-up-session");
		expect(sent.headers.get("x-panel-timestamp")).toBe(String(world.nowS()));
		expect(sent.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"POST",
				sent.url,
				"made-up-session",
				'{"a":1}',
			),
		);
	});

	it("leaves the session header out when a session is being started", async () => {
		const world = makeWorld();
		world.on(`${API}/`, () => jsonAnswer({}));
		await call(world, {
			method: "POST",
			path: "/api/panel/session",
			credential: "a-firebase-token",
			sendSession: false,
			body: "{}",
		});
		const sent = only(world);
		expect(sent.headers.has("x-panel-session")).toBe(false);
		// The token is still what the signature is made over.
		expect(sent.headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"POST",
				sent.url,
				"a-firebase-token",
				"{}",
			),
		);
	});

	it("sends nothing while the backend's address or the secret is missing", async () => {
		for (const overrides of [
			{ API_ORIGIN: undefined },
			{ API_ORIGIN: "" },
			{ API_ORIGIN: "api.example.test" },
			{ API_ORIGIN: "http://api.example.test" },
			{ API_ORIGIN: "https://api.example.test/api" },
			{ PANEL_SIGNING_SECRET: undefined },
			{ PANEL_SIGNING_SECRET: "" },
			{ PANEL_SIGNING_SECRET: "   " },
			{ PANEL_SIGNING_SECRET: "x".repeat(31) },
			{ PANEL_SIGNING_SECRET: `  ${"x".repeat(31)}  ` },
		]) {
			const world = makeWorld(overrides);
			expect(await call(world, {}), JSON.stringify(overrides)).toBe(
				"notConfigured",
			);
			expect(world.calls, JSON.stringify(overrides)).toEqual([]);
		}
	});

	it("signs with a secret of exactly 32 characters", async () => {
		const world = makeWorld({ PANEL_SIGNING_SECRET: "x".repeat(32) });
		world.on(`${API}/`, () => jsonAnswer({}));
		await call(world, {});
		expect(only(world).headers.get("x-panel-signature")).toBe(
			await expectedSignature(
				"x".repeat(32),
				String(world.nowS()),
				"GET",
				`${API}/api/panel/manageUsers`,
				"made-up-session",
			),
		);
	});

	it("says so when the backend cannot be reached", async () => {
		const world = makeWorld();
		world.backend.down = true;
		expect(await call(world, {})).toBe("unreachable");
		expect(world.calls).toHaveLength(1);
	});

	it("returns the backend's answer as it is, whatever the status", async () => {
		for (const status of [200, 204, 401, 403, 404, 500, 503]) {
			const world = makeWorld();
			world.on(`${API}/`, () => new Response(null, { status }));
			const response = await call(world, {});
			expect((response as Response).status).toBe(status);
		}
	});
});

describe("the body is part of what is signed", () => {
	/** A world with an admin's session, to make calls the backend lets in. */
	async function withSession(): Promise<{ world: World; session: string }> {
		const world = makeWorld();
		return { world, session: sessionOf(await signedIn(world)) };
	}

	const signatureOf = async (
		body: string | ArrayBuffer | null | undefined,
		method = "POST",
	) => {
		const world = makeWorld();
		world.on(`${API}/`, () => jsonAnswer({}));
		await callBackend(world.env, world.deps, {
			method,
			path: "/api/panel/manageChallenges",
			credential: "made-up-session",
			body,
		});
		return only(world).headers.get("x-panel-signature");
	};

	/** The backend's own answer to what it would expect for these bytes. */
	const expectedFor = (
		world: World,
		body: string | Uint8Array | null,
		method = "POST",
	) =>
		expectedSignature(
			SIGNING_SECRET,
			String(world.nowS()),
			method,
			`${API}/api/panel/manageChallenges`,
			"made-up-session",
			body,
		);

	it("a GET signs the hash of the empty string", async () => {
		const world = makeWorld();
		const signature = await signatureOf(undefined, "GET");
		expect(signature).toBe(await expectedFor(world, null, "GET"));
		expect(signature).toBe(await expectedFor(world, "", "GET"));
		expect(signature).toBe(await expectedFor(world, new Uint8Array(0), "GET"));
		expect(signature).not.toBe(await expectedFor(world, "{}", "GET"));
	});

	it("no body, a null body and an empty one are signed alike", async () => {
		const none = await signatureOf(undefined);
		expect(await signatureOf(null)).toBe(none);
		expect(await signatureOf("")).toBe(none);
		expect(await signatureOf(new ArrayBuffer(0))).toBe(none);
		expect(none).toBe(await expectedFor(makeWorld(), null));
	});

	it("a body is signed as the exact bytes that are sent", async () => {
		const binary = new ArrayBuffer(256);
		new Uint8Array(binary).set(Uint8Array.from({ length: 256 }, (_, i) => i));
		for (const body of [
			'{"a":1}',
			'{"a": 1}',
			'{"name":"Zażółć gęślą jaźń"}',
			"line\r\nbreaks and a tab\t",
			bufferOf('{"name":"Zażółć gęślą jaźń"}'),
			binary,
		]) {
			const world = makeWorld();
			world.on(`${API}/`, () => jsonAnswer({}));
			await callBackend(world.env, world.deps, {
				method: "POST",
				path: "/api/panel/manageChallenges",
				credential: "made-up-session",
				body,
			});
			const sent = only(world);
			expect(sent.raw).toEqual(
				new Uint8Array(typeof body === "string" ? bufferOf(body) : body),
			);
			expect(sent.headers.get("x-panel-signature")).toBe(
				await expectedFor(world, sent.raw),
			);
		}
		// One space more is another signature.
		expect(await signatureOf('{"a":1}')).not.toBe(
			await signatureOf('{"a": 1}'),
		);
	});

	it("the backend lets in a call whose body is the one that was signed", async () => {
		const { world, session } = await withSession();
		for (const body of [
			'{"title":"[TEST] Zażółć"}',
			bufferOf("\u0000\u0001\u00ff"),
		]) {
			const response = await callBackend(world.env, world.deps, {
				method: "POST",
				path: "/api/panel/manageChallenges",
				credential: session,
				body,
			});
			expect((response as Response).status).toBe(200);
		}
		expect(world.backend.refused).toEqual([]);
		expect(world.backend.accepted).toHaveLength(2);
	});

	// Someone who captured one signed call sends it again, as it is but for
	// the body. Without the body in the signature the backend took it.
	const captured = async (body: string | null, method = "POST") => {
		const { world, session } = await withSession();
		await callBackend(world.env, world.deps, {
			method,
			path: "/api/panel/manageChallenges",
			query: new URLSearchParams("dryRun=false"),
			credential: session,
			headers: new Headers({ "content-type": "application/json" }),
			body,
		});
		const call = only(world);
		expect(world.backend.accepted).toEqual([call]);
		world.forget();
		const replay = async (other: BodyInit | null) => {
			const response = await world.deps.fetch(call.url, {
				method: call.method,
				headers: call.headers,
				body: other ?? undefined,
				redirect: "manual",
			});
			return { status: response.status, code: await errorCodeOf(response) };
		};
		return { world, replay };
	};
	const REFUSED = { status: 401, code: "BAD_SIGNATURE" };
	const ORIGINAL = '{"audience":"one","text":"[TEST] made up"}';

	it("the backend refuses a captured call sent again with another body", async () => {
		const { world, replay } = await captured(ORIGINAL);
		for (const other of [
			'{"audience":"all","text":"[TEST] made up"}',
			`${ORIGINAL} `,
			` ${ORIGINAL}`,
			ORIGINAL.replace("one", "onE"),
			ORIGINAL.slice(0, -1),
			`${ORIGINAL}${ORIGINAL}`,
			"{}",
			bufferOf(ORIGINAL).slice(1),
		]) {
			expect(await replay(other)).toEqual(REFUSED);
		}
		expect(world.backend.accepted).toEqual([]);
		expect(world.backend.refused).toHaveLength(8);
	});

	it("the backend refuses a captured call sent again without its body", async () => {
		const { world, replay } = await captured(ORIGINAL);
		expect(await replay(null)).toEqual(REFUSED);
		expect(await replay("")).toEqual(REFUSED);
		expect(world.backend.accepted).toEqual([]);
	});

	it("the backend refuses a body added to a call that was signed without one", async () => {
		for (const method of ["POST", "PUT", "DELETE"]) {
			const { world, replay } = await captured(null, method);
			expect(await replay(ORIGINAL), method).toEqual(REFUSED);
			expect(await replay("{}"), method).toEqual(REFUSED);
			expect(await replay(" "), method).toEqual(REFUSED);
			expect(world.backend.accepted, method).toEqual([]);
		}
	});

	it("the same bytes again are the same call: that much a capture is still good for, for a minute", async () => {
		// The signature has no one-time part. What bounds a replay of the
		// very same call is the timestamp, and the backend's own second step
		// on the two dangerous actions (rule 18).
		const { world, replay } = await captured(ORIGINAL);
		expect(await replay(ORIGINAL)).toEqual({ status: 200, code: null });
		expect(await replay(bufferOf(ORIGINAL))).toEqual({
			status: 200,
			code: null,
		});
		world.advance(61);
		expect(await replay(ORIGINAL)).toEqual(REFUSED);
	});

	it("a signed sign-out cannot be given a body, nor a session start another token", async () => {
		const { world, session } = await withSession();
		await endSession(world.env, world.deps, session);
		const signOut = only(world);
		const withBody = await world.deps.fetch(signOut.url, {
			method: "POST",
			headers: signOut.headers,
			body: '{"everyone":true}',
		});
		expect(await errorCodeOf(withBody)).toBe("BAD_SIGNATURE");

		const other = makeWorld();
		const token = freshFirebaseToken(other, ADMIN.uid);
		const second = freshFirebaseToken(other, STRANGER.uid);
		await startSession(other.env, other.deps, token);
		const start = only(other);
		const swapped = await other.deps.fetch(start.url, {
			method: "POST",
			headers: start.headers,
			body: JSON.stringify({ idToken: second }),
		});
		expect(await errorCodeOf(swapped)).toBe("BAD_SIGNATURE");
		// The same token in a body spelled another way is refused as well.
		const respelled = await other.deps.fetch(start.url, {
			method: "POST",
			headers: start.headers,
			body: JSON.stringify({ idToken: token, extra: true }),
		});
		expect(await errorCodeOf(respelled)).toBe("BAD_SIGNATURE");
	});
});

describe("errorCodeOf", () => {
	it("reads the error code of a backend answer and leaves the body readable", async () => {
		const response = backendError(403, "NOT_PANEL_ADMIN");
		expect(await errorCodeOf(response)).toBe("NOT_PANEL_ADMIN");
		expect(await response.json()).toMatchObject({
			errorCode: "NOT_PANEL_ADMIN",
		});
	});

	it("is null when there is none to read", async () => {
		for (const response of [
			new Response(null, { status: 401 }),
			new Response("not json", { status: 401 }),
			new Response("<html>Bad gateway</html>", { status: 502 }),
			jsonAnswer(null, 401),
			jsonAnswer("BAD_SIGNATURE", 401),
			jsonAnswer(["BAD_SIGNATURE"], 401),
			jsonAnswer({ error: "no code" }, 401),
			jsonAnswer({ errorCode: 7 }, 401),
			jsonAnswer({ errorCode: null }, 401),
			jsonAnswer({ errorCode: { code: "BAD_SIGNATURE" } }, 401),
		]) {
			expect(await errorCodeOf(response)).toBeNull();
		}
	});
});

describe("startSession", () => {
	it("hands the Firebase token to the backend, signed, and returns the session", async () => {
		const world = makeWorld();
		const token = freshFirebaseToken(world, ADMIN.uid);
		const started = await startSession(world.env, world.deps, token);
		expect(started).toEqual({
			ok: true,
			session: expect.stringMatching(/^[A-Za-z0-9._-]+$/),
			maxAge: SESSION_S,
			user: { uid: ADMIN.uid, email: ADMIN.email, displayName: ADMIN.name },
		});
		const sent = only(world);
		expect(sent.url).toBe(`${API}/api/panel/session`);
		expect(sent.method).toBe("POST");
		expect(sent.redirect).toBe("manual");
		expect(sent.headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(sent.body ?? "")).toEqual({ idToken: token });
		// In the body only: the session header is for sessions.
		expect(sent.headers.has("x-panel-session")).toBe(false);
		expect(world.backend.refused).toEqual([]);
		expect(world.backend.accepted).toEqual([sent]);
	});

	it("signs the JSON body it sends, with the token as the credential", async () => {
		const world = makeWorld();
		const token = freshFirebaseToken(world, ADMIN.uid);
		await startSession(world.env, world.deps, token);
		const sent = only(world);
		expect(sent.body).toBe(JSON.stringify({ idToken: token }));
		const signature = sent.headers.get("x-panel-signature");
		const expected = (body: string | null, credential: string) =>
			expectedSignature(
				SIGNING_SECRET,
				String(world.nowS()),
				"POST",
				sent.url,
				credential,
				body,
			);
		expect(signature).toBe(await expected(sent.body, token));
		// Not the token alone, and not the body alone.
		expect(signature).not.toBe(await expected(null, token));
		expect(signature).not.toBe(await expected(sent.body, ""));
	});

	const answered = async (response: () => Response) => {
		const world = makeWorld();
		world.on(`${API}/api/panel/session`, response);
		return startSession(world.env, world.deps, "a-firebase-token");
	};
	const good = (change: Record<string, unknown> = {}) =>
		jsonAnswer({
			session: "made.up-session_1",
			expiresInSeconds: SESSION_S,
			user: { uid: "uid-1", email: "ada@example.test", name: "Ada" },
			...change,
		});

	it("keeps the lifetime the backend states, up to 48 hours", async () => {
		for (const [stated, kept] of [
			[SESSION_S, SESSION_S],
			[3600, 3600],
			[1, 1],
			[SESSION_S + 1, SESSION_S],
			[30 * 24 * 3600, SESSION_S],
			[Number.MAX_SAFE_INTEGER, SESSION_S],
			["7200", 7200],
			// Nothing usable stated: the session's own limit.
			[undefined, SESSION_S],
			[null, SESSION_S],
			[0, SESSION_S],
			[-60, SESSION_S],
			["soon", SESSION_S],
			[{}, SESSION_S],
		] as const) {
			const started = await answered(() => good({ expiresInSeconds: stated }));
			expect(started, String(stated)).toMatchObject({ ok: true, maxAge: kept });
		}
	});

	it("names the person by name, else by e-mail, else as an administrator", async () => {
		const userOf = async (user: unknown) => {
			const started = await answered(() => good({ user }));
			return started.ok ? started.user : null;
		};
		expect(
			await userOf({ uid: "u", email: "a@example.test", name: "" }),
		).toEqual({
			uid: "u",
			email: "a@example.test",
			displayName: "a@example.test",
		});
		expect(await userOf({ uid: "u", email: null, name: null })).toEqual({
			uid: "u",
			email: null,
			displayName: "Administrator",
		});
		expect(await userOf({ uid: "u", email: "", name: 7 })).toEqual({
			uid: "u",
			email: null,
			displayName: "Administrator",
		});
	});

	it("refuses a session value with characters that do not belong in a cookie", async () => {
		for (const session of [
			"a b",
			"a;b",
			"a; Domain=example.test",
			"a,b",
			"a=b",
			'a"b',
			"a\\b",
			"a\r\nSet-Cookie: x=1",
			"a\nb",
			"a\u0000b",
			"zażółć",
			"a%3Bb",
			"a/b+c==",
			" a",
		]) {
			const started = await answered(() => good({ session }));
			expect(started, JSON.stringify(session)).toEqual({
				ok: false,
				reason: "unavailable",
			});
		}
	});

	it("counts an answer without a session or a person as no answer", async () => {
		for (const response of [
			() => good({ session: "" }),
			() => good({ session: undefined }),
			() => good({ session: 7 }),
			() => good({ session: ["made-up"] }),
			() => good({ user: undefined }),
			() => good({ user: null }),
			() => good({ user: "uid-1" }),
			() => good({ user: {} }),
			() => good({ user: { uid: "" } }),
			() => good({ user: { uid: 7 } }),
			() => jsonAnswer([]),
			() => jsonAnswer(null),
			() => new Response("not json", { status: 200 }),
			() => new Response(null, { status: 204 }),
		]) {
			expect(await answered(response)).toEqual({
				ok: false,
				reason: "unavailable",
			});
		}
	});

	it("says who it was when the backend's list does not have them", async () => {
		const world = makeWorld();
		const token = freshFirebaseToken(world, STRANGER.uid);
		expect(await startSession(world.env, world.deps, token)).toEqual({
			ok: false,
			reason: "notAdmin",
			uid: STRANGER.uid,
		});
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"NOT_PANEL_ADMIN",
		]);
		// Without a user id in the answer there is none to show.
		expect(await answered(() => backendError(403, "NOT_PANEL_ADMIN"))).toEqual({
			ok: false,
			reason: "notAdmin",
			uid: null,
		});
		expect(
			await answered(() => backendError(403, "NOT_PANEL_ADMIN", { uid: 7 })),
		).toEqual({ ok: false, reason: "notAdmin", uid: null });
	});

	it("is refused for a token Firebase did not issue", async () => {
		const world = makeWorld();
		const forged = fakeIdToken({ sub: ADMIN.uid, auth_time: world.nowS() });
		expect(await startSession(world.env, world.deps, forged)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"TOKEN_INVALID",
		]);
	});

	it("is refused for a sign-in older than five minutes", async () => {
		const world = makeWorld();
		const token = freshFirebaseToken(world, ADMIN.uid);
		world.advance(5 * 60 + 1);
		expect(await startSession(world.env, world.deps, token)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"SIGN_IN_TOO_OLD",
		]);
	});

	it("sorts every other refusal of the backend", async () => {
		for (const [status, code, reason] of [
			[401, "TOKEN_INVALID", "refused"],
			[401, "SIGN_IN_TOO_OLD", "refused"],
			[403, "WRONG_SIGN_IN_METHOD", "refused"],
			[401, "SESSION_INVALID", "refused"],
			[400, "SOMETHING_NEW", "refused"],
			[401, "BAD_SIGNATURE", "misconfigured"],
			[503, "PANEL_NOT_CONFIGURED", "misconfigured"],
			[500, "SOMETHING_NEW", "unavailable"],
			[503, "SOMETHING_NEW", "unavailable"],
		] as const) {
			expect(
				await answered(() => backendError(status, code)),
				`${status} ${code}`,
			).toEqual({ ok: false, reason });
		}
		for (const [status, reason] of [
			[400, "refused"],
			[401, "refused"],
			[403, "refused"],
			[404, "refused"],
			[429, "refused"],
			[500, "unavailable"],
			[502, "unavailable"],
		] as const) {
			expect(
				await answered(() => new Response("<html></html>", { status })),
				String(status),
			).toEqual({ ok: false, reason });
		}
	});

	it("does not follow a redirect to a session somewhere else", async () => {
		const world = makeWorld();
		world.on(
			`${API}/api/panel/session`,
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "https://elsewhere.example.test/session" },
				}),
		);
		expect(
			await startSession(world.env, world.deps, "a-firebase-token"),
		).toEqual({ ok: false, reason: "refused" });
		expect(world.calls).toHaveLength(1);
	});

	it("is misconfigured when the backend's secret is another one, or it has none", async () => {
		const world = makeWorld();
		const token = freshFirebaseToken(world, ADMIN.uid);
		world.backend.signingKey = "another made up secret, also long enough";
		expect(await startSession(world.env, world.deps, token)).toEqual({
			ok: false,
			reason: "misconfigured",
		});
		world.backend.signingKey = SIGNING_SECRET;
		world.backend.configured = false;
		expect(await startSession(world.env, world.deps, token)).toEqual({
			ok: false,
			reason: "misconfigured",
		});
	});

	it("is misconfigured, and sends the token nowhere, without an address or a secret", async () => {
		for (const overrides of [
			{ API_ORIGIN: undefined },
			{ PANEL_SIGNING_SECRET: undefined },
			{ PANEL_SIGNING_SECRET: "too short" },
		]) {
			const world = makeWorld(overrides);
			expect(
				await startSession(world.env, world.deps, "a-firebase-token"),
			).toEqual({ ok: false, reason: "misconfigured" });
			expect(world.calls).toEqual([]);
		}
	});

	it("is unavailable when the backend is down", async () => {
		const world = makeWorld();
		world.backend.down = true;
		expect(
			await startSession(world.env, world.deps, "a-firebase-token"),
		).toEqual({ ok: false, reason: "unavailable" });
	});
});

describe("whoAmI", () => {
	it("asks the backend, signed, with the session in its header", async () => {
		const world = makeWorld();
		const session = sessionOf(await signedIn(world));
		expect(await whoAmI(world.env, world.deps, session)).toEqual({
			ok: true,
			user: { uid: ADMIN.uid, email: ADMIN.email, displayName: ADMIN.name },
		});
		const sent = only(world);
		expect(sent.url).toBe(`${API}/api/panel/me`);
		expect(sent.method).toBe("GET");
		expect(sent.body).toBeNull();
		expect(sent.redirect).toBe("manual");
		expect(sent.headers.get("x-panel-session")).toBe(session);
		expect(world.backend.accepted).toEqual([sent]);
	});

	it("is signed out for a session the backend does not know", async () => {
		const world = makeWorld();
		expect(await whoAmI(world.env, world.deps, "made-up-session")).toEqual({
			ok: false,
			reason: "signedOut",
		});
		expect(world.backend.refused.map((entry) => entry.code)).toEqual([
			"SESSION_INVALID",
		]);
	});

	it("is signed out once the person is off the list, and once the 48 hours are over", async () => {
		const world = makeWorld();
		const session = sessionOf(await signedIn(world));
		world.advance(SESSION_S - 1);
		expect(await whoAmI(world.env, world.deps, session)).toMatchObject({
			ok: true,
		});
		world.advance(1);
		expect(await whoAmI(world.env, world.deps, session)).toEqual({
			ok: false,
			reason: "signedOut",
		});

		const other = makeWorld();
		const kept = sessionOf(await signedIn(other));
		other.backend.admins.delete(ADMIN.uid);
		expect(await whoAmI(other.env, other.deps, kept)).toEqual({
			ok: false,
			reason: "signedOut",
		});
		expect(other.backend.refused.map((entry) => entry.code)).toEqual([
			"NOT_PANEL_ADMIN",
		]);
	});

	const answered = async (response: () => Response) => {
		const world = makeWorld();
		world.on(`${API}/api/panel/me`, response);
		return whoAmI(world.env, world.deps, "made-up-session");
	};

	it("sorts every answer of the backend", async () => {
		for (const [status, code, reason] of [
			[401, "SESSION_INVALID", "signedOut"],
			[403, "NOT_PANEL_ADMIN", "signedOut"],
			[403, "WRONG_SIGN_IN_METHOD", "signedOut"],
			// The code decides, whatever status it came with.
			[503, "SESSION_INVALID", "signedOut"],
			[401, "BAD_SIGNATURE", "misconfigured"],
			[503, "PANEL_NOT_CONFIGURED", "misconfigured"],
			[500, "SOMETHING_NEW", "unavailable"],
			[503, "SOMETHING_NEW", "unavailable"],
			[404, "SOMETHING_NEW", "unavailable"],
			[429, "SOMETHING_NEW", "unavailable"],
			// A refusal that is not the guard's verdict on this session.
			[401, "SOMETHING_NEW", "unavailable"],
			[403, "SOMETHING_NEW", "unavailable"],
			[401, "TOKEN_INVALID", "unavailable"],
			[401, "SIGN_IN_TOO_OLD", "unavailable"],
			[401, "session_invalid", "unavailable"],
		] as const) {
			expect(
				await answered(() => backendError(status, code)),
				`${status} ${code}`,
			).toEqual({ ok: false, reason });
		}
	});

	it("does not take a bare 401 or 403 for the backend's word: it is trouble, not a sign-out", async () => {
		// The host or a gateway in between can answer 401 or 403 itself (a
		// function registered with a key by mistake, a firewall rule). Only
		// the backend's own guard can say a session is over.
		for (const answer of [
			() => new Response(null, { status: 401 }),
			() => new Response(null, { status: 403 }),
			() => new Response("Unauthorized", { status: 401 }),
			() => new Response("<html>403 Forbidden</html>", { status: 403 }),
			() => jsonAnswer({ message: "Access denied" }, 403),
			() => jsonAnswer({ error: "no code" }, 401),
			() => jsonAnswer({ errorCode: 7 }, 401),
			() => jsonAnswer({ errorCode: ["SESSION_INVALID"] }, 401),
			() => jsonAnswer(["SESSION_INVALID"], 401),
			() => jsonAnswer("SESSION_INVALID", 401),
			() =>
				new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				}),
		]) {
			expect(await answered(answer)).toEqual({
				ok: false,
				reason: "unavailable",
			});
		}
	});

	it("counts every other failure as trouble too", async () => {
		for (const status of [302, 304, 404, 429, 500, 502]) {
			expect(
				await answered(() => new Response(null, { status })),
				String(status),
			).toEqual({ ok: false, reason: "unavailable" });
		}
	});

	it("counts an answer without a user id as no answer", async () => {
		for (const body of [{}, { uid: "" }, { uid: 7 }, [], null, "uid-1"]) {
			expect(await answered(() => jsonAnswer(body))).toEqual({
				ok: false,
				reason: "unavailable",
			});
		}
		expect(await answered(() => new Response("not json"))).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});

	it("is unavailable when the backend is down, misconfigured when it cannot be asked", async () => {
		const down = makeWorld();
		down.backend.down = true;
		expect(await whoAmI(down.env, down.deps, "made-up-session")).toEqual({
			ok: false,
			reason: "unavailable",
		});
		const unset = makeWorld({ PANEL_SIGNING_SECRET: undefined });
		expect(await whoAmI(unset.env, unset.deps, "made-up-session")).toEqual({
			ok: false,
			reason: "misconfigured",
		});
		expect(unset.calls).toEqual([]);
	});
});

describe("endSession", () => {
	it("tells the backend, signed, and the session is over there", async () => {
		const world = makeWorld();
		const session = sessionOf(await signedIn(world));
		expect(await endSession(world.env, world.deps, session)).toBe(true);
		const sent = only(world);
		expect(sent.url).toBe(`${API}/api/panel/signOut`);
		expect(sent.method).toBe("POST");
		expect(sent.headers.get("x-panel-session")).toBe(session);
		expect(world.backend.accepted).toEqual([sent]);
		expect(await whoAmI(world.env, world.deps, session)).toEqual({
			ok: false,
			reason: "signedOut",
		});
	});

	it("is false whenever the backend did not end it", async () => {
		const unknown = makeWorld();
		expect(await endSession(unknown.env, unknown.deps, "made-up-session")).toBe(
			false,
		);

		const down = makeWorld();
		down.backend.down = true;
		expect(await endSession(down.env, down.deps, "made-up-session")).toBe(
			false,
		);

		const unset = makeWorld({ API_ORIGIN: undefined });
		expect(await endSession(unset.env, unset.deps, "made-up-session")).toBe(
			false,
		);
		expect(unset.calls).toEqual([]);

		const failing = makeWorld();
		failing.on(`${API}/`, () => new Response(null, { status: 500 }));
		expect(await endSession(failing.env, failing.deps, "made-up-session")).toBe(
			false,
		);
	});
});
