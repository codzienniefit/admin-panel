import { fromBase64 } from "./codec";

// What the Worker is configured with. Every value is set in Cloudflare
// (Workers → admin-panel → Settings → Variables and Secrets); none is in the
// repository. docs/SIGN-IN-SETUP.md says where each one comes from.
//
// Nothing here is required for the Test environment, which never calls the
// Worker. Until every value below is set, Produkcja is switched off: nobody
// can sign in and nothing is forwarded.

/** Cloudflare's static assets: the built panel (wrangler.json, `assets.binding`). */
export interface AssetsBinding {
	fetch(request: Request): Promise<Response>;
}

export interface PanelEnv {
	/**
	 * The built panel's files, from wrangler.json rather than a setting. Absent only in tests that
	 * leave it out on purpose.
	 */
	ASSETS?: AssetsBinding;
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
	 * 32 random bytes, base64. Seals the Worker's own cookies: the sign-in
	 * attempt to Google and back, the refusal note, and the pass to the
	 * panel's code. None of them is a session. Secret.
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

export type LogLevel = "info" | "warn" | "error";

/** Refusals that are part of normal use, worded for what they mean. */
const EXPECTED_REASONS: Record<string, string> = {
	noPass: "Not served the panel's code: the browser has not signed in",
};

/** Refusals only someone outside the panel causes: tagged like the backend's alerts. */
const SECURITY_REASONS: Record<string, string> = {
	host: "a request to an address other than PANEL_ORIGIN",
	foreign: "a request that did not come from the panel's own page",
	noAttempt: "a return from Google for a sign-in this browser did not start",
	notInTable: "a call to an API path the panel never uses",
};

/** Sign-ins that end because of our own setup, not the person: worth an error. */
const SETUP_OUTCOMES = new Set(["misconfigured", "unavailable"]);

const text = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value);

/**
 * The line a log entry is read by in Cloudflare's Logs view, and its level. The tags match the
 * backend's: `[ADMIN_ACTION]` for what an admin did, `[SECURITY_ALERT]` for what only someone
 * outside the panel causes. Never more than the entry holds: no body, cookie, token or query.
 */
export function describeLog(entry: LogEntry): {
	level: LogLevel;
	message: string;
} {
	const route = [text(entry.method), text(entry.route)]
		.filter((part) => part !== "")
		.join(" ");
	const where = route ? ` ${route}` : "";
	const reason = text(entry.reason);
	switch (entry.event) {
		case "refused": {
			const expected = EXPECTED_REASONS[reason];
			if (expected) return { level: "info", message: `${expected}${where}` };
			const security = SECURITY_REASONS[reason];
			if (security) {
				return {
					level: "warn",
					message: `[SECURITY_ALERT] Refused ${security}${where}`,
				};
			}
			const status = entry.status ? `, ${text(entry.status)}` : "";
			return {
				level: "warn",
				message: `Refused (${reason || "no reason"}${status})${where}`,
			};
		}
		case "forwarded": {
			const status = Number(entry.status);
			const who = entry.uid ? ` by uid=${text(entry.uid)}` : "";
			return {
				level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
				message: `[ADMIN_ACTION]${where} → ${text(entry.status)}${who}`,
			};
		}
		case "signIn": {
			const outcome = text(entry.outcome);
			const uid = entry.uid ? ` uid=${text(entry.uid)}` : "";
			if (outcome === "admin") {
				return { level: "info", message: `[ADMIN_ACTION] Signed in:${uid}` };
			}
			if (outcome === "forbidden") {
				return {
					level: "warn",
					message: `[SECURITY_ALERT] Sign-in refused: not a panel admin${uid ? `,${uid}` : ""}`,
				};
			}
			if (outcome === "cancelled") {
				return { level: "info", message: "Sign-in cancelled at Google" };
			}
			return {
				level: SETUP_OUTCOMES.has(outcome) ? "error" : "warn",
				message: `Sign-in failed: ${outcome || "unknown"}${
					outcome === "unavailable"
						? " (the backend could not be reached or has no panel routes)"
						: outcome === "misconfigured"
							? " (check the Worker's settings and PANEL_SIGNING_SECRET in Azure)"
							: ""
				}${uid}`,
			};
		}
		case "signOut":
			return {
				level: "info",
				message: entry.ended ? "Signed out" : "Signed out (no session)",
			};
		case "backendRefusedWorker":
			return {
				level: "error",
				message: `The backend refused the Worker's signed call${where}${
					reason ? ` (${reason})` : ""
				}: check that PANEL_SIGNING_SECRET is the same in Azure and in the Worker`,
			};
		case "error":
			return {
				level: "error",
				message: `Worker error: ${text(entry.name) || "unknown"}`,
			};
	}
}

/** What a handler needs from outside, so tests can stand in for it. */
export interface Deps {
	fetch: typeof fetch;
	/** Milliseconds since the epoch. */
	now(): number;
	randomBytes(length: number): Uint8Array;
	log(entry: LogEntry): void;
	/**
	 * Where the public files are stored, as the backend's redirect showed it
	 * (proxy.ts): files are then fetched from there directly, without asking
	 * the backend for each one. Kept for the life of the Worker instance.
	 */
	fileBase?: {
		get(): string | null;
		set(base: string): void;
		forget(): void;
	};
}

let learnedFileBase: string | null = null;

export const realDeps: Deps = {
	fileBase: {
		get: () => learnedFileBase,
		set: (base) => {
			learnedFileBase = base;
		},
		forget: () => {
			learnedFileBase = null;
		},
	},
	fetch: (input, init) => fetch(input, init),
	now: () => Date.now(),
	randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
	log: (entry) => {
		const { level, message } = describeLog(entry);
		// One line of JSON: Cloudflare's Logs view shows `message` and indexes every field.
		const line = JSON.stringify({ message, level, ...entry });
		if (level === "error") console.error(line);
		else if (level === "warn") console.warn(line);
		else console.log(line);
	},
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

/**
 * The names of the values that are missing or not valid, in the order docs/SIGN-IN-SETUP.md lists
 * them. Only ever sent while sign-in is not set up (see `sessionStatus` in auth.ts): once it is,
 * nothing about the Worker's settings leaves it.
 */
export function missingSettings(env: PanelEnv): string[] {
	const checks: [string, boolean][] = [
		["PANEL_ORIGIN", panelOrigin(env) !== null],
		["API_ORIGIN", apiOrigin(env) !== null],
		["MEDIA_ORIGINS", mediaOrigins(env).size > 0],
		["FIREBASE_API_KEY", set(env.FIREBASE_API_KEY)],
		["GOOGLE_CLIENT_ID", set(env.GOOGLE_CLIENT_ID)],
		["GOOGLE_CLIENT_SECRET", set(env.GOOGLE_CLIENT_SECRET)],
		["SIGN_IN_COOKIE_KEY", hasCookieKey(env)],
		["PANEL_SIGNING_SECRET", signingSecret(env) !== null],
	];
	return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

/** The ways of signing in that have everything they need. One, or none. */
export const signInMethods = (env: PanelEnv): SignInMethodId[] =>
	canSignIn(env) ? ["google"] : [];
