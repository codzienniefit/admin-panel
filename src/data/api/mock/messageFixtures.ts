import type { ContentBlock } from "@/data/schemas/common";
import type { Message } from "@/data/schemas/message";
import { UNKNOWN_FIELD } from "./fixtures";

// Sample messages: a few drafts in different states of readiness, a history
// of sent ones and a small archive. Synthetic.

const BASE_TIME = Date.UTC(2026, 10, 10, 9, 0, 0);
const DAY = 86_400_000;
const iso = (daysAgo: number) =>
	new Date(BASE_TIME - daysAgo * DAY).toISOString();

const SENDER = "Codziennie Fit";

const block = (
	type: string,
	content: string,
	metadata?: ContentBlock["metadata"],
): ContentBlock => ({
	type,
	content,
	metadata: metadata ?? null,
	[UNKNOWN_FIELD]: "block",
});

const body = (heading: string, ...paragraphs: string[]): ContentBlock[] => [
	block("Title", heading),
	...paragraphs.map((text) => block("Text", text)),
];

type Row = Pick<Message, "title" | "status" | "targetGroup"> & {
	daysAgo: number;
	fancyContent: ContentBlock[];
	from?: string;
	/** Days after creation it was sent; absent for one never sent. */
	sentAfter?: number;
	archivedAfter?: number;
};

const SENT: Array<
	[title: string, group: string, heading: string, text: string]
> = [
	[
		"Start wyzwania Mocne plecy",
		"all",
		"Ruszamy w poniedziałek",
		"Siedem dni, jeden trening dziennie. <b>Dołącz</b> w zakładce Wyzwania.",
	],
	[
		"Nowe treningi jogi",
		"all",
		"Pięć nowych sesji jogi",
		"Spokojne poranki i wieczorne wyciszenie czekają w katalogu.",
	],
	[
		"Przypomnienie o live",
		"subscribers",
		"Dziś o 19:00 trenujemy na żywo",
		"Przygotuj matę i wodę. Nagranie zostanie w aplikacji.",
	],
	[
		"Ankieta po wyzwaniu",
		"all",
		"Jak Ci poszło?",
		'Opowiedz nam o tym w <a href="https://example.test/ankieta">krótkiej ankiecie</a>.',
	],
	[
		"Plan na jesień",
		"nonSubscribers",
		"Jesienna forma startuje",
		"Cztery tygodnie ruchu w domu, bez sprzętu.",
	],
	[
		"Zmiana godziny live",
		"subscribers",
		"Live przeniesiony na środę",
		"Widzimy się o tej samej porze, dzień później.",
	],
	[
		"Podsumowanie miesiąca",
		"all",
		"Wasz październik w liczbach",
		"Razem zrobiliście ponad <b>dwadzieścia tysięcy</b> treningów. Brawo!",
	],
	[
		"Nowa odznaka do zdobycia",
		"all",
		"Odznaka za poranne treningi",
		"Zrób pięć treningów przed ósmą i odbierz odznakę.",
	],
	[
		"Przerwa techniczna",
		"all",
		"Krótka przerwa w nocy",
		"W nocy z wtorku na środę aplikacja może działać wolniej.",
	],
	[
		"Trening dla początkujących",
		"nonSubscribers",
		"Zacznij od zera",
		"Nowy plan dla osób, które wracają do ruchu po przerwie.",
	],
	[
		"Życzenia świąteczne",
		"all",
		"Spokojnych świąt",
		"Dziękujemy, że trenujecie z nami. Do zobaczenia na macie!",
	],
	[
		"Start zapisów na wiosnę",
		"subscribers",
		"Wiosenny start już wkrótce",
		"Jako pierwsi zobaczycie plan nowego wyzwania.",
	],
];

const ROWS: Row[] = [
	{
		title: "Zapowiedź wyzwania Wiosenny start",
		status: "draft",
		targetGroup: "all",
		daysAgo: 1,
		fancyContent: [
			...body(
				"Wiosenny start",
				"Czternaście dni, dwa poziomy. <b>Zapisy ruszają w marcu.</b>",
			),
			block("Image", "", {
				imageRelativePath: "messages/cf-0003.webp",
				heightToWidthRatio: 0.56,
				[UNKNOWN_FIELD]: "metadata",
			}),
		],
	},
	{
		// Ready except for the recipients: sending must be refused.
		title: "Nowy plan uzupełniający",
		status: "draft",
		targetGroup: null,
		daysAgo: 2,
		fancyContent: body(
			"Rozciąganie na koniec dnia",
			"Dziesięć minut, które robią różnicę.",
		),
	},
	{
		// Content the app would show wrongly: sending must be refused.
		title: "Promocja Pro (do poprawy)",
		status: "draft",
		targetGroup: "nonSubscribers",
		daysAgo: 4,
		fancyContent: body(
			"Sprawdź <i>Pro</i>",
			"Więcej planów i treningi na żywo.",
		),
	},
	{
		title: "Pomysł: cykl o oddychaniu",
		status: "draft",
		targetGroup: null,
		from: "",
		daysAgo: 6,
		fancyContent: [],
	},
	...SENT.map(
		([title, targetGroup, heading, text], index): Row => ({
			title,
			status: "sent",
			targetGroup,
			daysAgo: 9 + index * 11,
			sentAfter: 0.25,
			fancyContent: body(heading, text),
		}),
	),
	{
		title: "Letnie wyzwanie (stare)",
		status: "archived",
		targetGroup: "all",
		daysAgo: 160,
		sentAfter: 1,
		archivedAfter: 60,
		fancyContent: body("Letnie wyzwanie", "Trzy tygodnie ruchu na dworze."),
	},
	{
		title: "Zeszłoroczna promocja",
		status: "archived",
		targetGroup: "nonSubscribers",
		daysAgo: 300,
		sentAfter: 0.5,
		archivedAfter: 30,
		fancyContent: body("Pro taniej do niedzieli", "Oferta już nieaktualna."),
	},
	{
		title: "Szkic, z którego zrezygnowaliśmy",
		status: "archived",
		targetGroup: "all",
		daysAgo: 45,
		archivedAfter: 3,
		fancyContent: body("Niespodzianka", "Do dopisania."),
	},
];

export function buildMessageFixtures(): Message[] {
	return ROWS.map((row, index) => {
		const { daysAgo, sentAfter, archivedAfter, ...fields } = row;
		const sentAtUtc = sentAfter === undefined ? null : iso(daysAgo - sentAfter);
		const archivedAtUtc =
			archivedAfter === undefined ? null : iso(daysAgo - archivedAfter);
		return {
			id: `M${ROWS.length - index}`,
			etag: "1",
			from: SENDER,
			targetGroupValue: null,
			...fields,
			createdAtUtc: iso(daysAgo),
			sentAtUtc,
			archivedAtUtc,
			updatedAtUtc: archivedAtUtc ?? sentAtUtc ?? iso(daysAgo),
			[UNKNOWN_FIELD]: `message:M${ROWS.length - index}`,
		};
	});
}
