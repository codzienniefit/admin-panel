import { describe, expect, it } from "vitest";

// The panel is a private site: no search engine, archive or AI crawler may index or use it, and
// nothing seen before sign-in says what it is. (The Worker's own answers carry the same
// X-Robots-Tag: worker/http.test.ts and worker/proxy.test.ts.)
//
// Read through Vite rather than node:fs, as src/conventions.test.ts does.
const files = import.meta.glob<string>(
	["../public/robots.txt", "../public/_headers", "../index.html"],
	{ query: "?raw", import: "default", eager: true },
);
const read = (path: string): string => {
	const text = files[path];
	if (text === undefined) throw new Error(`${path} was not found`);
	return text;
};

const NO_INDEX = [
	"noindex",
	"nofollow",
	"noarchive",
	"nosnippet",
	"noimageindex",
	"noai",
	"noimageai",
];

describe("kept out of search engines and AI", () => {
	it("tells every crawler to stay away, and names the AI ones", () => {
		const robots = read("../public/robots.txt");
		expect(robots).toMatch(/User-agent: \*\s+Disallow: \/\s/);
		for (const bot of [
			"GPTBot",
			"ClaudeBot",
			"Google-Extended",
			"PerplexityBot",
			"CCBot",
			"Bytespider",
		]) {
			expect(robots).toContain(`User-agent: ${bot}`);
		}
	});

	it("marks every file and the page itself as not to be indexed or used", () => {
		const headers = read("../public/_headers");
		const page = read("../index.html");
		for (const word of NO_INDEX) {
			expect(headers).toMatch(new RegExp(`X-Robots-Tag:.*\\b${word}\\b`));
			expect(page).toMatch(
				new RegExp(`<meta name="robots" content="[^"]*\\b${word}\\b`),
			);
		}
	});

	it("does not say what it is before sign-in", () => {
		const page = read("../index.html");
		expect(page).toContain("<title>Logowanie</title>");
		expect(page.toLowerCase()).not.toMatch(/panel|admin/);
	});
});
