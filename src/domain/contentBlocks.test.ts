import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/data/schemas/workout";
import {
	blocksToJson,
	contentErrors,
	contentExcerpt,
	contentIssues,
	formattingBlockers,
	inspectContentJson,
	linkAddressIn,
	linkAddressProblem,
	looksLikeJson,
	parseContentJson,
	textSegments,
	textToBlocks,
	trailingCommas,
} from "./contentBlocks";

const title = (content: string): ContentBlock => ({
	type: "Title",
	content,
	metadata: null,
});
const text = (content: string): ContentBlock => ({
	type: "Text",
	content,
	metadata: null,
});
const image = (
	imageRelativePath: string,
	heightToWidthRatio: number,
): ContentBlock => ({
	type: "Image",
	content: "",
	metadata: { imageRelativePath, heightToWidthRatio },
});

const errorsOf = (block: ContentBlock) =>
	contentIssues([block])
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);
const warningsOf = (block: ContentBlock) =>
	contentIssues([block])
		.filter((issue) => issue.severity === "warning")
		.map((issue) => issue.message);

describe("content validation", () => {
	it("accepts what the app can show", () => {
		const blocks = [
			title("Co Cię dzisiaj czeka 🎧 [AUDIO]"),
			text(
				'Skupimy się na <b>biodrach i kręgosłupie</b>.\nWięcej w <a href="https://codzienniefitapp.com/faq">FAQ</a> 🙂',
			),
			image("workouts/mobilnosc.webp", 0.667),
		];
		expect(contentIssues(blocks)).toEqual([]);
	});

	it("reports the block a problem is in", () => {
		const issues = contentIssues([title("Dobrze"), text(""), title("")]);
		expect(issues.map((issue) => issue.index)).toEqual([1, 2]);
	});

	describe("title", () => {
		it("must not be empty", () => {
			expect(errorsOf(title("   "))).toEqual(["Tytuł jest pusty"]);
		});
		it("may carry a less-than and a greater-than sign that are no tag", () => {
			expect(errorsOf(title("Tempo < 5 min, puls > 120"))).toEqual([]);
			expect(errorsOf(title("3 < 5 > 2"))).toEqual([]);
		});

		it("must not carry tags", () => {
			expect(errorsOf(title("<b>Mocny</b> start"))).toHaveLength(1);
			expect(errorsOf(title("Koniec</b>"))).toHaveLength(1);
		});
		it("warns about a line break", () => {
			expect(errorsOf(title("Dwie\nlinie"))).toEqual([]);
			expect(warningsOf(title("Dwie\nlinie"))).toHaveLength(1);
		});
	});

	describe("text", () => {
		it("must not be empty", () => {
			expect(errorsOf(text(""))).toEqual(["Tekst jest pusty"]);
		});

		it.each([
			["<i>kursywa</i>", "italic"],
			["linia<br>druga", "a line break tag"],
			["<u>podkreślenie</u>", "underline"],
			["<strong>mocne</strong>", "strong"],
		])("refuses %s (%s)", (content) => {
			expect(errorsOf(text(content)).join(" ")).toContain(
				"nie jest obsługiwany",
			);
		});

		it.each([
			["<B>wielkie</B>", "upper case"],
			['<b class="x">atrybut</b>', "an attribute on bold"],
			["<b >spacja</b>", "a space inside the tag"],
		])("refuses %s (%s)", (content) => {
			expect(errorsOf(text(content)).join(" ")).toContain("zapisany inaczej");
		});

		it("does not take a sign in a sentence for a tag", () => {
			// Only "<" with a letter (or "/" and a letter) right after it begins a tag.
			for (const sentence of [
				"tempo < 5 min, puls > 120",
				"3 < 5 i 7 > 2",
				"serce <3 biegania > wszystko",
				"a <= b, c >= d",
				"strzałka -> i <- z powrotem",
				"a </ 3 > b",
			]) {
				expect(errorsOf(text(sentence)), sentence).toEqual([]);
			}
			// With a letter or a slash after it, it is one, as before.
			expect(errorsOf(text("tempo <i>szybkie</i>"))).toHaveLength(1);
			expect(errorsOf(text("koniec </i> tu"))).toHaveLength(1);
			expect(errorsOf(text("tempo <5min> i <b>mocno</b>"))).toEqual([]);
		});

		it("needs every tag closed", () => {
			expect(errorsOf(text("<b>bez końca")).join(" ")).toContain(
				"nie jest domknięte",
			);
			expect(
				errorsOf(text('<a href="https://x.pl">bez końca')).join(" "),
			).toContain("nie jest domknięty");
			expect(errorsOf(text("ucięty <b tag")).join(" ")).toContain(
				"bez zamykającego",
			);
		});

		it("refuses formatting that spans a line break", () => {
			expect(errorsOf(text("<b>pierwsza\ndruga</b>")).join(" ")).toContain(
				"nową linię",
			);
		});

		it("refuses emoji or a bracket inside bold or a link", () => {
			expect(errorsOf(text("<b>Nowy plan 🎧</b>")).join(" ")).toContain(
				"Pogrubienie nie zadziała",
			);
			expect(errorsOf(text("<b>[AUDIO] plan</b>")).join(" ")).toContain(
				"Pogrubienie nie zadziała",
			);
			expect(
				errorsOf(text('<a href="https://x.pl">Klik ➡</a>')).join(" "),
			).toContain("Link nie zadziała");
			expect(errorsOf(text("<b>Nowy plan</b> 🎧"))).toEqual([]);
		});

		it("refuses nesting either way", () => {
			expect(
				errorsOf(text('<a href="https://x.pl">zobacz <b>tu</b></a>')).join(" "),
			).toContain("Pogrubienie w linku „zobacz tu” nie zadziała");
			expect(
				errorsOf(text('<b>zobacz <a href="https://x.pl">tu</a></b>')).join(" "),
			).toContain("Link w pogrubionym tekście „zobacz tu” nie zadziała");
		});

		it("refuses empty bold", () => {
			expect(errorsOf(text("puste <b></b> tu")).join(" ")).toContain(
				"Puste pogrubienie",
			);
		});

		it("checks how a link's address is written", () => {
			expect(
				errorsOf(text("<a href='https://x.pl'>x</a>")).join(" "),
			).toContain("podwójnych cudzysłowach");
			expect(
				errorsOf(text('<a target="_blank" href="https://x.pl">x</a>')).join(
					" ",
				),
			).toContain("pierwszym atrybutem");
			expect(errorsOf(text('<a href="x.pl">x</a>'))).toEqual([]);
			expect(warningsOf(text('<a href="x.pl">x</a>')).join(" ")).toContain(
				"https://",
			);
		});

		it.each([
			["javascript:alert(1)"],
			["JavaScript:alert(1)"],
			[" javascript:alert(1)"],
			["data:text/html,x"],
			["file:///etc/hosts"],
			["intent://x"],
		])("refuses a link to %s", (href) => {
			expect(errorsOf(text(`<a href="${href}">x</a>`)).join(" ")).toContain(
				"niedozwolony",
			);
		});

		it.each([
			["https://codzienniefitapp.com/faq"],
			["http://codzienniefitapp.com"],
			["mailto:pomoc@example.test"],
			["tel:+48123456789"],
		])("accepts a link to %s", (href) => {
			expect(errorsOf(text(`<a href="${href}">x</a>`))).toEqual([]);
		});

		it("refuses HTML entities", () => {
			expect(errorsOf(text("Sól &amp; pieprz")).join(" ")).toContain("&amp;");
		});

		it("warns about an opening bracket anywhere", () => {
			expect(errorsOf(text("Plan [AUDIO]"))).toEqual([]);
			expect(warningsOf(text("Plan [AUDIO]"))).toHaveLength(1);
			expect(warningsOf(text("Plan (AUDIO)]"))).toEqual([]);
		});
	});

	describe("image", () => {
		it("needs a file", () => {
			expect(errorsOf(image("", 0.6))).toEqual(["Nie wybrano obrazu"]);
			expect(errorsOf({ type: "Image", content: "", metadata: null })).toEqual([
				"Nie wybrano obrazu",
			]);
		});
		it("needs a ratio above 0 and below 5", () => {
			expect(errorsOf(image("workouts/a.webp", 0))).toHaveLength(1);
			expect(errorsOf(image("workouts/a.webp", 5))).toHaveLength(1);
			expect(errorsOf(image("workouts/a.webp", 4.99))).toEqual([]);
		});
		it("warns about spaces and Polish letters in the file name", () => {
			expect(warningsOf(image("workouts/moje zdjęcie.webp", 0.6))).toHaveLength(
				1,
			);
			expect(warningsOf(image("workouts/moje-zdjecie.webp", 0.6))).toEqual([]);
		});
	});

	it("refuses a block type the app does not have", () => {
		expect(
			errorsOf({ type: "Video", content: "x", metadata: null }).join(" "),
		).toContain("Nieznany rodzaj bloku");
	});

	it("separates errors from warnings", () => {
		const blocks = [text("Plan [AUDIO]"), title("")];
		expect(contentIssues(blocks)).toHaveLength(2);
		expect(contentErrors(blocks)).toHaveLength(1);
	});
});

describe("an address typed for a link", () => {
	it.each([
		["https://codzienniefitapp.com/faq"],
		["http://codzienniefitapp.com"],
		["HTTPS://CODZIENNIEFITAPP.COM"],
		["mailto:pomoc@example.test"],
		["tel:+48123456789"],
		["  https://codzienniefitapp.com/faq?a=1&b=2#c  "],
	])("accepts %s", (address) => {
		expect(linkAddressProblem(address)).toBeNull();
	});

	it.each([
		["javascript:alert(1)"],
		["JavaScript:alert(1)"],
		["data:text/html,x"],
		["file:///etc/hosts"],
		["intent://x"],
		["ftp://x.pl"],
	])("refuses %s with the words the block's own check uses", (address) => {
		const problem = linkAddressProblem(address);
		expect(problem).toBe(
			`Adres linku „${address}” jest niedozwolony. Link musi zaczynać się od https://`,
		);
		expect(errorsOf(text(`<a href="${address}">x</a>`))).toEqual([problem]);
	});

	it("needs one of the schemes the app can open", () => {
		expect(linkAddressProblem("codzienniefitapp.com/faq")).toBe(
			"Adres linku „codzienniefitapp.com/faq” nie zaczyna się od https://",
		);
		expect(linkAddressProblem("/workouts")).toContain("nie zaczyna się od");
		expect(linkAddressProblem("https:codzienniefitapp.com")).toContain(
			"nie zaczyna się od",
		);
	});

	it("needs something after the scheme", () => {
		expect(linkAddressProblem("")).toBe("Wpisz adres linku");
		expect(linkAddressProblem("   ")).toBe("Wpisz adres linku");
		expect(linkAddressProblem("https://")).toBe("Adres linku jest niepełny");
		expect(linkAddressProblem("mailto:")).toBe("Adres linku jest niepełny");
	});

	it("refuses what would end the address early inside the tag", () => {
		for (const address of [
			'https://x.pl/"onclick="alert(1)',
			"https://x.pl/<b>",
			"https://x.pl/a>b",
			"https://x.pl/a b",
			"https://x.pl/a\nb",
		]) {
			expect(linkAddressProblem(address), address).toContain(
				"nie może zawierać",
			);
		}
	});

	it("reads the address out of a tag the way the app does", () => {
		expect(linkAddressIn('<a href="https://x.pl">')).toBe("https://x.pl");
		expect(linkAddressIn('<a target="_blank" href="https://x.pl">')).toBe(
			"_blank",
		);
		expect(linkAddressIn("<a href='https://x.pl'>")).toBe("");
		expect(linkAddressIn("<a>")).toBe("");
	});
});

describe("text preview", () => {
	it("splits bold and links from plain text", () => {
		expect(
			textSegments('Start <b>mocny</b>, potem <a href="https://x.pl">FAQ</a>.'),
		).toEqual([
			{ kind: "text", text: "Start " },
			{ kind: "bold", text: "mocny" },
			{ kind: "text", text: ", potem " },
			{ kind: "link", text: "FAQ", href: "https://x.pl" },
			{ kind: "text", text: "." },
		]);
	});

	it("leaves tags the app would not recognise as visible text", () => {
		expect(textSegments("<i>kursywa</i> i <b>niedomknięte")).toEqual([
			{ kind: "text", text: "<i>kursywa</i> i <b>niedomknięte" },
		]);
	});

	it("shows the tags when bold or a link holds an emoji or a bracket", () => {
		expect(textSegments("<b>Nowy plan 🎧</b> i <b>stary</b>")).toEqual([
			{ kind: "text", text: "<b>Nowy plan 🎧</b> i " },
			{ kind: "bold", text: "stary" },
		]);
		expect(textSegments('<a href="https://x.pl">[klik]</a>')).toEqual([
			{ kind: "text", text: '<a href="https://x.pl">[klik]</a>' },
		]);
	});

	it("handles plain and empty text", () => {
		expect(textSegments("zwykły")).toEqual([{ kind: "text", text: "zwykły" }]);
		expect(textSegments("")).toEqual([]);
	});
});

describe("pasted text to blocks", () => {
	const pasted = [
		"Co Cię czeka",
		"",
		"Krótki, spokojny start dnia. Skupimy się na <b>biodrach</b>.",
		"Zabierz matę.",
		"",
		"   ",
		"Sprzęt",
		"",
		"Gotowe na dziś.",
	].join("\n");

	it("makes short lone lines titles and the rest text", () => {
		expect(textToBlocks(pasted).map((b) => [b.type, b.content])).toEqual([
			["Title", "Co Cię czeka"],
			[
				"Text",
				"Krótki, spokojny start dnia. Skupimy się na <b>biodrach</b>.\nZabierz matę.",
			],
			["Title", "Sprzęt"],
			["Text", "Gotowe na dziś."],
		]);
	});

	it("respects the title length setting", () => {
		expect(textToBlocks("Co Cię czeka", 5)[0]?.type).toBe("Text");
		expect(textToBlocks("Co Cię czeka", 50)[0]?.type).toBe("Title");
	});

	it("strips tags from a title and handles Windows line endings", () => {
		expect(textToBlocks("<b>Sprzęt</b>\r\n\r\nMata i woda.")).toEqual([
			{ type: "Title", content: "Sprzęt", metadata: null },
			{ type: "Text", content: "Mata i woda.", metadata: null },
		]);
	});

	it("returns nothing for blank input", () => {
		expect(textToBlocks("  \n\n  ")).toEqual([]);
	});

	it("splits a short first line from the text right under it", () => {
		const pasted =
			"Dla kogo\nSilne nogi 14 dni: plan krok po kroku, z dniami odpoczynku.";
		expect(textToBlocks(pasted)).toEqual([
			{ type: "Title", content: "Dla kogo", metadata: null },
			{
				type: "Text",
				content: "Silne nogi 14 dni: plan krok po kroku, z dniami odpoczynku.",
				metadata: null,
			},
		]);
	});

	it("keeps the line breaks of the text under such a heading", () => {
		expect(
			textToBlocks("<b>Sprzęt</b>\nMata, woda i ręcznik.\nNic więcej.").map(
				(b) => [b.type, b.content],
			),
		).toEqual([
			["Title", "Sprzęt"],
			["Text", "Mata, woda i ręcznik.\nNic więcej."],
		]);
	});

	it("leaves a list of short lines as one text", () => {
		expect(textToBlocks("Hantle\nMata\nRoller")).toEqual([
			{ type: "Text", content: "Hantle\nMata\nRoller", metadata: null },
		]);
	});

	it("does not take a line that leads into what follows as a heading", () => {
		const pasted = "Potrzebujesz:\nmaty, butelki wody i dobrego nastroju.";
		expect(textToBlocks(pasted)).toEqual([
			{ type: "Text", content: pasted, metadata: null },
		]);
	});

	it("does not take a sentence or a long first line as a heading", () => {
		expect(
			textToBlocks("Zaczynamy.\nPierwszy dzień to spokojna rozgrzewka.")[0]
				?.type,
		).toBe("Text");
		expect(
			textToBlocks(
				"Pierwsza linia dłuższa niż tytuł\nPierwszy dzień to spokojna rozgrzewka.",
			),
		).toHaveLength(1);
	});
});

describe("JSON form", () => {
	const blocks: ContentBlock[] = [
		{ type: "Title", content: "Treść", metadata: null, x_new: "kept" },
		{
			type: "Image",
			content: "",
			metadata: {
				imageRelativePath: "challenges/a.webp",
				heightToWidthRatio: 0.64,
				x_new: "kept too",
			},
		},
	];

	it("recognises JSON by its first character", () => {
		expect(looksLikeJson('  [{"type":"Title"}]')).toBe(true);
		expect(looksLikeJson("Zwykły tekst [z nawiasem]")).toBe(false);
	});

	it("round-trips, keeping fields the panel does not know", () => {
		const parsed = parseContentJson(blocksToJson(blocks));
		expect(parsed).toEqual({ ok: true, blocks });
	});

	it("accepts the sample the old panel offered", () => {
		const parsed = parseContentJson(
			'[{"type":"Title","content":"Treść"},{"type":"Text","content":"Treść"}]',
		);
		expect(parsed.ok && parsed.blocks.map((b) => b.type)).toEqual([
			"Title",
			"Text",
		]);
	});

	it("explains what is wrong with bad input", () => {
		expect(parseContentJson("[{")).toMatchObject({ ok: false });
		expect(parseContentJson('{"type":"Title"}')).toMatchObject({
			ok: false,
			problem: expect.stringContaining("listą bloków"),
		});
		expect(
			parseContentJson('[{"type":"Title","content":"a"},{"content":"b"}]'),
		).toMatchObject({ ok: false, problem: expect.stringContaining("Blok 2") });
	});
});

describe("excerpt", () => {
	it("joins text without tags and skips images", () => {
		expect(
			contentExcerpt([
				title("Start"),
				image("a.webp", 1),
				text("Z <b>matą</b> i wodą."),
			]),
		).toBe("Start · Z matą i wodą.");
	});
	it("shortens long content", () => {
		expect(contentExcerpt([text("a".repeat(300))], 50)).toHaveLength(50);
	});
});

describe("formattingBlockers: what the editor's Bold and Link buttons refuse", () => {
	const plain = {
		text: "trzy serie",
		spansLines: false,
		inLink: false,
		inBold: false,
		allBold: false,
	};

	it("allows both on plain text in one line", () => {
		expect(formattingBlockers(plain)).toEqual({ bold: null, link: null });
	});

	it("refuses bold on a link, and a link on bold text, saying why", () => {
		const onLink = formattingBlockers({ ...plain, inLink: true });
		expect(onLink.bold).toMatch(/Nie można pogrubić tekstu linku/);
		const onBold = formattingBlockers({ ...plain, inBold: true });
		expect(onBold.link).toMatch(/Nie można dodać linku do pogrubionego tekstu/);
		expect(onBold.link).toMatch(/zdejmij pogrubienie/i);
	});

	it("always allows taking bold off", () => {
		expect(
			formattingBlockers({
				...plain,
				inBold: true,
				allBold: true,
				inLink: true,
			}).bold,
		).toBeNull();
	});

	it("lets a cursor in a link open that link", () => {
		expect(
			formattingBlockers({ ...plain, text: "", inLink: true }).link,
		).toBeNull();
		// but typing bold inside it is refused
		expect(
			formattingBlockers({ ...plain, text: "", inLink: true }).bold,
		).not.toBeNull();
	});

	it("names the emoji or symbol that would break the formatting", () => {
		const blockers = formattingBlockers({
			...plain,
			text: "brzuch 🔥 i plecy",
		});
		expect(blockers.bold).toMatch(/emoji, symbol albo „\[”.*🔥/);
		expect(blockers.link).toMatch(/🔥/);
	});

	it("refuses formatting across a new line", () => {
		const blockers = formattingBlockers({
			...plain,
			text: "a\nb",
			spansLines: true,
		});
		expect(blockers.bold).toMatch(/nową linię/);
		expect(blockers.link).toMatch(/nową linię/);
	});
});

describe("inspectContentJson", () => {
	it("says which block lacks what, and keeps the good ones in place", () => {
		const inspected = inspectContentJson(
			JSON.stringify([
				{ type: "Title" },
				{ type: "Text", content: "Dobrze." },
				{ content: 5 },
				"tekst",
			]),
		);
		if (inspected.kind !== "blocks") throw new Error("test: expected blocks");
		expect(inspected.blocks.map((block) => block?.content ?? null)).toEqual([
			null,
			"Dobrze.",
			null,
			null,
		]);
		expect(inspected.problems).toEqual([
			{
				index: 0,
				reason: "brakuje pola „content”",
				message: "Blok 1: brakuje pola „content”",
			},
			{
				index: 2,
				reason:
					"brakuje pola „type”, pole „content” musi być tekstem w cudzysłowie",
				message:
					"Blok 3: brakuje pola „type”, pole „content” musi być tekstem w cudzysłowie",
			},
			{
				index: 3,
				reason: "to nie jest obiekt { … }",
				message: "Blok 4: to nie jest obiekt { … }",
			},
		]);
	});

	it("points near the line of a syntax mistake", () => {
		const inspected = inspectContentJson(
			'[\n  {\n    "type": "Title"\n    "content": "x"\n  }\n]',
		);
		expect(inspected.kind).toBe("syntax");
		if (inspected.kind !== "syntax") return;
		expect(inspected.problem).toMatch(/^To nie jest poprawny JSON/);
		expect(inspected.problem).toMatch(/linii \d+/);
	});

	it("is ok for good blocks and refuses what is not a list", () => {
		expect(
			inspectContentJson('[{"type":"Text","content":"a","metadata":null}]')
				.kind,
		).toBe("ok");
		expect(inspectContentJson('{"type":"Text"}').kind).toBe("notList");
	});
});

describe("trailing commas", () => {
	it("names the block and the line of a comma left before }", () => {
		const text = [
			"[",
			"  {",
			'    "type": "Title",',
			"  },",
			"  {",
			'    "type": "Text",',
			'    "content": "Dobry, z przecinkiem, w tekście }",',
			'    "metadata": null',
			"  }",
			"]",
		].join("\n");
		expect(trailingCommas(text)).toEqual([
			{ index: 0, line: 3, at: text.indexOf('"Title",') + 7, before: "}" },
		]);
		const inspected = inspectContentJson(text);
		if (inspected.kind !== "blocks") throw new Error("test: expected blocks");
		// the second block is still read and drawn
		expect(inspected.blocks[0]).toBeNull();
		expect(inspected.blocks[1]?.content).toBe(
			"Dobry, z przecinkiem, w tekście }",
		);
		expect(inspected.problems).toEqual([
			{
				index: 0,
				reason:
					"zbędny przecinek przed „}” (linia 3): usuń go, brakuje pola „content”",
				message:
					"Blok 1: zbędny przecinek przed „}” (linia 3): usuń go, brakuje pola „content”",
			},
		]);
	});

	it("names a comma after the last block, and never counts one in quotes", () => {
		const text = '[{"type":"Text","content":"a, }"},\n]';
		const inspected = inspectContentJson(text);
		if (inspected.kind !== "blocks") throw new Error("test: expected blocks");
		expect(inspected.problems.map((problem) => problem.message)).toEqual([
			"Blok 1: zbędny przecinek po ostatnim bloku (linia 1): usuń go",
		]);
		expect(trailingCommas('[{"type":"Text","content":",}"}]')).toEqual([]);
	});

	it("still says where, when the commas are not the only mistake", () => {
		const inspected = inspectContentJson(
			'[{"type": "Title",}, {"type" "Text"}]',
		);
		expect(inspected.kind).toBe("syntax");
		if (inspected.kind !== "syntax") return;
		expect(inspected.problem).toContain("Blok 1: zbędny przecinek przed „}”");
	});
});
