import type { Challenge } from "@/data/schemas/challenge";
import { type Day, dayOfInstant, instantOnDay } from "./calendarDates";
import type { CalendarItem } from "./challengeCalendar";
import { isHexColor, paletteColorFor } from "./palette";

// Where a challenge sits on the calendar (docs/PLAN.md, decision 4): on its
// premiere date if it has one, else on its "visible from" date; with neither
// it is listed under "Bez daty".

export type CalendarDateField = "liveAtUtc" | "availableAtUtc";

/** The date that places the challenge, and which field it comes from. */
export function calendarStart(
	challenge: Pick<Challenge, "liveAtUtc" | "availableAtUtc">,
): { field: CalendarDateField; day: Day } | null {
	const live = dayOfInstant(challenge.liveAtUtc);
	if (live) return { field: "liveAtUtc", day: live };
	const available = dayOfInstant(challenge.availableAtUtc);
	if (available) return { field: "availableAtUtc", day: available };
	return null;
}

/**
 * The field a new calendar date goes into. A challenge without any date
 * gets "visible from": setting a premiere date would turn a plan into a
 * live challenge, which is a decision for the content form, not for a drag.
 */
export const calendarField = (
	challenge: Pick<Challenge, "liveAtUtc" | "availableAtUtc">,
): CalendarDateField => calendarStart(challenge)?.field ?? "availableAtUtc";

/** Moves the challenge to `day`, keeping the time of day it had. */
export function withCalendarDay<
	T extends Pick<Challenge, "liveAtUtc" | "availableAtUtc">,
>(challenge: T, day: Day): T {
	const field = calendarField(challenge);
	return { ...challenge, [field]: instantOnDay(day, challenge[field]) };
}

export function toCalendarItem(
	challenge: Pick<
		Challenge,
		"id" | "title" | "lengthDays" | "liveAtUtc" | "availableAtUtc"
	>,
	calendarColor: string | null | undefined,
): CalendarItem {
	return {
		id: challenge.id,
		title: challenge.title || "Bez nazwy",
		color: isHexColor(calendarColor)
			? calendarColor
			: paletteColorFor(challenge.id),
		start: calendarStart(challenge)?.day ?? null,
		lengthDays: challenge.lengthDays,
	};
}
