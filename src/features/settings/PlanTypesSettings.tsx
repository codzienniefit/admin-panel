import { useState } from "react";
import type { PlanType } from "@/data/schemas/planning";
import { plural } from "@/domain/text";
import { trainingTypeIdsOf, useConfig } from "@/features/config/useConfig";
import { applySettingsChange } from "@/features/planner/planningActions";
import { usePlanningById } from "@/features/planner/usePlanning";
import { saveOrToast, settleChange } from "@/features/saving/applyChange";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { Loading } from "@/ui/Loading";
import { ConditionList } from "./ConditionsEditor";
import { PlanTypeDialog } from "./PlanTypeDialog";
import { usePlannerSettings } from "./usePlannerSettings";

/** The kinds of plan the team uses, each with the rules its weeks must meet. */
export function PlanTypesSettings() {
	const settings = usePlannerSettings();
	const config = useConfig().workouts;
	const planningById = usePlanningById();
	const [editing, setEditing] = useState<PlanType | "new" | null>(null);

	if (!settings) return <Loading />;
	const trainingTypeIds = trainingTypeIdsOf(config);
	const usedBy = (planTypeId: string) =>
		[...planningById.values()].reduce(
			(count, planning) =>
				count +
				Object.values(planning.variants).filter(
					(variant) => variant.planTypeId === planTypeId,
				).length,
			0,
		);

	const save = async (planType: PlanType) => {
		const result = await settleChange(() =>
			applySettingsChange(
				settings,
				(draft) => {
					const index = draft.planTypes.findIndex((t) => t.id === planType.id);
					if (index >= 0) draft.planTypes[index] = planType;
					else draft.planTypes.push(planType);
				},
				trainingTypeIds,
				"Rodzaj planu zapisany",
			),
		);
		// Held by the saver: the notice above explains, the dialog can close.
		if (!result || result.ok) return null;
		return result.issues.map((issue) => issue.message);
	};

	const remove = async (planType: PlanType) => {
		const used = usedBy(planType.id);
		const sure = await confirm({
			title: `Usunąć rodzaj planu „${planType.name}”?`,
			description:
				used > 0
					? `Używa go ${plural(used, "wariant", "warianty", "wariantów")}. Zostaną bez rodzaju planu i planer sprawdzi je wymaganiem domyślnym.`
					: "Nie używa go żaden wariant.",
			confirmLabel: "Usuń",
			destructive: true,
		});
		if (!sure) return;
		await saveOrToast("Nie można usunąć", () =>
			applySettingsChange(
				settings,
				(draft) => {
					draft.planTypes = draft.planTypes.filter((t) => t.id !== planType.id);
				},
				trainingTypeIds,
				"Rodzaj planu usunięty",
			),
		);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-muted">
					Rodzaj planu wybiera się w ustawieniach wariantu. Wyzwanie może mieć
					własne wymagania: zakładka „Wymagania” wyzwania.
				</p>
				<Button variant="primary" onClick={() => setEditing("new")}>
					Nowy rodzaj planu
				</Button>
			</div>
			{settings.planTypes.length === 0 ? (
				<EmptyState title="Brak rodzajów planów">
					Dodaj pierwszy, żeby planer mógł sprawdzać tygodnie.
				</EmptyState>
			) : (
				settings.planTypes.map((planType) => {
					const used = usedBy(planType.id);
					return (
						<Card key={planType.id} className="flex flex-col gap-2">
							<div className="flex flex-wrap items-start gap-3">
								<div className="min-w-0 flex-1">
									<h2 className="text-lg font-semibold">
										{planType.name || "Bez nazwy"}
									</h2>
									{planType.description && (
										<p className="text-sm text-subtle">
											{planType.description}
										</p>
									)}
								</div>
								<span className="text-xs text-muted">
									{used > 0
										? `używany w ${plural(used, "wariancie", "wariantach", "wariantach")}`
										: "nieużywany"}
								</span>
								<Button onClick={() => setEditing(planType)}>Edytuj</Button>
								<Button variant="ghost" onClick={() => void remove(planType)}>
									Usuń
								</Button>
							</div>
							<ConditionList conditions={planType.conditions} />
						</Card>
					);
				})
			)}
			{editing && (
				<PlanTypeDialog
					planType={editing === "new" ? null : editing}
					idPrefix="pt"
					takenNames={settings.planTypes
						.filter((t) => editing === "new" || t.id !== editing.id)
						.map((t) => t.name)}
					trainingTypes={config.trainingTypes}
					onSave={save}
					onClose={() => setEditing(null)}
				/>
			)}
		</div>
	);
}
