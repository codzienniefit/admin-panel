import { describe, expect, it } from "vitest";
import {
	expandQuery,
	type SearchableWorkout,
	searchWorkouts,
	type WorkoutSearch,
} from "./workoutSearch";

const make = (
	id: string,
	title: string,
	patch: Partial<SearchableWorkout> = {},
): SearchableWorkout => ({
	id,
	title,
	durationMinutes: 20,
	trainingTypeIds: ["strength"],
	status: "published",
	...patch,
});

const workouts = [
	make("W1", "Brzuch", { durationMinutes: 10, trainingTypeIds: ["core"] }),
	make("W2", "Brzuch i pośladki", { trainingTypeIds: ["core", "strength"] }),
	make("W3", "Płaski brzuch w 10 minut", {
		durationMinutes: 10,
		trainingTypeIds: ["core"],
	}),
	make("W4", "Mocny brzuch", { durationMinutes: 15 }),
	make("W5", "Trening na pośladki i brzuch", { durationMinutes: 30 }),
	make("W6", "Brzuchomania", { durationMinutes: 45 }),
	make("W7", "ABS express", { durationMinutes: 8, trainingTypeIds: ["core"] }),
	make("W8", "Joga poranna", {
		internalTitle: "Dobra na brzuch po ciąży",
		trainingTypeIds: ["stretching"],
	}),
	make("W9", "Stary brzuch", { status: "deleted" }),
	make("W12", "Rozciąganie całego ciała", {
		durationMinutes: 25,
		trainingTypeIds: ["stretching"],
	}),
	make("W13", "Łydki ze stali", { status: "draft", trainingTypeIds: [] }),
	make("W14", "Cardio 2", { trainingTypeIds: ["cardio"] }),
	make("W15", "Cardio 10", { trainingTypeIds: ["cardio"], status: "hidden" }),
];

const idsOf = (search: WorkoutSearch) =>
	searchWorkouts(workouts, search).map((workout) => workout.id);

describe("synonyms", () => {
	it("adds the other words of a group the query names", () => {
		const terms = expandQuery("joga");
		expect(terms).toContain("stretching");
		expect(terms).toContain("rozciaganie");
		expect(terms).not.toContain("joga");
		expect(terms).not.toContain("cardio");
	});

	it("returns terms without diacritics, ready to compare", () => {
		expect(expandQuery("Nogi")).toEqual([
			"uda",
			"posladki",
			"dol ciala",
			"przysiady",
			"lydki",
		]);
		expect(expandQuery("ŁYDKI")).toContain("posladki");
	});

	it("matches a group when the query contains one of its terms", () => {
		expect(expandQuery("szybki trening na plecy")).toContain("kregoslup");
	});

	it("matches a group when one of its terms contains the query", () => {
		expect(expandQuery("rozciąg")).toContain("joga");
	});

	it("joins every group the query touches, once each term", () => {
		// "spalanie" is a cardio word and part of "spalanie tłuszczu".
		const terms = expandQuery("spalanie");
		expect(terms).toContain("hiit");
		expect(terms).toContain("odchudzanie");
		expect(new Set(terms).size).toBe(terms.length);
	});

	it("has nothing to add to an unknown, empty or one-letter query", () => {
		expect(expandQuery("pilates")).toEqual([]);
		expect(expandQuery("")).toEqual([]);
		expect(expandQuery("   ")).toEqual([]);
		expect(expandQuery("a")).toEqual([]);
	});
});

describe("workout search filters", () => {
	it("never returns deleted workouts", () => {
		expect(idsOf({})).not.toContain("W9");
		expect(idsOf({ query: "stary brzuch" })).not.toContain("W9");
		expect(idsOf({ query: "w9" })).toEqual([]);
	});

	it("keeps drafts and hidden workouts", () => {
		expect(idsOf({})).toContain("W13");
		expect(idsOf({})).toContain("W15");
	});

	it("orders by title the Polish way when there is no query", () => {
		expect(idsOf({})).toEqual([
			"W7", // ABS express
			"W1", // Brzuch
			"W2", // Brzuch i pośladki
			"W6", // Brzuchomania
			"W14", // Cardio 2
			"W15", // Cardio 10
			"W8", // Joga poranna
			"W13", // Łydki ze stali
			"W4", // Mocny brzuch
			"W3", // Płaski brzuch w 10 minut
			"W12", // Rozciąganie całego ciała
			"W5", // Trening na pośladki i brzuch
		]);
		expect(idsOf({ query: "   " })).toEqual(idsOf({}));
	});

	it("filters by duration, ends included", () => {
		expect(idsOf({ minMinutes: 30 })).toEqual(["W6", "W5"]);
		expect(idsOf({ maxMinutes: 10 })).toEqual(["W7", "W1", "W3"]);
		expect(idsOf({ minMinutes: 10, maxMinutes: 15 })).toEqual([
			"W1",
			"W4",
			"W3",
		]);
		expect(idsOf({ minMinutes: 46 })).toEqual([]);
	});

	it("filters by type: any of the given ones is enough", () => {
		expect(idsOf({ typeIds: ["cardio"] })).toEqual(["W14", "W15"]);
		expect(idsOf({ typeIds: ["core"] })).toEqual(["W7", "W1", "W2", "W3"]);
		expect(idsOf({ typeIds: ["cardio", "stretching"] })).toEqual([
			"W14",
			"W15",
			"W8",
			"W12",
		]);
		expect(idsOf({ typeIds: ["pilates"] })).toEqual([]);
	});

	it("treats an empty type list as no type filter", () => {
		expect(idsOf({ typeIds: [] })).toEqual(idsOf({}));
	});

	it("leaves out excluded workouts", () => {
		const excludeIds = new Set(["W14", "W1"]);
		expect(idsOf({ typeIds: ["cardio"], excludeIds })).toEqual(["W15"]);
		expect(idsOf({ query: "brzuch", excludeIds })).not.toContain("W1");
	});

	it("combines the filters with a query", () => {
		expect(
			idsOf({ query: "brzuch", typeIds: ["core"], maxMinutes: 10 }),
		).toEqual(["W1", "W3", "W7"]);
	});

	it("returns the workouts it was given, and leaves the list alone", () => {
		const before = workouts.map((workout) => workout.id);
		const found = searchWorkouts(workouts, { query: "joga" });
		expect(found[0]).toBe(workouts[7]);
		searchWorkouts(workouts, {});
		expect(workouts.map((workout) => workout.id)).toEqual(before);
	});
});

describe("workout search ranking", () => {
	it("ranks exact, prefix, phrase, comment, then synonym", () => {
		expect(idsOf({ query: "brzuch" })).toEqual([
			"W1", // the title is the query
			"W6", // starts with it: Brzuchomania, the shorter title
			"W2", // starts with it: Brzuch i pośladki
			"W4", // contains it at 6: Mocny brzuch
			"W3", // contains it at 7: Płaski brzuch w 10 minut
			"W5", // contains it at 22
			"W8", // only the comment mentions it
			"W7", // ABS: a synonym
		]);
	});

	it("ignores case, diacritics and stray spaces", () => {
		expect(idsOf({ query: "  LYDKI " })[0]).toBe("W13");
		expect(idsOf({ query: "płaski   BRZUCH" })[0]).toBe("W3");
		expect(idsOf({ query: "posladki" })).toContain("W2");
	});

	it("finds all words as whole words when the phrase is not there", () => {
		// Neither title contains "brzuch pośladki"; the shorter comes first.
		// After them come the titles that only have a synonym of the query.
		expect(idsOf({ query: "brzuch pośladki" }).slice(0, 2)).toEqual([
			"W2",
			"W5",
		]);
	});

	it("ranks whole words above parts of words", () => {
		const list = [
			make("A", "Brzuchomania i pośladkowanie"),
			make("B", "Pośladki, potem brzuch"),
			make("C", "Brzuch pośladki uda"),
		];
		const found = searchWorkouts(list, { query: "brzuch pośladki" });
		// C has the phrase, B both words (punctuation aside), A only as parts.
		expect(found.map((workout) => workout.id)).toEqual(["C", "B", "A"]);
	});

	it("needs every word of the query", () => {
		expect(idsOf({ query: "poranna" })).toEqual(["W8"]);
		expect(idsOf({ query: "poranna zumba" })).toEqual([]);
	});

	it("still offers synonyms when the words are not all there", () => {
		// No title has both words; each one names a group of synonyms.
		const found = idsOf({ query: "pilates cardio" });
		expect(found).toEqual(["W14", "W15"]);
	});

	it("finds a workout by its id", () => {
		expect(idsOf({ query: "w12" })).toEqual(["W12"]);
		expect(idsOf({ query: "W1" })).toEqual(["W1"]);
	});

	it("finds a workout by its comment", () => {
		expect(idsOf({ query: "po ciąży" })).toEqual(["W8"]);
	});

	it("falls back to synonyms after real matches", () => {
		// "joga" names W8; W12 is stretching, which the team calls the same.
		expect(idsOf({ query: "joga" })).toEqual(["W8", "W12"]);
		expect(idsOf({ query: "stretching" })).toEqual(["W8", "W12"]);
	});

	it("breaks ties by shorter title, then title order", () => {
		const list = [
			make("A", "Cardio 10"),
			make("B", "Cardio 2"),
			make("C", "Cardio dla początkujących"),
			make("D", "Cardio 1"),
		];
		const found = searchWorkouts(list, { query: "cardio" });
		expect(found.map((workout) => workout.id)).toEqual(["D", "B", "A", "C"]);
	});

	it("returns nothing when nothing matches", () => {
		expect(idsOf({ query: "pilates" })).toEqual([]);
	});
});

describe("searching a full library", () => {
	const KINDS = ["Joga", "Cardio", "Siłowy", "Brzuch", "Rozciąganie"];
	const TYPES = ["stretching", "cardio", "strength"];
	const library: SearchableWorkout[] = Array.from({ length: 2000 }, (_, i) =>
		make(`W${i}`, `${KINDS[i % 5]} dzień ${i}`, {
			durationMinutes: 5 + (i % 56),
			trainingTypeIds: [TYPES[i % 3] ?? "cardio"],
			status: i % 100 === 99 ? "deleted" : "published",
		}),
	);
	const live = library.filter((workout) => workout.status !== "deleted");
	const idsIn = (search: WorkoutSearch) =>
		searchWorkouts(library, search).map((workout) => workout.id);

	it("lists everything that is not deleted, by title", () => {
		const found = idsIn({});
		expect(found).toHaveLength(1980);
		// Numeric order: "Brzuch dzień 3" before "Brzuch dzień 8" before "… 13".
		expect(found.slice(0, 3)).toEqual(["W3", "W8", "W13"]);
		expect(found.at(-1)).toBe("W1997");
	});

	it("applies the filters to every workout", () => {
		const search = { minMinutes: 20, maxMinutes: 30, typeIds: ["cardio"] };
		const expected = live.filter(
			(workout) =>
				workout.durationMinutes >= 20 &&
				workout.durationMinutes <= 30 &&
				workout.trainingTypeIds.includes("cardio"),
		);
		const found = idsIn(search);
		expect(found).toHaveLength(expected.length);
		expect(new Set(found)).toEqual(
			new Set(expected.map((workout) => workout.id)),
		);
	});

	it("puts the exact title first, synonyms last", () => {
		const found = searchWorkouts(library, { query: "joga dzien 1230" });
		expect(found[0]?.id).toBe("W1230");
		// Nothing else has all three words. The rest match a word for yoga:
		// the other yoga workouts and the stretching ones.
		const related = live.filter(
			(workout) =>
				/^(Joga|Rozciąganie)/.test(workout.title) && workout.id !== "W1230",
		);
		const rest = found.slice(1);
		expect(rest).toHaveLength(related.length);
		expect(new Set(rest)).toEqual(new Set(related));
	});

	it("orders phrase matches by where the phrase starts", () => {
		const found = idsIn({ query: "dzień 12" });
		// The phrase: 12, 120–129 and 1200–1299, without the deleted W1299.
		const withPhrase = found.slice(0, 110);
		expect(
			withPhrase.every((id) => /^W12\d{0,2}$/.test(id) && id !== "W1299"),
		).toBe(true);
		// "Joga" is the shortest first word, so the phrase starts earliest there.
		expect(withPhrase.slice(0, 3)).toEqual(["W120", "W125", "W1200"]);
		// Then both words apart: a "12" later in the number, as in 312 or 1125.
		const apart = found.slice(110);
		expect(apart).toHaveLength(28);
		expect(apart.every((id) => /^W\d+12\d*$/.test(id))).toBe(true);
	});

	it("finds one workout by id among all of them", () => {
		expect(idsIn({ query: "w1777" })).toEqual(["W1777"]);
	});

	it("ranks every match of a common word", () => {
		const found = searchWorkouts(library, { query: "cardio" });
		const cardio = live.filter((workout) => workout.title.startsWith("Cardio"));
		expect(found.slice(0, cardio.length).map((workout) => workout.id)).toEqual(
			cardio
				.map((workout) => workout.id)
				.sort((a, b) => a.length - b.length || a.localeCompare(b)),
		);
		expect(found.length).toBeGreaterThanOrEqual(cardio.length);
	});
});
