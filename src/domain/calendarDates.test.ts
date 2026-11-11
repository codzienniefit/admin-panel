import { describe, expect, it } from "vitest";
import {
	addDays,
	buildMonthGrid,
	dayOfInstant,
	diffInDays,
	formatDay,
	formatDayFull,
	formatDayMonth,
	holidayNamePL,
	instantOnDay,
	isHolidayPL,
	mondayOf,
	monthLabel,
	parseDay,
	today,
	WEEKDAY_SHORT_PL,
} from "./calendarDates";

// Expectations are written as day strings or built with local Date
// constructors, so the tests hold in whatever time zone they run.

describe("parsing and formatting a day", () => {
	it("parses to local midnight", () => {
		const date = parseDay("2026-09-14");
		expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
			2026, 8, 14,
		]);
		expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([
			0, 0, 0,
		]);
	});

	it("formats from local components", () => {
		expect(formatDay(new Date(2026, 0, 5))).toBe("2026-01-05");
		expect(formatDay(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
		expect(formatDay(new Date(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
	});

	it("round-trips", () => {
		for (const day of [
			"2024-02-29",
			"2026-03-29",
			"2026-10-25",
			"2027-01-01",
		]) {
			expect(formatDay(parseDay(day))).toBe(day);
		}
	});

	it("refuses what is not a calendar day", () => {
		for (const bad of [
			"",
			"2026-9-14",
			"14.09.2026",
			"2026-02-31",
			"2026-13-01",
		]) {
			expect(Number.isNaN(parseDay(bad).getTime())).toBe(true);
		}
	});

	it("takes today from the given clock", () => {
		expect(today(new Date(2026, 10, 11, 8, 30))).toBe("2026-11-11");
		expect(today(new Date(2026, 10, 11, 23, 59))).toBe("2026-11-11");
		expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("day arithmetic", () => {
	it("adds and subtracts days across months and years", () => {
		expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
		expect(addDays("2026-09-14", 0)).toBe("2026-09-14");
		expect(addDays("2026-09-14", 27)).toBe("2026-10-11");
	});

	it("measures the distance between two days", () => {
		expect(diffInDays("2026-09-14", "2026-09-14")).toBe(0);
		expect(diffInDays("2026-09-14", "2026-09-15")).toBe(1);
		expect(diffInDays("2026-09-15", "2026-09-14")).toBe(-1);
		expect(diffInDays("2026-01-01", "2027-01-01")).toBe(365);
		expect(diffInDays("2024-01-01", "2025-01-01")).toBe(366);
	});

	// The last Sundays of March and October in Europe, and the US changes, so
	// whichever zone the tests run in, one pair crosses a 23- or 25-hour day.
	it.each([
		["2026-03-28", "2026-03-29", "2026-03-30"],
		["2026-10-24", "2026-10-25", "2026-10-26"],
		["2026-03-07", "2026-03-08", "2026-03-09"],
		["2026-10-31", "2026-11-01", "2026-11-02"],
	])(
		"does not skip or repeat a day around the clock change of %s",
		(before, change, after) => {
			expect(addDays(before, 1)).toBe(change);
			expect(addDays(change, 1)).toBe(after);
			expect(addDays(before, 2)).toBe(after);
			expect(addDays(after, -1)).toBe(change);
			expect(addDays(after, -2)).toBe(before);
			expect(diffInDays(before, change)).toBe(1);
			expect(diffInDays(change, after)).toBe(1);
			expect(diffInDays(before, after)).toBe(2);
			expect(diffInDays(after, before)).toBe(-2);
		},
	);

	it("keeps adding and measuring in step over a whole year", () => {
		let day = "2026-01-01";
		for (let count = 1; count <= 365; count++) {
			day = addDays(day, 1);
			expect(addDays("2026-01-01", count)).toBe(day);
			expect(diffInDays("2026-01-01", day)).toBe(count);
		}
		expect(day).toBe("2027-01-01");
	});
});

describe("weeks and month pages", () => {
	it("finds the Monday of a week", () => {
		// 14 September 2026 is a Monday.
		expect(mondayOf("2026-09-14")).toBe("2026-09-14");
		expect(mondayOf("2026-09-16")).toBe("2026-09-14");
		expect(mondayOf("2026-09-20")).toBe("2026-09-14");
		expect(mondayOf("2026-09-21")).toBe("2026-09-21");
		expect(mondayOf("2027-01-01")).toBe("2026-12-28");
	});

	it("builds a month page with padding days, Monday first", () => {
		const grid = buildMonthGrid(2026, 8);
		expect(grid).toHaveLength(5);
		expect(grid[0]).toEqual([
			"2026-08-31",
			"2026-09-01",
			"2026-09-02",
			"2026-09-03",
			"2026-09-04",
			"2026-09-05",
			"2026-09-06",
		]);
		expect(grid[4]?.[0]).toBe("2026-09-28");
		expect(grid[4]?.[6]).toBe("2026-10-04");
	});

	it("uses as many rows as the month needs", () => {
		// February 2027 starts on a Monday and has exactly four weeks.
		const february = buildMonthGrid(2027, 1);
		expect(february).toHaveLength(4);
		expect(february[0]?.[0]).toBe("2027-02-01");
		expect(february[3]?.[6]).toBe("2027-02-28");
		// August 2026 starts on a Saturday and needs six.
		const august = buildMonthGrid(2026, 7);
		expect(august).toHaveLength(6);
		expect(august[0]?.[0]).toBe("2026-07-27");
		expect(august[5]?.[6]).toBe("2026-09-06");
	});

	it("gives every month of a year whole, consecutive weeks", () => {
		for (let month0 = 0; month0 < 12; month0++) {
			const days = buildMonthGrid(2026, month0).flat();
			expect(days.length % 7).toBe(0);
			expect(mondayOf(days[0] ?? "")).toBe(days[0]);
			days.forEach((day, index) => {
				expect(day).toBe(addDays(days[0] ?? "", index));
			});
			const prefix = `2026-${String(month0 + 1).padStart(2, "0")}-`;
			const inMonth = days.filter((day) => day.startsWith(prefix));
			expect(inMonth).toHaveLength(new Date(2026, month0 + 1, 0).getDate());
		}
	});
});

describe("Polish public holidays", () => {
	it("knows the fixed ones", () => {
		for (const monthDay of [
			"01-01",
			"01-06",
			"05-01",
			"05-03",
			"08-15",
			"11-01",
			"11-11",
			"12-25",
			"12-26",
		]) {
			expect(isHolidayPL(`2026-${monthDay}`)).toBe(true);
			expect(isHolidayPL(`2019-${monthDay}`)).toBe(true);
		}
		expect(holidayNamePL("2026-11-11")).toBe("Narodowe Święto Niepodległości");
		expect(holidayNamePL("2026-05-03")).toBe("Święto Konstytucji 3 Maja");
	});

	it("counts Christmas Eve from 2025 on", () => {
		expect(isHolidayPL("2024-12-24")).toBe(false);
		expect(isHolidayPL("2025-12-24")).toBe(true);
		expect(holidayNamePL("2026-12-24")).toBe("Wigilia Bożego Narodzenia");
		expect(holidayNamePL("2024-12-24")).toBeNull();
	});

	it.each([
		[2025, "2025-04-20", "2025-04-21", "2025-06-08", "2025-06-19"],
		[2026, "2026-04-05", "2026-04-06", "2026-05-24", "2026-06-04"],
		[2027, "2027-03-28", "2027-03-29", "2027-05-16", "2027-05-27"],
	])(
		"finds the movable ones of %i",
		(_year, easter, monday, pentecost, corpusChristi) => {
			expect(holidayNamePL(easter)).toBe("Wielkanoc");
			expect(holidayNamePL(monday)).toBe("Poniedziałek Wielkanocny");
			expect(holidayNamePL(pentecost)).toBe("Zielone Świątki");
			expect(holidayNamePL(corpusChristi)).toBe("Boże Ciało");
			// Easter and Pentecost are Sundays, Corpus Christi a Thursday.
			expect(parseDay(easter).getDay()).toBe(0);
			expect(parseDay(pentecost).getDay()).toBe(0);
			expect(parseDay(corpusChristi).getDay()).toBe(4);
			expect(isHolidayPL(addDays(easter, -1))).toBe(false);
			expect(isHolidayPL(addDays(monday, 1))).toBe(false);
		},
	);

	it("says no for ordinary days and nonsense", () => {
		expect(isHolidayPL("2026-09-14")).toBe(false);
		expect(holidayNamePL("2026-09-14")).toBeNull();
		// Last year's Easter date is an ordinary day this year.
		expect(isHolidayPL("2026-04-20")).toBe(false);
		expect(isHolidayPL("")).toBe(false);
		expect(holidayNamePL("wtorek")).toBeNull();
	});

	it("finds 13 or 14 holidays in a year", () => {
		const holidaysIn = (year: number) => {
			let count = 0;
			for (
				let day = `${year}-01-01`;
				day < `${year + 1}-01-01`;
				day = addDays(day, 1)
			) {
				if (isHolidayPL(day)) count++;
			}
			return count;
		};
		expect(holidaysIn(2024)).toBe(13);
		expect(holidaysIn(2026)).toBe(14);
	});
});

describe("labels", () => {
	it("lists the weekdays from Monday", () => {
		expect(WEEKDAY_SHORT_PL).toEqual([
			"Pon",
			"Wt",
			"Śr",
			"Czw",
			"Pt",
			"Sob",
			"Nie",
		]);
		// The index is the column of a month page.
		const col = (day: string) => diffInDays(mondayOf(day), day);
		expect(WEEKDAY_SHORT_PL[col("2026-11-11")]).toBe("Śr");
		expect(WEEKDAY_SHORT_PL[col("2026-11-15")]).toBe("Nie");
	});

	it("names a month in the nominative, capitalised", () => {
		expect(monthLabel(2026, 8)).toBe("Wrzesień 2026");
		expect(monthLabel(2026, 0)).toBe("Styczeń 2026");
		expect(monthLabel(2027, 1)).toBe("Luty 2027");
		expect(monthLabel(2026, 9)).toBe("Październik 2026");
	});

	it("rolls a month past December into the next year", () => {
		expect(monthLabel(2026, 12)).toBe("Styczeń 2027");
		expect(monthLabel(2026, -1)).toBe("Grudzień 2025");
	});

	it("formats a day the Polish way", () => {
		expect(formatDayMonth("2026-09-04")).toBe("04.09");
		expect(formatDayFull("2026-09-04")).toBe("04.09.2026");
		expect(formatDayMonth("kiedyś")).toBe("");
		expect(formatDayFull("")).toBe("");
	});
});

describe("days and instants", () => {
	it("gives the local day of an instant", () => {
		// Late evening and just after midnight are where UTC has another date.
		expect(dayOfInstant(new Date(2026, 0, 1, 23, 30).toISOString())).toBe(
			"2026-01-01",
		);
		expect(dayOfInstant(new Date(2026, 6, 1, 0, 15).toISOString())).toBe(
			"2026-07-01",
		);
	});

	it("gives null for a missing or broken instant", () => {
		expect(dayOfInstant(null)).toBeNull();
		expect(dayOfInstant(undefined)).toBeNull();
		expect(dayOfInstant("")).toBeNull();
		expect(dayOfInstant("nie data")).toBeNull();
	});

	it("puts a new instant at 13:00 local", () => {
		const instant = instantOnDay("2026-09-14", null);
		expect(instant).toBe(new Date(2026, 8, 14, 13, 0, 0, 0).toISOString());
		expect(instantOnDay("2026-09-14", undefined)).toBe(instant);
		expect(instantOnDay("2026-09-14", "")).toBe(instant);
		expect(instantOnDay("2026-09-14", "nie data")).toBe(instant);
	});

	it("keeps the local time of day when moving to another day", () => {
		const previous = new Date(2026, 5, 1, 18, 30, 15, 250).toISOString();
		// June to December crosses a clock change: the UTC hour moves, the
		// local one must not.
		const moved = instantOnDay("2026-12-24", previous);
		expect(moved).toBe(new Date(2026, 11, 24, 18, 30, 15, 250).toISOString());
		expect(new Date(moved).getHours()).toBe(18);
	});

	it("round-trips a day through an instant", () => {
		const lateShow = new Date(2026, 2, 1, 23, 45).toISOString();
		for (const day of [
			"2026-01-01",
			"2026-03-29",
			"2026-10-25",
			"2026-12-31",
		]) {
			expect(dayOfInstant(instantOnDay(day, null))).toBe(day);
			expect(dayOfInstant(instantOnDay(day, lateShow))).toBe(day);
		}
	});

	it("leaves an instant alone when moved onto its own day", () => {
		const instant = new Date(2026, 8, 14, 9, 5).toISOString();
		expect(instantOnDay(dayOfInstant(instant) ?? "", instant)).toBe(instant);
	});

	it("moves an instant by whole days", () => {
		const instant = new Date(2026, 8, 14, 20, 0).toISOString();
		const start = dayOfInstant(instant) ?? "";
		const moved = instantOnDay(addDays(start, 10), instant);
		expect(diffInDays(start, dayOfInstant(moved) ?? "")).toBe(10);
	});
});
