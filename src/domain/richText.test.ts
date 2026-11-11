import { describe, expect, it } from "vitest";
import { type TextSegment, textSegments } from "./contentBlocks";
import {
	contentToDoc,
	contentToInline,
	docToContent,
	type RichInline,
	type RichMark,
} from "./richText";

const bold: RichMark = { type: "bold" };
const link = (href: string, source: string | null = null): RichMark => ({
	type: "link",
	attrs: { href, source },
});
const text = (value: string, ...marks: RichMark[]): RichInline =>
	marks.length > 0
		? { type: "text", text: value, marks }
		: { type: "text", text: value };
const lineBreak: RichInline = { type: "hardBreak" };

/** A document as an editor would hand it back: one paragraph of inline nodes. */
const docOf = (...inline: RichInline[]) => ({
	type: "doc",
	content: [{ type: "paragraph", content: inline }],
});

const roundTrip = (content: string) => docToContent(contentToDoc(content));

describe("stored text to document", () => {
	it("opens plain text as one paragraph", () => {
		expect(contentToDoc("Zabierz matę i wodę.")).toEqual({
			type: "doc",
			content: [{ type: "paragraph", content: [text("Zabierz matę i wodę.")] }],
		});
	});

	it("opens an empty block as an empty paragraph", () => {
		expect(contentToDoc("")).toEqual({
			type: "doc",
			content: [{ type: "paragraph" }],
		});
	});

	it("turns the two tags into marks, so no tag is left to see", () => {
		expect(
			contentToInline(
				'Start <b>mocny</b>, potem <a href="https://x.pl">FAQ</a>.',
			),
		).toEqual([
			text("Start "),
			text("mocny", bold),
			text(", potem "),
			text("FAQ", link("https://x.pl")),
			text("."),
		]);
	});

	it("turns every line break into a break, also the first and the last", () => {
		expect(contentToInline("\nraz\n\ndwa\n")).toEqual([
			lineBreak,
			text("raz"),
			lineBreak,
			lineBreak,
			text("dwa"),
			lineBreak,
		]);
	});

	it("reads bold inside a link and a link inside bold", () => {
		expect(
			contentToInline('<a href="https://x.pl">zobacz <b>tu</b></a>'),
		).toEqual([
			text("zobacz ", link("https://x.pl")),
			text("tu", link("https://x.pl"), bold),
		]);
		expect(
			contentToInline('<b>zobacz <a href="https://x.pl">tu</a></b>'),
		).toEqual([text("zobacz ", bold), text("tu", bold, link("https://x.pl"))]);
	});

	it("reads bold inside bold as bold, once", () => {
		expect(contentToInline("po <b><b>dniami</b></b> koniec")).toEqual([
			text("po "),
			text("dniami", bold),
			text(" koniec"),
		]);
	});

	it("joins bold that was written in pieces", () => {
		expect(contentToInline("<b>raz</b><b>dwa</b>")).toEqual([
			text("razdwa", bold),
		]);
	});

	it.each([
		["a < b i c > d"],
		["Sól &amp; pieprz &lt;3"],
		["<i>kursywa</i> zostaje"],
		["linia<br>druga"],
		["<B>wielkie</B> i <b >spacja</b>"],
		["<b>bez końca"],
		["bez początku</b> i </a>"],
		["ucięty <b tag"],
		["<a>bez adresu</a>"],
		["puste <b></b> i <b> </b> tu"],
		['pusty <a href="https://x.pl"></a> link'],
	])("leaves %s as the text it is", (content) => {
		expect(contentToInline(content)).toEqual([text(content)]);
	});

	it("does not pair a tag with one on another line", () => {
		expect(contentToInline("<b>pierwsza\ndruga</b>")).toEqual([
			text("<b>pierwsza"),
			lineBreak,
			text("druga</b>"),
		]);
	});

	it("keeps an address it would refuse to save: the data is not ours to drop", () => {
		expect(contentToInline('<a href="javascript:alert(1)">klik</a>')).toEqual([
			text("klik", link("javascript:alert(1)")),
		]);
	});

	it("takes the address the way the app does and remembers an unusual tag", () => {
		const blank = '<a href="https://x.pl" target="_blank">';
		expect(contentToInline(`${blank}FAQ</a>`)).toEqual([
			text("FAQ", link("https://x.pl", blank)),
		]);
		// The first thing in double quotes is the address, whatever it is.
		const reversed = '<a target="_blank" href="https://x.pl">';
		expect(contentToInline(`${reversed}FAQ</a>`)).toEqual([
			text("FAQ", link("_blank", reversed)),
		]);
		// No double quotes, no address: a link that leads nowhere.
		expect(contentToInline("<a href='https://x.pl'>FAQ</a>")).toEqual([
			text("FAQ", link("", "<a href='https://x.pl'>")),
		]);
	});
});

describe("document to stored text", () => {
	it("writes marks as the two tags", () => {
		expect(
			docToContent(
				docOf(
					text("Start "),
					text("mocny", bold),
					text(", potem "),
					text("FAQ", link("https://x.pl")),
				),
			),
		).toBe('Start <b>mocny</b>, potem <a href="https://x.pl">FAQ</a>');
	});

	it("writes an empty document as an empty string", () => {
		expect(
			docToContent({ type: "doc", content: [{ type: "paragraph" }] }),
		).toBe("");
		expect(docToContent({ type: "doc" })).toBe("");
	});

	it("writes a break as a line break", () => {
		expect(
			docToContent(docOf(text("raz"), lineBreak, lineBreak, text("dwa"))),
		).toBe("raz\n\ndwa");
		expect(docToContent(docOf(lineBreak, text("raz"), lineBreak))).toBe(
			"\nraz\n",
		);
	});

	it("closes formatting before a line break and opens it again after", () => {
		expect(
			docToContent(
				docOf(text("pierwsza", bold), lineBreak, text("druga", bold)),
			),
		).toBe("<b>pierwsza</b>\n<b>druga</b>");
		expect(
			docToContent(
				docOf(
					text("raz", link("https://x.pl")),
					lineBreak,
					text("dwa", link("https://x.pl")),
				),
			),
		).toBe('<a href="https://x.pl">raz</a>\n<a href="https://x.pl">dwa</a>');
	});

	it("never writes bold inside bold, however the document is cut up", () => {
		expect(
			docToContent(docOf(text("dni", bold), text("ami", bold), text("."))),
		).toBe("<b>dniami</b>.");
	});

	it("does not write bold that holds only spaces", () => {
		expect(docToContent(docOf(text("a"), text(" ", bold), text("b")))).toBe(
			"a b",
		);
		// Spaces next to bold words stay inside: that is one bold run.
		expect(docToContent(docOf(text("a ", bold), text("b", bold)))).toBe(
			"<b>a b</b>",
		);
	});

	it("nests a link and bold so that neither is opened twice", () => {
		const address = link("https://x.pl");
		expect(
			docToContent(docOf(text("zobacz ", address), text("tu", address, bold))),
		).toBe('<a href="https://x.pl">zobacz <b>tu</b></a>');
		expect(
			docToContent(docOf(text("tu", bold, address), text(" dalej", bold))),
		).toBe('<b><a href="https://x.pl">tu</a> dalej</b>');
		// Overlapping, which tags cannot say: the shared part goes inside.
		expect(
			docToContent(
				docOf(text("a", bold), text("b", bold, address), text("c", address)),
			),
		).toBe('<b>a<a href="https://x.pl">b</a></b><a href="https://x.pl">c</a>');
	});

	it("keeps two links apart and joins the pieces of one", () => {
		expect(
			docToContent(
				docOf(text("raz", link("https://x.pl")), text("dwa", link("tel:1"))),
			),
		).toBe('<a href="https://x.pl">raz</a><a href="tel:1">dwa</a>');
		expect(
			docToContent(
				docOf(
					text("raz", link("https://x.pl")),
					text("dwa", link("https://x.pl")),
				),
			),
		).toBe('<a href="https://x.pl">razdwa</a>');
	});

	it("leaves out a link whose address cannot be written between quotes", () => {
		expect(docToContent(docOf(text("klik", link(""))))).toBe("klik");
		expect(docToContent(docOf(text("klik", link('x" onclick="y'))))).toBe(
			"klik",
		);
		expect(docToContent(docOf(text("klik", link("https://x.pl/<a>"))))).toBe(
			"klik",
		);
	});

	it("forgets an unusual tag once its address has been changed", () => {
		const source = '<a href="https://x.pl" target="_blank">';
		expect(docToContent(docOf(text("FAQ", link("https://x.pl", source))))).toBe(
			`${source}FAQ</a>`,
		);
		expect(docToContent(docOf(text("FAQ", link("https://y.pl", source))))).toBe(
			'<a href="https://y.pl">FAQ</a>',
		);
	});

	it("takes what an editor adds to its documents", () => {
		expect(
			docToContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						attrs: { dir: null },
						content: [
							{
								type: "text",
								text: "FAQ",
								marks: [
									{ type: "link", attrs: { href: "https://x.pl", rel: null } },
									{ type: "italic" },
								],
							},
							{ type: "hardBreak", marks: [{ type: "bold" }] },
							{ type: "text", text: "dwie\nlinie" },
						],
					},
				],
			}),
		).toBe('<a href="https://x.pl">FAQ</a>\ndwie\nlinie');
	});
});

describe("there and back", () => {
	it.each([
		[""],
		["Zabierz matę i wodę."],
		["Skupimy się na <b>biodrach i kręgosłupie</b>."],
		['Więcej w <a href="https://codzienniefitapp.com/faq">FAQ</a> 🙂'],
		[
			'<a href="mailto:pomoc@example.test">Napisz</a> albo <a href="tel:+48123456789">zadzwoń</a>',
		],
		['<a href="https://x.pl">zobacz <b>tu</b></a>'],
		['<b>zobacz <a href="https://x.pl">tu</a></b>'],
		[
			'<b><a href="https://x.pl">tu</a></b> i <a href="https://x.pl"><b>tam</b></a>',
		],
		["\n\nraz\n\n\ndwa\n"],
		["<b>raz</b>\n<b>dwa</b>\n\n<b>trzy</b>"],
		["a < b, c > d, e <> f"],
		["Sól &amp; pieprz, &lt;b&gt; i &#39;"],
		["<i>kursywa</i>, <u>podkreślenie</u>, <br>, <B>X</B>, <b >y</b>"],
		["<b>niedomknięte i domknięte</b></b> oraz <b>"],
		["<a>bez adresu</a> i <a href>też</a>"],
		['<a href="javascript:alert(1)">klik</a>'],
		['<a href="x.pl">bez https</a>'],
		['<a href="https://x.pl" target="_blank">nowa karta</a>'],
		['<a target="_blank" href="https://x.pl">odwrotnie</a>'],
		["<a href='https://x.pl'>pojedyncze</a>"],
		["<b>Nowy plan 🎧</b> i <b>[AUDIO]</b>"],
		["<b>pierwsza\ndruga</b>"],
		['puste <b></b>, <b> </b> i <a href="https://x.pl"></a>'],
		["  spacje   w środku  i\tna końcu  "],
	])("gives back %j unchanged", (content) => {
		expect(roundTrip(content)).toBe(content);
	});

	it.each([
		["<b><b>dniami</b></b>", "<b>dniami</b>"],
		["raz\r\ndwa\rtrzy", "raz\ndwa\ntrzy"],
		["co <b>dwa</b><b> dni</b>", "co <b>dwa dni</b>"],
		["<b>a<b>b</b>c</b>", "<b>abc</b>"],
		[
			'<b>a<a href="https://x.pl">b</b>c</a>',
			'<b>a<a href="https://x.pl">b</a></b><a href="https://x.pl">c</a>',
		],
		[
			'<a href="https://x.pl">raz</a><a href="https://x.pl">dwa</a>',
			'<a href="https://x.pl">razdwa</a>',
		],
	])("tidies %j into %j, and then leaves it alone", (content, tidy) => {
		expect(roundTrip(content)).toBe(tidy);
		expect(roundTrip(tidy)).toBe(tidy);
	});

	it("settles: what was written reads back as the same document", () => {
		const documents = [
			docOf(text("a", bold), text(" ", bold, link("https://x.pl")), text("b")),
			docOf(text(" ", bold), lineBreak, text("x", link("tel:1"), bold)),
			docOf(text("<b>", bold), text("literał"), text("</b>")),
			docOf(text("a", link("https://x.pl"), bold), text("b", bold)),
		];
		for (const document of documents) {
			const content = docToContent(document);
			expect(docToContent(contentToDoc(content))).toBe(content);
		}
	});
});

// ---------------------------------------------------------------------------
// The app's own reading of a text (`textSegments`) is the reference: for
// everything it understands, the editor's document says the same, and the
// string comes back untouched.

/** A small repeatable source of numbers: the same cases on every run. */
function sequence(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

const WORDS = [
	"Zacznij",
	"od pięciu minut",
	"marszu,",
	"potem krążenia",
	"ramion.",
	"żółć & gęś",
	"a < b",
	"2 > 1",
	"(ok)",
	"100%",
	" ",
	"  ",
	"\n",
	"\n\n",
	"co drugi dzień",
	"„cytat”",
	"it's",
	"🙂",
	"🎧 audio",
];
const ADDRESSES = [
	"https://codzienniefitapp.com/faq",
	"http://x.pl/a?b=1&c=2#d",
	"mailto:pomoc@example.test",
	"tel:+48123456789",
	"x.pl",
	"javascript:alert(1)",
];

function randomSegments(next: () => number): TextSegment[] {
	const pick = <T>(list: readonly T[]) =>
		list[Math.floor(next() * list.length)] as T;
	const count = 1 + Math.floor(next() * 7);
	const out: TextSegment[] = [];
	while (out.length < count) {
		const previous = out.at(-1);
		const roll = next();
		const words = pick(WORDS) + (next() < 0.5 ? ` ${pick(WORDS)}` : "");
		if (roll < 0.45) {
			// Two stretches of plain text in a row are one stretch.
			if (previous?.kind === "text") previous.text += words;
			else out.push({ kind: "text", text: words });
			continue;
		}
		// Inside the tags the app takes neither a line break nor an emoji, and
		// bold around nothing but spaces is not bold.
		const inside = words.replace(/\n/g, " ").replace(/🙂|🎧/g, "x");
		if (roll < 0.75) {
			if (previous?.kind === "bold" || inside.trim() === "") continue;
			out.push({ kind: "bold", text: inside });
		} else {
			const href = pick(ADDRESSES);
			if (previous?.kind === "link" && previous.href === href) continue;
			out.push({ kind: "link", text: inside, href });
		}
	}
	return out;
}

const written = (segments: readonly TextSegment[]) =>
	segments
		.map((segment) =>
			segment.kind === "bold"
				? `<b>${segment.text}</b>`
				: segment.kind === "link"
					? `<a href="${segment.href}">${segment.text}</a>`
					: segment.text,
		)
		.join("");

/** The document read the way the preview reads the string. */
function asSegments(inline: readonly RichInline[]): TextSegment[] {
	const out: TextSegment[] = [];
	for (const node of inline) {
		const value = node.type === "hardBreak" ? "\n" : node.text;
		const marks = node.type === "hardBreak" ? [] : (node.marks ?? []);
		const mark = marks[0];
		const previous = out.at(-1);
		if (!mark) {
			if (previous?.kind === "text") previous.text += value;
			else out.push({ kind: "text", text: value });
		} else if (mark.type === "bold") {
			out.push({ kind: "bold", text: value });
		} else {
			out.push({ kind: "link", text: value, href: mark.attrs.href });
		}
	}
	return out;
}

describe("agreement with what the app shows", () => {
	it("reads every text the app understands as the app does, and writes it back unchanged", () => {
		const next = sequence(20261111);
		for (let round = 0; round < 500; round += 1) {
			const segments = randomSegments(next);
			const content = written(segments);
			// The generator only makes what the app's reading takes apart again.
			expect(textSegments(content), content).toEqual(segments);

			const inline = contentToInline(content);
			expect(asSegments(inline), content).toEqual(segments);
			expect(roundTrip(content), content).toBe(content);
		}
	});

	it("agrees with the app on the examples of its own tests", () => {
		for (const content of [
			'Start <b>mocny</b>, potem <a href="https://x.pl">FAQ</a>.',
			"<i>kursywa</i> i <b>niedomknięte",
			"zwykły",
		]) {
			expect(asSegments(contentToInline(content))).toEqual(
				textSegments(content),
			);
		}
	});
});
