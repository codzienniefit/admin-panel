const hasControlCharacter = (text: string) =>
	[...text].some((character) => character.charCodeAt(0) < 32);

/**
 * Where to go after signing in. Only paths inside the panel are accepted, so
 * a crafted link cannot send someone to another site after login.
 */
export function sanitizeRedirect(target: unknown): string {
	if (typeof target !== "string") return "/";
	if (!target.startsWith("/") || target.startsWith("//")) return "/";
	if (target.includes("\\") || hasControlCharacter(target)) return "/";
	if (target === "/login" || target.startsWith("/login?")) return "/";
	return target;
}
