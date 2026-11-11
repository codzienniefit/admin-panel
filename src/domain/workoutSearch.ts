import { normalizeText } from "./text";

// Finding a workout to put on a plan day. Ranked, because the picker shows
// only the first screenful of some 2,000 workouts: the title someone typed
// has to come before the titles that merely mention it.

export interface SearchableWorkout {
	id: string;
	title: string;
	/** The team's internal comment. */
	internalTitle?: string | null;
	durationMinutes: number;
	trainingTypeIds: readonly string[];
	status: string;
}

export interface WorkoutSearch {
	query?: string;
	/** Shortest and longest duration, both included. */
	minMinutes?: number;
	maxMinutes?: number;
	/** A workout matches when it has ANY of these; empty means no filter. */
	typeIds?: readonly string[];
	/** Workouts to leave out, e.g. those already on the day. */
	excludeIds?: ReadonlySet<string>;
}

// Words the team uses for the same thing. Typing one finds titles with the
// others, after everything that matches the query itself.
const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
	[
		"brzuch",
		"brzucha",
		"core",
		"abs",
		"mięśnie brzucha",
		"sześciopak",
		"płaski brzuch",
		"talia",
	],
	["nogi", "uda", "pośladki", "dół ciała", "przysiady", "łydki"],
	[
		"rozciąganie",
		"stretching",
		"mobilność",
		"joga",
		"yoga",
		"relaks",
		"relaksacja",
		"elastyczność",
		"rozciągnij",
	],
	[
		"cardio",
		"aerobik",
		"spalanie",
		"hiit",
		"interwały",
		"wytrzymałość",
		"kondycja",
		"tabata",
	],
	[
		"siła",
		"siłowy",
		"wzmacnianie",
		"hantle",
		"ciężary",
		"trening siłowy",
		"wzmacniający",
	],
	["plecy", "kręgosłup", "postawa", "prostowanie pleców"],
	["ręce", "ramiona", "biceps", "triceps", "barki", "góra ciała"],
	["klatka", "klatka piersiowa", "pompki"],
	["całe ciało", "full body", "total body", "ogólnorozwojowy"],
	["rozgrzewka", "warm up", "warmup", "rozruszanie"],
	[
		"początkujący",
		"dla początkujących",
		"beginner",
		"łatwy",
		"delikatny",
		"na start",
	],
	["zaawansowany", "trudny", "intensywny", "advanced", "mocny"],
	[
		"odchudzanie",
		"schudnąć",
		"spalanie tłuszczu",
		"redukcja",
		"waga",
		"na płaski brzuch",
	],
	["schłodzenie", "cool down", "wyciszenie", "oddech", "medytacja"],
].map((group) => group.map(normalizeText));

/** Lower-case, no diacritics, single spaces, no spaces at the ends. */
const tidy = (text: string): string =>
	normalizeText(text).replace(/\s+/g, " ").trim();

// Below this a query is contained in a term of nearly every group ("a"), and
// the synonyms would match the whole library.
const MIN_SYNONYM_QUERY = 2;

/**
 * Other words for what the query says: every term of each synonym group the
 * query touches (it contains a term, or a term contains it). Normalised, and
 * without the query itself.
 */
export function expandQuery(query: string): string[] {
	const phrase = tidy(query);
	if (phrase.length < MIN_SYNONYM_QUERY) return [];
	const terms = new Set<string>();
	for (const group of SYNONYM_GROUPS) {
		const touches = group.some(
			(term) => phrase.includes(term) || term.includes(phrase),
		);
		if (touches) for (const term of group) terms.add(term);
	}
	terms.delete(phrase);
	return [...terms];
}

const polish = new Intl.Collator("pl", { numeric: true });

const byTitle = (a: SearchableWorkout, b: SearchableWorkout): number =>
	polish.compare(a.title, b.title) || polish.compare(a.id, b.id);

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

/** What the ranking needs to know about the query, worked out once. */
interface PreparedQuery {
	phrase: string;
	words: string[];
	synonyms: string[];
}

/**
 * How well a workout matches; lower is better, null is no match.
 * 0 title equals the query; 1 starts with it; 2 contains the phrase;
 * 3 has every word as a whole word; 4 has every word somewhere;
 * 5 the id is the query, or the comment contains the phrase;
 * 6 the title has a synonym of the query.
 */
function rankOf(
	workout: SearchableWorkout,
	title: string,
	query: PreparedQuery,
): { tier: number; position: number } | null {
	const { phrase, words, synonyms } = query;
	if (title === phrase) return { tier: 0, position: 0 };
	const position = title.indexOf(phrase);
	if (position === 0) return { tier: 1, position: 0 };
	if (position > 0) return { tier: 2, position };

	if (words.every((word) => title.includes(word))) {
		const titleWords = new Set(title.split(WORD_BREAK));
		const whole = words.every((word) => titleWords.has(word));
		return { tier: whole ? 3 : 4, position: 0 };
	}
	if (normalizeText(workout.id) === phrase) return { tier: 5, position: 0 };
	if (workout.internalTitle && tidy(workout.internalTitle).includes(phrase)) {
		return { tier: 5, position: 0 };
	}
	if (synonyms.some((term) => title.includes(term))) {
		return { tier: 6, position: 0 };
	}
	return null;
}

/**
 * The workouts that pass the filters, best match first. Deleted workouts are
 * never returned. Without a query the order is by title. Comparison ignores
 * case and Polish diacritics.
 */
export function searchWorkouts<T extends SearchableWorkout>(
	workouts: readonly T[],
	search: WorkoutSearch,
): T[] {
	const { minMinutes, maxMinutes, excludeIds } = search;
	const typeIds = search.typeIds?.length ? new Set(search.typeIds) : null;

	const candidates = workouts.filter((workout) => {
		if (workout.status === "deleted") return false;
		if (excludeIds?.has(workout.id)) return false;
		if (minMinutes !== undefined && workout.durationMinutes < minMinutes) {
			return false;
		}
		if (maxMinutes !== undefined && workout.durationMinutes > maxMinutes) {
			return false;
		}
		if (typeIds && !workout.trainingTypeIds.some((id) => typeIds.has(id))) {
			return false;
		}
		return true;
	});

	const phrase = tidy(search.query ?? "");
	if (!phrase) return candidates.sort(byTitle);

	const query: PreparedQuery = {
		phrase,
		words: phrase.split(" "),
		synonyms: expandQuery(phrase),
	};
	const ranked: Array<{
		workout: T;
		tier: number;
		position: number;
		titleLength: number;
	}> = [];
	for (const workout of candidates) {
		const title = tidy(workout.title);
		const rank = rankOf(workout, title, query);
		if (rank) ranked.push({ workout, ...rank, titleLength: title.length });
	}
	ranked.sort(
		(a, b) =>
			a.tier - b.tier ||
			a.position - b.position ||
			a.titleLength - b.titleLength ||
			byTitle(a.workout, b.workout),
	);
	return ranked.map((entry) => entry.workout);
}
