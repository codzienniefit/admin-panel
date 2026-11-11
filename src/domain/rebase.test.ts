import { describe, expect, it } from "vitest";
import { rebase } from "./rebase";

const base = () => ({
	id: "C1",
	etag: "1",
	updatedAtUtc: "t1",
	title: "Start",
	x_new: "keep me",
	paths: [
		{
			pathId: "p1",
			levelId: "beginner",
			x_new: "path",
			days: [
				{ dayIndex: 1, workoutIds: ["A"], x_new: "day1" },
				{ dayIndex: 2, workoutIds: ["B"], x_new: "day2" },
			],
		},
	],
});
type Doc = ReturnType<typeof base>;
const edit = (change: (d: Doc) => void): Doc => {
	const doc = base();
	change(doc);
	return doc;
};

describe("rebase", () => {
	it("returns theirs untouched when I changed nothing", () => {
		const theirs = edit((d) => {
			d.title = "Theirs";
			d.etag = "2";
		});
		const { merged, conflicts } = rebase(base(), base(), theirs);
		expect(conflicts).toEqual([]);
		expect(merged).toEqual(theirs);
	});

	it("keeps both sides when they changed different fields", () => {
		const mine = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Z");
		});
		const theirs = edit((d) => {
			d.title = "Theirs";
			d.etag = "2";
		});
		const { merged, conflicts } = rebase(base(), mine, theirs);
		expect(conflicts).toEqual([]);
		expect(merged.title).toBe("Theirs");
		expect(merged.etag).toBe("2");
		expect(merged.paths[0]?.days[0]?.workoutIds).toEqual(["A", "Z"]);
	});

	it("merges edits to different days of the same path", () => {
		const mine = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Z");
		});
		const theirs = edit((d) => {
			d.paths[0]?.days[1]?.workoutIds.push("Y");
			d.etag = "2";
		});
		const { merged, conflicts } = rebase(base(), mine, theirs);
		expect(conflicts).toEqual([]);
		expect(merged.paths[0]?.days.map((d) => d.workoutIds)).toEqual([
			["A", "Z"],
			["B", "Y"],
		]);
	});

	it("reports a conflict when both changed the same day", () => {
		const mine = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Z");
		});
		const theirs = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Y");
		});
		const result = rebase(base(), mine, theirs);
		expect(result.conflicts).toEqual(["paths[p1].days[1].workoutIds"]);
		expect(result.merged.paths[0]?.days[0]?.workoutIds).toEqual(["A", "Y"]);
		const preferMine = rebase(base(), mine, theirs, { prefer: "mine" });
		expect(preferMine.merged.paths[0]?.days[0]?.workoutIds).toEqual(["A", "Z"]);
	});

	it("reports a conflict when both changed the same scalar differently", () => {
		const mine = edit((d) => {
			d.title = "Mine";
		});
		const theirs = edit((d) => {
			d.title = "Theirs";
		});
		expect(rebase(base(), mine, theirs).conflicts).toEqual(["title"]);
	});

	it("is not a conflict when both made the same change", () => {
		const same = edit((d) => {
			d.title = "Same";
		});
		expect(rebase(base(), same, same).conflicts).toEqual([]);
	});

	it("never lets my stale etag or timestamp win", () => {
		const mine = edit((d) => {
			d.title = "Mine";
		});
		const theirs = edit((d) => {
			d.etag = "9";
			d.updatedAtUtc = "t9";
		});
		const { merged } = rebase(base(), mine, theirs);
		expect(merged.etag).toBe("9");
		expect(merged.updatedAtUtc).toBe("t9");
		expect(merged.title).toBe("Mine");
	});

	it("carries unknown fields from theirs at every level", () => {
		const mine = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Z");
		});
		const theirs = edit((d) => {
			d.x_new = "changed by server";
			const path = d.paths[0];
			if (path) path.x_new = "path changed";
			const day = path?.days[1];
			if (day) day.x_new = "day2 changed";
		});
		const { merged } = rebase(base(), mine, theirs);
		expect(merged.x_new).toBe("changed by server");
		expect(merged.paths[0]?.x_new).toBe("path changed");
		expect(merged.paths[0]?.days[0]?.x_new).toBe("day1");
		expect(merged.paths[0]?.days[1]?.x_new).toBe("day2 changed");
	});

	it("treats a list as one unit when a side added or removed items", () => {
		const mine = edit((d) => {
			d.paths[0]?.days.push({ dayIndex: 3, workoutIds: [], x_new: "day3" });
		});
		const theirs = edit((d) => {
			d.paths[0]?.days[0]?.workoutIds.push("Y");
		});
		expect(rebase(base(), mine, theirs).conflicts).toEqual(["paths[p1].days"]);
	});
});

describe("rebase of nested documents", () => {
	interface Variant {
		notes: string;
		days: Record<string, { note?: string }>;
	}
	interface Folder {
		id: string;
		name: string;
	}
	interface Doc {
		id: string;
		etag: string;
		note: string;
		variants: { a: Variant; b: Variant };
		folders: [Folder, Folder, ...Folder[]];
	}
	const base: Doc = {
		id: "C1",
		etag: "1",
		note: "",
		variants: {
			a: { notes: "", days: { "1": { note: "x" } } },
			b: { notes: "", days: {} },
		},
		folders: [
			{ id: "f1", name: "Jeden" },
			{ id: "f2", name: "Dwa" },
		],
	};
	const edit = (change: (draft: Doc) => void) => {
		const draft = structuredClone(base);
		change(draft);
		return draft;
	};

	it("merges changes to different entries of a record", () => {
		const mine = edit((d) => {
			d.variants.a.days["2"] = { note: "moja" };
		});
		const theirs = edit((d) => {
			d.variants.b.notes = "ich";
			d.variants.a.days["3"] = { note: "ich dzień" };
		});
		const { merged, conflicts } = rebase(base, mine, theirs);
		expect(conflicts).toEqual([]);
		expect(merged.variants.a.days).toEqual({
			"1": { note: "x" },
			"2": { note: "moja" },
			"3": { note: "ich dzień" },
		});
		expect(merged.variants.b.notes).toBe("ich");
	});

	it("reports the exact entry both sides changed", () => {
		const mine = edit((d) => {
			d.variants.a.days["1"] = { note: "moja" };
		});
		const theirs = edit((d) => {
			d.variants.a.days["1"] = { note: "ich" };
		});
		expect(rebase(base, mine, theirs).conflicts).toEqual([
			"variants.a.days.1.note",
		]);
	});

	it("keeps my removal of an entry they did not touch", () => {
		const mine = edit((d) => {
			delete d.variants.a.days["1"];
		});
		const theirs = edit((d) => {
			d.note = "ich";
		});
		const { merged, conflicts } = rebase(base, mine, theirs);
		expect(conflicts).toEqual([]);
		expect(merged.variants.a.days).toEqual({});
		expect(merged.note).toBe("ich");
	});

	it("merges lists of folders by id when both renamed different ones", () => {
		const mine = edit((d) => {
			d.folders[0].name = "Pierwszy";
		});
		const theirs = edit((d) => {
			d.folders[1].name = "Drugi";
		});
		const { merged, conflicts } = rebase(base, mine, theirs);
		expect(conflicts).toEqual([]);
		expect(merged.folders.map((f) => f.name)).toEqual(["Pierwszy", "Drugi"]);
	});

	it("treats the folder list as one unit when one side added a folder", () => {
		const mine = edit((d) => {
			d.folders[0].name = "Pierwszy";
		});
		const theirs = edit((d) => {
			d.folders.push({ id: "f3", name: "Trzy" });
		});
		expect(rebase(base, mine, theirs).conflicts).toEqual(["folders"]);
	});
});
