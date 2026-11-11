import { describe, expect, it } from "vitest";
import {
	formatDate,
	formatDateTime,
	fromLocalInput,
	toLocalInput,
} from "./dates";

// Instants are built from LOCAL date parts, so every expectation holds in
// whatever time zone the tests run (TZ=America/Los_Angeles, Pacific/Auckland).

/** The UTC instant of a local wall-clock time. */
const instant = (
	year: number,
	month: number,
	dayOfMonth: number,
	hour = 0,
	minute = 0,
	second = 0,
) => new Date(year, month - 1, dayOfMonth, hour, minute, second).toISOString();

describe("toLocalInput", () => {
	it("shows an instant as local date and time", () => {
		expect(toLocalInput(instant(2026, 11, 24, 18, 30))).toBe(
			"2026-11-24T18:30",
		);
	});

	it("pads single digits", () => {
		expect(toLocalInput(instant(2026, 3, 4, 9, 5))).toBe("2026-03-04T09:05");
		expect(toLocalInput(instant(2026, 1, 1))).toBe("2026-01-01T00:00");
	});

	it("drops seconds", () => {
		expect(toLocalInput(instant(2026, 6, 15, 7, 45, 59))).toBe(
			"2026-06-15T07:45",
		);
	});

	it("stays on the local day late in the evening and just after midnight", () => {
		// Where a UTC reading would already show the next or the previous day.
		expect(toLocalInput(instant(2026, 12, 31, 23, 59))).toBe(
			"2026-12-31T23:59",
		);
		expect(toLocalInput(instant(2027, 1, 1, 0, 1))).toBe("2027-01-01T00:01");
	});

	it.each([
		["nothing", null],
		["an empty text", ""],
		["a text that is no date", "w przyszły wtorek"],
	])("is empty for %s", (_what, input) => {
		expect(toLocalInput(input)).toBe("");
	});
});

describe("fromLocalInput", () => {
	it("reads the input as local time", () => {
		expect(fromLocalInput("2026-11-24T18:30")).toBe(
			instant(2026, 11, 24, 18, 30),
		);
		expect(fromLocalInput("2026-03-04T09:05")).toBe(instant(2026, 3, 4, 9, 5));
	});

	it("gives an ISO instant in UTC", () => {
		expect(fromLocalInput("2026-11-24T18:30")).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/,
		);
	});

	it("is null for an empty input", () => {
		expect(fromLocalInput("")).toBeNull();
	});

	it.each(["jutro", "24.11.2026 18:30", "2026-13-40T25:61"])(
		"is null for %s",
		(input) => {
			expect(fromLocalInput(input)).toBeNull();
		},
	);
});

describe("the round trip through a datetime-local input", () => {
	it.each([
		"2026-01-01T00:00",
		"2026-03-04T09:05",
		"2026-07-19T12:00",
		"2026-11-24T18:30",
		"2026-12-31T23:59",
		"2028-02-29T06:15",
	])("gives %s back", (input) => {
		const iso = fromLocalInput(input);
		expect(iso).not.toBeNull();
		expect(toLocalInput(iso)).toBe(input);
	});

	it("keeps an instant that has whole minutes", () => {
		const iso = instant(2026, 9, 14, 6, 0);
		expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
	});

	it("turns an emptied field back into no date", () => {
		expect(fromLocalInput(toLocalInput(null))).toBeNull();
	});
});

describe("formatDate", () => {
	it("writes day, month and year the Polish way", () => {
		expect(formatDate(instant(2026, 3, 4, 12))).toBe("04.03.2026");
		expect(formatDate(instant(2026, 11, 24, 12))).toBe("24.11.2026");
	});

	it("shows the local day at both ends of it", () => {
		expect(formatDate(instant(2026, 12, 31, 23, 59))).toBe("31.12.2026");
		expect(formatDate(instant(2027, 1, 1, 0, 1))).toBe("01.01.2027");
	});

	it.each([
		["nothing", null],
		["an empty text", ""],
		["a text that is no date", "wkrótce"],
	])("shows a dash for %s", (_what, input) => {
		expect(formatDate(input)).toBe("—");
	});
});

describe("formatDateTime", () => {
	it("adds the local time on a 24-hour clock", () => {
		expect(formatDateTime(instant(2026, 3, 4, 9, 5))).toBe("04.03.2026, 09:05");
		expect(formatDateTime(instant(2026, 11, 24, 18, 30))).toBe(
			"24.11.2026, 18:30",
		);
		expect(formatDateTime(instant(2026, 11, 24, 0, 7))).toBe(
			"24.11.2026, 00:07",
		);
	});

	it.each([
		["nothing", null],
		["an empty text", ""],
		["a text that is no date", "wkrótce"],
	])("shows a dash for %s", (_what, input) => {
		expect(formatDateTime(input)).toBe("—");
	});
});
