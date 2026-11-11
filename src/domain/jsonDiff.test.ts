import { describe, expect, it } from "vitest";
import { jsonDiff } from "./jsonDiff";

const paths = (before: unknown, after: unknown) =>
	jsonDiff(before, after).changes.map((change) => change.path);

const challenge = () => ({
	id: "C1",
	etag: "7",
	title: "Wiosenny start",
	subtitle: "14 dni, kilka poziomów",
	comment: null as string | null,
	goalIds: ["kondycja", "mobilnosc"],
	x_addedByNewerBackend: "challenge:C1",
	paths: [
		{
			pathId: "p-easy",
			levelId: "beginner",
			frequency: 5,
			days: [
				{ dayIndex: 1, workoutIds: ["W1"] },
				{ dayIndex: 2, workoutIds: ["W2"] },
				{ dayIndex: 3, workoutIds: [] as string[] },
			],
		},
		{
			pathId: "p-hard",
			levelId: "advanced",
			frequency: 6,
			days: [{ dayIndex: 1, workoutIds: ["W6", "W4"] }],
		},
	],
});

describe("two documents that are the same", () => {
	it("have no differences", () => {
		expect(jsonDiff(challenge(), challenge())).toEqual({
			changes: [],
			before: undefined,
			after: undefined,
		});
	});

	it("do not differ by the order of their properties", () => {
		expect(paths({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
	});

	it("are the same for plain values too", () => {
		expect(paths("tekst", "tekst")).toEqual([]);
		expect(paths(null, null)).toEqual([]);
		expect(paths([1, 2], [1, 2])).toEqual([]);
	});
});

describe("a changed property", () => {
	it("is the only thing reported", () => {
		const after = { ...challenge(), title: "Wiosenny start 2027" };
		expect(jsonDiff(challenge(), after)).toEqual({
			changes: [
				{
					path: "title",
					before: "Wiosenny start",
					after: "Wiosenny start 2027",
				},
			],
			before: { title: "Wiosenny start" },
			after: { title: "Wiosenny start 2027" },
		});
	});

	it("is reported with null as a real value", () => {
		const after = { ...challenge(), comment: "premiera w marcu" };
		expect(jsonDiff(challenge(), after)).toMatchObject({
			before: { comment: null },
			after: { comment: "premiera w marcu" },
		});
	});

	it("keeps properties this build does not know out of it when unchanged", () => {
		const after = { ...challenge(), title: "Inna nazwa" };
		const diff = jsonDiff(challenge(), after);
		expect(JSON.stringify(diff)).not.toContain("x_addedByNewerBackend");
		expect(JSON.stringify(diff)).not.toContain("etag");
	});

	it("is reported when it is one this build does not know", () => {
		const after = { ...challenge(), x_addedByNewerBackend: "zmienione" };
		expect(paths(challenge(), after)).toEqual(["x_addedByNewerBackend"]);
	});

	it("comes in the order of the new document, removed ones last", () => {
		const before = { a: 1, b: 2, c: 3 };
		const after = { d: 4, c: 30, a: 10 };
		expect(paths(before, after)).toEqual(["d", "c", "a", "b"]);
	});
});

describe("a property added or removed", () => {
	it("is on one side only", () => {
		const diff = jsonDiff({ title: "A" }, { title: "A", liveAtUtc: "2027" });
		expect(diff.changes).toEqual([
			{ path: "liveAtUtc", before: undefined, after: "2027" },
		]);
		expect(diff.before).toEqual({});
		expect(diff.after).toEqual({ liveAtUtc: "2027" });
	});

	it("is on the other side when it goes away", () => {
		const diff = jsonDiff({ title: "A", old: true }, { title: "A" });
		expect(diff.changes).toEqual([
			{ path: "old", before: true, after: undefined },
		]);
		expect(diff.before).toEqual({ old: true });
		expect(diff.after).toEqual({});
	});

	it("tells a missing property from one that is null", () => {
		expect(paths({ a: null }, {})).toEqual(["a"]);
		// `undefined` is not written to JSON at all, so it is the same as missing.
		expect(paths({ a: undefined }, {})).toEqual([]);
	});
});

describe("nested objects", () => {
	it("are compared property by property", () => {
		const before = {
			trainingTypeStyles: {
				strength: { tone: "red", emoji: "💪" },
				yoga: { tone: "teal", emoji: "" },
			},
		};
		const after = structuredClone(before);
		after.trainingTypeStyles.yoga.emoji = "🧘";
		expect(jsonDiff(before, after)).toEqual({
			changes: [
				{ path: "trainingTypeStyles.yoga.emoji", before: "", after: "🧘" },
			],
			before: { trainingTypeStyles: { yoga: { emoji: "" } } },
			after: { trainingTypeStyles: { yoga: { emoji: "🧘" } } },
		});
	});

	it("count as one value when an object replaces something else", () => {
		expect(paths({ meta: null }, { meta: { ratio: 1 } })).toEqual(["meta"]);
		expect(paths({ meta: [1] }, { meta: { ratio: 1 } })).toEqual(["meta"]);
	});
});

describe("a plain list", () => {
	it("is one value: all of it before, all of it after", () => {
		const after = { ...challenge(), goalIds: ["kondycja"] };
		expect(jsonDiff(challenge(), after)).toEqual({
			changes: [
				{
					path: "goalIds",
					before: ["kondycja", "mobilnosc"],
					after: ["kondycja"],
				},
			],
			before: { goalIds: ["kondycja", "mobilnosc"] },
			after: { goalIds: ["kondycja"] },
		});
	});

	it("differs when only the order changed", () => {
		const after = { ...challenge(), goalIds: ["mobilnosc", "kondycja"] };
		expect(paths(challenge(), after)).toEqual(["goalIds"]);
	});
});

describe("variants and days, which have an identity", () => {
	it("report the one day that changed, with the variant and the day named", () => {
		const after = challenge();
		after.paths[0]?.days[2]?.workoutIds.push("W5");
		expect(jsonDiff(challenge(), after)).toEqual({
			changes: [
				{
					path: "paths[p-easy].days[3].workoutIds",
					before: [],
					after: ["W5"],
				},
			],
			before: {
				paths: [{ pathId: "p-easy", days: [{ dayIndex: 3, workoutIds: [] }] }],
			},
			after: {
				paths: [
					{ pathId: "p-easy", days: [{ dayIndex: 3, workoutIds: ["W5"] }] },
				],
			},
		});
	});

	it("report a setting of one variant without its days", () => {
		const after = challenge();
		const hard = after.paths[1];
		if (hard) hard.frequency = 4;
		const diff = jsonDiff(challenge(), after);
		expect(diff.changes.map((change) => change.path)).toEqual([
			"paths[p-hard].frequency",
		]);
		expect(diff.after).toEqual({
			paths: [{ pathId: "p-hard", frequency: 4 }],
		});
	});

	it("report an added variant whole", () => {
		const after = challenge();
		const added = {
			pathId: "p-mid",
			levelId: "intermediate",
			frequency: 4,
			days: [],
		};
		after.paths.push(added);
		const diff = jsonDiff(challenge(), after);
		expect(diff.changes).toEqual([
			{ path: "paths[p-mid]", before: undefined, after: added },
		]);
		expect(diff.before).toEqual({ paths: [] });
		expect(diff.after).toEqual({ paths: [added] });
	});

	it("report a removed variant whole", () => {
		const after = challenge();
		const [removed] = after.paths.splice(1, 1);
		const diff = jsonDiff(challenge(), after);
		expect(diff.changes).toEqual([
			{ path: "paths[p-hard]", before: removed, after: undefined },
		]);
		expect(diff.before).toEqual({ paths: [removed] });
		expect(diff.after).toEqual({ paths: [] });
	});

	it("report several places at once, each on its own", () => {
		const after = challenge();
		after.title = "Nowa nazwa";
		after.paths[0]?.days[0]?.workoutIds.splice(0, 1, "W9");
		after.paths[1]?.days[0]?.workoutIds.reverse();
		expect(paths(challenge(), after)).toEqual([
			"title",
			"paths[p-easy].days[1].workoutIds",
			"paths[p-hard].days[1].workoutIds",
		]);
	});

	it("treat a reordered list as one changed value", () => {
		const after = challenge();
		after.paths.reverse();
		const diff = jsonDiff(challenge(), after);
		expect(diff.changes.map((change) => change.path)).toEqual(["paths"]);
		expect(diff.after).toEqual({ paths: after.paths });
	});

	it("treat a list with a repeated or missing identity as one changed value", () => {
		const twice = challenge();
		const first = twice.paths[0];
		if (first) twice.paths.push({ ...first, frequency: 1 });
		expect(paths(challenge(), twice)).toEqual(["paths"]);

		const nameless = { paths: [{ levelId: "beginner" }] };
		expect(paths({ paths: [{ levelId: "advanced" }] }, nameless)).toEqual([
			"paths",
		]);
	});

	it("compare plan types and folders by id", () => {
		const before = {
			planTypes: [
				{
					id: "pt-1",
					name: "Zbalansowany",
					conditions: [{ type: "min", n: 2 }],
				},
				{ id: "pt-2", name: "Siłowy", conditions: [] },
			],
			folders: [{ id: "f-1", name: "Archiwum" }],
		};
		const after = structuredClone(before);
		const second = after.planTypes[1];
		if (second) second.name = "Siłowy plus";
		after.folders.push({ id: "f-2", name: "Zima" });
		expect(paths(before, after)).toEqual([
			"planTypes[pt-2].name",
			"folders[f-2]",
		]);
	});

	it("do not treat a list called `days` outside a variant as keyed", () => {
		// Only inside `paths` are days matched by dayIndex.
		const before = { days: [{ dayIndex: 1, note: "a" }] };
		const after = { days: [{ dayIndex: 1, note: "b" }] };
		expect(paths(before, after)).toEqual(["days"]);
	});
});

describe("a document that is new or gone", () => {
	it("is one change: everything", () => {
		const diff = jsonDiff(undefined, { title: "Nowy trening" });
		expect(diff.changes).toEqual([
			{ path: "", before: undefined, after: { title: "Nowy trening" } },
		]);
		expect(diff.before).toBeUndefined();
		expect(diff.after).toEqual({ title: "Nowy trening" });
	});

	it("leaves both documents as they were", () => {
		const before = challenge();
		const after = challenge();
		after.title = "Zmieniona";
		after.paths[0]?.days[0]?.workoutIds.push("W7");
		const copies = [structuredClone(before), structuredClone(after)];
		jsonDiff(before, after);
		expect([before, after]).toEqual(copies);
	});
});
