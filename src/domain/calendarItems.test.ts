import { describe, expect, it } from "vitest";
import { dayOfInstant, instantOnDay } from "./calendarDates";
import {
	calendarField,
	calendarStart,
	toCalendarItem,
	withCalendarDay,
} from "./calendarItems";
import { paletteColorFor } from "./palette";

const live = instantOnDay("2027-03-10", null);
const available = instantOnDay("2027-02-01", null);

describe("a challenge's place on the calendar", () => {
	it("uses the premiere date first, then the visible-from date", () => {
		expect(
			calendarStart({ liveAtUtc: live, availableAtUtc: available }),
		).toEqual({ field: "liveAtUtc", day: "2027-03-10" });
		expect(
			calendarStart({ liveAtUtc: null, availableAtUtc: available }),
		).toEqual({ field: "availableAtUtc", day: "2027-02-01" });
		expect(calendarStart({ liveAtUtc: null, availableAtUtc: null })).toBeNull();
		expect(
			calendarStart({ liveAtUtc: "nonsense", availableAtUtc: "" }),
		).toBeNull();
	});

	it("gives an undated challenge a visible-from date, never a premiere", () => {
		const plan = { liveAtUtc: null, availableAtUtc: null };
		expect(calendarField(plan)).toBe("availableAtUtc");
		const moved = withCalendarDay(plan, "2027-05-04");
		expect(moved.liveAtUtc).toBeNull();
		expect(dayOfInstant(moved.availableAtUtc)).toBe("2027-05-04");
	});

	it("moves the date it is placed by and keeps the time of day", () => {
		const moved = withCalendarDay(
			{ liveAtUtc: live, availableAtUtc: available },
			"2027-03-17",
		);
		expect(dayOfInstant(moved.liveAtUtc)).toBe("2027-03-17");
		expect(moved.availableAtUtc).toBe(available);
		expect(new Date(moved.liveAtUtc ?? "").getHours()).toBe(
			new Date(live).getHours(),
		);
	});

	it("builds a calendar item with a chosen or a derived colour", () => {
		const challenge = {
			id: "C7",
			title: "",
			lengthDays: 14,
			liveAtUtc: live,
			availableAtUtc: null,
		};
		expect(toCalendarItem(challenge, "#ef4444")).toEqual({
			id: "C7",
			title: "Bez nazwy",
			color: "#ef4444",
			start: "2027-03-10",
			lengthDays: 14,
		});
		expect(toCalendarItem(challenge, "red").color).toBe(paletteColorFor("C7"));
		expect(toCalendarItem(challenge, null).color).toBe(paletteColorFor("C7"));
	});
});
