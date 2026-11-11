import { describe, expect, it } from "vitest";
import { matchesQuery, normalizeText, plural, slugify } from "./text";

describe("normalizeText", () => {
	it("makes Łódź findable as lodz", () => {
		expect(normalizeText("Łódź")).toBe("lodz");
	});

	it.each([
		["ą", "a"],
		["ć", "c"],
		["ę", "e"],
		["ł", "l"],
		["ń", "n"],
		["ó", "o"],
		["ś", "s"],
		["ź", "z"],
		["ż", "z"],
		["Ą", "a"],
		["Ć", "c"],
		["Ę", "e"],
		["Ł", "l"],
		["Ń", "n"],
		["Ó", "o"],
		["Ś", "s"],
		["Ź", "z"],
		["Ż", "z"],
	])("reads %s as %s", (letter, plain) => {
		expect(normalizeText(letter)).toBe(plain);
	});

	it("handles a whole sentence", () => {
		expect(normalizeText("Zażółć gęślą jaźń")).toBe("zazolc gesla jazn");
		expect(normalizeText("ŚWIĄTECZNE Rozciąganie")).toBe(
			"swiateczne rozciaganie",
		);
	});

	it("treats a letter typed as base plus accent the same", () => {
		// "ó" as "o" followed by a combining acute accent.
		expect(normalizeText("Jóga")).toBe("joga");
	});

	it("leaves digits, spaces and punctuation alone", () => {
		expect(normalizeText("Dzień 7: HIIT (20 min)")).toBe(
			"dzien 7: hiit (20 min)",
		);
		expect(normalizeText("")).toBe("");
	});
});

describe("matchesQuery", () => {
	const title = "Poranna joga dla początkujących – Łódź";

	it("matches whatever the case and the diacritics, on either side", () => {
		expect(matchesQuery(title, "lodz")).toBe(true);
		expect(matchesQuery(title, "ŁÓDŹ")).toBe(true);
		expect(matchesQuery(title, "poczatkujacych")).toBe(true);
		expect(matchesQuery("Poranna joga dla poczatkujacych", "początk")).toBe(
			true,
		);
	});

	it("wants every word of the query, in any order", () => {
		expect(matchesQuery(title, "joga poranna")).toBe(true);
		expect(matchesQuery(title, "łódź joga")).toBe(true);
		expect(matchesQuery(title, "joga wieczorna")).toBe(false);
	});

	it("matches parts of words", () => {
		expect(matchesQuery(title, "pora jog")).toBe(true);
	});

	it("ignores extra spaces in the query", () => {
		expect(matchesQuery(title, "  joga \t  łódź \n")).toBe(true);
	});

	it("matches everything for an empty query", () => {
		expect(matchesQuery(title, "")).toBe(true);
		expect(matchesQuery(title, "   ")).toBe(true);
		expect(matchesQuery("", "")).toBe(true);
	});

	it("finds nothing in an empty text", () => {
		expect(matchesQuery("", "joga")).toBe(false);
	});
});

describe("plural", () => {
	const bloki = (count: number) => plural(count, "blok", "bloki", "bloków");

	it("uses the singular for exactly one", () => {
		expect(bloki(1)).toBe("1 blok");
	});

	it.each([2, 3, 4, 22, 23, 24, 32, 102, 104, 1002])("says %i bloki", (n) => {
		expect(bloki(n)).toBe(`${n} bloki`);
	});

	it.each([
		0, 5, 6, 9, 10, 11, 15, 19, 20, 21, 25, 30, 31, 100, 101, 105, 1000,
	])("says %i bloków", (n) => {
		expect(bloki(n)).toBe(`${n} bloków`);
	});

	it.each([12, 13, 14, 112, 113, 114, 212, 1012])(
		"says %i bloków, the teens being an exception",
		(n) => {
			expect(bloki(n)).toBe(`${n} bloków`);
		},
	);

	it("picks the form of a negative count by its size", () => {
		expect(bloki(-1)).toBe("-1 blok");
		expect(bloki(-3)).toBe("-3 bloki");
		expect(bloki(-5)).toBe("-5 bloków");
		expect(bloki(-12)).toBe("-12 bloków");
		expect(bloki(-22)).toBe("-22 bloki");
	});

	it("works for other nouns", () => {
		expect(plural(1, "dzień", "dni", "dni")).toBe("1 dzień");
		expect(plural(28, "dzień", "dni", "dni")).toBe("28 dni");
		expect(plural(3, "trening", "treningi", "treningów")).toBe("3 treningi");
		expect(plural(17, "trening", "treningi", "treningów")).toBe("17 treningów");
	});
});

describe("slugify", () => {
	it("makes a file name the storage accepts", () => {
		expect(slugify("Poranna Joga – część 2.webp")).toBe(
			"poranna-joga-czesc-2.webp",
		);
		expect(slugify("Wiosenne wyzwanie biegowe")).toBe(
			"wiosenne-wyzwanie-biegowe",
		);
	});

	it("drops Polish diacritics instead of the letters", () => {
		expect(slugify("Zażółć gęślą jaźń")).toBe("zazolc-gesla-jazn");
		expect(slugify("Łódź")).toBe("lodz");
	});

	it("keeps dots, underscores and hyphens", () => {
		expect(slugify("okladka_v2.final.WEBP")).toBe("okladka_v2.final.webp");
		expect(slugify("hiit-20-min")).toBe("hiit-20-min");
	});

	it("joins a run of anything else into one hyphen", () => {
		expect(slugify("Trening (HIIT) #3")).toBe("trening-hiit-3");
		expect(slugify("siła  &  wytrzymałość")).toBe("sila-wytrzymalosc");
		expect(slugify("a - b")).toBe("a-b");
		expect(slugify("a---b")).toBe("a-b");
	});

	it("has no hyphen at either end", () => {
		expect(slugify("  Żółw!  ")).toBe("zolw");
		expect(slugify("(nowy) plan")).toBe("nowy-plan");
	});

	it("is empty when nothing usable is left", () => {
		expect(slugify("")).toBe("");
		expect(slugify("¿?!")).toBe("");
		expect(slugify(" – ")).toBe("");
	});
});
