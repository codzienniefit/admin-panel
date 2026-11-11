import {
	buildMonthGrid,
	type Day,
	monthLabel,
	parseDay,
	today,
} from "@/domain/calendarDates";
import {
	buildYearColorIndex,
	type DatedItem,
	itemsOnDay,
} from "@/domain/challengeCalendar";

interface YearGridProps {
	year: number;
	dated: readonly DatedItem[];
	onOpenMonth: (month0: number) => void;
}

/** Up to three colours as vertical stripes. */
function stripes(colors: readonly string[]): string | undefined {
	if (colors.length === 0) return undefined;
	if (colors.length === 1) return colors[0];
	const step = 100 / colors.length;
	return `linear-gradient(90deg, ${colors
		.map((color, i) => `${color} ${i * step}% ${(i + 1) * step}%`)
		.join(", ")})`;
}

/** Twelve small months; a day takes the colours of the challenges running on it. */
export function YearGrid({ year, dated, onOpenMonth }: YearGridProps) {
	const colorsByDay = buildYearColorIndex(dated, year);
	const now = today();
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{Array.from({ length: 12 }, (_, month0) => (
				<section
					// biome-ignore lint/suspicious/noArrayIndexKey: the twelve months
					key={month0}
					className="rounded-card border border-line bg-surface p-3"
				>
					<button
						type="button"
						onClick={() => onOpenMonth(month0)}
						className="mb-2 text-sm font-semibold hover:text-primary"
					>
						{monthLabel(year, month0).replace(` ${year}`, "")}
					</button>
					<div className="grid grid-cols-7 gap-0.5">
						{buildMonthGrid(year, month0)
							.flat()
							.map((day: Day) => {
								const inMonth = parseDay(day).getMonth() === month0;
								const colors = inMonth ? (colorsByDay.get(day) ?? []) : [];
								const names = colors.length
									? itemsOnDay(dated, day)
											.map((item) => item.title)
											.join(", ")
									: undefined;
								return (
									<button
										key={day}
										type="button"
										tabIndex={inMonth ? 0 : -1}
										aria-hidden={!inMonth}
										title={names}
										onClick={() => onOpenMonth(month0)}
										style={{ background: stripes(colors) }}
										className={`flex aspect-square items-center justify-center rounded-[4px] text-[10px] ${
											inMonth ? "" : "invisible"
										} ${colors.length ? "font-semibold text-white" : "text-subtle hover:bg-hover"} ${
											day === now ? "ring-2 ring-danger" : ""
										}`}
									>
										{parseDay(day).getDate()}
									</button>
								);
							})}
					</div>
				</section>
			))}
		</div>
	);
}
