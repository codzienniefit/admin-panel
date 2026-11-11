import { addDays, type Day, diffInDays, parseDay } from "./calendarDates";

// Layout of challenges on the calendar: which are on it, which row ("lane")
// each one takes, and what a month page or a year page shows for them. Pure
// arithmetic on days; the screens only draw the result.

export interface CalendarItem {
	id: string;
	title: string;
	/** `#rrggbb`. */
	color: string;
	/** The first day, or null when the challenge has no date yet. */
	start: Day | null;
	lengthDays: number;
}

/** An item that is on the calendar; `end` is its last day, included. */
export interface DatedItem extends CalendarItem {
	start: Day;
	end: Day;
}

export interface WeekSegment {
	id: string;
	/** Row inside this week, from 0. */
	lane: number;
	startCol: number;
	endCol: number;
	/** The item began before this week / goes on after it. */
	continuesLeft: boolean;
	continuesRight: boolean;
}

/** How many colour stripes a day of the year page has room for. */
const MAX_COLORS_PER_DAY = 3;

const polish = new Intl.Collator("pl", { numeric: true });

/** Earlier start first, then the longer one, then by id. */
const byStart = (a: DatedItem, b: DatedItem): number => {
	if (a.start !== b.start) return a.start < b.start ? -1 : 1;
	if (a.end !== b.end) return a.end > b.end ? -1 : 1;
	return a.id.localeCompare(b.id, "pl", { numeric: true });
};

/** At least one day, whatever is stored. */
const daysOf = (lengthDays: number): number =>
	Number.isFinite(lengthDays) ? Math.max(1, Math.trunc(lengthDays)) : 1;

/** The last day of something that starts on `start` and lasts `lengthDays`. */
export const lastDay = (start: Day, lengthDays: number): Day =>
	addDays(start, daysOf(lengthDays) - 1);

const isRealDay = (day: Day): boolean => !Number.isNaN(parseDay(day).getTime());

/**
 * Items with a date, in calendar order, and the rest ("Bez daty") by title.
 * A start that is not a real day counts as no date.
 */
export function splitItems(items: readonly CalendarItem[]): {
	dated: DatedItem[];
	undated: CalendarItem[];
} {
	const dated: DatedItem[] = [];
	const undated: CalendarItem[] = [];
	for (const item of items) {
		if (item.start !== null && isRealDay(item.start)) {
			dated.push({
				...item,
				start: item.start,
				end: lastDay(item.start, item.lengthDays),
			});
		} else {
			undated.push(item);
		}
	}
	dated.sort(byStart);
	undated.sort(
		(a, b) => polish.compare(a.title, b.title) || polish.compare(a.id, b.id),
	);
	return { dated, undated };
}

/**
 * A lane for every item so that no two in the same lane overlap. Assigned
 * over the whole timeline, not per week, so an item keeps its row from week
 * to week and month to month. Each item takes the first lane that is already
 * free on its first day; ranges that only touch (one ends the day before the
 * other starts) share a lane.
 */
export function assignLanes(dated: readonly DatedItem[]): Map<string, number> {
	const laneById = new Map<string, number>();
	const laneEnds: Day[] = [];
	// The greedy pass is only right in start order.
	for (const item of [...dated].sort(byStart)) {
		let lane = laneEnds.findIndex((end) => end < item.start);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = item.end;
		laneById.set(item.id, lane);
	}
	return laneById;
}

/**
 * The bars of one row of a month page. Lanes are renumbered from 0 within
 * the week, so a week with one item in global lane 5 does not draw five empty
 * rows; the order between items stays. What does not fit in `maxLanes` rows
 * is listed per column instead ("+N więcej").
 */
export function buildWeekSegments(
	weekDays: readonly Day[],
	dated: readonly DatedItem[],
	laneById: ReadonlyMap<string, number>,
	maxLanes: number,
): { segments: WeekSegment[]; hiddenByDay: string[][] } {
	const hiddenByDay: string[][] = weekDays.map(() => []);
	const weekStart = weekDays[0];
	const weekEnd = weekDays[weekDays.length - 1];
	if (weekStart === undefined || weekEnd === undefined) {
		return { segments: [], hiddenByDay };
	}

	const inWeek = dated.filter(
		(item) => item.start <= weekEnd && item.end >= weekStart,
	);
	// An item the lane map does not know still has to be drawn somewhere:
	// each gets a lane of its own below the known ones.
	const knownLanes = inWeek.flatMap((item) => laneById.get(item.id) ?? []);
	let spareLane = Math.max(-1, ...knownLanes) + 1;
	const globalLanes = new Map<string, number>();
	for (const item of inWeek) {
		globalLanes.set(item.id, laneById.get(item.id) ?? spareLane++);
	}
	const usedLanes = [...new Set(globalLanes.values())].sort((a, b) => a - b);
	const compactLane = new Map(usedLanes.map((lane, index) => [lane, index]));

	const segments: WeekSegment[] = [];
	for (const item of inWeek) {
		const lane = compactLane.get(globalLanes.get(item.id) ?? -1) ?? 0;
		const startCol = Math.max(0, diffInDays(weekStart, item.start));
		const endCol = Math.min(
			weekDays.length - 1,
			diffInDays(weekStart, item.end),
		);
		if (lane >= maxLanes) {
			for (let col = startCol; col <= endCol; col++) {
				hiddenByDay[col]?.push(item.id);
			}
			continue;
		}
		segments.push({
			id: item.id,
			lane,
			startCol,
			endCol,
			continuesLeft: item.start < weekStart,
			continuesRight: item.end > weekEnd,
		});
	}
	segments.sort((a, b) => a.lane - b.lane || a.startCol - b.startCol);
	return { segments, hiddenByDay };
}

/**
 * The colours to stripe each day of a year with: those of the first three
 * items on that day, in calendar order. Days without items are not in the map.
 */
export function buildYearColorIndex(
	dated: readonly DatedItem[],
	year: number,
): Map<Day, string[]> {
	const yearStart = `${String(year).padStart(4, "0")}-01-01`;
	const yearEnd = `${String(year).padStart(4, "0")}-12-31`;
	const colorsByDay = new Map<Day, string[]>();
	for (const item of dated) {
		if (item.start > yearEnd || item.end < yearStart) continue;
		const from = item.start < yearStart ? yearStart : item.start;
		const to = item.end > yearEnd ? yearEnd : item.end;
		for (let day = from; day <= to; day = addDays(day, 1)) {
			const colors = colorsByDay.get(day);
			if (!colors) colorsByDay.set(day, [item.color]);
			else if (colors.length < MAX_COLORS_PER_DAY) colors.push(item.color);
		}
	}
	return colorsByDay;
}

/**
 * The list with one item moved by `deltaDays`, for the preview while it is
 * dragged. Start and end move together, so the item never changes length.
 */
export function shiftItem(
	dated: readonly DatedItem[],
	id: string,
	deltaDays: number,
): DatedItem[] {
	return dated
		.map((item) =>
			item.id === id
				? {
						...item,
						start: addDays(item.start, deltaDays),
						end: addDays(item.end, deltaDays),
					}
				: item,
		)
		.sort(byStart);
}

/** The items that cover the day, in the order they were given. */
export function itemsOnDay(dated: readonly DatedItem[], day: Day): DatedItem[] {
	return dated.filter((item) => item.start <= day && item.end >= day);
}
