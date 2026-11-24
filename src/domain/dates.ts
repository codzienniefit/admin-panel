// Dates are stored as UTC ISO strings and always shown in Polish time
// (Europe/Warsaw, polishTime.ts), whatever the browser's time zone is.

import {
	POLISH_TIME_ZONE,
	polishDayOf,
	polishInstant,
	polishTimeOf,
} from "./polishTime";

/** ISO UTC → "YYYY-MM-DDTHH:mm" in Polish time, as a datetime-local input wants. */
export function toLocalInput(iso: string | null): string {
	const day = polishDayOf(iso);
	const time = polishTimeOf(iso);
	return day && time ? `${day}T${time}` : "";
}

/** The reverse, read as Polish time; empty, invalid or nonexistent is null. */
export function fromLocalInput(value: string): string | null {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
	return match?.[1] && match[2] ? polishInstant(match[1], match[2]) : null;
}

const dateFormat = new Intl.DateTimeFormat("pl-PL", {
	timeZone: POLISH_TIME_ZONE,
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("pl-PL", {
	timeZone: POLISH_TIME_ZONE,
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

export function formatDate(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

export function formatDateTime(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
}
