import { describe, expect, it } from "vitest";

// Guards for the two modes of access (docs/ACCESS-MODES.md) that need the repository's files:
// what is in public/, and how wrangler.json routes requests. The Worker's own behaviour is
// tested in worker/accessModes.test.ts.
//
// Read through Vite rather than node:fs, as notIndexed.test.ts does; the Worker's module is loaded
// the same way, because the app and the Worker are separate TypeScript projects.

/** Every file in public/, by its address on the site. Not imported: only the names are used. */
const publicFiles = Object.keys(import.meta.glob("../public/**/*"))
	.map((path) => path.replace(/^\.\.\/public/, ""))
	// Cloudflare's own configuration, never served.
	.filter((path) => path !== "/_headers")
	.toSorted();

const gate = import.meta.glob<{ PUBLIC_FILES: ReadonlySet<string> }>(
	"../worker/gate.ts",
	{ eager: true },
)["../worker/gate.ts"];

const wranglerText = import.meta.glob<string>("../wrangler.json", {
	query: "?raw",
	import: "default",
	eager: true,
})["../wrangler.json"];

describe("what a signed-out visitor can download", () => {
	it("is every file in public/, by a decision: a new file there is gated until it is added to PUBLIC_FILES on purpose", () => {
		expect(gate).toBeDefined();
		const allowed = [...(gate?.PUBLIC_FILES ?? [])].toSorted();
		expect(publicFiles).toEqual(allowed);
		expect(allowed).toEqual([
			"/apple-touch-icon.png",
			"/favicon-192.png",
			"/favicon-32.png",
			"/favicon.ico",
			"/robots.txt",
		]);
	});
});

describe("wrangler.json", () => {
	const config = JSON.parse(wranglerText ?? "{}") as {
		assets?: {
			binding?: string;
			not_found_handling?: string;
			run_worker_first?: boolean | string[];
		};
	};

	it("gives the Worker the static files as ASSETS", () => {
		expect(config.assets?.binding).toBe("ASSETS");
		expect(config.assets?.not_found_handling).toBe("single-page-application");
	});

	it("sends every request to the Worker first, so no file of the panel bypasses the pass", () => {
		// `true`, not a list: a list with exclusions (`!/…`) would let those addresses past the
		// Worker. Changing this needs a review (docs/ACCESS-MODES.md, "Rules for changes").
		expect(config.assets?.run_worker_first).toBe(true);
	});
});
