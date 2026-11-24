import { polishInstant } from "./polishTime";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The UTC ISO string of a Polish date and time, for tests: what
 * `new Date(y, m0, d, h, mi, s, ms).toISOString()` was on a computer in
 * Poland, whatever time zone the tests run in. The month counts from 0 like
 * Date's.
 */
export function polishMoment(
	year: number,
	month0: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0,
	ms = 0,
): string {
	const iso = polishInstant(
		`${year}-${pad(month0 + 1)}-${pad(day)}`,
		`${pad(hour)}:${pad(minute)}`,
	);
	if (iso === null) throw new Error("test: no such Polish time");
	return new Date(new Date(iso).getTime() + second * 1000 + ms).toISOString();
}
