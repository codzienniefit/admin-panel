import { useDroppable } from "@dnd-kit/core";
import type { Workout } from "@/data/schemas/workout";
import { Button } from "@/ui/Button";
import { SCRATCHPAD_DROP_ID } from "./dragTypes";
import { PlannerCard } from "./PlannerCard";

interface ScratchpadProps {
	workoutIds: readonly string[];
	workoutById: ReadonlyMap<string, Workout>;
	readOnly: boolean;
	onAdd: () => void;
	onRemove: (workoutId: string) => void;
	onCopy: (workoutId: string) => void;
	onOpen: (workoutId: string) => void;
}

/**
 * Workouts kept aside for this challenge, shared by all its variants.
 * Dragging one onto a day copies it there; dragging a day's workout here
 * moves it out of the day.
 */
export function Scratchpad({
	workoutIds,
	workoutById,
	readOnly,
	onAdd,
	onRemove,
	onCopy,
	onOpen,
}: ScratchpadProps) {
	const { setNodeRef, isOver } = useDroppable({
		id: SCRATCHPAD_DROP_ID,
		data: { kind: "scratchpad" },
		disabled: readOnly,
	});
	return (
		<section
			ref={setNodeRef}
			aria-label="Brudnopis"
			className={`rounded-card border border-line border-dashed bg-surface p-3 md:p-4 ${isOver ? "outline-2 outline-primary outline-dashed" : ""}`}
		>
			<header className="mb-3 flex flex-wrap items-center gap-3">
				<h3 className="text-lg font-semibold">
					Brudnopis
					<span className="ml-2 rounded-full bg-hover px-2 py-0.5 text-xs font-normal text-muted">
						{workoutIds.length}
					</span>
				</h3>
				<p className="text-sm text-muted">
					Treningi „na później”, wspólne dla wszystkich wariantów. Przeciągnij
					na dzień, żeby skopiować.
				</p>
				{!readOnly && (
					<Button className="ml-auto" onClick={onAdd}>
						Dodaj do brudnopisu
					</Button>
				)}
			</header>
			{workoutIds.length === 0 ? (
				<p className="rounded-cell bg-bg px-3 py-6 text-center text-sm text-muted">
					Pusto. Przeciągnij tu trening z planu albo dodaj z katalogu.
				</p>
			) : (
				<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
					{workoutIds.map((id) => (
						<PlannerCard
							key={id}
							dragId={`scratch-${id}`}
							source={{ kind: "scratch", workoutId: id }}
							workoutId={id}
							workout={workoutById.get(id)}
							readOnly={readOnly}
							actions={[
								{ label: "Kopiuj", onSelect: () => onCopy(id) },
								{ label: "Otwórz trening", onSelect: () => onOpen(id) },
								{
									label: "Usuń z brudnopisu",
									destructive: true,
									onSelect: () => onRemove(id),
								},
							]}
						/>
					))}
				</div>
			)}
		</section>
	);
}
