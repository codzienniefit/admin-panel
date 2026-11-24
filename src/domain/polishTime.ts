// Polish time. The backend stores every moment as a UTC ISO string; people
// always read, type and pick it in Polish time (Europe/Warsaw), whatever time
// zone the computer in front of them is set to. This file is the only place
// that converts between the two.
//
// Twice a year the clock changes, and one hour on that night is special:
//
//   - last Sunday of March, 02:00–02:59 does not exist (clocks jump to 03:00);
//     such a time is refused ("gap"), never silently moved;
//   - last Sunday of October, 02:00–02:59 happens twice; the first one
//     (summer time) is taken, and the caller is told ("ambiguous").

export const POLISH_TIME_ZONE = "Europe/Warsaw";

/** "YYYY-MM-DD", a calendar day in Poland. */
export type PolishDay = string;
/** "HH:MM", 24-hour, Polish time. */
export type PolishTime = string;

const pad = (n: number) => String(n).padStart(2, "0");

const partsFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: POLISH_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

export interface PolishParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** What a Polish clock and calendar showed at this moment. */
export function polishParts(date: Date): PolishParts {
	const parts: Record<string, number> = {};
	for (const part of partsFormat.formatToParts(date)) {
		if (part.type !== "literal") parts[part.type] = Number(part.value);
	}
	return {
		year: parts.year ?? Number.NaN,
		month: parts.month ?? Number.NaN,
		day: parts.day ?? Number.NaN,
		// some engines write midnight as 24 even with h23
		hour: (parts.hour ?? Number.NaN) % 24,
		minute: parts.minute ?? Number.NaN,
		second: parts.second ?? Number.NaN,
	};
}

const valid = (iso: string | null | undefined): Date | null => {
	if (!iso) return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
};

/** The Polish calendar day of a moment; null for empty or invalid input. */
export function polishDayOf(iso: string | null | undefined): PolishDay | null {
	const date = valid(iso);
	if (!date) return null;
	const p = polishParts(date);
	return `${String(p.year).padStart(4, "0")}-${pad(p.month)}-${pad(p.day)}`;
}

/** The Polish time of day of a moment; null for empty or invalid input. */
export function polishTimeOf(
	iso: string | null | undefined,
): PolishTime | null {
	const date = valid(iso);
	if (!date) return null;
	const p = polishParts(date);
	return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Today in Poland. */
export function polishToday(now: Date = new Date()): PolishDay {
	return polishDayOf(now.toISOString()) as PolishDay;
}

export type PolishInstant =
	| { kind: "ok"; iso: string; ambiguous: boolean }
	/** The time does not exist that day: the clocks jump over it. */
	| { kind: "gap" }
	/** Not a real day or not a time of day. */
	| { kind: "invalid" };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;
const MINUTE = 60_000;

/**
 * The UTC moment of a Polish day and time. Poland is UTC+1 in winter and
 * UTC+2 in summer: of the two candidates, the ones a Polish clock really
 * shows as that day and time are the answer.
 */
export function resolvePolishTime(
	day: PolishDay,
	time: PolishTime,
): PolishInstant {
	const d = DAY.exec(day);
	const t = TIME.exec(time);
	if (!d || !t) return { kind: "invalid" };
	const [year, month, dayOfMonth] = [Number(d[1]), Number(d[2]), Number(d[3])];
	const [hour, minute] = [Number(t[1]), Number(t[2])];
	if (hour > 23 || minute > 59) return { kind: "invalid" };
	const wall = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
	const check = new Date(wall);
	// Date.UTC rolls 31.02 over into March instead of refusing it
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== dayOfMonth
	) {
		return { kind: "invalid" };
	}
	const matches = [120, 60]
		.map((offset) => wall - offset * MINUTE)
		.filter((ms) => {
			const p = polishParts(new Date(ms));
			return (
				p.year === year &&
				p.month === month &&
				p.day === dayOfMonth &&
				p.hour === hour &&
				p.minute === minute
			);
		});
	const [first] = matches;
	if (first === undefined) return { kind: "gap" };
	// the earlier one: summer time, the first time the clock shows it
	return {
		kind: "ok",
		iso: new Date(first).toISOString(),
		ambiguous: matches.length > 1,
	};
}

/** The UTC ISO string of a Polish day and time; null when there is none. */
export function polishInstant(day: PolishDay, time: PolishTime): string | null {
	const resolved = resolvePolishTime(day, time);
	return resolved.kind === "ok" ? resolved.iso : null;
}

/** Why a Polish day and time cannot be used, in Polish; null when it can. */
export function polishTimeProblem(
	day: PolishDay,
	time: PolishTime,
): string | null {
	const resolved = resolvePolishTime(day, time);
	if (resolved.kind === "gap") {
		return `Godzina ${time} nie istnieje tego dnia w Polsce: o 02:00 zegary przestawia się na 03:00 (czas letni). Wybierz inną godzinę.`;
	}
	if (resolved.kind === "invalid")
		return "Wpisz godzinę jako GG:MM, od 00:00 do 23:59.";
	return null;
}

/** A note for the October night when an hour happens twice; null otherwise. */
export function polishTimeNote(
	day: PolishDay,
	time: PolishTime,
): string | null {
	const resolved = resolvePolishTime(day, time);
	return resolved.kind === "ok" && resolved.ambiguous
		? `Godzina ${time} jest tego dnia dwa razy (zmiana czasu na zimowy). Zapisana zostanie pierwsza, w czasie letnim.`
		: null;
}
