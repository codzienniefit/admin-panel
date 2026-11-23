const hasControlCharacter = (text: string) =>
	[...text].some((character) => character.charCodeAt(0) < 32);

/** A dot, a slash or a backslash written as `%xx`: never in a panel address. */
const ENCODED_STEP = /%(2e|2f|5c)/i;

/** Only for resolving a path; never requested. */
const BASE = "https://panel.invalid";

/**
 * Where to go after signing in. Only paths inside the panel are accepted, so
 * a crafted link cannot send someone to another site after login.
 *
 * The target is resolved the way a browser resolves it and only then
 * checked, so `/x/../api/…` is judged as the `/api/…` it really is. The same
 * rule as the Worker's `safeRedirect`.
 */
export function sanitizeRedirect(target: unknown): string {
	if (typeof target !== "string") return "/";
	if (!target.startsWith("/") || target.startsWith("//")) return "/";
	if (target.includes("\\") || hasControlCharacter(target)) return "/";
	if (ENCODED_STEP.test(target)) return "/";
	let url: URL;
	try {
		url = new URL(target, BASE);
	} catch {
		return "/";
	}
	if (url.origin !== BASE) return "/";
	if (url.pathname.startsWith("//")) return "/";
	if (url.pathname === "/login") return "/";
	// The Worker's own addresses are not pages.
	if (/^\/(api|auth)(\/|$)/i.test(url.pathname)) return "/";
	return target;
}
