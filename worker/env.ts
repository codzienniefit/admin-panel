import { fromBase64 } from "./codec";

// What the Worker is configured with. Every value is set in Cloudflare
// (Workers → admin-panel → Settings → Variables and Secrets); none is in the
// repository. docs/SIGN-IN-SETUP.md says where each one comes from.
//
// Nothing here is required for the Test environment, which never calls the
// Worker. Until every value below is set, Produkcja is switched off: nobody
// can sign in and nothing is forwarded.

export interface PanelEnv {
	/**
	 * The one address the panel is used at, e.g. "https://panel.example.com".
	 * A request for any other host is refused before anything else.
	 */
	PANEL_ORIGIN?: string;
	/** The backend, e.g. "https://api.example.com". Requests go to `${API_ORIGIN}/api/...`. */
	API_ORIGIN?: string;
	/**
	 * Where the backend keeps media files, e.g. "https://files.example.com".
	 * Several are separated by commas. A file is fetched from nowhere else.
	 */
	MEDIA_ORIGINS?: string;
	/** Firebase Web API key of the app's project. Not a secret. */
	FIREBASE_API_KEY?: string;
	/** Google OAuth "Web application" client. The secret is a secret. */
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	/**
	 * 32 random bytes, base64. Encrypts the cookie that carries a sign-in
	 * attempt to Google and back, and nothing else. Secret.
	 */
	SIGN_IN_COOKIE_KEY?: string;
	/**
	 * Shared with the backend and with nothing else. Every call the Worker
	 * forwards is signed with it; the backend refuses an unsigned one. Secret.
	 */
	PANEL_SIGNING_SECRET?: string;
}

/** One line in the Worker's log. Never a body, a cookie, a token or a query. */
export interface LogEntry {
	event:
		| "refused"
		| "forwarded"
		| "signIn"
		| "signOut"
		| "backendRefusedWorker"
		| "error";
	[field: string]: string | number | boolean | null | undefined;
}

/** What a handler needs from outside, so tests can stand in for it. */
export interface Deps {
	fetch: typeof fetch;
	/** Milliseconds since the epoch. */
	now(): number;
	randomBytes(length: number): Uint8Array;
	log(entry: LogEntry): void;
}

export const realDeps: Deps = {
	fetch: (input, init) => fetch(input, init),
	now: () => Date.now(),
	randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
	log: (entry) => console.log(JSON.stringify(entry)),
};

/** True when SIGN_IN_COOKIE_KEY is a key: 32 bytes of base64. */
const hasCookieKey = (env: PanelEnv): boolean =>
	fromBase64(env.SIGN_IN_COOKIE_KEY ?? "")?.length === 32;

const set = (value: string | undefined): value is string =>
	typeof value === "string" && value.trim() !== "";

/** The backend refuses a shorter one; so does the Worker. */
export const MIN_SIGNING_SECRET_LENGTH = 32;

export type SignInMethodId = "google";

/** A plain origin: https, or http on this machine. Null for anything else. */
function originOf(value: string | undefined): string | null {
	if (!set(value)) return null;
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
	if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
		return null;
	}
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== "/" && url.pathname !== "") return null;
	return url.origin;
}

/** The panel's own address, or null while it is not set. */
export const panelOrigin = (env: PanelEnv): string | null =>
	originOf(env.PANEL_ORIGIN);

/** The backend's address, or null while it is not set. */
export const apiOrigin = (env: PanelEnv): string | null =>
	originOf(env.API_ORIGIN);

/** The addresses a media file may be fetched from. */
export function mediaOrigins(env: PanelEnv): Set<string> {
	const origins = new Set<string>();
	for (const part of (env.MEDIA_ORIGINS ?? "").split(/[\s,]+/)) {
		const origin = originOf(part);
		if (origin) origins.add(origin);
	}
	return origins;
}

/** The signing secret when it is long enough to be one. */
export function signingSecret(env: PanelEnv): string | null {
	const secret = env.PANEL_SIGNING_SECRET?.trim() ?? "";
	return secret.length >= MIN_SIGNING_SECRET_LENGTH ? secret : null;
}

/** True when the backend can be called at all. */
export const canReachBackend = (env: PanelEnv): boolean =>
	apiOrigin(env) !== null && signingSecret(env) !== null;

/** True when everything a sign-in needs is set. */
export const canSignIn = (env: PanelEnv): boolean =>
	panelOrigin(env) !== null &&
	canReachBackend(env) &&
	set(env.FIREBASE_API_KEY) &&
	set(env.GOOGLE_CLIENT_ID) &&
	set(env.GOOGLE_CLIENT_SECRET) &&
	hasCookieKey(env);

/** The ways of signing in that have everything they need. One, or none. */
export const signInMethods = (env: PanelEnv): SignInMethodId[] =>
	canSignIn(env) ? ["google"] : [];
