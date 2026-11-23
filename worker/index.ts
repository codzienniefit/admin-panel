import { handleAuth } from "./auth";
import { type Deps, type PanelEnv, panelOrigin, realDeps } from "./env";
import { fromAssets, handleStatic } from "./gate";
import { failure, json } from "./http";
import { handleApi } from "./proxy";

// The panel is a static single-page app. Cloudflare serves the built files
// and falls back to index.html for the app's own routes. Every request
// reaches this Worker first (see wrangler.json):
//
//   /auth/*  sign-in with Google and the session: auth.ts
//   /api/*   forwarded to the backend, signed: proxy.ts
//   the rest the built files, only after sign-in: gate.ts
//
// The Test environment of the panel uses neither: it runs on sample data
// inside the browser.
//
// Design and rules: docs/AUTH-HARDENING.md.

export async function handle(
	request: Request,
	env: PanelEnv,
	deps: Deps = realDeps,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/api/health") return json({ ok: true });
	const own =
		url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/");

	// Only a Worker without its own address (this machine, the UI tests) serves the files as they
	// always were. A deployed one (PANEL_ORIGIN set) is closed whatever else is missing: a broken
	// or deleted setting must never open the panel's code to everyone (docs/ACCESS-MODES.md).
	if (!own && panelOrigin(env) === null) return fromAssets(request, env);

	// One address only. The Worker also answers on its workers.dev address
	// and on the address of every old version; there it does nothing.
	const origin = panelOrigin(env);
	if (origin !== null && url.origin !== origin) {
		deps.log({
			event: "refused",
			reason: "host",
			ray: request.headers.get("cf-ray"),
		});
		return failure(404, "Not found", "NOT_FOUND");
	}

	if (url.pathname.startsWith("/auth/")) {
		return handleAuth(request, env, deps, origin);
	}
	if (url.pathname.startsWith("/api/")) {
		return handleApi(request, env, deps, origin);
	}
	// PANEL_ORIGIN is set here.
	return origin === null
		? failure(404, "Not found", "NOT_FOUND")
		: handleStatic(request, env, deps, origin);
}

export default {
	async fetch(request, env) {
		try {
			return await handle(request, env as PanelEnv);
		} catch (error) {
			// The name only, never the text: it could quote what went wrong inside.
			realDeps.log({
				event: "error",
				name: error instanceof Error ? error.name : "unknown",
			});
			return failure(
				500,
				"Błąd serwera. Spróbuj ponownie za chwilę.",
				"WORKER_ERROR",
			);
		}
	},
} satisfies ExportedHandler;
