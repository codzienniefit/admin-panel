import { sameText } from "./codec";

// Answers, cookies and the checks every request passes before it is handled.

/** Set by the panel's own code on every request; a form on another site cannot. */
export const PANEL_HEADER = "x-cf-panel";

/**
 * On every answer the Worker makes itself. `public/_headers` covers only the
 * static files; nothing in it reaches a response built here.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"x-content-type-options": "nosniff",
	"cross-origin-resource-policy": "same-origin",
	"referrer-policy": "no-referrer",
	"x-frame-options": "DENY",
	// a private site: no search engine, archive or AI may index or use what it answers
	"x-robots-tag":
		"noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai",
};

/** For answers that are data, never a page: nothing in them may load or run. */
const DATA_POLICY = "default-src 'none'; frame-ancestors 'none'";

export function json(
	body: unknown,
	status = 200,
	cookies: readonly string[] = [],
): Response {
	const headers = new Headers({
		...SECURITY_HEADERS,
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": DATA_POLICY,
	});
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(JSON.stringify(body), { status, headers });
}

/** The error envelope the panel's client already understands. */
export const failure = (
	status: number,
	error: string,
	errorCode: string,
	cookies: readonly string[] = [],
): Response => json({ error, errorCode }, status, cookies);

export function redirect(
	location: string,
	cookies: readonly string[] = [],
): Response {
	const headers = new Headers({
		...SECURITY_HEADERS,
		location,
		"cache-control": "no-store",
		"content-security-policy": DATA_POLICY,
	});
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(null, { status: 303, headers });
}

// ─── Cookies ────────────────────────────────────────────────────────────────

export function readCookies(request: Request): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const at = part.indexOf("=");
		if (at < 1) continue;
		const name = part.slice(0, at).trim();
		if (name === "") continue;
		// The first one wins, as the standard orders more specific paths first.
		if (!cookies.has(name)) cookies.set(name, part.slice(at + 1).trim());
	}
	return cookies;
}

export interface CookieOptions {
	/** Seconds. Zero deletes the cookie. */
	maxAge: number;
	/**
	 * Strict: never sent on a request another site started. Lax is only for
	 * the few minutes of a sign-in that passes through Google and has to come
	 * back.
	 */
	sameSite: "Strict" | "Lax";
}

/**
 * A cookie only this site's server can read. The `__Host-` name makes the
 * browser itself insist on Secure, on Path=/ and on no Domain, so no
 * subdomain and no plain-http page can set or shadow it; HttpOnly keeps it
 * away from every script.
 */
export function cookie(
	name: string,
	value: string,
	options: CookieOptions,
): string {
	if (!name.startsWith("__Host-")) throw new Error("cookie without __Host-");
	return [
		`${name}=${value}`,
		"Path=/",
		`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
		"HttpOnly",
		"Secure",
		`SameSite=${options.sameSite}`,
	].join("; ");
}

export const clearCookie = (
	name: string,
	sameSite: CookieOptions["sameSite"] = "Strict",
) => cookie(name, "", { maxAge: 0, sameSite });

// ─── Who is asking ──────────────────────────────────────────────────────────

/**
 * True when the request was made by the panel's own page. Three independent
 * signs, any of which a page on another site fails: the browser's own
 * `Sec-Fetch-Site`, the `Origin` it attaches, and the header only our code
 * sets. (The session cookie is SameSite=Strict on top of this.)
 *
 * A request that changes something must carry `Sec-Fetch-Site`: every
 * current browser sends it, so one without it did not come from the panel.
 *
 * @param origin the panel's own address (PANEL_ORIGIN)
 */
export function fromOwnPage(request: Request, origin: string): boolean {
	const site = request.headers.get("sec-fetch-site");
	if (site === null) {
		if (request.method !== "GET") return false;
	} else if (site !== "same-origin") {
		return false;
	}
	const sent = request.headers.get("origin");
	if (sent !== null && !sameText(sent, origin)) return false;
	return request.headers.get(PANEL_HEADER) === "1";
}

/**
 * True when the browser says the person came from the panel itself or typed
 * the address. For the one address reached by navigating (starting a
 * sign-in), where the panel's header cannot be set.
 */
export function navigatedFromPanel(request: Request): boolean {
	const site = request.headers.get("sec-fetch-site");
	return site === "same-origin" || site === "none";
}

/** True for a picture, sound or film the panel's own page is loading. */
export function loadedByOwnPage(request: Request): boolean {
	return request.headers.get("sec-fetch-site") === "same-origin";
}

const hasControlCharacter = (text: string) =>
	[...text].some((character) => character.charCodeAt(0) < 32);

/** A dot, a slash or a backslash written as `%xx`: never in a panel address. */
const ENCODED_STEP = /%(2e|2f|5c)/i;

/**
 * Where to send someone after signing in: a path inside the panel, or "/".
 *
 * The target is resolved the way a browser resolves it and only then
 * checked, so `/x/../api/…` is judged as the `/api/…` it really is. What is
 * returned is the resolved address, which is plain ASCII and safe in a
 * `Location` header.
 *
 * @param origin the panel's own address
 */
export function safeRedirect(target: string | null, origin: string): string {
	if (!target?.startsWith("/") || target.startsWith("//")) return "/";
	if (target.includes("\\") || hasControlCharacter(target)) return "/";
	if (ENCODED_STEP.test(target)) return "/";
	let url: URL;
	try {
		url = new URL(target, origin);
	} catch {
		return "/";
	}
	if (url.origin !== origin) return "/";
	const path = url.pathname;
	// Resolving `/.//host` drops the dot and leaves `//host`, which a browser
	// reads as another site.
	if (path.startsWith("//")) return "/";
	if (path === "/login") return "/";
	// The Worker's own addresses are not pages.
	if (/^\/(api|auth)(\/|$)/i.test(path)) return "/";
	return `${path}${url.search}${url.hash}`;
}
