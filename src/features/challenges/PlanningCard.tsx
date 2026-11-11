import { Link } from "@tanstack/react-router";
import type { Planning } from "@/data/schemas/planning";
import type { Folder } from "@/data/schemas/settings";
import { paletteColorFor } from "@/domain/palette";
import { editPlanning } from "@/features/planner/plannerSession";
import { applyPlanningChange } from "@/features/planner/planningActions";
import { saveOrToast } from "@/features/saving/applyChange";
import { Card } from "@/ui/Card";
import { ColorPalette } from "@/ui/ColorPalette";
import { Field, TextAreaField } from "@/ui/Field";
import { Select } from "@/ui/Select";

interface PlanningCardProps {
	planning: Planning;
	folders: readonly Folder[];
	trainingTypeIds: ReadonlySet<string>;
	readOnly: boolean;
}

/** What the team keeps about a challenge that the app never sees. */
export function PlanningCard({
	planning,
	folders,
	trainingTypeIds,
	readOnly,
}: PlanningCardProps) {
	// Folder and colour save on the click, so the click gets an answer.
	const change = (apply: (draft: Planning) => void) =>
		saveOrToast("Nie można zapisać", () =>
			applyPlanningChange(planning, apply, trainingTypeIds, "Zapisano"),
		);
	// A folder that was deleted in the settings counts as "no folder".
	const folderId = folders.some((folder) => folder.id === planning.folderId)
		? planning.folderId
		: null;

	return (
		<Card className="flex flex-col gap-4">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-lg font-semibold">Planowanie</h2>
				<span className="text-xs text-muted">tylko dla zespołu</span>
			</div>
			<Field label="Folder">
				{() => (
					<Select
						label="Folder"
						placeholder="Bez folderu"
						options={folders.map((folder) => ({
							value: folder.id,
							label: folder.name,
						}))}
						value={folderId}
						onChange={(value) =>
							void change((draft) => {
								draft.folderId = value;
							})
						}
						emptyText="Brak folderów. Dodaj je w ustawieniach."
						disabled={readOnly}
						clearable
						className="w-full"
					/>
				)}
			</Field>
			<div>
				<ColorPalette
					label="Kolor w kalendarzu"
					noneLabel="Automatyczny"
					// The colour the calendar picks by itself for this challenge.
					noneColor={paletteColorFor(planning.id)}
					value={planning.calendarColor}
					onChange={(value) =>
						void change((draft) => {
							draft.calendarColor = value;
						})
					}
					disabled={readOnly}
				/>
			</div>
			<TextAreaField
				label="Notatka wewnętrzna"
				rows={3}
				maxLength={5000}
				hint="Zapisuje się sama."
				disabled={readOnly}
				defaultValue={planning.note}
				onChange={(event) => {
					const text = event.target.value;
					editPlanning(planning.id, (draft) => {
						draft.note = text;
					});
				}}
			/>
			<Link
				to="/challenges/$challengeId/requirements"
				params={{ challengeId: planning.id }}
				className="self-start text-sm text-primary hover:underline"
			>
				Wymagania i rodzaje planu →
			</Link>
		</Card>
	);
}
