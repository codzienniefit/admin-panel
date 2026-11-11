import { useDraggable } from "@dnd-kit/core";
import type { CardPlanning } from "@/data/schemas/planning";
import type { Workout } from "@/data/schemas/workout";
import { Menu, type MenuAction } from "@/ui/Menu";
import { WorkoutCard } from "@/ui/WorkoutCard";
import type { DragSource } from "./dragTypes";

interface PlannerCardProps {
	dragId: string;
	source: DragSource;
	workoutId: string;
	workout: Workout | undefined;
	card?: CardPlanning;
	actions: readonly MenuAction[];
	/** Read-only plans cannot be dragged and have no menu. */
	readOnly?: boolean;
}

/**
 * A workout that can be dragged and has a "⋯" menu. Everything a drag can do
 * is also in the menu, for touch screens and keyboards.
 */
export function PlannerCard({
	dragId,
	source,
	workoutId,
	workout,
	card,
	actions,
	readOnly = false,
}: PlannerCardProps) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: dragId,
		data: source,
		disabled: readOnly,
	});
	const title = workout?.title || workoutId;

	return (
		<div
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			className={`touch-manipulation rounded-chip outline-none focus-visible:shadow-focus ${
				readOnly ? "" : "cursor-grab active:cursor-grabbing"
			} ${isDragging ? "opacity-40" : ""}`}
		>
			<WorkoutCard
				workout={workout}
				fallbackTitle={workoutId}
				color={card?.color}
				note={card?.note}
				action={
					!readOnly &&
					actions.length > 0 && (
						<Menu
							label={`Akcje: ${title}`}
							trigger="⋯"
							triggerClassName="h-full shrink-0 px-2 text-base leading-none opacity-70 hover:bg-black/10 hover:opacity-100"
							actions={actions}
						/>
					)
				}
			/>
		</div>
	);
}
