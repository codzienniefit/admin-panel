import { handleAuth } from "./auth";
import { type Deps, type PanelEnv, panelOrigin, realDeps } from "./env";
import { failure, json } from "./http";
import { handleApi } from "./proxy";

// The panel is a static single-page app. Cloudflare serves the built files
// and falls back to index.html for the app's own routes; only /api/* and
// /auth/* reach this Worker (see wrangler.json).
//
//   /auth/*  sign-in with Google and the session: auth.ts
//   /api/*   forwarded to the backend, signed: proxy.ts
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
	return failure(404, "Not found", "NOT_FOUND");
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
