import { useState } from "react";
import type { Challenge } from "@/data/schemas/challenge";
import type { Planning, PlanType } from "@/data/schemas/planning";
import { trainingTypeIdsOf, useConfig } from "@/features/config/useConfig";
import { applyPlanningChange } from "@/features/planner/planningActions";
import { usePlanning } from "@/features/planner/usePlanning";
import { saveOrToast, settleChange } from "@/features/saving/applyChange";
import { ConditionList } from "@/features/settings/ConditionsEditor";
import { PlanTypeDialog } from "@/features/settings/PlanTypeDialog";
import { usePlannerSettings } from "@/features/settings/usePlannerSettings";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta } from "@/ui/enums";
import { Loading } from "@/ui/Loading";
import { Tag } from "@/ui/Tag";

type Editing =
	| { kind: "custom"; planType: PlanType | null }
	| { kind: "override"; planType: PlanType }
	| null;

/**
 * The third tab of a challenge: which rules its plans are checked against.
 * A challenge can replace the rules of a plan type for itself, and can have
 * plan types of its own.
 */
export function ChallengeRequirements({ challenge }: { challenge: Challenge }) {
	const planning = usePlanning(challenge.id);
	const settings = usePlannerSettings();
	const config = useConfig().workouts;
	const [editing, setEditing] = useState<Editing>(null);

	if (!planning || !settings) return <Loading />;
	const readOnly = challenge.status === "deleted";
	const trainingTypeIds = trainingTypeIdsOf(config);
	const customIds = new Set(planning.customPlanTypes.map((type) => type.id));
	const globalTypes = settings.planTypes.filter(
		(type) => !customIds.has(type.id),
	);

	const usedBy = (planTypeId: string) =>
		challenge.paths
			.filter(
				(path) => planning.variants[path.pathId]?.planTypeId === planTypeId,
			)
			.map((path) => levelMeta(path.levelId));

	const save = (apply: (draft: Planning) => void, done: string) =>
		applyPlanningChange(planning, apply, trainingTypeIds, done);

	/** For the dialog: the reasons it was refused, or null. */
	const change = async (apply: (draft: Planning) => void, done: string) => {
		const result = await settleChange(() => save(apply, done));
		// Null: held by the saver; the notice above the tabs explains.
		if (!result || result.ok) return null;
		return result.issues.map((issue) => issue.message);
	};

	/** For a button: problems become a toast. */
	const run = (apply: (draft: Planning) => void, done: string) =>
		saveOrToast("Nie można zapisać", () => save(apply, done));

	const removeCustom = async (planType: PlanType) => {
		const users = usedBy(planType.id);
		const sure = await confirm({
			title: `Usunąć rodzaj planu „${planType.name}”?`,
			description:
				users.length > 0
					? `Używają go warianty: ${users.map((level) => level.label).join(", ")}. Zostaną bez rodzaju planu.`
					: "Nie używa go żaden wariant tego wyzwania.",
			confirmLabel: "Usuń",
			destructive: true,
		});
		if (!sure) return;
		await run((draft) => {
			draft.customPlanTypes = draft.customPlanTypes.filter(
				(type) => type.id !== planType.id,
			);
			delete draft.conditionOverrides[planType.id];
		}, "Rodzaj planu usunięty");
	};

	const renderUsers = (planTypeId: string) => {
		const users = usedBy(planTypeId);
		return users.length === 0 ? (
			<span className="text-xs text-muted">nieużywany w tym wyzwaniu</span>
		) : (
			users.map((level) => (
				<Tag key={level.label} tone={level.tone} variant="dot">
					{level.label}
				</Tag>
			))
		);
	};

	return (
		<div className="flex flex-col gap-6">
			<p className="max-w-3xl text-sm text-muted">
				Planer sprawdza każdy tydzień wariantu wymaganiami jego rodzaju planu.
				Rodzaj planu wybiera się w ustawieniach wariantu. Tutaj można te
				wymagania zmienić tylko dla tego wyzwania.
			</p>

			<section className="flex flex-col gap-3">
				<h2 className="text-lg font-semibold">Wspólne rodzaje planów</h2>
				{globalTypes.length === 0 && (
					<EmptyState title="Brak rodzajów planów">
						Dodaje się je w Ustawieniach.
					</EmptyState>
				)}
				{globalTypes.map((planType) => {
					const override = planning.conditionOverrides[planType.id];
					const overridden = Boolean(override?.length);
					return (
						<Card key={planType.id} className="flex flex-col gap-2">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="font-semibold">{planType.name}</h3>
								{overridden && <Tag tone="amber">Zmienione dla wyzwania</Tag>}
								{renderUsers(planType.id)}
								{!readOnly && (
									<div className="ml-auto flex flex-wrap gap-2">
										<Button
											onClick={() =>
												setEditing({
													kind: "override",
													planType: {
														...planType,
														conditions: overridden
															? (override ?? [])
															: planType.conditions,
													},
												})
											}
										>
											{overridden ? "Zmień wymagania" : "Dostosuj dla wyzwania"}
										</Button>
										{overridden && (
											<Button
												variant="ghost"
												onClick={() =>
													void run((draft) => {
														delete draft.conditionOverrides[planType.id];
													}, "Przywrócono wymagania rodzaju planu")
												}
											>
												Przywróć wspólne
											</Button>
										)}
									</div>
								)}
							</div>
							<ConditionList
								conditions={overridden ? (override ?? []) : planType.conditions}
							/>
						</Card>
					);
				})}
			</section>

			<section className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-lg font-semibold">
						Rodzaje planów tylko w tym wyzwaniu
					</h2>
					{!readOnly && (
						<Button
							variant="primary"
							onClick={() => setEditing({ kind: "custom", planType: null })}
						>
							Dodaj rodzaj planu
						</Button>
					)}
				</div>
				{planning.customPlanTypes.length === 0 ? (
					<p className="text-sm text-muted">
						Brak. Przydają się, gdy wyzwanie ma nietypowy układ tygodnia.
					</p>
				) : (
					planning.customPlanTypes.map((planType) => (
						<Card key={planType.id} className="flex flex-col gap-2">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="font-semibold">{planType.name}</h3>
								{renderUsers(planType.id)}
								{!readOnly && (
									<div className="ml-auto flex flex-wrap gap-2">
										<Button
											onClick={() => setEditing({ kind: "custom", planType })}
										>
											Edytuj
										</Button>
										<Button
											variant="ghost"
											onClick={() => void removeCustom(planType)}
										>
											Usuń
										</Button>
									</div>
								)}
							</div>
							{planType.description && (
								<p className="text-sm text-subtle">{planType.description}</p>
							)}
							<ConditionList conditions={planType.conditions} />
						</Card>
					))
				)}
			</section>

			{editing?.kind === "custom" && (
				<PlanTypeDialog
					planType={editing.planType}
					idPrefix="custom"
					takenNames={[...settings.planTypes, ...planning.customPlanTypes]
						.filter((type) => type.id !== editing.planType?.id)
						.map((type) => type.name)}
					trainingTypes={config.trainingTypes}
					onSave={(planType) =>
						change((draft) => {
							const index = draft.customPlanTypes.findIndex(
								(type) => type.id === planType.id,
							);
							if (index >= 0) draft.customPlanTypes[index] = planType;
							else draft.customPlanTypes.push(planType);
						}, "Rodzaj planu zapisany")
					}
					onClose={() => setEditing(null)}
				/>
			)}
			{editing?.kind === "override" && (
				<PlanTypeDialog
					planType={editing.planType}
					idPrefix="pt"
					takenNames={[]}
					trainingTypes={config.trainingTypes}
					rulesOnly
					title={`Wymagania „${editing.planType.name}” w tym wyzwaniu`}
					onSave={(planType) =>
						change((draft) => {
							// No rules at all means "use the plan type's own".
							if (planType.conditions.length === 0) {
								delete draft.conditionOverrides[planType.id];
							} else {
								draft.conditionOverrides[planType.id] = planType.conditions;
							}
						}, "Wymagania zapisane")
					}
					onClose={() => setEditing(null)}
				/>
			)}
		</div>
	);
}
