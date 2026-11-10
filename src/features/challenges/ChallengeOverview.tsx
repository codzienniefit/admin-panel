import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import type { Challenge, Path } from "@/data/schemas/challenge";
import { scheduleStats } from "@/domain/challengeFilters";
import { formatDateTime } from "@/domain/dates";
import { plural } from "@/domain/text";
import { ContentPreview } from "@/features/content/ContentPreview";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta } from "@/ui/enums";
import { Tag } from "@/ui/Tag";
import { applyChallengeChange, toastIssues } from "./challengeActions";
import { useChallengeRules } from "./useChallengeRules";
import { VariantDialog } from "./VariantDialog";

/** The first tab of a challenge: its variants and the facts at a glance. */
export function ChallengeOverview({ challenge }: { challenge: Challenge }) {
	const { config, context, challenges } = useChallengeRules(challenge.id);
	const [editing, setEditing] = useState<Path | "new" | null>(null);
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
		try {
			const result = await applyChallengeChange(
				challenge,
				(draft) => {
					draft.paths = draft.paths.filter((p) => p.pathId !== path.pathId);
				},
				{ config, context, done: "Wariant usunięty" },
			);
			if (!result.ok) toastIssues("Nie można usunąć wariantu", result.issues);
		} catch {
			// Held by the saver; the notice above the tabs explains.
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
						return (
							<Card key={path.pathId} className="flex flex-col gap-3">
								<div className="flex flex-wrap items-center gap-2">
									<Tag tone={level.tone}>{level.label}</Tag>
									{path.pro && <Tag tone="indigo">PRO</Tag>}
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
				<Card className="flex flex-col gap-3">
					{challenge.imageRelativePath ? (
						<img
							src={mediaUrl(challenge.imageRelativePath)}
							alt=""
							className="aspect-[5/2] w-full rounded-control object-cover"
						/>
					) : (
						<div className="flex aspect-[5/2] items-center justify-center rounded-control border border-line-input border-dashed text-xs text-muted">
							brak miniaturki
						</div>
					)}
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
					<div className="max-h-96 overflow-y-auto rounded-chip border border-line bg-white py-4">
						<ContentPreview
							blocks={challenge.descriptionFancyContent}
							compact
						/>
					</div>
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
