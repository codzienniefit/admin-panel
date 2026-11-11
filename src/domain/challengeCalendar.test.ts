import { describe, expect, it } from "vitest";
import { buildMonthGrid } from "./calendarDates";
import {
	assignLanes,
	buildWeekSegments,
	buildYearColorIndex,
	type CalendarItem,
	itemsOnDay,
	lastDay,
	shiftItem,
	splitItems,
} from "./challengeCalendar";

const item = (
	id: string,
	start: string | null,
	lengthDays: number,
	patch: Partial<CalendarItem> = {},
): CalendarItem => ({
	id,
	title: `Wyzwanie ${id}`,
	color: "#3b82f6",
	start,
	lengthDays,
	...patch,
});

const datedOf = (...items: CalendarItem[]) => splitItems(items).dated;
const ids = (items: ReadonlyArray<{ id: string }>) =>
	items.map((entry) => entry.id);

// Monday 14 to Sunday 20 September 2026.
const WEEK = [
	"2026-09-14",
	"2026-09-15",
	"2026-09-16",
	"2026-09-17",
	"2026-09-18",
	"2026-09-19",
	"2026-09-20",
];

describe("splitting items into dated and undated", () => {
	it("computes the last day from the length", () => {
		const { dated } = splitItems([item("C1", "2026-09-14", 28)]);
		expect(dated[0]).toMatchObject({
			id: "C1",
			start: "2026-09-14",
			end: "2026-10-11",
		});
	});

	it("treats a length of 0 or less as one day", () => {
		const dated = datedOf(
			item("C1", "2026-09-14", 0),
			item("C2", "2026-09-15", -5),
			item("C3", "2026-09-16", Number.NaN),
			item("C4", "2026-09-17", 1),
		);
		for (const entry of dated) expect(entry.end).toBe(entry.start);
	});

	it("orders dated items by start, then longer first, then id", () => {
		const dated = datedOf(
			item("C10", "2026-09-14", 7),
			item("C3", "2026-10-01", 7),
			item("C2", "2026-09-14", 7),
			item("C7", "2026-09-14", 28),
			item("C1", "2026-09-01", 3),
		);
		expect(ids(dated)).toEqual(["C1", "C7", "C2", "C10", "C3"]);
	});

	it("orders undated items by title the Polish way", () => {
		const { dated, undated } = splitItems([
			item("C1", null, 28, { title: "Żelazne plecy" }),
			item("C2", null, 28, { title: "Zdrowy kręgosłup" }),
			item("C3", "2026-09-14", 28, { title: "Brzuch" }),
			item("C4", null, 28, { title: "Łydki ze stali" }),
			item("C5", null, 28, { title: "abs w 10 minut" }),
			item("C6", null, 28, { title: "Plan 10" }),
			item("C7", null, 28, { title: "Plan 9" }),
		]);
		expect(ids(dated)).toEqual(["C3"]);
		expect(undated.map((entry) => entry.title)).toEqual([
			"abs w 10 minut",
			"Łydki ze stali",
			"Plan 9",
			"Plan 10",
			"Zdrowy kręgosłup",
			"Żelazne plecy",
		]);
	});

	it("puts an item whose start is not a real day with the undated", () => {
		const { dated, undated } = splitItems([
			item("C1", "wkrótce", 28),
			item("C2", "2026-02-31", 28),
		]);
		expect(dated).toEqual([]);
		expect(ids(undated)).toEqual(["C1", "C2"]);
	});

	it("does not change the list it was given", () => {
		const items = [item("C2", null, 7), item("C1", null, 7)];
		splitItems(items);
		expect(ids(items)).toEqual(["C2", "C1"]);
	});
});

describe("lanes", () => {
	it("puts overlapping items in different lanes", () => {
		const lanes = assignLanes(
			datedOf(item("A", "2026-09-01", 7), item("B", "2026-09-05", 7)),
		);
		expect(lanes.get("A")).toBe(0);
		expect(lanes.get("B")).toBe(1);
	});

	it("lets ranges that only touch share a lane", () => {
		// A ends on the 7th, B starts on the 8th.
		const lanes = assignLanes(
			datedOf(item("A", "2026-09-01", 7), item("B", "2026-09-08", 7)),
		);
		expect(lanes.get("A")).toBe(0);
		expect(lanes.get("B")).toBe(0);
	});

	it("separates ranges that share a single day", () => {
		const lanes = assignLanes(
			datedOf(item("A", "2026-09-01", 7), item("B", "2026-09-07", 7)),
		);
		expect(lanes.get("B")).toBe(1);
	});

	it("reuses the first lane that has become free", () => {
		const lanes = assignLanes(
			datedOf(
				item("long", "2026-09-01", 30),
				item("short", "2026-09-02", 3),
				item("mid", "2026-09-03", 10),
				item("late", "2026-09-06", 5),
			),
		);
		expect(Object.fromEntries(lanes)).toEqual({
			long: 0,
			short: 1,
			mid: 2,
			late: 1,
		});
	});

	it("never puts two overlapping items in one lane", () => {
		const dated = datedOf(
			...Array.from({ length: 40 }, (_, index) =>
				item(
					`C${index}`,
					`2026-${String(1 + (index % 12)).padStart(2, "0")}-${String(1 + ((index * 7) % 28)).padStart(2, "0")}`,
					7 + ((index * 5) % 40),
				),
			),
		);
		const lanes = assignLanes(dated);
		for (const a of dated) {
			for (const b of dated) {
				if (a.id === b.id || lanes.get(a.id) !== lanes.get(b.id)) continue;
				expect(a.end < b.start || b.end < a.start).toBe(true);
			}
		}
	});

	it("gives the same lanes whatever order the items come in", () => {
		const dated = datedOf(
			item("A", "2026-09-01", 7),
			item("B", "2026-09-05", 7),
			item("C", "2026-09-08", 2),
		);
		expect(assignLanes([...dated].reverse())).toEqual(assignLanes(dated));
	});
});

describe("week segments", () => {
	it("clips bars at the week's edges and says where they go on", () => {
		const dated = datedOf(
			item("before", "2026-09-10", 7), // 10th to 16th
			item("inside", "2026-09-15", 3), // 15th to 17th
			item("after", "2026-09-18", 10), // 18th to 27th
			item("across", "2026-09-01", 30), // the whole of September
			item("elsewhere", "2026-10-05", 7),
		);
		const { segments, hiddenByDay } = buildWeekSegments(
			WEEK,
			dated,
			assignLanes(dated),
			4,
		);
		expect(segments).toEqual([
			{
				id: "across",
				lane: 0,
				startCol: 0,
				endCol: 6,
				continuesLeft: true,
				continuesRight: true,
			},
			{
				id: "before",
				lane: 1,
				startCol: 0,
				endCol: 2,
				continuesLeft: true,
				continuesRight: false,
			},
			{
				id: "after",
				lane: 1,
				startCol: 4,
				endCol: 6,
				continuesLeft: false,
				continuesRight: true,
			},
			{
				id: "inside",
				lane: 2,
				startCol: 1,
				endCol: 3,
				continuesLeft: false,
				continuesRight: false,
			},
		]);
		expect(hiddenByDay).toEqual([[], [], [], [], [], [], []]);
	});

	it("does not flag an item that starts on Monday or ends on Sunday", () => {
		const dated = datedOf(item("exact", "2026-09-14", 7));
		const { segments } = buildWeekSegments(WEEK, dated, assignLanes(dated), 4);
		expect(segments).toEqual([
			{
				id: "exact",
				lane: 0,
				startCol: 0,
				endCol: 6,
				continuesLeft: false,
				continuesRight: false,
			},
		]);
	});

	it("closes the gaps left by lanes that are empty this week", () => {
		const dated = datedOf(
			item("X", "2026-09-01", 3),
			item("Y", "2026-09-01", 2),
			item("Z", "2026-09-02", 20), // global lane 2, alone by the 14th
		);
		const lanes = assignLanes(dated);
		expect(lanes.get("Z")).toBe(2);
		const { segments } = buildWeekSegments(WEEK, dated, lanes, 4);
		expect(segments.map((segment) => [segment.id, segment.lane])).toEqual([
			["Z", 0],
		]);
	});

	it("keeps an item in the same row from one week to the next", () => {
		const dated = datedOf(
			item("top", "2026-09-07", 21),
			item("bottom", "2026-09-09", 14),
		);
		const lanes = assignLanes(dated);
		for (const week of buildMonthGrid(2026, 8).slice(1, 4)) {
			const { segments } = buildWeekSegments(week, dated, lanes, 4);
			const laneOf = Object.fromEntries(
				segments.map((segment) => [segment.id, segment.lane]),
			);
			expect(laneOf).toEqual({ top: 0, bottom: 1 });
		}
	});

	it("lists what does not fit under each day it covers", () => {
		const dated = datedOf(
			item("P", "2026-09-14", 7),
			item("Q", "2026-09-14", 3),
			item("R", "2026-09-15", 2), // lane 2: Tuesday and Wednesday
			item("S", "2026-09-17", 1), // back in lane 1 once Q has ended
		);
		const { segments, hiddenByDay } = buildWeekSegments(
			WEEK,
			dated,
			assignLanes(dated),
			2,
		);
		expect(segments.map((segment) => [segment.id, segment.lane])).toEqual([
			["P", 0],
			["Q", 1],
			["S", 1],
		]);
		expect(hiddenByDay).toEqual([[], ["R"], ["R"], [], [], [], []]);
	});

	it("hides everything beyond the limit, clipped to the week", () => {
		const dated = datedOf(
			item("A", "2026-09-10", 30),
			item("B", "2026-09-11", 30),
			item("C", "2026-09-12", 4), // ends on Tuesday the 15th
			item("D", "2026-09-19", 30), // from Saturday
		);
		const { segments, hiddenByDay } = buildWeekSegments(
			WEEK,
			dated,
			assignLanes(dated),
			1,
		);
		expect(ids(segments)).toEqual(["A"]);
		expect(hiddenByDay).toEqual([
			["B", "C"],
			["B", "C"],
			["B"],
			["B"],
			["B"],
			["B", "D"],
			["B", "D"],
		]);
	});

	it("still draws an item the lane map does not know", () => {
		const dated = datedOf(
			item("known", "2026-09-14", 7),
			item("new", "2026-09-15", 2),
		);
		const lanes = new Map([["known", 0]]);
		const { segments } = buildWeekSegments(WEEK, dated, lanes, 4);
		expect(segments.map((segment) => [segment.id, segment.lane])).toEqual([
			["known", 0],
			["new", 1],
		]);
	});

	it("returns an empty week for an empty calendar", () => {
		expect(buildWeekSegments(WEEK, [], new Map(), 4)).toEqual({
			segments: [],
			hiddenByDay: [[], [], [], [], [], [], []],
		});
	});
});

describe("year colour index", () => {
	const RED = "#ef4444";
	const GREEN = "#22c55e";
	const BLUE = "#3b82f6";
	const PINK = "#ec4899";

	it("gives a day with one item its colour", () => {
		const index = buildYearColorIndex(
			datedOf(item("A", "2026-03-02", 3, { color: RED })),
			2026,
		);
		expect(Object.fromEntries(index)).toEqual({
			"2026-03-02": [RED],
			"2026-03-03": [RED],
			"2026-03-04": [RED],
		});
	});

	it("stacks the colours of overlapping items in calendar order", () => {
		const index = buildYearColorIndex(
			datedOf(
				item("B", "2026-03-03", 2, { color: GREEN }),
				item("A", "2026-03-02", 3, { color: RED }),
			),
			2026,
		);
		expect(index.get("2026-03-02")).toEqual([RED]);
		expect(index.get("2026-03-03")).toEqual([RED, GREEN]);
		expect(index.get("2026-03-04")).toEqual([RED, GREEN]);
		expect(index.get("2026-03-05")).toBeUndefined();
	});

	it("keeps at most three colours for a day", () => {
		const index = buildYearColorIndex(
			datedOf(
				item("A", "2026-03-01", 10, { color: RED }),
				item("B", "2026-03-02", 10, { color: GREEN }),
				item("C", "2026-03-03", 10, { color: BLUE }),
				item("D", "2026-03-04", 10, { color: PINK }),
			),
			2026,
		);
		expect(index.get("2026-03-03")).toEqual([RED, GREEN, BLUE]);
		expect(index.get("2026-03-04")).toEqual([RED, GREEN, BLUE]);
		// Once the first has ended there is room for the fourth.
		expect(index.get("2026-03-11")).toEqual([GREEN, BLUE, PINK]);
		for (const colors of index.values()) {
			expect(colors.length).toBeLessThanOrEqual(3);
		}
	});

	it("covers only the days of the year asked for", () => {
		const dated = datedOf(
			item("A", "2025-12-30", 5, { color: RED }), // to 3 January
			item("B", "2026-12-30", 5, { color: GREEN }), // to 3 January 2027
			item("C", "2027-06-01", 5, { color: BLUE }),
		);
		expect([...buildYearColorIndex(dated, 2026).keys()]).toEqual([
			"2026-01-01",
			"2026-01-02",
			"2026-01-03",
			"2026-12-30",
			"2026-12-31",
		]);
		expect(buildYearColorIndex(dated, 2024).size).toBe(0);
	});
});

describe("shifting an item", () => {
	const dated = datedOf(
		item("A", "2026-09-01", 7),
		item("B", "2026-09-10", 14),
		item("C", "2026-09-20", 3),
	);

	it("moves start and end together", () => {
		const moved = shiftItem(dated, "B", 5).find((entry) => entry.id === "B");
		expect(moved).toMatchObject({ start: "2026-09-15", end: "2026-09-28" });
	});

	it("re-sorts the list", () => {
		expect(ids(shiftItem(dated, "A", 30))).toEqual(["B", "C", "A"]);
		expect(ids(shiftItem(dated, "C", -25))).toEqual(["C", "A", "B"]);
	});

	it("keeps the length across a month end and a clock change", () => {
		const long = datedOf(item("L", "2026-10-20", 28));
		const moved = shiftItem(long, "L", -3)[0];
		expect(moved).toMatchObject({ start: "2026-10-17", end: "2026-11-13" });
	});

	it("leaves the given list and the other items alone", () => {
		const before = structuredClone(dated);
		const shifted = shiftItem(dated, "B", 5);
		expect(dated).toEqual(before);
		expect(shifted.find((entry) => entry.id === "A")).toEqual(before[0]);
		expect(shiftItem(dated, "nie ma", 5)).toEqual(before);
		expect(shiftItem(dated, "B", 0)).toEqual(before);
	});

	it("changes the lanes of the preview", () => {
		// B moved back onto A's days no longer fits in A's lane.
		expect(assignLanes(dated).get("B")).toBe(0);
		expect(assignLanes(shiftItem(dated, "B", -5)).get("B")).toBe(1);
	});
});

describe("items on a day", () => {
	const dated = datedOf(
		item("A", "2026-09-01", 7),
		item("B", "2026-09-07", 7),
		item("C", "2026-09-20", 1),
	);

	it("includes the first and the last day of an item", () => {
		expect(ids(itemsOnDay(dated, "2026-09-01"))).toEqual(["A"]);
		expect(ids(itemsOnDay(dated, "2026-09-07"))).toEqual(["A", "B"]);
		expect(ids(itemsOnDay(dated, "2026-09-13"))).toEqual(["B"]);
		expect(ids(itemsOnDay(dated, "2026-09-20"))).toEqual(["C"]);
	});

	it("is empty on a free day", () => {
		expect(itemsOnDay(dated, "2026-09-14")).toEqual([]);
		expect(itemsOnDay(dated, "2026-08-31")).toEqual([]);
	});
});

describe("the last day of a challenge", () => {
	it("is the first day when it lasts one day", () => {
		expect(lastDay("2026-09-14", 1)).toBe("2026-09-14");
	});

	it("counts the first day in", () => {
		expect(lastDay("2026-09-14", 2)).toBe("2026-09-15");
		expect(lastDay("2026-09-14", 7)).toBe("2026-09-20");
		expect(lastDay("2026-09-14", 28)).toBe("2026-10-11");
	});

	it.each([
		["zero", 0],
		["a negative length", -5],
		["not a number", Number.NaN],
		["an endless length", Number.POSITIVE_INFINITY],
		["less than a day", 0.5],
		["a day and a bit", 1.9],
	])("treats %s as one day", (_what, lengthDays) => {
		expect(lastDay("2026-09-14", lengthDays)).toBe("2026-09-14");
	});

	it("counts only whole days of a fractional length", () => {
		expect(lastDay("2026-09-14", 2.9)).toBe("2026-09-15");
		expect(lastDay("2026-09-14", 28.5)).toBe("2026-10-11");
	});

	it("crosses the end of a month", () => {
		expect(lastDay("2026-01-30", 3)).toBe("2026-02-01");
		expect(lastDay("2026-04-30", 2)).toBe("2026-05-01");
		expect(lastDay("2026-02-01", 28)).toBe("2026-02-28");
		expect(lastDay("2026-02-01", 29)).toBe("2026-03-01");
	});

	it("knows a leap year", () => {
		expect(lastDay("2028-02-28", 2)).toBe("2028-02-29");
		expect(lastDay("2028-02-01", 29)).toBe("2028-02-29");
		expect(lastDay("2027-02-28", 2)).toBe("2027-03-01");
	});

	it("crosses the end of a year", () => {
		expect(lastDay("2026-12-31", 1)).toBe("2026-12-31");
		expect(lastDay("2026-12-31", 2)).toBe("2027-01-01");
		expect(lastDay("2026-12-20", 28)).toBe("2027-01-16");
		expect(lastDay("2026-01-01", 365)).toBe("2026-12-31");
	});

	// The clocks change on these days in Europe/Warsaw (29 March, 25 October
	// 2026), America/Los_Angeles (8 March, 1 November) and Pacific/Auckland
	// (5 April, 27 September): a day there is 23 or 25 hours long.
	it.each([
		["2026-03-29", "2026-03-30", "2026-04-04"],
		["2026-10-25", "2026-10-26", "2026-10-31"],
		["2026-03-08", "2026-03-09", "2026-03-14"],
		["2026-11-01", "2026-11-02", "2026-11-07"],
		["2026-04-05", "2026-04-06", "2026-04-11"],
		["2026-09-27", "2026-09-28", "2026-10-03"],
	])(
		"does not slip on the clock change of %s",
		(changeDay, dayAfter, weekEnd) => {
			expect(lastDay(changeDay, 1)).toBe(changeDay);
			expect(lastDay(changeDay, 2)).toBe(dayAfter);
			expect(lastDay(changeDay, 7)).toBe(weekEnd);
		},
	);

	it("ends on, and passes over, a day when the clocks change", () => {
		expect(lastDay("2026-03-23", 7)).toBe("2026-03-29");
		expect(lastDay("2026-03-28", 3)).toBe("2026-03-30");
		expect(lastDay("2026-10-19", 7)).toBe("2026-10-25");
		expect(lastDay("2026-10-24", 3)).toBe("2026-10-26");
		expect(lastDay("2026-03-02", 28)).toBe("2026-03-29");
		expect(lastDay("2026-10-05", 28)).toBe("2026-11-01");
	});

	it("agrees with the end splitItems works out", () => {
		for (const lengthDays of [1, 7, 28, 0, -2, Number.NaN]) {
			const [entry] = datedOf(item("C1", "2026-10-20", lengthDays));
			expect(entry?.end).toBe(lastDay("2026-10-20", lengthDays));
		}
	});
});
