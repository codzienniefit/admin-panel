import { hmacSha256Hex, sha256Hex } from "./codec";
import { apiOrigin, type Deps, type PanelEnv, signingSecret } from "./env";

// How the Worker talks to the backend.
//
// The backend decides who is an admin; the Worker never does. Every call
// carries two things the backend checks itself (PanelAccessService there):
//
//   - the session: a Firebase session cookie the backend created, for 48
//     hours, for someone on its own list who signed in with Google
//   - the Worker's signature over the call, made with a secret only the two
//     share, so a session or token used anywhere but through the panel
//     opens nothing
//
// The panel's routes on the backend live under `/api/panel/`.

export const PANEL_PREFIX = "/api/panel";

export const SIGNING = {
	timestamp: "x-panel-timestamp",
	signature: "x-panel-signature",
	session: "x-panel-session",
	version: "v1",
} as const;

/**
 * The query in one fixed spelling: decoded, sorted, encoded again. The
 * backend builds the same text from what it receives.
 */
export function canonicalQuery(params: URLSearchParams): string {
	return [...params.entries()]
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.sort()
		.join("&");
}

/**
 * The text that is signed: when, what call, what body, whose session. The
 * body is part of it, so a signed call that someone captured cannot be sent
 * again with other content. `credential` is the session, or the token a
 * session starts from.
 */
export async function signingText(
	timestamp: string,
	method: string,
	path: string,
	query: string,
	body: string | ArrayBuffer,
	credential: string,
): Promise<string> {
	return [
		SIGNING.version,
		timestamp,
		method.toUpperCase(),
		path,
		query,
		await sha256Hex(body),
		await sha256Hex(credential),
	].join("\n");
}

export interface BackendCall {
	method: string;
	/** Path on the backend, starting with `/api/`. */
	path: string;
	query?: URLSearchParams;
	/** The session, or the Firebase token when a session is being started. */
	credential: string;
	/** False only when a session is being started: the token travels in the body. */
	sendSession?: boolean;
	headers?: Headers;
	/** Whole, never a stream: it is signed before it is sent. */
	body?: string | ArrayBuffer | null;
}

export type BackendFailure = "notConfigured" | "unreachable";

/**
 * Sends one signed call to the backend. Redirects are never followed: the
 * panel's routes do not redirect, and a signed call must not travel on.
 */
export async function callBackend(
	env: PanelEnv,
	deps: Deps,
	call: BackendCall,
): Promise<Response | BackendFailure> {
	const origin = apiOrigin(env);
	const secret = signingSecret(env);
	if (!origin || !secret) return "notConfigured";

	const query = canonicalQuery(call.query ?? new URLSearchParams());
	const timestamp = String(Math.floor(deps.now() / 1000));
	const signature = await hmacSha256Hex(
		secret,
		await signingText(
			timestamp,
			call.method,
			call.path,
			query,
			call.body ?? "",
			call.credential,
		),
	);

	const headers = new Headers(call.headers);
	headers.set(SIGNING.timestamp, timestamp);
	headers.set(SIGNING.signature, `${SIGNING.version}=${signature}`);
	if (call.sendSession !== false) headers.set(SIGNING.session, call.credential);

	try {
		return await deps.fetch(
			`${origin}${call.path}${query === "" ? "" : `?${query}`}`,
			{
				method: call.method,
				headers,
				body: call.body ?? undefined,
				redirect: "manual",
			},
		);
	} catch {
		return "unreachable";
	}
}

/** The error code in a backend answer, or null. */
export async function errorCodeOf(response: Response): Promise<string | null> {
	try {
		const body: unknown = await response.clone().json();
		const code =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>).errorCode
				: null;
		return typeof code === "string" ? code : null;
	} catch {
		return null;
	}
}

async function recordOf(response: Response): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await response.json();
		return typeof body === "object" && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export interface PanelUser {
	uid: string;
	email: string | null;
	displayName: string;
}

function userOf(value: unknown): PanelUser | null {
	if (typeof value !== "object" || value === null) return null;
	const { uid, email, name } = value as Record<string, unknown>;
	if (typeof uid !== "string" || uid === "") return null;
	const mail = typeof email === "string" && email !== "" ? email : null;
	return {
		uid,
		email: mail,
		displayName:
			typeof name === "string" && name !== ""
				? name
				: (mail ?? "Administrator"),
	};
}

export type SessionStart =
	| { ok: true; session: string; maxAge: number; user: PanelUser }
	/** A valid account that is not on the backend's list. */
	| { ok: false; reason: "notAdmin"; uid: string | null }
	/** The backend said no for another reason: wrong way of signing in, a stale sign-in. */
	| { ok: false; reason: "refused" }
	/** The backend did not accept the Worker itself: a wrong or missing signing secret. */
	| { ok: false; reason: "misconfigured" }
	| { ok: false; reason: "unavailable" };

/** The longest a session cookie is kept, whatever the backend says. */
export const MAX_SESSION_S = 48 * 60 * 60;

/** Asks the backend to turn a fresh Firebase sign-in into a session. */
export async function startSession(
	env: PanelEnv,
	deps: Deps,
	idToken: string,
): Promise<SessionStart> {
	const response = await callBackend(env, deps, {
		method: "POST",
		path: `${PANEL_PREFIX}/session`,
		credential: idToken,
		sendSession: false,
		headers: new Headers({ "content-type": "application/json" }),
		body: JSON.stringify({ idToken }),
	});
	if (response === "notConfigured")
		return { ok: false, reason: "misconfigured" };
	if (response === "unreachable") return { ok: false, reason: "unavailable" };

	const body = await recordOf(response);
	if (response.ok) {
		const user = userOf(body.user);
		const seconds = Number(body.expiresInSeconds);
		if (typeof body.session !== "string" || body.session === "" || !user) {
			return { ok: false, reason: "unavailable" };
		}
		// A session value goes into a cookie as it is: nothing but the
		// characters of a token may be in it.
		if (!/^[A-Za-z0-9._-]+$/.test(body.session)) {
			return { ok: false, reason: "unavailable" };
		}
		return {
			ok: true,
			session: body.session,
			maxAge:
				Number.isFinite(seconds) && seconds > 0
					? Math.min(seconds, MAX_SESSION_S)
					: MAX_SESSION_S,
			user,
		};
	}
	const code = typeof body.errorCode === "string" ? body.errorCode : "";
	if (code === "NOT_PANEL_ADMIN") {
		return {
			ok: false,
			reason: "notAdmin",
			uid: typeof body.uid === "string" ? body.uid : null,
		};
	}
	if (code === "BAD_SIGNATURE" || code === "PANEL_NOT_CONFIGURED") {
		return { ok: false, reason: "misconfigured" };
	}
	if (response.status >= 500) return { ok: false, reason: "unavailable" };
	return { ok: false, reason: "refused" };
}

export type WhoAmI =
	| { ok: true; user: PanelUser }
	/** The session is over, or the person is no longer on the list. */
	| { ok: false; reason: "signedOut" }
	| { ok: false; reason: "misconfigured" }
	| { ok: false; reason: "unavailable" };

/** Asks the backend who this session belongs to. */
export async function whoAmI(
	env: PanelEnv,
	deps: Deps,
	session: string,
): Promise<WhoAmI> {
	const response = await callBackend(env, deps, {
		method: "GET",
		path: `${PANEL_PREFIX}/me`,
		credential: session,
	});
	if (response === "notConfigured")
		return { ok: false, reason: "misconfigured" };
	if (response === "unreachable") return { ok: false, reason: "unavailable" };
	if (response.ok) {
		const user = userOf(await recordOf(response));
		return user ? { ok: true, user } : { ok: false, reason: "unavailable" };
	}
	const code = await errorCodeOf(response);
	if (code === "BAD_SIGNATURE" || code === "PANEL_NOT_CONFIGURED") {
		return { ok: false, reason: "misconfigured" };
	}
	// Only the backend's own guard saying "no" to this session ends it. A 401
	// or 403 from anything in between (the host, a gateway) is a fault, and a
	// fault must not sign every admin out.
	if (
		code === "SESSION_INVALID" ||
		code === "NOT_PANEL_ADMIN" ||
		code === "WRONG_SIGN_IN_METHOD"
	) {
		return { ok: false, reason: "signedOut" };
	}
	return { ok: false, reason: "unavailable" };
}

/** Tells the backend to end this person's sessions. True when it did. */
export async function endSession(
	env: PanelEnv,
	deps: Deps,
	session: string,
): Promise<boolean> {
	const response = await callBackend(env, deps, {
		method: "POST",
		path: `${PANEL_PREFIX}/signOut`,
		credential: session,
	});
	return typeof response !== "string" && response.ok;
}
