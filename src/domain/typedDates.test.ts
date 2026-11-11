import { describe, expect, it } from "vitest";
import {
	dayOfInstant,
	formatDateTimeText,
	instantAt,
	parseDateTimeText,
	parseDayText,
	parseTimeText,
	shiftTime,
	timeOfInstant,
} from "./calendarDates";

// Dates as people type them into the date fields (the last part of
// calendarDates.ts). Instants are built with local Date constructors, so the
// tests hold in whatever time zone they run.

describe("a typed time", () => {
	it.each([
		["10:06", "10:06"],
		["9:05", "09:05"],
		["09.05", "09:05"],
		["0905", "09:05"],
		["905", "09:05"],
		["9", "09:00"],
		["13", "13:00"],
		["0:00", "00:00"],
		["23:59", "23:59"],
		["  7:30 ", "07:30"],
	])("reads %s as %s", (typed, time) => {
		expect(parseTimeText(typed)).toBe(time);
	});

	it.each([
		["24:00"],
		["12:60"],
		["1:2:3"],
		["dziesiąta"],
		[""],
		["10:"],
		["-1"],
		["10:06 AM"],
	])("refuses %s", (typed) => {
		expect(parseTimeText(typed)).toBeNull();
	});
});

describe("a typed day", () => {
	it.each([
		["20.11.2026", "2026-11-20"],
		["20/11/2026", "2026-11-20"],
		["20-11-2026", "2026-11-20"],
		["1.3.2027", "2027-03-01"],
		["01.03.27", "2027-03-01"],
		["2026-11-20", "2026-11-20"],
		["2026-3-1", "2026-03-01"],
		[" 29.02.2028 ", "2028-02-29"],
	])("reads %s as %s", (typed, day) => {
		expect(parseDayText(typed)).toBe(day);
	});

	it.each([
		["31.02.2026", "a day that month does not have"],
		["29.02.2027", "29 February outside a leap year"],
		["0.11.2026", "day zero"],
		["20.13.2026", "month thirteen"],
		["20.11", "no year"],
		["20.11.202", "a three-digit year"],
		["11/20/2026", "the American order"],
		["jutro", "a word"],
		["", "nothing"],
	])("refuses %s (%s)", (typed) => {
		expect(parseDayText(typed)).toBeNull();
	});
});

describe("a typed day and time", () => {
	it("reads both, with a space or a comma between", () => {
		const both = { day: "2026-11-20", time: "10:06" };
		expect(parseDateTimeText("20.11.2026 10:06")).toEqual(both);
		expect(parseDateTimeText("20.11.2026, 10:06")).toEqual(both);
		expect(parseDateTimeText("  20.11.2026   10.06 ")).toEqual(both);
		expect(parseDateTimeText("2026-11-20 1006")).toEqual(both);
	});

	it("reads a day alone and leaves the time open", () => {
		expect(parseDateTimeText("20.11.2026")).toEqual({
			day: "2026-11-20",
			time: null,
		});
	});

	it("refuses a real day followed by something that is not a time", () => {
		expect(parseDateTimeText("20.11.2026 25:00")).toBeNull();
		expect(parseDateTimeText("20.11.2026 rano")).toBeNull();
		expect(parseDateTimeText("20.11.2026 10:06 AM")).toBeNull();
	});

	it("refuses a day that is not a day, whatever follows", () => {
		expect(parseDateTimeText("31.02.2026 10:00")).toBeNull();
		expect(parseDateTimeText("")).toBeNull();
	});
});

describe("a day and a time as an instant", () => {
	it("is that local moment", () => {
		expect(instantAt("2026-11-20", "10:06")).toBe(
			new Date(2026, 10, 20, 10, 6).toISOString(),
		);
		expect(instantAt("2027-01-01", "00:00")).toBe(
			new Date(2027, 0, 1, 0, 0).toISOString(),
		);
	});

	it("comes back as the same day and time", () => {
		for (const day of [
			"2026-01-01",
			"2026-03-29",
			"2026-10-25",
			"2026-12-31",
		]) {
			for (const time of ["00:00", "06:15", "13:00", "23:59"]) {
				const instant = instantAt(day, time);
				expect(dayOfInstant(instant)).toBe(day);
				expect(timeOfInstant(instant)).toBe(time);
			}
		}
	});

	it("is null for a malformed day or time", () => {
		expect(instantAt("2026-02-31", "10:00")).toBeNull();
		expect(instantAt("20.11.2026", "10:00")).toBeNull();
		expect(instantAt("2026-11-20", "24:00")).toBeNull();
		expect(instantAt("2026-11-20", "9:00")).toBeNull();
		expect(instantAt("2026-11-20", "")).toBeNull();
	});

	it("has no time for an empty or broken instant", () => {
		expect(timeOfInstant(null)).toBeNull();
		expect(timeOfInstant(undefined)).toBeNull();
		expect(timeOfInstant("")).toBeNull();
		expect(timeOfInstant("wczoraj")).toBeNull();
	});
});

describe("an instant as text", () => {
	it("is written the Polish way, 24-hour, local", () => {
		expect(
			formatDateTimeText(new Date(2026, 10, 20, 10, 6).toISOString()),
		).toBe("20.11.2026 10:06");
		expect(formatDateTimeText(new Date(2027, 2, 1, 0, 5).toISOString())).toBe(
			"01.03.2027 00:05",
		);
	});

	it("is empty for nothing or for a broken value", () => {
		expect(formatDateTimeText(null)).toBe("");
		expect(formatDateTimeText(undefined)).toBe("");
		expect(formatDateTimeText("kiedyś")).toBe("");
	});

	it("can be typed back in unchanged", () => {
		const instant = new Date(2026, 5, 9, 18, 45).toISOString();
		const typed = parseDateTimeText(formatDateTimeText(instant));
		expect(typed).toEqual({ day: "2026-06-09", time: "18:45" });
		expect(instantAt(typed?.day ?? "", typed?.time ?? "")).toBe(instant);
	});
});

describe("stepping a time", () => {
	it("moves by minutes", () => {
		expect(shiftTime("10:00", 15)).toBe("10:15");
		expect(shiftTime("10:00", -15)).toBe("09:45");
		expect(shiftTime("10:50", 15)).toBe("11:05");
	});

	it("wraps around midnight both ways", () => {
		expect(shiftTime("23:50", 15)).toBe("00:05");
		expect(shiftTime("00:05", -15)).toBe("23:50");
		expect(shiftTime("12:00", 1440)).toBe("12:00");
		expect(shiftTime("12:00", -2880)).toBe("12:00");
	});

	it("leaves a malformed time alone", () => {
		expect(shiftTime("teraz", 15)).toBe("teraz");
	});
});
