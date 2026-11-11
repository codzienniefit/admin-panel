import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	useDraggable,
	useDroppable,
} from "@dnd-kit/core";
import { useState } from "react";
import {
	addDays,
	buildMonthGrid,
	type Day,
	diffInDays,
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
import { useDragSensors } from "@/lib/useDragSensors";
import { Popover } from "@/ui/Popover";

const MAX_LANES = 4;

interface MonthGridProps {
	year: number;
	month0: number;
	dated: readonly DatedItem[];
	onOpen: (id: string) => void;
	/** Dropped `deltaDays` away from where it was picked up. */
	onMove: (id: string, deltaDays: number) => void;
}

interface Grab {
	id: string;
	/** The day under the pointer when the drag started. */
	day: Day;
}

const rangeLabel = (item: DatedItem) =>
	`${formatDayMonth(item.start)}–${formatDayMonth(item.end)}`;

/** A month, Monday first, with every challenge as a bar across its days. */
export function MonthGrid({
	year,
	month0,
	dated,
	onOpen,
	onMove,
}: MonthGridProps) {
	const sensors = useDragSensors();
	const [grab, setGrab] = useState<Grab | null>(null);
	const laneById = assignLanes(dated);
	const byId = new Map(dated.map((item) => [item.id, item]));
	const weeks = buildMonthGrid(year, month0);
	const now = today();

	const onDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as
			| { id: string; firstDay: Day; span: number }
			| undefined;
		if (!data) return;
		// Which of the bar's days was grabbed, so the bar moves with the pointer
		// instead of jumping its first day under it.
		const rect = event.active.rect.current.initial;
		const pointer = event.activatorEvent;
		const x =
			"touches" in pointer
				? ((pointer as TouchEvent).touches[0]?.clientX ?? null)
				: "clientX" in pointer
					? (pointer as MouseEvent).clientX
					: null;
		const offset =
			rect && x !== null && rect.width > 0
				? Math.min(
						data.span - 1,
						Math.max(0, Math.floor((x - rect.left) / (rect.width / data.span))),
					)
				: 0;
		setGrab({ id: data.id, day: addDays(data.firstDay, offset) });
	};

	const onDragEnd = (event: DragEndEvent) => {
		const target = (event.over?.data.current as { day?: Day } | undefined)?.day;
		const from = grab;
		setGrab(null);
		if (!from || !target) return;
		const delta = diffInDays(from.day, target);
		if (delta !== 0) onMove(from.id, delta);
	};

	const dragged = grab ? byId.get(grab.id) : undefined;

	return (
		<DndContext
			sensors={sensors}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => setGrab(null)}
		>
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
											firstDay={weekDays[segment.startCol] ?? item.start}
											weekKey={weekDays[0] ?? ""}
											onOpen={onOpen}
										/>
									) : null;
								})}
							</div>
						</div>
					);
				})}
			</div>
			<DragOverlay dropAnimation={null}>
				{dragged && (
					<div
						style={{
							backgroundColor: dragged.color,
							color: readableTextOn(dragged.color),
						}}
						className="w-44 truncate rounded-chip px-2 py-0.5 text-xs font-medium shadow-menu"
					>
						{dragged.title}
					</div>
				)}
			</DragOverlay>
		</DndContext>
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
	const { setNodeRef, isOver } = useDroppable({
		id: `calendar-${day}`,
		data: { day },
	});
	const holiday = holidayNamePL(day);
	return (
		<div
			ref={setNodeRef}
			className={`flex min-w-0 flex-col justify-between border-line border-r p-1 last:border-r-0 ${
				weekend || outside ? "bg-bg" : ""
			} ${isOver ? "bg-primary-soft" : ""}`}
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
	firstDay,
	weekKey,
	onOpen,
}: {
	item: DatedItem;
	segment: WeekSegment;
	firstDay: Day;
	weekKey: string;
	onOpen: (id: string) => void;
}) {
	const span = segment.endCol - segment.startCol + 1;
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `${item.id}@${weekKey}`,
		data: { id: item.id, firstDay, span },
	});
	const weeksLong = Math.ceil(Math.max(1, item.lengthDays) / 7);
	return (
		<button
			ref={setNodeRef}
			type="button"
			{...attributes}
			{...listeners}
			onClick={() => onOpen(item.id)}
			title={`${item.title} · ${rangeLabel(item)} · ${weeksLong} tyg.`}
			style={{
				gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
				gridRow: segment.lane + 1,
				backgroundColor: item.color,
				color: readableTextOn(item.color),
			}}
			className={`pointer-events-auto mx-0.5 h-5 min-w-0 cursor-grab touch-manipulation truncate px-1.5 text-left text-[11px] font-medium leading-5 outline-none focus-visible:shadow-focus active:cursor-grabbing ${
				segment.continuesLeft ? "rounded-l-none" : "rounded-l-chip"
			} ${segment.continuesRight ? "rounded-r-none" : "rounded-r-chip"} ${
				isDragging ? "opacity-40" : ""
			}`}
		>
			{segment.continuesLeft ? "‹ " : ""}
			{item.title}
		</button>
	);
}
