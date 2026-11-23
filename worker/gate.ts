import { hasPass, refusedUid } from "./auth";
import { canSignIn, type Deps, missingSettings, type PanelEnv } from "./env";
import { failure } from "./http";
import { loginPage, loginPageRequest } from "./loginPage";

// The panel's own files (its pages, scripts and styles) go only to a browser that signed in.
//
// Once sign-in is configured, every request reaches the Worker first (wrangler.json). A browser
// that signed in holds a pass (auth.ts, PASS_COOKIE) and gets the files from Cloudflare's static
// assets exactly as before. Anyone else gets the Worker's own sign-in page (loginPage.ts) for a page
// address, and 404 for a file, so nothing of the panel is downloaded before sign-in.
//
// The pass opens no data: every /api call still needs the session, which the backend checks. It
// only decides who may download the code.
//
// Until sign-in is configured (on this machine, in the UI tests, an unset Worker) every file is
// served as it always was.

/** What a browser or a crawler asks for by itself, before any page: anyone may have these. */
export const PUBLIC_FILES: ReadonlySet<string> = new Set([
	"/robots.txt",
	"/favicon.ico",
	"/favicon-32.png",
	"/favicon-192.png",
	"/apple-touch-icon.png",
]);

/** A file rather than a page: the built code, or any address that ends in an extension. */
export const isFile = (pathname: string): boolean =>
	pathname.startsWith("/assets/") ||
	/\.[A-Za-z0-9]+$/.test(pathname.slice(pathname.lastIndexOf("/") + 1));

/** As before this Worker saw static files: straight from the static assets. */
export function fromAssets(request: Request, env: PanelEnv): Promise<Response> {
	if (!env.ASSETS)
		return Promise.resolve(failure(404, "Not found", "NOT_FOUND"));
	return env.ASSETS.fetch(request);
}

/**
 * A file from the static assets for someone with a pass. Kept out of every shared cache: the same
 * address answers someone without a pass differently. A page is not stored at all; a script or a
 * style may stay in this browser's own cache, asked again each time.
 */
async function forPassHolder(
	request: Request,
	env: PanelEnv,
): Promise<Response> {
	const served = await fromAssets(request, env);
	const response = new Response(served.body, served);
	const html = (response.headers.get("content-type") ?? "").startsWith(
		"text/html",
	);
	response.headers.set(
		"cache-control",
		html ? "private, no-store" : "private, no-cache",
	);
	return response;
}

/**
 * Every address that is neither /api/ nor /auth/, on the panel's own address, with sign-in
 * configured.
 *
 * @param origin the panel's own address (PANEL_ORIGIN)
 */
export async function handleStatic(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	origin: string,
): Promise<Response> {
	const url = new URL(request.url);
	if (PUBLIC_FILES.has(url.pathname)) return fromAssets(request, env);
	// Deployed, but sign-in not fully set up: closed to everyone, pass or not. The sign-in page
	// names what is missing, as the panel's own page used to.
	if (!canSignIn(env)) {
		if (isFile(url.pathname)) return failure(404, "Not found", "NOT_FOUND");
		if (request.method !== "GET" && request.method !== "HEAD") {
			return failure(404, "Not found", "NOT_FOUND");
		}
		return loginPage(
			{
				redirect: "/",
				problem: null,
				refusedUid: null,
				missing: missingSettings(env),
			},
			request.method,
		);
	}
	if (await hasPass(request, env, deps)) return forPassHolder(request, env);

	if (isFile(url.pathname)) {
		// Only the panel's own code is worth a line; scanners' guesses are not.
		if (url.pathname.startsWith("/assets/")) {
			deps.log({
				event: "refused",
				method: request.method,
				route: "/assets/*",
				reason: "noPass",
				ray: request.headers.get("cf-ray"),
			});
		}
		return failure(404, "Not found", "NOT_FOUND");
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		return failure(404, "Not found", "NOT_FOUND");
	}
	const { redirect, problem } = loginPageRequest(url, origin);
	return loginPage(
		{
			redirect,
			problem,
			refusedUid:
				problem === "forbidden" ? await refusedUid(request, env, deps) : null,
		},
		request.method,
	);
}
