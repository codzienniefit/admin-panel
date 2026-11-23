import type { Deps, LogEntry, PanelEnv } from "./env";
import { PANEL_HEADER } from "./http";
import { handle } from "./index";

// What the Worker's tests share: a made-up world. Every outbound request goes
// to a fake `fetch` that records it and answers as Google, Firebase, the
// backend or the media store would; time is a number the test sets; random
// bytes come from a fixed sequence; log lines are kept in a list. Nothing
// here is, or looks like, a real secret, and nothing reaches the network.
//
// The fakes are written from the contracts (Google's and Firebase's
// documented answers, the backend's PanelAccessService), not from the
// Worker's code: the backend's signature check below is its own
// implementation, so a mistake in the Worker's signing does not hide.

export const ORIGIN = "https://panel.example.test";
export const API = "https://api.example.test";
export const MEDIA = "https://files.example.test";
export const FIREBASE_KEY = "fake-firebase-web-key";
export const GOOGLE_CLIENT = "fake-google-client.apps.example.test";
// Made-up values with spaces in them: no real key or password looks like these.
export const GOOGLE_SECRET = "made up google secret";
export const SIGNING_SECRET = "made up signing secret, long enough to count";

export const GOOGLE_AUTHORIZE_URL =
	"https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const IDP_URL =
	"https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp";

export const SESSION_COOKIE = "__Host-cf_session";
export const ATTEMPT_COOKIE = "__Host-cf_oauth";
export const REFUSED_COOKIE = "__Host-cf_refused";

export const HOUR_S = 60 * 60;
export const SESSION_S = 48 * HOUR_S;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ─── Bytes and hashes, independent of worker/codec.ts ───────────────────────

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

const hex = (buffer: ArrayBuffer) =>
	[...new Uint8Array(buffer)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

export const sha256HexOf = async (data: string | Uint8Array): Promise<string> =>
	hex(
		await crypto.subtle.digest(
			"SHA-256",
			typeof data === "string" ? encoder.encode(data) : data,
		),
	);

export const pkceChallengeOf = async (verifier: string): Promise<string> =>
	base64Url(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
		),
	);

export async function hmacHexOf(key: string, text: string): Promise<string> {
	const imported = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return hex(await crypto.subtle.sign("HMAC", imported, encoder.encode(text)));
}

/** The query as the backend spells it before checking a signature. */
export const backendCanonicalQuery = (params: URLSearchParams): string =>
	[...params.entries()]
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.sort()
		.join("&");

/**
 * The signature the backend expects on a call, by its own rule: seven lines,
 * the body's hash among them. `body` is what was received, as text or as
 * bytes; none is the empty string.
 */
export async function expectedSignature(
	key: string,
	timestamp: string,
	method: string,
	url: string,
	credential: string,
	body: string | Uint8Array | null = null,
): Promise<string> {
	const parsed = new URL(url);
	const text = [
		"v1",
		timestamp,
		method.toUpperCase(),
		parsed.pathname,
		backendCanonicalQuery(parsed.searchParams),
		await sha256HexOf(body ?? ""),
		await sha256HexOf(credential),
	].join("\n");
	return `v1=${await hmacHexOf(key, text)}`;
}

/** A fresh AES key for one test: 32 random bytes, base64. */
export const randomKey = (): string =>
	btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

/** The same 32 bytes every time (0, 1, 2 …): plainly not a real key. */
export const COUNTING_KEY = btoa(
	String.fromCharCode(...Uint8Array.from({ length: 32 }, (_, i) => i)),
);

const segment = (value: unknown) =>
	base64Url(encoder.encode(JSON.stringify(value)));

/** Shaped like an id token or a session cookie; the signature is plain text. */
export const fakeIdToken = (claims: Record<string, unknown>): string =>
	`${segment({ alg: "RS256", typ: "JWT" })}.${segment(claims)}.fake-signature`;

/** The claims of a fake token; {} for anything else. */
export function claimsOf(token: string): Record<string, unknown> {
	try {
		const part = (token.split(".")[1] ?? "")
			.replace(/-/g, "+")
			.replace(/_/g, "/");
		const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
		const claims: unknown = JSON.parse(decoder.decode(bytes));
		return typeof claims === "object" && claims !== null
			? (claims as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

// ─── People ─────────────────────────────────────────────────────────────────

export interface Person {
	/** Firebase user id. */
	uid: string;
	/** The person's id at Google. */
	googleSub: string;
	email: string;
	name: string;
}

/** On the backend's list. */
export const ADMIN: Person = {
	uid: "uid-admin-0001",
	googleSub: "google-sub-1001",
	email: "ada.admin@example.test",
	name: "Ada Admin",
};
/** Also on the list. */
export const SECOND_ADMIN: Person = {
	uid: "uid-admin-0002",
	googleSub: "google-sub-1002",
	email: "olga.other@example.test",
	name: "Olga Other",
};
/** A real Google and Firebase account that is not on the backend's list. */
export const STRANGER: Person = {
	uid: "uid-stranger-0003",
	googleSub: "google-sub-1003",
	email: "sam.stranger@example.test",
	name: "Sam Stranger",
};

export const PEOPLE: readonly Person[] = [ADMIN, SECOND_ADMIN, STRANGER];

/** What Firebase sends along with every sign-in; the Worker must drop it. */
export const refreshTokenOf = (person: Person) =>
	`firebase-refresh-token-of-${person.uid}`;
export const googleAccessTokenOf = (person: Person) =>
	`google-access-token-of-${person.googleSub}`;

// ─── Outbound calls ─────────────────────────────────────────────────────────

export interface Call {
	url: string;
	method: string;
	headers: Headers;
	/** The body as text; null when there was none. */
	readonly body: string | null;
	/** The body as it was sent; null when there was none. */
	raw: Uint8Array | null;
	redirect: string | undefined;
}

type Answer = Response | Promise<Response>;
type Route = (call: Call) => Answer;

export const jsonAnswer = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

/** How the backend words a refusal. */
export const backendError = (
	status: number,
	errorCode: string,
	extra: Record<string, unknown> = {},
): Response =>
	jsonAnswer({ error: `refused: ${errorCode}`, errorCode, ...extra }, status);

/** How Firebase words a refusal. */
export const firebaseError = (message: string, status = 400): Response =>
	jsonAnswer({ error: { code: status, message } }, status);

// ─── The fakes ──────────────────────────────────────────────────────────────

interface Grant {
	person: Person;
	nonce: string;
	challenge: string;
	redirectUri: string;
	clientId: string;
	change: Record<string, unknown>;
	used: boolean;
}

export interface FakeGoogle {
	/**
	 * What Google does when the person agrees: the address it sends the
	 * browser back to, with a one-time code. `change` overrides claims of the
	 * id token that code will be exchanged for (undefined removes one).
	 */
	approve(
		authorizeUrl: string | null,
		person: Person,
		change?: Record<string, unknown>,
	): string;
	/** What Google does when the person says no, or something fails there. */
	decline(authorizeUrl: string | null, error?: string): string;
	/** Every id token it issued. */
	issued: string[];
}

export interface FakeFirebase {
	/** Every Firebase id token it issued; the backend accepts no other. */
	issued: string[];
	/** Set to answer every sign-in with this instead. */
	answer: Route | null;
}

interface Session {
	person: Person;
	authTime: number;
	exp: number;
}

export interface FakeBackend {
	/** Its own list of admin user ids. Take one off and that person is out. */
	admins: Set<string>;
	/**
	 * Its copy of the signing secret. Change it and the backend refuses the
	 * Worker itself (BAD_SIGNATURE), whoever is signed in.
	 */
	signingKey: string;
	/** False: no signing secret is set there (503 PANEL_NOT_CONFIGURED). */
	configured: boolean;
	/** True: it cannot be reached at all. */
	down: boolean;
	/** How long it says a new session lasts. */
	sessionSeconds: number;
	/** The sessions it created that are still good, by cookie value. */
	sessions: Map<string, Session>;
	/** Panel calls that passed the signature, the session and the list. */
	accepted: Call[];
	/** Panel calls it refused, with the code it answered. */
	refused: { call: Call; code: string }[];
	/** Answers an admin call that passed every check. Echoes by default. */
	data: (call: Call, admin: Person) => Answer;
}

export interface FakeMedia {
	/** Files by path inside the public container. */
	files: Map<string, { type: string | null; body: string }>;
	put(path: string, type: string | null, body?: string): void;
}

export interface World {
	env: PanelEnv;
	deps: Deps;
	/** Every outbound request, in order. */
	calls: Call[];
	/** Every log line, in order. */
	logs: LogEntry[];
	google: FakeGoogle;
	firebase: FakeFirebase;
	backend: FakeBackend;
	media: FakeMedia;
	/** Seconds since the epoch; tests move it with `advance`. */
	nowS(): number;
	setNowS(seconds: number): void;
	advance(seconds: number): void;
	/**
	 * Answers requests whose address starts with `prefix` instead of the
	 * fakes. The latest wins. A route that throws is a host that is down.
	 */
	on(prefix: string, route: Route): void;
	callsTo(prefix: string): Call[];
	/** Forgets the calls and log lines so far, and what the backend let in or refused. */
	forget(): void;
	send(request: Request): Promise<Response>;
}

async function bytesOf(body: unknown): Promise<Uint8Array | null> {
	if (body === null || body === undefined) return null;
	if (typeof body === "string") return encoder.encode(body);
	return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}

/** Bytes that are the same in every run and differ from call to call. */
function fixedSequence(): (size: number) => Uint8Array {
	let state = 20261113;
	return (size) => {
		const out = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			out[i] = state >>> 24;
		}
		return out;
	};
}

export function makeWorld(overrides: Partial<PanelEnv> = {}): World {
	let nowMs = Date.UTC(2026, 10, 13, 12, 0, 0);
	const nowS = () => Math.floor(nowMs / 1000);
	const calls: Call[] = [];
	const logs: LogEntry[] = [];
	const routes: { prefix: string; route: Route }[] = [];

	// ── Google ──
	const grants = new Map<string, Grant>();
	const google: FakeGoogle = {
		issued: [],
		approve(authorizeUrl, person, change = {}) {
			if (!authorizeUrl?.startsWith(`${GOOGLE_AUTHORIZE_URL}?`)) {
				throw new Error("not Google's sign-in address");
			}
			const asked = new URL(authorizeUrl).searchParams;
			const code = `code-${grants.size + 1}`;
			grants.set(code, {
				person,
				nonce: asked.get("nonce") ?? "",
				challenge: asked.get("code_challenge") ?? "",
				redirectUri: asked.get("redirect_uri") ?? "",
				clientId: asked.get("client_id") ?? "",
				change,
				used: false,
			});
			const back = new URL(asked.get("redirect_uri") ?? "");
			back.searchParams.set("state", asked.get("state") ?? "");
			back.searchParams.set("code", code);
			return back.toString();
		},
		decline(authorizeUrl, error = "access_denied") {
			if (!authorizeUrl?.startsWith(`${GOOGLE_AUTHORIZE_URL}?`)) {
				throw new Error("not Google's sign-in address");
			}
			const asked = new URL(authorizeUrl).searchParams;
			const back = new URL(asked.get("redirect_uri") ?? "");
			back.searchParams.set("state", asked.get("state") ?? "");
			back.searchParams.set("error", error);
			return back.toString();
		},
	};
	const googleToken: Route = async (call) => {
		const form = new URLSearchParams(call.body ?? "");
		const grant = grants.get(form.get("code") ?? "");
		const invalid = (error: string) => jsonAnswer({ error }, 400);
		if (
			call.method !== "POST" ||
			form.get("grant_type") !== "authorization_code"
		)
			return invalid("unsupported_grant_type");
		if (
			form.get("client_id") !== GOOGLE_CLIENT ||
			form.get("client_secret") !== GOOGLE_SECRET
		)
			return invalid("invalid_client");
		// A code works once, for the client and return address it was made for,
		// and only with the PKCE verifier whose hash was sent at the start.
		if (!grant || grant.used) return invalid("invalid_grant");
		grant.used = true;
		if (
			form.get("redirect_uri") !== grant.redirectUri ||
			grant.clientId !== GOOGLE_CLIENT ||
			(await pkceChallengeOf(form.get("code_verifier") ?? "")) !==
				grant.challenge
		)
			return invalid("invalid_grant");
		const idToken = fakeIdToken({
			iss: "https://accounts.google.com",
			azp: GOOGLE_CLIENT,
			aud: GOOGLE_CLIENT,
			sub: grant.person.googleSub,
			email: grant.person.email,
			email_verified: true,
			name: grant.person.name,
			nonce: grant.nonce,
			iat: nowS(),
			exp: nowS() + HOUR_S,
			...grant.change,
		});
		google.issued.push(idToken);
		return jsonAnswer({
			access_token: googleAccessTokenOf(grant.person),
			expires_in: 3599,
			scope: "openid email profile",
			token_type: "Bearer",
			id_token: idToken,
		});
	};

	// ── Firebase ──
	const firebase: FakeFirebase = { issued: [], answer: null };
	const firebaseSignIn: Route = (call) => {
		if (firebase.answer) return firebase.answer(call);
		if (new URL(call.url).searchParams.get("key") !== FIREBASE_KEY) {
			return firebaseError("API key not valid. Please pass a valid API key.");
		}
		let sent: Record<string, unknown> = {};
		try {
			sent = JSON.parse(call.body ?? "") as Record<string, unknown>;
		} catch {
			return firebaseError("INVALID_ARGUMENT");
		}
		const posted = new URLSearchParams(String(sent.postBody ?? ""));
		const googleIdToken = posted.get("id_token") ?? "";
		if (
			posted.get("providerId") !== "google.com" ||
			!google.issued.includes(googleIdToken)
		) {
			return firebaseError("INVALID_IDP_RESPONSE : not a token of Google's");
		}
		const person = PEOPLE.find(
			(known) => known.googleSub === claimsOf(googleIdToken).sub,
		);
		if (!person) return firebaseError("INVALID_IDP_RESPONSE");
		const idToken = fakeIdToken({
			iss: "https://securetoken.google.com/fake-project",
			aud: "fake-project",
			auth_time: nowS(),
			user_id: person.uid,
			sub: person.uid,
			iat: nowS(),
			exp: nowS() + HOUR_S,
			email: person.email,
			email_verified: true,
			name: person.name,
			firebase: { sign_in_provider: "google.com" },
		});
		firebase.issued.push(idToken);
		return jsonAnswer({
			kind: "identitytoolkit#VerifyAssertionResponse",
			providerId: "google.com",
			localId: person.uid,
			email: person.email,
			emailVerified: true,
			displayName: person.name,
			idToken,
			refreshToken: refreshTokenOf(person),
			expiresIn: "3600",
		});
	};

	// ── Backend ──
	const backend: FakeBackend = {
		admins: new Set([ADMIN.uid, SECOND_ADMIN.uid]),
		signingKey: SIGNING_SECRET,
		configured: true,
		down: false,
		sessionSeconds: SESSION_S,
		sessions: new Map(),
		accepted: [],
		refused: [],
		data: (call) => {
			const url = new URL(call.url);
			return jsonAnswer(
				{ path: url.pathname, query: url.search, method: call.method },
				200,
				{ etag: 'W/"7"' },
			);
		},
	};
	let sessionSerial = 0;

	/** The guard of PanelAccessService, then the route. */
	const panelCall = async (call: Call): Promise<Response> => {
		const url = new URL(call.url);
		const refuse = (
			status: number,
			code: string,
			extra: Record<string, unknown> = {},
		) => {
			backend.refused.push({ call, code });
			return backendError(status, code, extra);
		};
		const starting =
			call.method === "POST" && url.pathname === "/api/panel/session";
		let credential = call.headers.get("x-panel-session") ?? "";
		if (starting) {
			try {
				const sent = JSON.parse(call.body ?? "") as { idToken?: unknown };
				credential = typeof sent.idToken === "string" ? sent.idToken : "";
			} catch {
				credential = "";
			}
		}

		// 1. The Worker's signature.
		if (!backend.configured) return refuse(503, "PANEL_NOT_CONFIGURED");
		const timestamp = call.headers.get("x-panel-timestamp") ?? "";
		const signature = call.headers.get("x-panel-signature") ?? "";
		if (
			!/^\d{1,12}$/.test(timestamp) ||
			Math.abs(nowS() - Number(timestamp)) > 60 ||
			signature !==
				(await expectedSignature(
					backend.signingKey,
					timestamp,
					call.method,
					call.url,
					credential,
					// The bytes it received. A GET has none as far as the
					// backend is concerned, whatever was sent along.
					call.method === "GET" ? null : call.raw,
				))
		) {
			return refuse(401, "BAD_SIGNATURE");
		}

		// Starting a session from a fresh Firebase sign-in.
		if (starting) {
			if (!firebase.issued.includes(credential)) {
				return refuse(401, "TOKEN_INVALID");
			}
			const claims = claimsOf(credential);
			const person = PEOPLE.find((known) => known.uid === claims.sub);
			if (!person || !backend.admins.has(person.uid)) {
				return refuse(403, "NOT_PANEL_ADMIN", { uid: claims.sub });
			}
			const authTime = Number(claims.auth_time);
			if (nowS() - authTime > 5 * 60) return refuse(401, "SIGN_IN_TOO_OLD");
			sessionSerial += 1;
			const exp = nowS() + SESSION_S;
			const session = fakeIdToken({
				iss: "https://session.firebase.google.com/fake-project",
				aud: "fake-project",
				auth_time: authTime,
				sub: person.uid,
				iat: nowS(),
				exp,
				serial: sessionSerial,
				firebase: { sign_in_provider: "google.com" },
			});
			backend.sessions.set(session, { person, authTime, exp });
			backend.accepted.push(call);
			return jsonAnswer({
				session,
				expiresInSeconds: backend.sessionSeconds,
				user: { uid: person.uid, email: person.email, name: person.name },
			});
		}

		// 2. The session, 3. the list.
		const session = backend.sessions.get(credential);
		if (!session || nowS() >= session.exp) {
			return refuse(401, "SESSION_INVALID");
		}
		const { person } = session;
		if (!backend.admins.has(person.uid)) {
			return refuse(403, "NOT_PANEL_ADMIN", { uid: person.uid });
		}
		backend.accepted.push(call);

		if (call.method === "GET" && url.pathname === "/api/panel/me") {
			return jsonAnswer({
				uid: person.uid,
				email: person.email,
				name: person.name,
			});
		}
		if (call.method === "POST" && url.pathname === "/api/panel/signOut") {
			// Ends every session of this person.
			for (const [value, known] of backend.sessions) {
				if (known.person.uid === person.uid) backend.sessions.delete(value);
			}
			return jsonAnswer({ ok: true });
		}
		return backend.data(call, person);
	};

	const backendRoute: Route = (call) => {
		if (backend.down) throw new TypeError("fetch failed");
		const url = new URL(call.url);
		if (url.pathname.startsWith("/api/panel/")) return panelCall(call);
		if (
			url.pathname === "/api/internalConfig" ||
			url.pathname === "/api/workoutsConfig"
		) {
			return jsonAnswer({ document: url.pathname.slice("/api/".length) }, 200, {
				etag: 'W/"config-1"',
			});
		}
		if (url.pathname === "/api/files") {
			// Where the file is stored; the backend itself serves nothing.
			return new Response(null, {
				status: 302,
				headers: {
					location: `${MEDIA}/public/${(url.searchParams.get("path") ?? "")
						.split("/")
						.map(encodeURIComponent)
						.join("/")}`,
				},
			});
		}
		return jsonAnswer({ error: "no such function" }, 404);
	};

	// ── Media store ──
	const media: FakeMedia = {
		files: new Map(),
		put(path, type, body = `bytes of ${path}`) {
			media.files.set(path, { type, body });
		},
	};
	media.put("covers/spring.png", "image/png");
	const mediaRoute: Route = (call) => {
		const path = new URL(call.url).pathname
			.slice("/public/".length)
			.split("/")
			.map(decodeURIComponent)
			.join("/");
		const file = media.files.get(path);
		if (!file) return new Response("BlobNotFound", { status: 404 });
		const headers = new Headers({
			etag: '"0x8DFAKE"',
			"accept-ranges": "bytes",
			"last-modified": "Thu, 12 Nov 2026 10:00:00 GMT",
			// What a store sends that must not reach the browser.
			"x-ms-request-id": "fake-request-id",
			"access-control-allow-origin": "*",
		});
		if (file.type !== null) headers.set("content-type", file.type);
		// "Not changed since you last asked."
		if (call.headers.get("if-none-match") === headers.get("etag")) {
			return new Response(null, { status: 304, headers });
		}
		const range = /^bytes=(\d+)-(\d+)$/.exec(call.headers.get("range") ?? "");
		if (range) {
			const from = Number(range[1]);
			const to = Number(range[2]);
			headers.set("content-range", `bytes ${from}-${to}/${file.body.length}`);
			return new Response(encoder.encode(file.body.slice(from, to + 1)), {
				status: 206,
				headers,
			});
		}
		// As bytes: a text body would be given a type by `Response` itself, and
		// a file without a type has to stay without one.
		return new Response(encoder.encode(file.body), { status: 200, headers });
	};

	const builtIn: { prefix: string; route: Route }[] = [
		{ prefix: GOOGLE_TOKEN_URL, route: googleToken },
		{ prefix: IDP_URL, route: firebaseSignIn },
		{ prefix: `${API}/`, route: backendRoute },
		{ prefix: `${MEDIA}/`, route: mediaRoute },
	];

	const fakeFetch = async (
		input: unknown,
		init?: RequestInit,
	): Promise<Response> => {
		const raw = await bytesOf(init?.body);
		const call: Call = {
			url: String(input),
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			// Read only when a test looks: a body can be tens of megabytes.
			get body() {
				return raw === null ? null : decoder.decode(raw);
			},
			raw,
			redirect: init?.redirect,
		};
		calls.push(call);
		const match = [...routes, ...builtIn].find((entry) =>
			call.url.startsWith(entry.prefix),
		);
		// Nothing in a test may reach the network: an address nobody prepared
		// fails like a host that cannot be reached.
		if (!match) throw new Error(`unexpected outbound request: ${call.url}`);
		return match.route(call);
	};

	const env: PanelEnv = {
		PANEL_ORIGIN: ORIGIN,
		API_ORIGIN: API,
		MEDIA_ORIGINS: MEDIA,
		FIREBASE_API_KEY: FIREBASE_KEY,
		GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
		GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
		SIGN_IN_COOKIE_KEY: COUNTING_KEY,
		PANEL_SIGNING_SECRET: SIGNING_SECRET,
		...overrides,
	};
	const deps: Deps = {
		fetch: fakeFetch as unknown as Deps["fetch"],
		now: () => nowMs,
		randomBytes: fixedSequence(),
		log: (entry) => {
			logs.push(entry);
		},
	};
	return {
		env,
		deps,
		calls,
		logs,
		google,
		firebase,
		backend,
		media,
		nowS,
		setNowS: (seconds) => {
			nowMs = seconds * 1000;
		},
		advance: (seconds) => {
			nowMs += seconds * 1000;
		},
		on: (prefix, route) => {
			routes.unshift({ prefix, route });
		},
		callsTo: (prefix) => calls.filter((call) => call.url.startsWith(prefix)),
		forget: () => {
			calls.length = 0;
			logs.length = 0;
			backend.accepted.length = 0;
			backend.refused.length = 0;
		},
		send: (request) => handle(request, env, deps),
	};
}

// ─── Requests ───────────────────────────────────────────────────────────────

export interface RequestOptions {
	method?: string;
	/** A null value leaves out a header the helper would add. */
	headers?: Record<string, string | null>;
	/** The value of the `cookie` header. */
	cookies?: string;
	body?: BodyInit;
	/** Sent as JSON. */
	json?: unknown;
	/** The address the request arrives at, when not the panel's own. */
	at?: string;
}

/** A request with nothing that marks it as the panel's own. */
export function bare(path: string, options: RequestOptions = {}): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (value !== null) headers.set(name, value);
	}
	if (options.cookies) headers.set("cookie", options.cookies);
	let body = options.body;
	if (options.json !== undefined) {
		body = JSON.stringify(options.json);
		headers.set("content-type", "application/json");
	}
	const url = /^https?:\/\//.test(path)
		? path
		: `${options.at ?? ORIGIN}${path}`;
	return new Request(url, {
		method: options.method ?? (body === undefined ? "GET" : "POST"),
		headers,
		body,
	});
}

/** A request as the panel's own code makes it with `fetch`. */
export function fromPanel(path: string, options: RequestOptions = {}): Request {
	return bare(path, {
		...options,
		headers: {
			[PANEL_HEADER]: "1",
			origin: options.at ?? ORIGIN,
			"sec-fetch-site": "same-origin",
			"sec-fetch-mode": "cors",
			...options.headers,
		},
	});
}

/** The browser going to an address: typed in, a bookmark, or a link in the panel. */
export function navigation(
	path: string,
	options: RequestOptions & { site?: string } = {},
): Request {
	return bare(path, {
		...options,
		headers: {
			"sec-fetch-site": options.site ?? "none",
			"sec-fetch-mode": "navigate",
			"sec-fetch-dest": "document",
			...options.headers,
		},
	});
}

/** The browser coming back from Google. */
export const fromGoogle = (url: string, options: RequestOptions = {}) =>
	navigation(url, { ...options, site: "cross-site" });

/** A picture, sound or film loaded by the panel's own page. */
export function fromOwnMedia(
	path: string,
	options: RequestOptions = {},
): Request {
	return bare(path, {
		...options,
		headers: {
			"sec-fetch-site": "same-origin",
			"sec-fetch-mode": "no-cors",
			"sec-fetch-dest": "image",
			...options.headers,
		},
	});
}

// ─── Answers ────────────────────────────────────────────────────────────────

export interface SetCookie {
	name: string;
	value: string;
	/** Attribute names in lower case; a flag has the value "". */
	attributes: Map<string, string>;
	raw: string;
}

export function setCookies(response: Response): SetCookie[] {
	return response.headers.getSetCookie().map((raw) => {
		const [first = "", ...rest] = raw.split("; ");
		const at = first.indexOf("=");
		const attributes = new Map<string, string>();
		for (const part of rest) {
			const eq = part.indexOf("=");
			if (eq < 0) attributes.set(part.toLowerCase(), "");
			else attributes.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1));
		}
		return {
			name: first.slice(0, at),
			value: first.slice(at + 1),
			attributes,
			raw,
		};
	});
}

export const cookieNamed = (
	response: Response,
	name: string,
): SetCookie | undefined =>
	setCookies(response).find((cookie) => cookie.name === name);

/** True when the answer tells the browser to forget this cookie. */
export const clears = (response: Response, name: string): boolean => {
	const cookie = cookieNamed(response, name);
	return (
		cookie !== undefined &&
		cookie.value === "" &&
		cookie.attributes.get("max-age") === "0"
	);
};

/**
 * What a browser would send back after these answers, oldest first: a later
 * cookie replaces an earlier one of the same name, and Max-Age=0 removes it.
 */
export function jar(previous: string, ...responses: Response[]): string {
	const kept = new Map<string, string>();
	for (const part of previous.split("; ")) {
		const at = part.indexOf("=");
		if (at > 0) kept.set(part.slice(0, at), part.slice(at + 1));
	}
	for (const response of responses) {
		for (const cookie of setCookies(response)) {
			if (cookie.attributes.get("max-age") === "0") kept.delete(cookie.name);
			else kept.set(cookie.name, cookie.value);
		}
	}
	return [...kept].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** The value of one cookie in a `cookie` header, or null. */
export function inJar(cookies: string, name: string): string | null {
	for (const part of cookies.split("; ")) {
		if (part.startsWith(`${name}=`)) return part.slice(name.length + 1);
	}
	return null;
}

/** The session a browser with these cookies holds. */
export function sessionOf(cookies: string): string {
	const session = inJar(cookies, SESSION_COOKIE);
	if (!session) throw new Error("no session cookie in the jar");
	return session;
}

export const bodyOf = async (
	response: Response,
): Promise<Record<string, unknown>> =>
	(await response.clone().json()) as Record<string, unknown>;

/**
 * Every place something could leak to the page: the body and every header
 * except Set-Cookie (which the page cannot read; checked separately).
 */
export async function visibleText(response: Response): Promise<string> {
	const headers: string[] = [];
	response.headers.forEach((value, name) => {
		if (name.toLowerCase() !== "set-cookie") headers.push(`${name}: ${value}`);
	});
	return `${headers.join("\n")}\n${await response.clone().text()}`;
}

/** Everything about an outbound call as one text, to search for what must not be in it. */
export const callText = (call: Call): string => {
	const headers: string[] = [];
	call.headers.forEach((value, name) => {
		headers.push(`${name}: ${value}`);
	});
	return `${call.method} ${call.url}\n${headers.join("\n")}\n${call.body ?? ""}`;
};

// ─── Signing in ─────────────────────────────────────────────────────────────

export interface SignInRun {
	/** The cookies the browser holds afterwards. */
	cookies: string;
	/** The answer that sent the browser to Google. */
	start: Response;
	/** Google's sign-in address, as the Worker built it. */
	authorize: URL;
	/** The address Google sent the browser back to. */
	back: string;
	/** The Worker's answer to that. */
	end: Response;
}

/** The whole way through Google and back, as a browser would go. */
export async function signInWithGoogle(
	world: World,
	person: Person,
	options: {
		redirect?: string;
		cookies?: string;
		change?: Record<string, unknown>;
	} = {},
): Promise<SignInRun> {
	const query =
		options.redirect === undefined
			? ""
			: `?redirect=${encodeURIComponent(options.redirect)}`;
	const start = await world.send(
		navigation(`/auth/google/start${query}`, { cookies: options.cookies }),
	);
	const location = start.headers.get("location");
	if (start.status !== 303 || !location?.startsWith(GOOGLE_AUTHORIZE_URL)) {
		throw new Error(`sign-in did not start in test setup: ${location}`);
	}
	let cookies = jar(options.cookies ?? "", start);
	const back = world.google.approve(location, person, options.change);
	const end = await world.send(fromGoogle(back, { cookies }));
	cookies = jar(cookies, end);
	return { cookies, start, authorize: new URL(location), back, end };
}

/** Signs an admin in and returns the cookies they now hold. Calls and log lines so far are forgotten. */
export async function signedIn(
	world: World,
	person: Person = ADMIN,
): Promise<string> {
	const run = await signInWithGoogle(world, person);
	if (inJar(run.cookies, SESSION_COOKIE) === null) {
		throw new Error(
			`sign-in failed in test setup: ${run.end.headers.get("location")}`,
		);
	}
	world.forget();
	return run.cookies;
}
