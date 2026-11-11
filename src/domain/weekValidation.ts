import type { Condition } from "@/data/schemas/planning";
import { ALL_SCOPE } from "./conditions";

// The one place a week of a plan is checked against its rules. What a rule
// consists of (its fields and their limits) is in conditions.ts.

export interface WeekDayInput {
	workouts: ReadonlyArray<{ typeIds: readonly string[] }>;
}

/** 1 to 7 days; only the last week of a plan is shorter than 7. */
export type WeekInput = readonly WeekDayInput[];

export interface ConditionResult {
	label: string;
	pass: boolean;
}

export interface WeekResult {
	/** Workouts in the week. */
	total: number;
	state: "valid" | "invalid" | "neutral";
	results: ConditionResult[];
}

const DEFAULT_LABEL = "Domyślnie: 2–3 treningi w tygodniu";

/** A stored number as a whole number that is at least `minimum`. */
function whole(value: unknown, minimum: number, fallback = minimum): number {
	const parsed = Math.trunc(Number(value));
	return Math.max(
		minimum,
		Number.isFinite(parsed) && parsed ? parsed : fallback,
	);
}

const scopeOf = (condition: Condition): string => condition.scope || ALL_SCOPE;

const countInDay = (day: WeekDayInput | undefined, scope: string): number => {
	if (!day) return 0;
	if (scope === ALL_SCOPE) return day.workouts.length;
	return day.workouts.filter((workout) => workout.typeIds.includes(scope))
		.length;
};

const countInWeek = (week: WeekInput, scope: string): number =>
	week.reduce((sum, day) => sum + countInDay(day, scope), 0);

/** Indexes of the days that have at least one workout of the scope. */
function daysWithScope(week: WeekInput, scope: string): number[] {
	const indexes: number[] = [];
	week.forEach((day, index) => {
		if (countInDay(day, scope) > 0) indexes.push(index);
	});
	return indexes;
}

/**
 * After every day with a scope workout, the next `rest` days must have no
 * workout of ANY type. Days past the end of the plan do not count against it.
 */
function passesRestAfter(
	week: WeekInput,
	scope: string,
	rest: number,
	next: WeekInput,
): boolean {
	if (rest === 0) return true;
	const following = [...week, ...next];
	return daysWithScope(week, scope).every((index) => {
		for (let step = 1; step <= rest; step++) {
			if (countInDay(following[index + step], ALL_SCOPE) > 0) return false;
		}
		return true;
	});
}

/**
 * The distance in days between two days with a scope workout must be at least
 * `minDays`; adjacent days are 1 apart.
 *
 * Unlike the old planner, the distance is measured the same way inside a week
 * and across a week boundary (PLAN.md §9, decision 11): the old one counted
 * the free days in between when crossing a boundary, so "min. 1" passed for
 * Monday + Tuesday but failed for Sunday + Monday.
 */
function passesMinDistance(
	week: WeekInput,
	scope: string,
	minDays: number,
	prev: WeekInput,
	next: WeekInput,
): boolean {
	const days = daysWithScope(week, scope);
	const first = days[0];
	const last = days[days.length - 1];
	if (first === undefined || last === undefined) return true;

	for (let i = 0; i < days.length - 1; i++) {
		const here = days[i];
		const after = days[i + 1];
		if (here !== undefined && after !== undefined && after - here < minDays) {
			return false;
		}
	}
	const nextFirst = daysWithScope(next, scope)[0];
	if (nextFirst !== undefined && week.length + nextFirst - last < minDays) {
		return false;
	}
	const prevLast = daysWithScope(prev, scope).pop();
	if (prevLast !== undefined && prev.length + first - prevLast < minDays) {
		return false;
	}
	return true;
}

/**
 * At most `maxCount` scope workouts in any `windowDays` consecutive days.
 * Every window that touches this week is checked, including the ones that
 * start in the previous week or end in the next; a window that would run past
 * the known days is not.
 */
function passesMaxInWindow(
	week: WeekInput,
	scope: string,
	maxCount: number,
	windowDays: number,
	prev: WeekInput,
	next: WeekInput,
): boolean {
	const counts = [...prev, ...week, ...next].map((day) =>
		countInDay(day, scope),
	);
	const weekStart = prev.length;
	const weekEnd = weekStart + week.length - 1;
	const firstStart = Math.max(0, weekStart - windowDays + 1);
	const lastStart = Math.min(weekEnd, counts.length - windowDays);

	let inWindow = 0;
	for (let day = firstStart; day < firstStart + windowDays - 1; day++) {
		inWindow += counts[day] ?? 0;
	}
	for (let start = firstStart; start <= lastStart; start++) {
		inWindow += counts[start + windowDays - 1] ?? 0;
		if (inWindow > maxCount) return false;
		inWindow -= counts[start] ?? 0;
	}
	return true;
}

function checkCondition(
	week: WeekInput,
	condition: Condition,
	prev: WeekInput,
	next: WeekInput,
): boolean {
	const scope = scopeOf(condition);
	const countsDays = condition.countMode === "days";
	const counted = countsDays
		? daysWithScope(week, scope).length
		: countInWeek(week, scope);

	switch (condition.type) {
		case "limit":
			return counted <= whole(condition.value, 0);
		case "minimum":
			return countInWeek(week, scope) >= whole(condition.value, 0);
		case "zakres": {
			const from = whole(condition.valueMin, 0);
			const to = Math.max(from, whole(condition.valueMax, 0));
			return counted >= from && counted <= to;
		}
		case "odstep":
			return passesRestAfter(week, scope, whole(condition.value, 0), next);
		case "min_odstep":
			return passesMinDistance(
				week,
				scope,
				whole(condition.value, 1),
				prev,
				next,
			);
		case "max_w_ciagu":
			return passesMaxInWindow(
				week,
				scope,
				whole(condition.value, 1),
				whole(condition.valueDays, 1, 2),
				prev,
				next,
			);
		case "min_dni_odpoczynku": {
			const restDays = week.filter((day) => day.workouts.length === 0).length;
			return week.length > 0 && restDays >= whole(condition.value, 0);
		}
		case "max_w_dniu": {
			const most = whole(condition.value, 1);
			return week.every((day) => day.workouts.length <= most);
		}
		// The old "max training days" kind; saved today as a limit counted in days.
		case "max_dni_treningowych":
			return daysWithScope(week, scope).length <= whole(condition.value, 0);
		// A kind this panel does not know must not turn the week red.
		default:
			return true;
	}
}

/**
 * The rule in words, with the numbers the check really uses. `scopeLabel`
 * turns "all" or a training type id into its Polish name.
 */
export function formatConditionLabel(
	condition: Condition,
	scopeLabel: (scope: string) => string,
): string {
	const scoped = `(${scopeLabel(scopeOf(condition))})`;
	const unit = condition.countMode === "days" ? " dni treningowych" : "";

	switch (condition.type) {
		case "limit":
			return `Max ${whole(condition.value, 0)}${unit} ${scoped}`;
		case "minimum":
			return `Min. ${whole(condition.value, 0)} ${scoped}`;
		case "zakres": {
			const from = whole(condition.valueMin, 0);
			const to = Math.max(from, whole(condition.valueMax, 0));
			return `Od ${from} do ${to}${unit} ${scoped}`;
		}
		case "odstep":
			return `Odstęp ${whole(condition.value, 0)} dni po ${scoped}`;
		case "min_odstep":
			return `Min. ${whole(condition.value, 1)} dni między ${scoped}`;
		case "max_w_ciagu":
			return `Max ${whole(condition.value, 1)} w ciągu ${whole(condition.valueDays, 1, 2)} dni ${scoped}`;
		case "min_dni_odpoczynku":
			return `Min. ${whole(condition.value, 0)} dni odpoczynku`;
		case "max_w_dniu":
			return `Max ${whole(condition.value, 1)} w jednym dniu`;
		case "max_dni_treningowych":
			return `Max ${whole(condition.value, 0)} dni treningowych ${scoped}`;
		default:
			return condition.type;
	}
}

/**
 * Checks one week against its rules. The neighbouring weeks matter for the
 * rules about gaps and runs of days, so changing a week can flip the result of
 * the weeks on either side of it.
 *
 * Without any rules the built-in default applies: 2 or 3 workouts are right,
 * 4 or more are too many, fewer than 2 is not judged yet.
 */
export function validateWeek(
	week: WeekInput,
	conditions: readonly Condition[],
	neighbours: { prev?: WeekInput; next?: WeekInput },
	scopeLabel: (scope: string) => string,
): WeekResult {
	const total = countInWeek(week, ALL_SCOPE);

	if (conditions.length === 0) {
		const pass = total >= 2 && total < 4;
		return {
			total,
			state: pass ? "valid" : total >= 4 ? "invalid" : "neutral",
			results: [{ label: DEFAULT_LABEL, pass }],
		};
	}

	const prev = neighbours.prev ?? [];
	const next = neighbours.next ?? [];
	const results = conditions.map((condition) => ({
		label: formatConditionLabel(condition, scopeLabel),
		pass: checkCondition(week, condition, prev, next),
	}));
	return {
		total,
		state: results.every((result) => result.pass) ? "valid" : "invalid",
		results,
	};
}
