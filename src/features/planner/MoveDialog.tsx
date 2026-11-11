import { useState } from "react";
import { MAX_WORKOUTS_PER_DAY } from "@/domain/schedule";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { Select } from "@/ui/Select";

interface MoveDialogProps {
	workoutTitle: string;
	workoutId: string;
	fromDay: number;
	days: ReadonlyArray<{ dayIndex: number; workoutIds: readonly string[] }>;
	onMove: (toDay: number) => void;
	onClose: () => void;
}

/** "Przenieś do…": what a drag does, for touch screens and keyboards. */
export function MoveDialog({
	workoutTitle,
	workoutId,
	fromDay,
	days,
	onMove,
	onClose,
}: MoveDialogProps) {
	const [target, setTarget] = useState<string | null>(null);
	const options = days
		.filter((day) => day.dayIndex !== fromDay)
		.map((day) => {
			const blocked = day.workoutIds.includes(workoutId)
				? "już tam jest"
				: day.workoutIds.length >= MAX_WORKOUTS_PER_DAY
					? "dzień pełny"
					: null;
			return {
				value: String(day.dayIndex),
				label: `Dzień ${day.dayIndex}`,
				hint:
					blocked ??
					`tydzień ${Math.ceil(day.dayIndex / 7)} · treningów: ${day.workoutIds.length}`,
				disabled: blocked !== null,
			};
		});

	return (
		<Dialog
			open
			onClose={onClose}
			title="Przenieś trening"
			description={`„${workoutTitle}” z dnia ${fromDay}`}
			size="sm"
			footer={
				<>
					<Button size="md" onClick={onClose}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={!target}
						onClick={() => {
							if (target) onMove(Number(target));
							onClose();
						}}
					>
						Przenieś
					</Button>
				</>
			}
		>
			<Field label="Do dnia">
				{() => (
					<Select
						label="Do dnia"
						options={options}
						value={target}
						onChange={setTarget}
						placeholder="Wybierz dzień"
						searchPlaceholder="Numer dnia…"
						emptyText="Brak innych dni"
						className="w-full"
					/>
				)}
			</Field>
		</Dialog>
	);
}
