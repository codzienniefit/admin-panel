import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Challenge, Path } from "@/data/schemas/challenge";
import { scheduleStats } from "@/domain/challengeFilters";
import { formatDateTime } from "@/domain/dates";
import { availablePlanTypes, PREP_LABELS } from "@/domain/planningRules";
import { plural } from "@/domain/text";
import { trainingTypeIdsOf } from "@/features/config/useConfig";
import { ContentPreview } from "@/features/content/ContentPreview";
import { PhoneFrame } from "@/features/content/PhoneFrame";
import { MediaImage } from "@/features/media/MediaImage";
import { applyPlanningChange } from "@/features/planner/planningActions";
import { usePlanning } from "@/features/planner/usePlanning";
import { saveOrToast, settleChange } from "@/features/saving/applyChange";
import { usePlannerSettings } from "@/features/settings/usePlannerSettings";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta, PREP_TONES } from "@/ui/enums";
import { Tag } from "@/ui/Tag";
import { applyChallengeChange } from "./challengeActions";
import { PlanningCard } from "./PlanningCard";
import { useChallengeRules } from "./useChallengeRules";
import { VariantDialog } from "./VariantDialog";

/** The first tab of a challenge: its variants and the facts at a glance. */
export function ChallengeOverview({ challenge }: { challenge: Challenge }) {
	const { config, context, challenges } = useChallengeRules(challenge.id);
	const [editing, setEditing] = useState<Path | "new" | null>(null);
	const planning = usePlanning(challenge.id);
	const settings = usePlannerSettings();
	const planTypes = availablePlanTypes(planning, settings);
	const trainingTypeIds = trainingTypeIdsOf(config);
	const readOnly = challenge.status === "deleted";
	const levelsLeft = config.challengeLevels.length - challenge.paths.length;
	const live =
		challenge.status === "published" || challenge.status === "hidden";

	const removeVariant = async (path: Path) => {
		const level = levelMeta(path.levelId).label;
		const { workouts } = scheduleStats(path.days);
		const sure = await confirm({
			title: `Usunąć wariant „${level}”?`,
			description: `${
				workouts > 0
					? `Zniknie jego plan (${plural(workouts, "trening", "treningi", "treningów")}). `
					: ""
			}${live ? "Osoby, które zaczęły ten wariant, stracą możliwość kontynuowania." : ""}`.trim(),
			confirmLabel: "Usuń wariant",
			destructive: true,
		});
		if (!sure) return;
		const removed = await saveOrToast("Nie można usunąć wariantu", () =>
			applyChallengeChange(
				challenge,
				(draft) => {
					draft.paths = draft.paths.filter((p) => p.pathId !== path.pathId);
				},
				{ config, context, done: "Wariant usunięty" },
			),
		);
		// Its notes, colours and status go with it.
		if (removed && planning?.variants[path.pathId]) {
			await settleChange(() =>
				applyPlanningChange(
					planning,
					(draft) => {
						delete draft.variants[path.pathId];
					},
					trainingTypeIds,
				),
			);
		}
	};

	const next = challenge.recommendedNext
		.map((item) => challenges.find((c) => c.id === item.id)?.title ?? item.id)
		.join(", ");

	return (
		<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
			<section aria-label="Warianty" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-lg font-semibold">
						Warianty ({challenge.paths.length})
					</h2>
					{!readOnly && (
						<Button
							variant="primary"
							disabled={levelsLeft <= 0}
							title={
								levelsLeft <= 0 ? "Wszystkie poziomy są już użyte" : undefined
							}
							onClick={() => setEditing("new")}
						>
							Dodaj wariant
						</Button>
					)}
				</div>

				{challenge.paths.length === 0 ? (
					<EmptyState title="Brak wariantów">
						Wyzwanie potrzebuje przynajmniej jednego wariantu, żeby je
						opublikować.
					</EmptyState>
				) : (
					challenge.paths.map((path) => {
						const level = levelMeta(path.levelId);
						const stats = scheduleStats(path.days);
						const planned = planning?.variants[path.pathId];
						const prep = planned?.prepStatus ?? "not_started";
						const planType = planTypes.find(
							(type) => type.id === planned?.planTypeId,
						);
						return (
							<Card
								key={path.pathId}
								className="flex flex-col gap-3 border-l-4 border-l-(--tone)"
								tone={PREP_TONES[prep]}
							>
								<div className="flex flex-wrap items-center gap-2">
									<Tag tone={level.tone}>{level.label}</Tag>
									{path.pro && <Tag tone="indigo">PRO</Tag>}
									<Tag tone={PREP_TONES[prep]}>{PREP_LABELS[prep]}</Tag>
									<Tag tone="grey">{planType?.name ?? "Bez rodzaju planu"}</Tag>
									<span className="text-sm text-subtle">
										{plural(stats.days, "dzień", "dni", "dni")} ·{" "}
										{plural(stats.workouts, "trening", "treningi", "treningów")}{" "}
										·{" "}
										{plural(
											stats.restDays,
											"dzień wolny",
											"dni wolne",
											"dni wolnych",
										)}
									</span>
								</div>
								<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
									<div>
										<dt className="text-xs text-muted">Treningi na tydzień</dt>
										<dd>{path.frequency}</dd>
									</div>
									<div>
										<dt className="text-xs text-muted">
											Min. dni do ukończenia
										</dt>
										<dd>{path.minimumDaysToComplete}</dd>
									</div>
									<div>
										<dt className="text-xs text-muted">Poziomy trudności</dt>
										<dd>
											{path.difficultyLevelsIds
												.map(
													(id) =>
														config.difficultyLevels.find((d) => d.id === id)
															?.title ?? id,
												)
												.join(", ") || "—"}
										</dd>
									</div>
								</dl>
								{path.description && (
									<p className="text-sm text-subtle">{path.description}</p>
								)}
								{prep === "in_progress" && planned?.prepNote && (
									<p className="text-sm text-subtle">
										<span className="font-semibold">Czego brakuje: </span>
										{planned.prepNote}
									</p>
								)}
								{stats.days !== challenge.lengthDays && (
									<p className="text-xs text-danger">
										Plan ma {plural(stats.days, "dzień", "dni", "dni")}, a
										wyzwanie trwa {challenge.lengthDays}. Zapisz czas trwania w
										zakładce Treść, żeby je wyrównać.
									</p>
								)}
								<div className="flex flex-wrap gap-2 border-line border-t pt-3">
									<Link
										to="/challenges/$challengeId/plan/$pathId"
										params={{ challengeId: challenge.id, pathId: path.pathId }}
										className="inline-flex items-center rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
									>
										Otwórz plan
									</Link>
									{!readOnly && (
										<>
											<Button onClick={() => setEditing(path)}>
												Ustawienia
											</Button>
											<Button
												variant="ghost"
												onClick={() => void removeVariant(path)}
											>
												Usuń
											</Button>
										</>
									)}
								</div>
							</Card>
						);
					})
				)}
			</section>

			<aside className="flex flex-col gap-4">
				{planning && (
					<PlanningCard
						planning={planning}
						folders={settings?.folders ?? []}
						trainingTypeIds={trainingTypeIds}
						readOnly={readOnly}
					/>
				)}
				<Card className="flex flex-col gap-3">
					<MediaImage
						path={challenge.imageRelativePath}
						placeholder="brak miniaturki"
						className="aspect-[5/2] w-full rounded-control"
					/>
					{challenge.subtitle && (
						<p className="text-sm text-subtle">{challenge.subtitle}</p>
					)}
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
						<Fact label="Czas trwania">
							{plural(challenge.lengthDays, "dzień", "dni", "dni")}
						</Fact>
						<Fact label="Premiera">{formatDateTime(challenge.liveAtUtc)}</Fact>
						<Fact label="Ukrycie">{formatDateTime(challenge.endsAtUtc)}</Fact>
						<Fact label="Kategoria">
							{config.challengeCategories.find(
								(c) => c.id === challenge.categoryId,
							)?.title ?? "—"}
						</Fact>
						<Fact label="Cele">
							{challenge.goalsIds
								.map(
									(id) =>
										config.challengeGoals.find((g) => g.id === id)?.title ?? id,
								)
								.join(", ") || "—"}
						</Fact>
						<Fact label="Dostęp">{challenge.pro ? "płatne" : "bezpłatne"}</Fact>
						<Fact label="Polecane dalej">{next || "—"}</Fact>
						{challenge.internalTitle && (
							<Fact label="Komentarz">{challenge.internalTitle}</Fact>
						)}
					</dl>
					<Link
						to="/challenges/$challengeId/content"
						params={{ challengeId: challenge.id }}
						className="self-start text-sm text-primary hover:underline"
					>
						Edytuj treść →
					</Link>
				</Card>
				<Card>
					<h2 className="mb-3 text-sm font-semibold">Opis w aplikacji</h2>
					<PhoneFrame screenClassName="h-80">
						<ContentPreview
							blocks={challenge.descriptionFancyContent}
							compact
						/>
					</PhoneFrame>
				</Card>
			</aside>

			{editing && (
				<VariantDialog
					challenge={challenge}
					path={editing === "new" ? null : editing}
					onClose={() => setEditing(null)}
				/>
			)}
		</div>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<>
			<dt className="text-xs leading-6 text-muted">{label}</dt>
			<dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
		</>
	);
}
