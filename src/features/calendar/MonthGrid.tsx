import {
	buildMonthGrid,
	type Day,
	formatDayMonth,
	holidayNamePL,
	parseDay,
	today,
	WEEKDAY_SHORT_PL,
} from "@/domain/calendarDates";
import {
	assignLanes,
	buildWeekSegments,
	type DatedItem,
	type WeekSegment,
} from "@/domain/challengeCalendar";
import { readableTextOn } from "@/domain/palette";
import { Popover } from "@/ui/Popover";

const MAX_LANES = 4;

interface MonthGridProps {
	year: number;
	month0: number;
	dated: readonly DatedItem[];
	onOpen: (id: string) => void;
}

const rangeLabel = (item: DatedItem) =>
	`${formatDayMonth(item.start)}–${formatDayMonth(item.end)}`;

/**
 * A month, Monday first, with every challenge as a bar across its days. A bar
 * opens its challenge; dates change on the challenge's own page.
 */
export function MonthGrid({ year, month0, dated, onOpen }: MonthGridProps) {
	const laneById = assignLanes(dated);
	const byId = new Map(dated.map((item) => [item.id, item]));
	const weeks = buildMonthGrid(year, month0);
	const now = today();

	return (
		<div className="overflow-hidden rounded-card border border-line bg-surface">
			<div className="grid grid-cols-7 border-line border-b bg-bg text-center text-xs font-semibold text-muted">
				{WEEKDAY_SHORT_PL.map((weekday) => (
					<div key={weekday} className="py-2">
						{weekday}
					</div>
				))}
			</div>
			{weeks.map((weekDays) => {
				const { segments, hiddenByDay } = buildWeekSegments(
					weekDays,
					dated,
					laneById,
					MAX_LANES,
				);
				return (
					<div
						key={weekDays[0]}
						className="relative grid min-h-36 grid-cols-7 border-line border-b last:border-b-0"
					>
						{weekDays.map((day, col) => (
							<DayCell
								key={day}
								day={day}
								outside={parseDay(day).getMonth() !== month0}
								weekend={col >= 5}
								isToday={day === now}
								hidden={(hiddenByDay[col] ?? []).flatMap((id) => {
									const item = byId.get(id);
									return item ? [item] : [];
								})}
								onOpen={onOpen}
							/>
						))}
						<div className="pointer-events-none absolute inset-x-0 top-8 grid grid-cols-7 gap-y-1 px-px">
							{segments.map((segment) => {
								const item = byId.get(segment.id);
								return item ? (
									<Bar
										key={segment.id}
										item={item}
										segment={segment}
										onOpen={onOpen}
									/>
								) : null;
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function DayCell({
	day,
	outside,
	weekend,
	isToday,
	hidden,
	onOpen,
}: {
	day: Day;
	outside: boolean;
	weekend: boolean;
	isToday: boolean;
	hidden: readonly DatedItem[];
	onOpen: (id: string) => void;
}) {
	const holiday = holidayNamePL(day);
	return (
		<div
			className={`flex min-w-0 flex-col justify-between border-line border-r p-1 last:border-r-0 ${
				weekend || outside ? "bg-bg" : ""
			}`}
		>
			<span
				title={holiday ?? undefined}
				className={`flex size-6 items-center justify-center self-end rounded-full text-xs ${
					isToday
						? "bg-danger font-semibold text-white"
						: holiday
							? "font-bold text-danger"
							: outside
								? "text-muted/60"
								: "text-subtle"
				}`}
			>
				{parseDay(day).getDate()}
			</span>
			{hidden.length > 0 && (
				<Popover
					label={`Pozostałe wyzwania, ${formatDayMonth(day)}`}
					title={formatDayMonth(day)}
					trigger={
						<span className="rounded-chip px-1 text-[11px] text-primary hover:underline">
							+{hidden.length} więcej
						</span>
					}
					triggerClassName="self-start"
				>
					<ul className="flex flex-col gap-1.5">
						{hidden.map((item) => (
							<li key={item.id}>
								<button
									type="button"
									onClick={() => onOpen(item.id)}
									className="flex w-full items-center gap-2 text-left hover:text-primary"
								>
									<span
										aria-hidden="true"
										className="size-2.5 shrink-0 rounded-full"
										style={{ backgroundColor: item.color }}
									/>
									<span className="min-w-0 flex-1 truncate">{item.title}</span>
									<span className="shrink-0 text-xs text-muted">
										{rangeLabel(item)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</Popover>
			)}
		</div>
	);
}

function Bar({
	item,
	segment,
	onOpen,
}: {
	item: DatedItem;
	segment: WeekSegment;
	onOpen: (id: string) => void;
}) {
	const weeksLong = Math.ceil(Math.max(1, item.lengthDays) / 7);
	return (
		<button
			type="button"
			onClick={() => onOpen(item.id)}
			title={`${item.title} · ${rangeLabel(item)} · ${weeksLong} tyg.`}
			style={{
				gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
				gridRow: segment.lane + 1,
				backgroundColor: item.color,
				color: readableTextOn(item.color),
			}}
			className={`pointer-events-auto mx-0.5 h-5 min-w-0 cursor-pointer truncate px-1.5 text-left text-[11px] font-medium leading-5 outline-none hover:brightness-95 focus-visible:shadow-focus ${
				segment.continuesLeft ? "rounded-l-none" : "rounded-l-chip"
			} ${segment.continuesRight ? "rounded-r-none" : "rounded-r-chip"}`}
		>
			{segment.continuesLeft ? "‹ " : ""}
			{item.title}
		</button>
	);
}
