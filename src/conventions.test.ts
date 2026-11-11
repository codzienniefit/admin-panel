import { describe, expect, it } from "vitest";

// Keeps docs/CODE-GUIDELINES.md true: the rules that can be checked by
// reading the source are checked here, so a slip fails the build instead of
// waiting for a review. Each failure lists the files to look at.

interface SourceFile {
	/** Relative to `src`, with forward slashes. */
	path: string;
	text: string;
}

// Every .ts and .tsx file under this folder (`src`) as text, except this
// file itself (a glob leaves out the file it is written in). Read through
// Vite rather than node:fs: the app's tsconfig has no Node types, and adding
// them for one test would let browser code use Node globals unnoticed.
const texts = import.meta.glob<string>("./**/*.{ts,tsx}", {
	query: "?raw",
	import: "default",
	eager: true,
});

const files: SourceFile[] = Object.entries(texts)
	.map(([path, text]) => ({ path: path.replace(/^\.\//, ""), text }))
	.toSorted((a, b) => a.path.localeCompare(b.path));

const isTest = (file: SourceFile) => /\.test\.tsx?$/.test(file.path);
const sources = files.filter((file) => !isTest(file));

/** The code without `//` and block comments. */
const withoutComments = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const paths = (found: readonly SourceFile[]) => found.map((file) => file.path);

/** An import of the bare client: the specifier is exactly "@/data/api". */
const importsClient =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']@\/data\/api["']/;

function textOf(path: string): string {
	const found = files.find((file) => file.path === path);
	if (!found) throw new Error(`src/${path} is gone; update this guard`);
	return found.text;
}

function expectNone(found: readonly SourceFile[], rule: string) {
	expect(
		paths(found),
		`${rule}:\n${paths(found)
			.map((path) => `  src/${path}`)
			.join("\n")}\n`,
	).toEqual([]);
}

describe("the source follows the written guidelines", () => {
	it("finds the source to check", () => {
		expect(files.length).toBeGreaterThan(200);
		expect(paths(files)).not.toContain("conventions.test.ts");
		expect(paths(files)).toContain("domain/rebase.test.ts");
		expect(paths(sources)).toContain("lib/storage.ts");
		expect(paths(sources)).toContain("data/collections/saver.ts");
		expect(sources.some((file) => file.path.endsWith(".tsx"))).toBe(true);
	});

	// A guard that can no longer see what it looks for passes for ever.
	it("recognises the things it looks for where they are allowed", () => {
		expect(textOf("ui/tasks.ts")).toContain("try {");
		expect(withoutComments(textOf("lib/storage.ts"))).toContain("localStorage");
		const onlyInComment = textOf("data/api/mock/persistence.ts");
		expect(onlyInComment).toContain("localStorage");
		expect(withoutComments(onlyInComment)).not.toContain("localStorage");
		expect(textOf("data/schemas/common.ts")).toContain("z.looseObject(");
		expect(importsClient.test(textOf("data/config.ts"))).toBe(true);
		expect(importsClient.test('import("@/data/api")')).toBe(true);
		expect(importsClient.test('import "@/data/api";')).toBe(true);
		expect(importsClient.test('from "@/data/api/errors"')).toBe(false);
		expect(importsClient.test('from "@/data/api/mock/controls"')).toBe(false);
	});

	it("keeps try out of components", () => {
		expectNone(
			files.filter(
				(file) => file.path.endsWith(".tsx") && file.text.includes("try {"),
			),
			"A .tsx file contains `try {`; use attempt/whileBusy from ui/tasks.ts, so the React Compiler can compile the component",
		);
	});

	it("has a test next to every file in domain/", () => {
		const all = new Set(paths(files));
		expectNone(
			sources.filter(
				(file) =>
					/^domain\/[^/]+\.ts$/.test(file.path) &&
					!all.has(file.path.replace(/\.ts$/, ".test.ts")),
			),
			"A file in src/domain has no .test.ts next to it",
		);
	});

	it("reaches localStorage only through lib/storage.ts", () => {
		expectNone(
			sources.filter(
				(file) =>
					file.path !== "lib/storage.ts" &&
					withoutComments(file.text).includes("localStorage"),
			),
			"localStorage is used outside src/lib/storage.ts; go through readStored/writeStored",
		);
	});

	it("keeps every schema loose", () => {
		const schemas = sources.filter((file) =>
			file.path.startsWith("data/schemas/"),
		);
		expect(schemas.length).toBeGreaterThan(0);
		expectNone(
			schemas.filter(
				(file) =>
					file.text.includes("z.object(") || file.text.includes(".strict("),
			),
			"A schema uses z.object( or .strict(, which drops or refuses fields this build does not know; use z.looseObject",
		);
	});

	it("never builds markup or code from text", () => {
		const banned = [
			"dangerouslySetInnerHTML",
			"innerHTML",
			"eval(",
			"new Function(",
		];
		expectNone(
			files.filter((file) => banned.some((word) => file.text.includes(word))),
			`A file contains one of ${banned.join(", ")}`,
		);
	});

	it("talks to the API client only from the data layer", () => {
		const allowed = (path: string) =>
			path.startsWith("data/api/") ||
			path.startsWith("data/collections/") ||
			path.startsWith("auth/") ||
			path === "data/config.ts";
		expectNone(
			sources.filter(
				(file) => !allowed(file.path) && importsClient.test(file.text),
			),
			'A file outside data/api, data/collections, data/config.ts and auth imports "@/data/api"; screens read and save through collections',
		);
	});
});
