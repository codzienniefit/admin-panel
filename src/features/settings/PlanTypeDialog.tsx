import { useState } from "react";
import type { Condition, PlanType } from "@/data/schemas/planning";
import { planTypeIssues } from "@/domain/conditions";
import { newId } from "@/lib/ids";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextAreaField, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice } from "@/ui/formIssues";
import { whileBusy } from "@/ui/tasks";
import { ConditionsEditor } from "./ConditionsEditor";

interface PlanTypeDialogProps {
	/** The plan type being edited; null adds one. */
	planType: PlanType | null;
	/** Prefix for the id of a new one: "pt" global, "custom" inside a challenge. */
	idPrefix: string;
	/** Names already taken, to refuse a duplicate. */
	takenNames: readonly string[];
	trainingTypes: ReadonlyArray<{ id: string; title: string }>;
	/** Edits only the rules: for an override of a plan type inside a challenge. */
	rulesOnly?: boolean;
	title?: string;
	/**
	 * Returns the reasons it was refused, or null when there is nothing more
	 * for the dialog to show. Must not throw.
	 */
	onSave: (planType: PlanType) => Promise<string[] | null>;
	onClose: () => void;
}

/** A plan type: its name, and the rules every week of such a plan must meet. */
export function PlanTypeDialog({
	planType,
	idPrefix,
	takenNames,
	trainingTypes,
	rulesOnly = false,
	title,
	onSave,
	onClose,
}: PlanTypeDialogProps) {
	const [label, setLabel] = useState(planType?.name ?? "");
	const [description, setDescription] = useState(planType?.description ?? "");
	const [conditions, setConditions] = useState<Condition[]>(
		planType?.conditions ?? [],
	);
	const [problems, setProblems] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);

	const save = async () => {
		const next: PlanType = {
			...planType,
			id: planType?.id ?? newId(idPrefix),
			name: label.trim(),
			description: description.trim(),
			conditions,
		};
		const issues = planTypeIssues(
			[next],
			"planTypes",
			new Set(trainingTypes.map((type) => type.id)),
		).map((issue) => issue.message);
		const key = next.name.toLocaleLowerCase("pl");
		if (
			!rulesOnly &&
			key &&
			takenNames.some((taken) => taken.trim().toLocaleLowerCase("pl") === key)
		) {
			issues.push(`Rodzaj planu „${next.name}” już istnieje`);
		}
		if (issues.length > 0) {
			setProblems([...new Set(issues)]);
			return;
		}
		const refused = await whileBusy(setBusy, () => onSave(next));
		if (refused?.length) setProblems(refused);
		else onClose();
	};

	return (
		<Dialog
			open
			onClose={onClose}
			title={title ?? (planType ? "Rodzaj planu" : "Nowy rodzaj planu")}
			description="Wymagania sprawdzają każdy tydzień planu. Tydzień, który je spełnia, ma zieloną ramkę."
			size="lg"
			footer={
				<>
					<Button size="md" onClick={onClose}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={busy}
						onClick={() => void save()}
					>
						{busy ? "Zapisywanie…" : "Zapisz"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<IssuesNotice
					title="Nie można zapisać"
					issues={problems.map(generalIssue)}
				/>
				{!rulesOnly && (
					<>
						<TextField
							label="Nazwa"
							required
							value={label}
							onChange={(event) => setLabel(event.target.value)}
						/>
						<TextAreaField
							label="Opis"
							rows={2}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</>
				)}
				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-semibold">Wymagania tygodnia</span>
					<ConditionsEditor
						conditions={conditions}
						onChange={setConditions}
						trainingTypes={trainingTypes}
					/>
				</div>
			</div>
		</Dialog>
	);
}
