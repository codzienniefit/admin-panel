import type { Badge } from "@/data/schemas/badge";
import {
	blankChallenge,
	blankPath,
	type Challenge,
	type Path,
} from "@/data/schemas/challenge";
import type { MediaFile } from "@/data/schemas/media";
import type { Workout } from "@/data/schemas/workout";
import { slugify } from "@/domain/text";

// Synthetic sample data. Nothing here comes from the real backend: the Test
// environment is public.

/**
 * Added to every object the mock returns, at every nesting level. It stands
 * for "a field a newer backend has and this panel does not know". A save that
 * loses it is the bug described in docs/PLAN.md §6.2.
 */
export const UNKNOWN_FIELD = "x_addedByNewerBackend";

export type DatasetSize = "normal" | "stress";

const SIZES: Record<
	DatasetSize,
	{ workouts: number; challenges: number; extraMedia: number }
> = {
	normal: { workouts: 150, challenges: 25, extraMedia: 40 },
	// Ten times a realistic catalogue, for the scale check in docs/ROADMAP.md §2.
	stress: { workouts: 2000, challenges: 300, extraMedia: 3000 },
};

export interface Fixtures {
	challenges: Challenge[];
	workouts: Workout[];
	media: MediaFile[];
	badges: Badge[];
}

/** A small seeded generator, so the sample data is the same on every load. */
function random(seed: number) {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (min: number, max: number) =>
			min + Math.floor(next() * (max - min + 1)),
		pick: <T>(list: readonly T[]): T =>
			list[Math.floor(next() * list.length)] as T,
		chance: (probability: number) => next() < probability,
	};
}

const BASE_TIME = Date.UTC(2026, 10, 10, 9, 0, 0);
const DAY = 86_400_000;
const iso = (daysAgo: number) =>
	new Date(BASE_TIME - daysAgo * DAY).toISOString();

const hand: Array<[string, string, number, string[]]> = [
	["W1", "Poranna mobilność bioder", 15, ["stretching"]],
	["W2", "Siła całego ciała z hantlami", 35, ["strength"]],
	["W3", "Cardio bez skakania", 25, ["cardio"]],
	["W4", "Brzuch i core", 20, ["strength"]],
	["W5", "Joga na dobry sen", 30, ["yoga", "stretching"]],
	["W6", "Interwały HIIT", 22, ["hiit", "cardio"]],
	["W7", "Pośladki i uda", 28, ["strength"]],
	["W8", "Rozciąganie po treningu", 12, ["stretching"]],
	["W9", "Pilates dla początkujących", 32, ["pilates"]],
	["W10", "Plecy i postawa", 18, ["strength", "stretching"]],
	["W11", "Tabata 4 rundy", 16, ["hiit"]],
	["W12", "Spacer z zadaniami", 40, ["cardio"]],
];

const THEMES: Array<{ type: string; names: string[] }> = [
	{
		type: "strength",
		names: ["Siła", "Wzmacnianie", "Mocne", "Trening siłowy"],
	},
	{ type: "cardio", names: ["Cardio", "Spalanie", "Kondycja", "Marsz"] },
	{ type: "stretching", names: ["Rozciąganie", "Mobilność", "Rozluźnienie"] },
	{ type: "yoga", names: ["Joga", "Vinyasa", "Powitanie słońca"] },
	{ type: "pilates", names: ["Pilates", "Stabilizacja", "Centrum"] },
	{ type: "hiit", names: ["HIIT", "Tabata", "Interwały"] },
];
const PARTS = [
	"całego ciała",
	"pośladków",
	"pleców",
	"brzucha",
	"nóg",
	"ramion",
	"bioder",
	"klatki piersiowej",
	"kręgosłupa",
	"barków",
];
const EXTRAS = [
	"",
	"",
	"z gumą",
	"z hantlami",
	"na macie",
	"przy krześle",
	"bez skakania",
	"na dobry początek dnia",
	"po pracy",
	"dla zabieganych",
];
const LEVELS = ["beginner", "intermediate", "advanced"];
const EQUIPMENT = ["noeq", "mat", "dumbbells", "band", "chair"];
const VIDEO_CHARS =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

function buildWorkouts(count: number): Workout[] {
	const rng = random(20261110);
	const workouts: Workout[] = [];

	const make = (
		index: number,
		id: string,
		title: string,
		durationMinutes: number,
		trainingTypeIds: string[],
		handMade: boolean,
	): Workout => {
		const roll = rng.next();
		const status = handMade
			? "published"
			: roll < 0.08
				? "draft"
				: roll < 0.2
					? "hidden"
					: roll < 0.23
						? "deleted"
						: "published";
		const hasAudio = !handMade && rng.chance(0.1);
		const hasVideo = !hasAudio && (handMade || rng.chance(0.85));
		const added = handMade ? 400 - index : rng.int(1, 700);
		const complete = status !== "draft";
		const slug = slugify(title);
		return {
			id,
			etag: "1",
			title,
			internalTitle: rng.chance(0.15) ? "do ponownego nagrania" : null,
			status,
			pro: rng.chance(0.25),
			durationMinutes,
			levelId: complete || rng.chance(0.5) ? rng.pick(LEVELS) : null,
			equipmentIds: rng.chance(0.4)
				? ["noeq"]
				: [
						rng.pick(EQUIPMENT.slice(1)),
						...(rng.chance(0.3) ? ["mat"] : []),
					].filter((value, i, list) => list.indexOf(value) === i),
			trainingTypeIds,
			imageRelativePath:
				complete || rng.chance(0.4)
					? `workouts/${slug}-${id.toLowerCase()}.webp`
					: null,
			audioRelativePath: hasAudio
				? `audio/${slug}-${id.toLowerCase()}.m4a`
				: null,
			videoUrl: hasVideo
				? `https://www.youtube.com/watch?v=${Array.from({ length: 11 }, () => rng.pick([...VIDEO_CHARS])).join("")}`
				: null,
			descriptionFancyContent: [
				{
					type: "Title",
					content: "Co Cię czeka",
					metadata: null,
					[UNKNOWN_FIELD]: "block",
				},
				{
					type: "Text",
					content: `${title}. Przygotuj <b>matę</b> i butelkę wody.`,
					metadata: null,
					[UNKNOWN_FIELD]: "block",
				},
			],
			badgeId: rng.chance(0.04) ? "n_1" : null,
			addedAtUtc: iso(added),
			liveAtUtc: rng.chance(0.03) ? iso(-rng.int(1, 20)) : null,
			availableAtUtc: rng.chance(0.05) ? iso(-rng.int(1, 30)) : null,
			updatedAtUtc: iso(Math.max(0, added - rng.int(0, 60))),
			[UNKNOWN_FIELD]: `workout:${id}`,
		};
	};

	hand.forEach(([id, title, minutes, types], index) => {
		workouts.push(make(index, id, title, minutes, types, true));
	});
	for (let n = hand.length + 1; workouts.length < count; n++) {
		const theme = rng.pick(THEMES);
		const extra = rng.pick(EXTRAS);
		const title = [rng.pick(theme.names), rng.pick(PARTS), extra]
			.filter(Boolean)
			.join(" ");
		const second = rng.chance(0.25) ? rng.pick(THEMES).type : null;
		const types =
			second && second !== theme.type ? [theme.type, second] : [theme.type];
		workouts.push(make(n, `W${n}`, title, rng.int(2, 12) * 5, types, false));
	}
	return workouts;
}

function buildPath(
	pathId: string,
	levelId: string,
	plan: string[][],
	extra: Partial<Path> = {},
): Path {
	const training = plan.filter((day) => day.length > 0).length;
	return {
		...blankPath(pathId, levelId, plan.length),
		frequency: Math.max(1, Math.round((training / plan.length) * 7)),
		minimumDaysToComplete: Math.max(0, training - 2),
		...extra,
		[UNKNOWN_FIELD]: `path:${pathId}`,
		days: plan.map((workoutIds, i) => ({
			dayIndex: i + 1,
			workoutIds,
			[UNKNOWN_FIELD]: `day:${i + 1}`,
		})),
	};
}

const describe = (title: string): Challenge["descriptionFancyContent"] => [
	{
		type: "Title",
		content: "Dla kogo",
		metadata: null,
		[UNKNOWN_FIELD]: "block",
	},
	{
		type: "Text",
		content: `${title}: plan krok po kroku, z dniami <b>odpoczynku</b>.`,
		metadata: null,
		[UNKNOWN_FIELD]: "block",
	},
];

function buildChallenges(count: number, workouts: Workout[]): Challenge[] {
	const rng = random(4711);
	const usable = workouts
		.filter((w) => w.status === "published")
		.map((w) => w.id);

	const make = (
		id: string,
		title: string,
		fields: Partial<Challenge> & Pick<Challenge, "status" | "paths">,
	): Challenge => {
		const lengthDays = fields.paths[0]?.days.length ?? 7;
		const added = rng.int(5, 500);
		return {
			...blankChallenge(iso(added)),
			id,
			etag: "1",
			title,
			subtitle: `${lengthDays} dni, ${fields.paths.length === 1 ? "jeden poziom" : "kilka poziomów"}`,
			lengthDays,
			imageRelativePath: `challenges/${slugify(title)}-${id.toLowerCase()}.webp`,
			descriptionFancyContent: describe(title),
			updatedAtUtc: iso(Math.max(0, added - rng.int(0, 40))),
			[UNKNOWN_FIELD]: `challenge:${id}`,
			...fields,
		};
	};

	const twoWeeksEasy: string[][] = [
		["W1"],
		["W2"],
		[],
		["W3", "W8"],
		["W4"],
		[],
		["W5"],
		["W1"],
		["W7"],
		[],
		["W6"],
		["W10"],
		[],
		["W9", "W8"],
	];
	const twoWeeksHard: string[][] = [
		["W2", "W8"],
		["W6"],
		["W4"],
		[],
		["W7", "W1"],
		["W11"],
		[],
		["W2"],
		["W3", "W4"],
		["W6"],
		[],
		["W7"],
		["W11", "W8"],
		["W5"],
	];

	const challenges: Challenge[] = [
		make("C1", "Wiosenny start", {
			status: "draft",
			internalTitle: "premiera w marcu",
			liveAtUtc: iso(-120),
			goalsIds: ["condition", "mobility"],
			difficultyLevelsIds: ["easy", "medium"],
			paths: [
				buildPath("p-easy", "beginner", twoWeeksEasy, {
					description: "Spokojne tempo, dużo rozciągania.",
				}),
				buildPath("p-hard", "advanced", twoWeeksHard, { pro: true }),
			],
		}),
		make("C2", "Mocne plecy w 7 dni", {
			status: "published",
			liveAtUtc: iso(20),
			endsAtUtc: iso(-40),
			goalsIds: ["strength"],
			difficultyLevelsIds: ["medium"],
			badgeId: "n_3",
			recommendedNext: [{ id: "C3" }],
			paths: [
				buildPath("p-main", "intermediate", [
					["W10"],
					["W1"],
					["W2"],
					[],
					["W10", "W8"],
					["W9"],
					[],
				]),
			],
		}),
		make("C3", "Plan spokojny: joga i rozciąganie", {
			status: "hidden",
			categoryId: "supplementary",
			goalsIds: ["calm", "mobility"],
			difficultyLevelsIds: ["easy"],
			paths: [
				buildPath("p-main", "beginner", [
					["W5"],
					["W8"],
					[],
					["W1"],
					["W5"],
					[],
					["W9"],
				]),
			],
		}),
	];

	const NAMES = [
		"Jesienna forma",
		"Zdrowy kręgosłup",
		"Płaski brzuch",
		"Silne nogi",
		"Poranki z jogą",
		"Start od zera",
		"Powrót po przerwie",
		"Letnie wyzwanie",
		"Zimowa energia",
		"Spokojna głowa",
	];
	const GOALS = ["strength", "condition", "mobility", "weight", "calm"];
	const CATEGORIES = ["main", "supplementary", "archived"];
	for (let n = challenges.length + 1; challenges.length < count; n++) {
		const weeks = rng.pick([1, 2, 2, 4, 4, 6, 8]);
		const levels = [...LEVELS]
			.sort(() => rng.next() - 0.5)
			.slice(0, rng.int(1, 3));
		const roll = rng.next();
		const live = rng.chance(0.4);
		const paid = rng.chance(0.2);
		challenges.push(
			make(`C${n}`, `${rng.pick(NAMES)} ${weeks * 7} dni`, {
				status:
					roll < 0.2
						? "draft"
						: roll < 0.32
							? "hidden"
							: roll < 0.36
								? "deleted"
								: "published",
				pro: paid,
				unlockedByEntitlementIds: paid ? ["pro"] : [],
				liveAtUtc: live ? iso(rng.int(-90, 200)) : null,
				endsAtUtc: live && rng.chance(0.5) ? iso(rng.int(-200, -91)) : null,
				categoryId: live ? null : rng.pick(CATEGORIES),
				goalsIds: [rng.pick(GOALS)],
				difficultyLevelsIds: [rng.pick(["easy", "medium", "hard"])],
				paths: levels.map((levelId) =>
					buildPath(
						`p-${levelId}`,
						levelId,
						Array.from({ length: weeks * 7 }, (_, day) => {
							// The first day always has a workout, so every plan is valid.
							if (day > 0 && rng.chance(0.3)) return [];
							const first = rng.pick(usable);
							const second = rng.chance(0.25) ? rng.pick(usable) : null;
							return second && second !== first ? [first, second] : [first];
						}),
					),
				),
			}),
		);
	}
	return challenges;
}

function buildBadges(): Badge[] {
	return [
		["n_1", "Pierwszy trening", "normal"],
		["n_2", "Mistrzyni mobilności", "normal"],
		["n_3", "Siła charakteru", "normal"],
		["n_4", "Spokój ducha", "normal"],
		["m_workouts_10", "10 treningów", "milestone"],
		["s_1", "Spotkanie na żywo", "manual"],
	].map(([id, name, type]) => ({
		id: id as string,
		name: name as string,
		type: type as string,
		imageRelativePath: `badges/${slugify(name as string)}.webp`,
		isHidden: false,
		[UNKNOWN_FIELD]: `badge:${id}`,
	}));
}

function buildMedia(
	workouts: Workout[],
	challenges: Challenge[],
	badges: Badge[],
	extra: number,
): MediaFile[] {
	const rng = random(99);
	const files = new Map<string, MediaFile>();
	const add = (path: string, type: MediaFile["type"], daysAgo: number) => {
		if (files.has(path)) return;
		files.set(path, {
			path,
			type,
			createdAtUtc: iso(daysAgo),
			sizeBytes:
				type === "audio" ? rng.int(4, 60) * 1_000_000 : rng.int(40, 240) * 1000,
			[UNKNOWN_FIELD]: "media",
		});
	};
	for (const workout of workouts) {
		if (workout.imageRelativePath)
			add(workout.imageRelativePath, "image", rng.int(1, 700));
		if (workout.audioRelativePath)
			add(workout.audioRelativePath, "audio", rng.int(1, 700));
	}
	for (const challenge of challenges) {
		if (challenge.imageRelativePath) {
			add(challenge.imageRelativePath, "image", rng.int(1, 500));
		}
	}
	for (const badge of badges)
		add(badge.imageRelativePath, "image", rng.int(1, 300));
	for (let n = 1; n <= extra; n++) {
		const folder = rng.pick([
			"challenges",
			"challenges",
			"messages",
			"workouts",
		]);
		add(
			`${folder}/cf-${String(n).padStart(4, "0")}.webp`,
			"image",
			rng.int(1, 700),
		);
	}
	return [...files.values()].sort((a, b) =>
		b.createdAtUtc.localeCompare(a.createdAtUtc),
	);
}

export function buildFixtures(size: DatasetSize = "normal"): Fixtures {
	const {
		workouts: workoutCount,
		challenges: challengeCount,
		extraMedia,
	} = SIZES[size];
	const workouts = buildWorkouts(workoutCount);
	const challenges = buildChallenges(challengeCount, workouts);
	const badges = buildBadges();
	return {
		workouts,
		challenges,
		badges,
		media: buildMedia(workouts, challenges, badges, extraMedia),
	};
}
