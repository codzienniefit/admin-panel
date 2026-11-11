import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CardPlanning, DayPlanning } from "@/data/schemas/planning";
import type { Workout } from "@/data/schemas/workout";
import {
	type Day,
	formatDayMonth,
	holidayNamePL,
} from "@/domain/calendarDates";
import { isHexColor, withAlpha } from "@/domain/palette";
import { MAX_WORKOUTS_PER_DAY } from "@/domain/schedule";
import { Menu, type MenuAction } from "@/ui/Menu";
import { dayDropId } from "./dragTypes";
import { PlannerCard } from "./PlannerCard";

/** Everything a day and its cards can ask the planner to do. */
export interface DayHandlers {
	add(dayIndex: number): void;
	paste(dayIndex: number): void;
	details(dayIndex: number): void;
	clear(dayIndex: number): void;
	cardDetails(dayIndex: number, workoutId: string): void;
	cardMove(dayIndex: number, index: number): void;
	cardCopy(workoutId: string): void;
	cardToScratchpad(dayIndex: number, index: number): void;
	cardShift(dayIndex: number, index: number, by: -1 | 1): void;
	cardRemove(dayIndex: number, index: number): void;
	cardOpen(workoutId: string): void;
}

interface PlannerDayProps {
	dayIndex: number;
	/** The calendar date, when the challenge has a premiere date. */
	date: Day | null;
	workoutIds: readonly string[];
	workoutById: ReadonlyMap<string, Workout>;
	planning: DayPlanning | undefined;
	cardOf: (workoutId: string) => CardPlanning | undefined;
	/** Title of the copied workout, when there is one to paste. */
	clipboardTitle: string | null;
	readOnly: boolean;
	handlers: DayHandlers;
}

export function PlannerDay({
	dayIndex,
	date,
	workoutIds,
	workoutById,
	planning,
	cardOf,
	clipboardTitle,
	readOnly,
	handlers,
}: PlannerDayProps) {
	const { setNodeRef, isOver } = useDroppable({
		id: dayDropId(dayIndex),
		data: { kind: "day", dayIndex },
		disabled: readOnly,
	});
	const minutes = workoutIds.reduce(
		(sum, id) => sum + (workoutById.get(id)?.durationMinutes ?? 0),
		0,
	);
	const full = workoutIds.length >= MAX_WORKOUTS_PER_DAY;
	const holiday = date ? holidayNamePL(date) : null;
	// Only a real colour reaches the style attribute, whatever the data says.
	const tint = isHexColor(planning?.tint) ? planning.tint : undefined;

	const dayActions: MenuAction[] = [
		{
			label: "Dodaj trening…",
			disabled: full,
			onSelect: () => handlers.add(dayIndex),
		},
	];
	if (clipboardTitle) {
		dayActions.push({
			label: `Wklej: ${clipboardTitle}`,
			disabled: full,
			onSelect: () => handlers.paste(dayIndex),
		});
	}
	dayActions.push({
		label: "Notatka i kolor dnia…",
		onSelect: () => handlers.details(dayIndex),
	});
	if (workoutIds.length > 0) {
		dayActions.push({
			label: "Wyczyść dzień",
			destructive: true,
			onSelect: () => handlers.clear(dayIndex),
		});
	}

	return (
		// A named group: screen readers announce which day a card is in, and the
		// UI tests find a day the same way.
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would add a legend and its own layout
		<div
			ref={setNodeRef}
			role="group"
			aria-label={`Dzień ${dayIndex}`}
			style={
				tint
					? {
							backgroundColor: withAlpha(tint, 0.16),
							borderColor: withAlpha(tint, 0.55),
						}
					: undefined
			}
			className={`flex min-h-36 min-w-0 flex-col gap-2 rounded-cell border p-2.5 transition-colors ${
				tint
					? ""
					: workoutIds.length
						? "border-line bg-surface"
						: "border-line bg-bg"
			} ${isOver ? "outline-2 outline-primary outline-dashed" : ""}`}
		>
			<div className="flex items-start justify-between gap-1 px-0.5">
				<div className="min-w-0">
					<p className="text-sm font-semibold">
						Dzień {dayIndex}
						{date && (
							<span
								title={holiday ?? undefined}
								className={`ml-1.5 text-xs font-normal ${holiday ? "font-semibold text-danger" : "text-muted"}`}
							>
								{formatDayMonth(date)}
							</span>
						)}
					</p>
					<p className="text-xs text-muted">
						{minutes > 0 ? `${minutes} min` : "wolne"}
					</p>
				</div>
				{!readOnly && (
					<Menu
						label={`Akcje dnia ${dayIndex}`}
						trigger="⋯"
						triggerClassName="-mt-1 rounded-control px-1.5 text-base text-muted hover:bg-hover hover:text-ink"
						actions={dayActions}
					/>
				)}
			</div>

			{planning?.note && (
				<DayNote
					dayIndex={dayIndex}
					note={planning.note}
					readOnly={readOnly}
					onOpen={() => handlers.details(dayIndex)}
				/>
			)}

			{workoutIds.map((id, index) => {
				const actions: MenuAction[] = [
					{
						label: "Notatka i kolor…",
						onSelect: () => handlers.cardDetails(dayIndex, id),
					},
					{
						label: "Przenieś do…",
						onSelect: () => handlers.cardMove(dayIndex, index),
					},
					{ label: "Kopiuj", onSelect: () => handlers.cardCopy(id) },
					{
						label: "Do brudnopisu",
						onSelect: () => handlers.cardToScratchpad(dayIndex, index),
					},
				];
				if (index > 0) {
					actions.push({
						label: "Wyżej",
						onSelect: () => handlers.cardShift(dayIndex, index, -1),
					});
				}
				if (index < workoutIds.length - 1) {
					actions.push({
						label: "Niżej",
						onSelect: () => handlers.cardShift(dayIndex, index, 1),
					});
				}
				actions.push(
					{ label: "Otwórz trening", onSelect: () => handlers.cardOpen(id) },
					{
						label: "Usuń z dnia",
						destructive: true,
						onSelect: () => handlers.cardRemove(dayIndex, index),
					},
				);
				return (
					<PlannerCard
						key={id}
						dragId={`placed-${dayIndex}-${id}`}
						source={{ kind: "placed", dayIndex, index, workoutId: id }}
						workoutId={id}
						workout={workoutById.get(id)}
						card={cardOf(id)}
						actions={actions}
						readOnly={readOnly}
					/>
				);
			})}

			{!readOnly && !full && (
				<button
					type="button"
					onClick={() => handlers.add(dayIndex)}
					className="mt-auto rounded-chip border border-line-input border-dashed px-2 py-1.5 text-xs text-muted hover:border-primary hover:text-primary"
				>
					+ Dodaj trening
				</button>
			)}
		</div>
	);
}

/** A day's note. It can be dragged onto another day. */
function DayNote({
	dayIndex,
	note,
	readOnly,
	onOpen,
}: {
	dayIndex: number;
	note: string;
	readOnly: boolean;
	onOpen: () => void;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `note-${dayIndex}`,
		data: { kind: "note", dayIndex },
		disabled: readOnly,
	});
	return (
		<button
			ref={setNodeRef}
			type="button"
			{...attributes}
			{...listeners}
			onClick={onOpen}
			title={note}
			data-tone="amber"
			className={`touch-manipulation rounded-chip bg-(--tone-soft) px-2 py-1 text-left text-[11px] text-(--tone-ink) ${isDragging ? "opacity-40" : ""}`}
		>
			<span className="line-clamp-2">📝 {note}</span>
		</button>
	);
}
