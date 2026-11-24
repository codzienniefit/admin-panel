import { describe, expect, it } from "vitest";
import { instantAt, instantOnDay, timeOfInstant, today } from "./calendarDates";
import { formatDateTime, fromLocalInput, toLocalInput } from "./dates";
import {
	polishDayOf,
	polishInstant,
	polishTimeNote,
	polishTimeOf,
	polishTimeProblem,
	resolvePolishTime,
} from "./polishTime";

// These hold whatever time zone the computer running them is set to; the
// suite is also run with TZ=America/Los_Angeles and TZ=Asia/Tokyo
// (npm run test:timezones).

describe("Polish time, stored as UTC", () => {
	it("winter is UTC+1, summer is UTC+2", () => {
		expect(polishInstant("2026-01-15", "11:53")).toBe(
			"2026-01-15T10:53:00.000Z",
		);
		expect(polishInstant("2026-07-15", "11:53")).toBe(
			"2026-07-15T09:53:00.000Z",
		);
	});

	it("reads a stored moment back as the Polish day and time it was entered as", () => {
		for (const [iso, day, time] of [
			["2026-01-15T10:53:00.000Z", "2026-01-15", "11:53"],
			["2026-07-15T09:53:00.000Z", "2026-07-15", "11:53"],
			// 23:30 UTC is already the next day in Poland
			["2026-12-31T23:30:00.000Z", "2027-01-01", "00:30"],
		] as const) {
			expect(polishDayOf(iso)).toBe(day);
			expect(polishTimeOf(iso)).toBe(time);
		}
	});

	it("every quarter-hour of a year goes there and back unchanged", () => {
		let checked = 0;
		for (
			let ms = Date.UTC(2026, 0, 1);
			ms < Date.UTC(2027, 0, 1);
			ms += 15 * 60_000
		) {
			const iso = new Date(ms).toISOString();
			const day = polishDayOf(iso) as string;
			const time = polishTimeOf(iso) as string;
			const back = resolvePolishTime(day, time);
			expect(back.kind).toBe("ok");
			// the October hour that happens twice comes back as its first occurrence
			if (back.kind === "ok" && !back.ambiguous) expect(back.iso).toBe(iso);
			checked++;
		}
		expect(checked).toBe(365 * 96);
	});

	it("refuses the March hour the clock skips, with a reason", () => {
		// 29.03.2026: 02:00 becomes 03:00
		for (const time of ["02:00", "02:30", "02:59"]) {
			expect(resolvePolishTime("2026-03-29", time)).toEqual({ kind: "gap" });
			expect(polishInstant("2026-03-29", time)).toBeNull();
			expect(polishTimeProblem("2026-03-29", time)).toMatch(
				/nie istnieje tego dnia w Polsce/,
			);
		}
		expect(polishInstant("2026-03-29", "01:59")).toBe(
			"2026-03-29T00:59:00.000Z",
		);
		expect(polishInstant("2026-03-29", "03:00")).toBe(
			"2026-03-29T01:00:00.000Z",
		);
	});

	it("takes the October hour that happens twice the first time, and says so", () => {
		// 25.10.2026: 03:00 becomes 02:00 again
		expect(resolvePolishTime("2026-10-25", "02:30")).toEqual({
			kind: "ok",
			iso: "2026-10-25T00:30:00.000Z",
			ambiguous: true,
		});
		expect(polishTimeNote("2026-10-25", "02:30")).toMatch(/dwa razy/);
		expect(polishTimeNote("2026-10-25", "03:30")).toBeNull();
		expect(polishTimeProblem("2026-10-25", "02:30")).toBeNull();
	});

	it("refuses what is not a day or a time", () => {
		for (const [day, time] of [
			["2026-02-31", "10:00"],
			["2026-13-01", "10:00"],
			["26-01-01", "10:00"],
			["2026-01-01", "24:00"],
			["2026-01-01", "10:60"],
			["2026-01-01", "9:00"],
		] as const) {
			expect(resolvePolishTime(day, time)).toEqual({ kind: "invalid" });
		}
		expect(polishTimeProblem("2026-01-01", "25:00")).toMatch(/GG:MM/);
		expect(polishDayOf("nie data")).toBeNull();
		expect(polishTimeOf(null)).toBeNull();
	});

	it("today is the Polish day, also late in the evening UTC", () => {
		expect(today(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01");
		expect(today(new Date("2026-06-30T21:59:00.000Z"))).toBe("2026-06-30");
		expect(today(new Date("2026-06-30T22:00:00.000Z"))).toBe("2026-07-01");
	});
});

describe("the panel's date helpers use Polish time", () => {
	it("instantAt and timeOfInstant", () => {
		expect(instantAt("2026-11-24", "11:53")).toBe("2026-11-24T10:53:00.000Z");
		expect(timeOfInstant("2026-11-24T10:53:00.000Z")).toBe("11:53");
		expect(instantAt("2026-03-29", "02:15")).toBeNull();
	});

	it("a challenge dragged to another day keeps its Polish hour, across a clock change", () => {
		// 13:00 in winter, moved to a summer day: still 13:00 in Poland
		expect(instantOnDay("2026-04-10", "2026-03-20T12:00:00.000Z")).toBe(
			"2026-04-10T11:00:00.000Z",
		);
		expect(instantOnDay("2026-04-10", null)).toBe("2026-04-10T11:00:00.000Z");
		// 02:30 does not exist on 29.03: an hour later
		expect(instantOnDay("2026-03-29", "2026-03-20T01:30:00.000Z")).toBe(
			"2026-03-29T01:30:00.000Z",
		);
		expect(() => instantOnDay("2026-02-31", null)).toThrow(RangeError);
	});

	it("formatDateTime shows Polish time", () => {
		expect(formatDateTime("2026-07-15T09:53:00.000Z")).toBe(
			"15.07.2026, 11:53",
		);
	});

	it("toLocalInput and fromLocalInput", () => {
		expect(toLocalInput("2026-07-15T09:53:00.000Z")).toBe("2026-07-15T11:53");
		expect(fromLocalInput("2026-07-15T11:53")).toBe("2026-07-15T09:53:00.000Z");
		expect(fromLocalInput("2026-03-29T02:30")).toBeNull();
		expect(fromLocalInput("")).toBeNull();
	});
});
