// The panel is a static single-page app. Cloudflare serves the built assets
// and falls back to index.html for client-side routes; only /api/* reaches
// this Worker (see wrangler.json).
//
// Phase 0 has no backend connection: the mock build makes no network requests.
// Forwarding to the real API and the endpoints that hold secrets arrive with
// the live slices in docs/ROADMAP.md.
export default {
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/api/health") {
			return Response.json({ ok: true });
		}
		return Response.json({ error: "Not found" }, { status: 404 });
	},
} satisfies ExportedHandler;
