// Calendar days for the planner. A day is a "YYYY-MM-DD" string in the
// browser's LOCAL time (the team works in Europe/Warsaw), so it never shifts
// when it crosses a time zone the way an instant does. Instants (ISO UTC
// strings, as the backend stores them) are handled in dates.ts; the two meet
// only in `dayOfInstant` and `instantOnDay` below.

export type Day = string; // "YYYY-MM-DD"

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local midnight of a day; an Invalid Date for anything that is not a real
 * calendar day. Never `new Date("YYYY-MM-DD")`: that is UTC midnight, which is
 * the day before in time zones west of Greenwich.
 */
export function parseDay(day: Day): Date {
	const match = DAY_PATTERN.exec(day);
	if (!match) return new Date(Number.NaN);
	const year = Number(match[1]);
	const month0 = Number(match[2]) - 1;
	const dayOfMonth = Number(match[3]);
	const date = new Date(year, month0, dayOfMonth);
	// The constructor rolls 02-31 over into March instead of refusing it.
	const real =
		date.getFullYear() === year &&
		date.getMonth() === month0 &&
		date.getDate() === dayOfMonth;
	return real ? date : new Date(Number.NaN);
}

/** The local calendar day of a date. */
export function formatDay(date: Date): Day {
	return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(now: Date = new Date()): Day {
	return formatDay(now);
}

/**
 * Moves by calendar days, not by 24-hour steps, so the two days a year that
 * are 23 or 25 hours long do not skip or repeat a date.
 */
export function addDays(day: Day, count: number): Day {
	const date = parseDay(day);
	date.setDate(date.getDate() + count);
	return formatDay(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffInDays(from: Day, to: Day): number {
	// Rounded because a span that crosses a clock change is an hour off.
	return Math.round(
		(parseDay(to).getTime() - parseDay(from).getTime()) / MS_PER_DAY,
	);
}

/** The Monday of the week the day is in (weeks start on Monday). */
export function mondayOf(day: Day): Day {
	const daysSinceMonday = (parseDay(day).getDay() + 6) % 7;
	return addDays(day, -daysSinceMonday);
}

/**
 * The weeks a month page shows: rows of 7 days from Monday to Sunday, padded
 * with the days of the neighbouring months. As many rows as the month needs
 * (4 to 6).
 */
export function buildMonthGrid(year: number, month0: number): Day[][] {
	const first = formatDay(new Date(year, month0, 1));
	const lastOfMonth = formatDay(new Date(year, month0 + 1, 0));
	const weeks: Day[][] = [];
	for (
		let monday = mondayOf(first);
		monday <= lastOfMonth;
		monday = addDays(monday, 7)
	) {
		weeks.push(Array.from({ length: 7 }, (_, col) => addDays(monday, col)));
	}
	return weeks;
}

const FIXED_HOLIDAYS: Readonly<Record<string, string>> = {
	"01-01": "Nowy Rok",
	"01-06": "Święto Trzech Króli",
	"05-01": "Święto Pracy",
	"05-03": "Święto Konstytucji 3 Maja",
	"08-15": "Wniebowzięcie Najświętszej Maryi Panny",
	"11-01": "Wszystkich Świętych",
	"11-11": "Narodowe Święto Niepodległości",
	"12-25": "Boże Narodzenie",
	"12-26": "Drugi dzień Bożego Narodzenia",
};

// Christmas Eve became a public holiday in Poland in 2025.
const CHRISTMAS_EVE = "12-24";
const CHRISTMAS_EVE_SINCE = 2025;
const CHRISTMAS_EVE_NAME = "Wigilia Bożego Narodzenia";

/** Easter Sunday in the Gregorian calendar (Meeus/Jones/Butcher). */
function easterSunday(year: number): Day {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
	return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(dayOfMonth)}`;
}

// A month page asks about the same year some forty times in a row.
const movableByYear = new Map<number, ReadonlyMap<Day, string>>();

function movableHolidays(year: number): ReadonlyMap<Day, string> {
	const known = movableByYear.get(year);
	if (known) return known;
	const easter = easterSunday(year);
	const holidays = new Map<Day, string>([
		[easter, "Wielkanoc"],
		[addDays(easter, 1), "Poniedziałek Wielkanocny"],
		[addDays(easter, 49), "Zielone Świątki"],
		[addDays(easter, 60), "Boże Ciało"],
	]);
	movableByYear.set(year, holidays);
	return holidays;
}

/** The Polish name of the public holiday on that day, or null. */
export function holidayNamePL(day: Day): string | null {
	const match = DAY_PATTERN.exec(day);
	if (!match) return null;
	const year = Number(match[1]);
	const monthDay = `${match[2]}-${match[3]}`;
	if (monthDay === CHRISTMAS_EVE) {
		return year >= CHRISTMAS_EVE_SINCE ? CHRISTMAS_EVE_NAME : null;
	}
	return FIXED_HOLIDAYS[monthDay] ?? movableHolidays(year).get(day) ?? null;
}

/** Whether the day is a public holiday in Poland (Sundays are not counted). */
export function isHolidayPL(day: Day): boolean {
	return holidayNamePL(day) !== null;
}

export const WEEKDAY_SHORT_PL: readonly string[] = [
	"Pon",
	"Wt",
	"Śr",
	"Czw",
	"Pt",
	"Sob",
	"Nie",
];

// Written out rather than taken from Intl: a calendar heading needs the
// nominative ("Wrzesień"), and which case Intl gives depends on the ICU data.
const MONTHS_PL = [
	"Styczeń",
	"Luty",
	"Marzec",
	"Kwiecień",
	"Maj",
	"Czerwiec",
	"Lipiec",
	"Sierpień",
	"Wrzesień",
	"Październik",
	"Listopad",
	"Grudzień",
] as const;

/** "Wrzesień 2026". A month outside 0–11 rolls into the next or previous year. */
export function monthLabel(year: number, month0: number): string {
	const date = new Date(year, month0, 1);
	return `${MONTHS_PL[date.getMonth()] ?? ""} ${date.getFullYear()}`;
}

/** "DD.MM"; empty for a malformed day. */
export function formatDayMonth(day: Day): string {
	const match = DAY_PATTERN.exec(day);
	return match ? `${match[3]}.${match[2]}` : "";
}

/** "DD.MM.RRRR"; empty for a malformed day. */
export function formatDayFull(day: Day): string {
	const match = DAY_PATTERN.exec(day);
	return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/** The local calendar day of an ISO instant, or null for empty/invalid input. */
export function dayOfInstant(iso: string | null | undefined): Day | null {
	if (!iso) return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : formatDay(date);
}

const DEFAULT_HOUR = 13;

/**
 * An ISO instant on `day` at the same local time of day as `previousIso`;
 * 13:00 local when there is none. Used when a challenge is dragged to another
 * day: its premiere hour must not move. Throws a RangeError for a malformed
 * day, like `toISOString` on any invalid date.
 */
export function instantOnDay(
	day: Day,
	previousIso: string | null | undefined,
): string {
	const date = parseDay(day);
	const previous = previousIso ? new Date(previousIso) : null;
	if (previous && !Number.isNaN(previous.getTime())) {
		date.setHours(
			previous.getHours(),
			previous.getMinutes(),
			previous.getSeconds(),
			previous.getMilliseconds(),
		);
	} else {
		date.setHours(DEFAULT_HOUR, 0, 0, 0);
	}
	return date.toISOString();
}

// --- dates as people type them ------------------------------------------
//
// The date fields show and accept "DD.MM.RRRR" and "GG:MM", the way dates are
// written in Polish, whatever the browser's own language is.

/** A time of day, "HH:MM", 24-hour, local. */
export type Time = string;

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * A time someone typed: "9:05", "09.05", "0905", "9" (the full hour).
 * Null when it is not a time of day.
 */
export function parseTimeText(text: string): Time | null {
	const match =
		/^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(text.trim()) ??
		/^(\d{1,2})[:.](\d)$/.exec(text.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2] ?? 0);
	if (hours > 23 || minutes > 59) return null;
	return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * A day someone typed: "20.11.2026", "20/11/2026", "20-11-26", "1.3.2027",
 * or "2026-11-20". Null when it is not a real calendar day.
 */
export function parseDayText(text: string): Day | null {
	const trimmed = text.trim();
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
	const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(trimmed);
	const parts = iso
		? { year: iso[1], month: iso[2], dayOfMonth: iso[3] }
		: local
			? { year: local[3], month: local[2], dayOfMonth: local[1] }
			: null;
	if (!parts?.year || !parts.month || !parts.dayOfMonth) return null;
	const year =
		parts.year.length === 2 ? 2000 + Number(parts.year) : Number(parts.year);
	const day = `${String(year).padStart(4, "0")}-${pad(Number(parts.month))}-${pad(Number(parts.dayOfMonth))}`;
	return Number.isNaN(parseDay(day).getTime()) ? null : day;
}

/**
 * A day with an optional time, as typed into a date-and-time field:
 * "20.11.2026 10:06", "20.11.2026, 10:06", "20.11.2026". Null when the day
 * is not a day, or when something follows it that is not a time.
 */
export function parseDateTimeText(
	text: string,
): { day: Day; time: Time | null } | null {
	const [first = "", ...rest] = text.trim().split(/[\s,]+/);
	const day = parseDayText(first);
	if (!day) return null;
	if (rest.length === 0) return { day, time: null };
	const time = parseTimeText(rest.join(""));
	return time ? { day, time } : null;
}

/** The local time of day of an ISO instant, or null for empty/invalid input. */
export function timeOfInstant(iso: string | null | undefined): Time | null {
	if (!iso) return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? null
		: `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The ISO instant of a local day and time; null when either is malformed. */
export function instantAt(day: Day, time: Time): string | null {
	const date = parseDay(day);
	const match = TIME_PATTERN.exec(time);
	if (Number.isNaN(date.getTime()) || !match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	date.setHours(hours, minutes, 0, 0);
	return date.toISOString();
}

/** "DD.MM.RRRR GG:MM" in local time; empty for empty/invalid input. */
export function formatDateTimeText(iso: string | null | undefined): string {
	const day = dayOfInstant(iso);
	const time = timeOfInstant(iso);
	return day && time ? `${formatDayFull(day)} ${time}` : "";
}

/** A time moved by some minutes, wrapping around midnight. */
export function shiftTime(time: Time, minutes: number): Time {
	const match = TIME_PATTERN.exec(time);
	if (!match) return time;
	const total =
		(((Number(match[1]) * 60 + Number(match[2]) + minutes) % 1440) + 1440) %
		1440;
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
