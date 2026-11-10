import type { Workout } from "@/data/schemas/workout";
import type { DaySlot, ScheduleOp } from "@/domain/schedule";
import { trainingTypeMeta } from "@/ui/enums";
import { Select } from "@/ui/Select";
import { WorkoutChip } from "@/ui/WorkoutChip";

export interface DayCellProps {
	pathId: string;
	dayIndex: number;
	workoutIds: readonly string[];
	workoutById: ReadonlyMap<string, Workout>;
	allWorkouts: readonly Workout[];
	selected: DaySlot | null;
	onSelect: (slot: DaySlot | null) => void;
	onEdit: (op: ScheduleOp) => void;
}

export function DayCell({
	pathId,
	dayIndex,
	workoutIds,
	workoutById,
	allWorkouts,
	selected,
	onSelect,
	onEdit,
}: DayCellProps) {
	const minutes = workoutIds.reduce(
		(sum, id) => sum + (workoutById.get(id)?.durationMinutes ?? 0),
		0,
	);
	const isTarget = selected !== null && selected.dayIndex !== dayIndex;
	const options = allWorkouts
		.filter((workout) => !workoutIds.includes(workout.id))
		.map((workout) => ({
			value: workout.id,
			label: workout.title,
			hint: `${workout.durationMinutes} min`,
			tone: trainingTypeMeta(workout.trainingTypeIds[0] ?? "").tone,
		}));

	return (
		<div
			className={`flex min-h-40 min-w-0 flex-col gap-2 rounded-cell border p-2.5 ${
				workoutIds.length ? "bg-surface" : "bg-bg"
			} ${isTarget ? "border-primary border-dashed" : "border-line"}`}
		>
			<div className="flex items-baseline justify-between gap-2 px-0.5">
				<span className="text-sm font-semibold">Dzień {dayIndex}</span>
				<span className="text-xs text-muted">
					{minutes > 0 ? `${minutes} min` : "wolne"}
				</span>
			</div>

			{workoutIds.map((id, index) => {
				const workout = workoutById.get(id);
				const isSelected =
					selected?.dayIndex === dayIndex && selected.index === index;
				return (
					<WorkoutChip
						key={id}
						title={workout?.title ?? id}
						durationMinutes={workout?.durationMinutes}
						trainingTypeIds={workout?.trainingTypeIds}
						selected={isSelected}
						onSelect={() => onSelect(isSelected ? null : { dayIndex, index })}
						onRemove={() =>
							onEdit({
								type: "remove",
								pathId,
								dayIndex,
								index,
								workoutId: id,
							})
						}
						removeContext={`z dnia ${dayIndex}`}
					/>
				);
			})}

			{isTarget && selected && (
				<button
					type="button"
					onClick={() =>
						onEdit({
							type: "move",
							pathId,
							from: selected,
							to: { dayIndex, index: workoutIds.length },
						})
					}
					className="rounded-chip border border-primary border-dashed px-2 py-1.5 text-xs text-primary hover:bg-primary-soft"
				>
					Przenieś tutaj
				</button>
			)}

			<Select
				label={`Dodaj trening do dnia ${dayIndex}`}
				options={options}
				value={null}
				onChange={(workoutId) => {
					if (!workoutId) return;
					onEdit({
						type: "add",
						pathId,
						dayIndex,
						index: workoutIds.length,
						workoutId,
					});
				}}
				placeholder="+ Dodaj"
				searchPlaceholder="Szukaj treningu…"
				emptyText="Brak treningów do dodania"
				size="sm"
				variant="quiet"
				className="mt-auto w-full"
			/>
		</div>
	);
}
