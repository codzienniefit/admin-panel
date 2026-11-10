import { useLiveQuery } from "@tanstack/react-db";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import type { ApiIssue } from "@/data/api/errors";
import {
	challengeSaver,
	challengesCollection,
} from "@/data/collections/challenges";
import type { Challenge, ContentStatus } from "@/data/schemas/challenge";
import {
	challengeIssues,
	challengeKind,
	KIND_LABELS,
} from "@/domain/challengeRules";
import { formatDateTime } from "@/domain/dates";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { type ConfirmOptions, confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { Menu, type MenuAction } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { Skeleton, useDelayedLoading } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { Tag } from "@/ui/Tag";
import { KIND_TONES } from "./ChallengeCard";
import { applyChallengeChange, unsavedContent } from "./challengeActions";
import { useChallengeRules } from "./useChallengeRules";

const tab =
	"rounded-control px-3 py-1.5 text-sm text-subtle hover:bg-hover hover:text-ink";
const tabActive = {
	className: "bg-primary-soft text-primary hover:bg-primary-soft",
};

const FIELD_LABELS: Record<string, string> = {
	title: "Nazwa",
	subtitle: "Podtytuł",
	internalTitle: "Komentarz",
	status: "Status",
	pro: "Płatne",
	lengthDays: "Czas trwania",
	visibleDaysUpFront: "Widoczne dni",
	imageRelativePath: "Miniaturka",
	descriptionFancyContent: "Opis",
	categoryId: "Kategoria",
	goalsIds: "Cele",
	difficultyLevelsIds: "Poziomy trudności",
	liveAtUtc: "Data premiery",
	endsAtUtc: "Data ukrycia",
	availableAtUtc: "Widoczne od",
	recommendedNext: "Polecane dalej",
	paths: "Warianty",
};

/** "paths[p-easy].days[4].workoutIds" → "wariant p-easy, dzień 4" */
export function describeChallengeConflict(location: string): string {
	const match = /^paths\[(.+?)\](?:\.days\[(\d+)\])?/.exec(location);
	if (match) {
		return match[2]
			? `dzień ${match[2]} w jednym z wariantów`
			: "ustawienia wariantu";
	}
	return FIELD_LABELS[location.split(".")[0] ?? location] ?? location;
}

/** The frame of one challenge: title, status, actions, and its tabs. */
export function ChallengeLayout({ challengeId }: { challengeId: string }) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	const showSkeleton = useDelayedLoading(isLoading);
	const challenge = data?.find((item) => item.id === challengeId);

	if (!challenge) {
		if (isLoading) {
			return showSkeleton ? (
				<div className="mx-auto max-w-6xl">
					<Skeleton className="mb-4 h-9 w-80" />
					<Skeleton className="mb-6 h-8 w-56" />
					<Skeleton className="h-72 rounded-card" />
				</div>
			) : null;
		}
		return (
			<div className="mx-auto max-w-2xl">
				<EmptyState
					title="Nie ma takiego wyzwania"
					action={
						<Link to="/challenges" className="text-primary hover:underline">
							Wróć do listy wyzwań
						</Link>
					}
				>
					{`Wyzwanie ${challengeId} nie istnieje.`}
				</EmptyState>
			</div>
		);
	}

	return <Loaded challenge={challenge} />;
}

function Loaded({ challenge }: { challenge: Challenge }) {
	const { config, context, ready } = useChallengeRules(challenge.id);
	const unsaved = useStore(unsavedContent).has(challenge.id);
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<{
		title: string;
		issues: readonly ApiIssue[];
	} | null>(null);
	const kind = challengeKind(challenge);
	const status = challenge.status;
	const promoted = context.promotedChallengeId === challenge.id;

	const setStatus = async (
		next: ContentStatus,
		done: string,
		refused: string,
		/** Asked first, once the rules allow the change. */
		ask?: ConfirmOptions,
	) => {
		setProblems(null);
		if (ask) {
			const issues = challengeIssues(
				{ ...challenge, status: next },
				config,
				context,
			);
			if (issues.length > 0) {
				setProblems({ title: refused, issues });
				return;
			}
			if (!(await confirm(ask))) return;
		}
		setBusy(true);
		try {
			const result = await applyChallengeChange(
				challenge,
				(draft) => {
					draft.status = next;
				},
				{ config, context, done },
			);
			if (!result.ok) setProblems({ title: refused, issues: result.issues });
		} catch {
			// The saver holds the change; HeldEditsNotice below explains.
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		const sure = await confirm({
			title: "Usunąć wyzwanie?",
			description:
				"Wyzwanie trafi do kosza i zniknie z aplikacji. Osoby, które je zaczęły, zachowają je w historii. Można je przywrócić.",
			confirmLabel: "Usuń",
			destructive: true,
		});
		if (sure) {
			await setStatus("deleted", "Wyzwanie w koszu", "Nie można usunąć");
		}
	};

	const more: MenuAction[] = [];
	if (status === "published") {
		more.push({
			label: "Ukryj",
			onSelect: () =>
				void setStatus("hidden", "Wyzwanie ukryte", "Nie można ukryć", {
					title: "Ukryć wyzwanie?",
					description:
						"Zniknie z listy w aplikacji. Osoby, które je zaczęły, mogą je dokończyć.",
					confirmLabel: "Ukryj",
				}),
		});
	}
	if (status === "hidden") {
		more.push({
			label: "Cofnij do szkicu",
			onSelect: () =>
				void setStatus(
					"draft",
					"Wyzwanie jest szkicem",
					"Nie można cofnąć do szkicu",
				),
		});
	}
	if (status !== "deleted") {
		more.push({
			label: promoted ? "Usuń (jest promowane)" : "Usuń",
			destructive: true,
			disabled: promoted,
			onSelect: () => void remove(),
		});
	}
	const waiting = busy || unsaved || !ready;

	return (
		<div className="mx-auto flex max-w-[1500px] flex-col gap-4">
			<header className="flex flex-col gap-3">
				<Link
					to="/challenges"
					className="self-start text-sm text-muted hover:text-primary"
				>
					← Wyzwania
				</Link>
				<div className="flex flex-wrap items-start gap-x-4 gap-y-3">
					<div className="min-w-0 flex-1">
						<h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
							{challenge.title || "Bez nazwy"}
						</h1>
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							<StatusBadge status={status} />
							<Tag tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Tag>
							{promoted && <Tag tone="amber">Promowane</Tag>}
							{challenge.pro && <Tag tone="indigo">Pro</Tag>}
							<span className="text-xs text-muted">
								{challenge.id} · zmieniono{" "}
								{formatDateTime(challenge.updatedAtUtc)}
							</span>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{unsaved && (
							<span className="text-xs text-muted">
								Najpierw zapisz zmiany w treści
							</span>
						)}
						{status === "deleted" ? (
							<Button
								variant="primary"
								size="md"
								disabled={waiting}
								onClick={() =>
									void setStatus(
										"draft",
										"Wyzwanie przywrócone jako szkic",
										"Nie można przywrócić",
									)
								}
							>
								Przywróć jako szkic
							</Button>
						) : (
							<>
								{(status === "draft" || status === "hidden") && (
									<Button
										variant="primary"
										size="md"
										disabled={waiting}
										onClick={() =>
											void setStatus(
												"published",
												"Wyzwanie opublikowane",
												"Nie można opublikować",
												{
													title: "Opublikować wyzwanie?",
													description:
														"Stanie się widoczne dla użytkowników aplikacji, zgodnie z ustawionymi datami.",
													confirmLabel: "Opublikuj",
												},
											)
										}
									>
										Opublikuj
									</Button>
								)}
								<Menu
									label="Więcej akcji"
									trigger="Więcej ▾"
									triggerClassName="h-9 rounded-control border border-line-input bg-surface px-4 text-sm hover:border-primary"
									actions={more}
								/>
							</>
						)}
					</div>
				</div>
				<nav aria-label="Części wyzwania" className="flex gap-1">
					<Link
						to="/challenges/$challengeId"
						params={{ challengeId: challenge.id }}
						className={tab}
						activeProps={tabActive}
						activeOptions={{ exact: true }}
					>
						Przegląd
					</Link>
					<Link
						to="/challenges/$challengeId/content"
						params={{ challengeId: challenge.id }}
						className={tab}
						activeProps={tabActive}
					>
						Treść
					</Link>
				</nav>
			</header>

			<HeldEditsNotice
				saver={challengeSaver}
				id={challenge.id}
				describe={describeChallengeConflict}
			/>
			{problems && (
				<Notice
					tone="red"
					role="alert"
					title={problems.title}
					actions={<Button onClick={() => setProblems(null)}>Zamknij</Button>}
				>
					<ul className="list-disc pl-5">
						{problems.issues.map((issue) => (
							<li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
						))}
					</ul>
				</Notice>
			)}
			{status === "deleted" && (
				<Notice tone="grey" title="To wyzwanie jest w koszu">
					Nie widać go w aplikacji i nie można go edytować. Przywrócenie
					zamienia je w szkic.
				</Notice>
			)}

			<Outlet />
		</div>
	);
}
