import { type Badge, blankBadge } from "@/data/schemas/badge";
import { slugify } from "@/domain/text";

// Sample badge definitions. Synthetic, like everything in the Test
// environment. The ids n_1 and n_3 are the ones sample workouts and
// challenges award (fixtures.ts), so those two must stay visible.

const BASE_TIME = Date.UTC(2026, 10, 10, 9, 0, 0);
const DAY = 86_400_000;
const iso = (daysAgo: number) =>
	new Date(BASE_TIME - daysAgo * DAY).toISOString();

type Row = [id: string, title: string, fields?: Partial<Badge>];

const challengeSection = { sectionId: "challenges", subsectionId: "completed" };
const workoutSection = { sectionId: "workouts", subsectionId: "single" };
const repeatSection = { sectionId: "workouts", subsectionId: "repeats" };
const eventSection = { sectionId: "special", subsectionId: "events" };
const trainingSection = { sectionId: "special", subsectionId: "trainings" };

const NORMAL: Row[] = [
	["n_1", "Pierwszy trening", workoutSection],
	["n_2", "Mistrzyni mobilności"],
	["n_3", "Siła charakteru", challengeSection],
	["n_4", "Spokój ducha", { comment: "Do planu jogi, jeszcze nieprzypisana." }],
	["n_5", "Mocne plecy"],
	["n_6", "Poranny ptaszek"],
	["n_7", "Wiosenny start", { activeFromUtc: iso(-110) }],
	[
		"n_8",
		"Jesienna forma",
		{ isHidden: true, comment: "Stara grafika, zastąpiona nową." },
	],
	["n_9", "Żelazna wola", { activeFromUtc: iso(200), activeTillUtc: iso(20) }],
	["n_10", "Zdrowy kręgosłup"],
];

const milestone = (category: string, count: number, title: string): Row => [
	`m_${category}_${count}`,
	title,
	{
		type: "milestone",
		repeatCategory: category,
		milestoneCount: count,
		...repeatSection,
	},
];

const MILESTONES: Row[] = [
	milestone("workouts", 10, "10 treningów"),
	milestone("workouts", 25, "25 treningów"),
	milestone("workouts", 50, "50 treningów"),
	milestone("workouts", 100, "100 treningów"),
	milestone("challenges", 1, "Pierwsze wyzwanie"),
	milestone("challenges", 3, "3 wyzwania"),
	milestone("challenges", 5, "5 wyzwań"),
];

const MANUAL: Row[] = [
	[
		"s_1",
		"Spotkanie na żywo",
		{
			type: "manual",
			specialCategory: "event",
			claimToken: "SPOTKANIE2026",
			isClaimLinkActive: true,
			comment: "Kod QR na spotkaniu w Warszawie.",
			...eventSection,
		},
	],
	[
		"s_2",
		"Targi zdrowia",
		{
			type: "manual",
			specialCategory: "event",
			claimToken: "TARGI2025",
			isClaimLinkActive: false,
			comment: "Po targach zdobywanie wyłączone.",
			...eventSection,
		},
	],
	[
		"s_3",
		"Trening z trenerką",
		{ type: "manual", specialCategory: "specialTraining", ...trainingSection },
	],
	[
		"s_4",
		"Testerka aplikacji",
		{
			type: "manual",
			specialCategory: "specialTraining",
			isHidden: true,
			comment: "Dla osób z zamkniętych testów.",
			...trainingSection,
		},
	],
];

const PERFECTIONS: Row[] = [
	[
		"p_1",
		"Wyzwanie na 100%",
		{ type: "perfections", sectionId: "challenges", subsectionId: "perfect" },
	],
	[
		"p_3",
		"Trzy wyzwania na 100%",
		{ type: "perfections", sectionId: "challenges", subsectionId: "perfect" },
	],
];

/**
 * The sample badges. `unknownField` is the name of the field that stands
 * for "something a newer backend added" (UNKNOWN_FIELD in fixtures.ts, which
 * calls this; passed in so the two files do not import each other).
 */
export function buildBadgeFixtures(unknownField: string): Badge[] {
	return [...NORMAL, ...MILESTONES, ...MANUAL, ...PERFECTIONS].map(
		([id, title, fields], index) => ({
			...blankBadge(),
			id,
			etag: "1",
			name: title,
			imageRelativePath: `badges/${slugify(title)}.webp`,
			sectionId: null,
			subsectionId: null,
			createdAtUtc: iso(400 - index * 9),
			updatedAtUtc: iso(120 - index * 4),
			[unknownField]: `badge:${id}`,
			...fields,
		}),
	);
}
