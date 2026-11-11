import { useLiveQuery } from "@tanstack/react-db";
import { Link, Outlet, useParams } from "@tanstack/react-router";
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
import { usePlanning } from "@/features/planner/usePlanning";
import { settleChange } from "@/features/saving/applyChange";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useJsonPreview } from "@/features/saving/JsonPreview";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { type ConfirmOptions, confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { IssuesNotice } from "@/ui/formIssues";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Menu, type MenuAction } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { StatusBadge } from "@/ui/StatusBadge";
import { tabItem, tabItemActive } from "@/ui/Tabs";
import { Tag } from "@/ui/Tag";
import { whileBusy } from "@/ui/tasks";
import { KIND_TONES } from "./ChallengeCard";
import {
	applyChallengeChange,
	challengeVersions,
	unsavedContent,
} from "./challengeActions";
import { useChallengeRules } from "./useChallengeRules";

const tabActive = { className: tabItemActive };

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
	const showLoading = useDelayedLoading(isLoading);
	const challenge = data?.find((item) => item.id === challengeId);

	if (!challenge) {
		if (isLoading) {
			return showLoading ? (
				<div className="mx-auto max-w-6xl">
					<Loading />
					<Loading />
					<Loading />
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
	const rules = useChallengeRules(challenge.id);
	const { config, context } = rules;
	// Notes, colours and plan types live in the planning document; every tab
	// reads or writes it, so it has to be there as well.
	const planning = usePlanning(challenge.id);
	const ready = rules.ready && planning !== undefined;
	const unsaved = useStore(unsavedContent).has(challenge.id);
	// The Plan tab leads to the variant that is open, else to the first one.
	const openPathId = useParams({ strict: false }).pathId;
	const planPathId =
		challenge.paths.find((path) => path.pathId === openPathId)?.pathId ??
		challenge.paths[0]?.pathId;
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
		// The rules below need the full lists; see useChallengeRules.
		if (!ready) return;
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
		const result = await whileBusy(setBusy, () =>
			settleChange(() =>
				applyChallengeChange(
					challenge,
					(draft) => {
						draft.status = next;
					},
					{ config, context, done },
				),
			),
		);
		// Null: the saver holds the change; HeldEditsNotice below explains.
		if (result && !result.ok) {
			setProblems({ title: refused, issues: result.issues });
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

	const json = useJsonPreview("wyzwania", () => challengeVersions(challenge));

	const more: MenuAction[] = [json.action];
	if (status === "published") {
		more.push({
			label: "Ukryj",
			disabled: !ready,
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
			disabled: !ready,
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
			disabled: promoted || !ready,
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
								Najpierw zapisz albo odrzuć zmiany
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
							(status === "draft" || status === "hidden") && (
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
							)
						)}
						{/* In every status, the bin included: the JSON preview is here. */}
						<Menu
							label="Więcej akcji"
							trigger="Więcej ▾"
							triggerClassName="h-9 rounded-control border border-line-input bg-surface px-4 text-sm hover:border-primary"
							actions={more}
						/>
					</div>
				</div>
				<nav
					aria-label="Części wyzwania"
					className="flex gap-1 overflow-x-auto"
				>
					<Link
						to="/challenges/$challengeId"
						params={{ challengeId: challenge.id }}
						className={tabItem}
						activeProps={tabActive}
						activeOptions={{ exact: true }}
					>
						Przegląd
					</Link>
					{planPathId && (
						<Link
							to="/challenges/$challengeId/plan/$pathId"
							params={{ challengeId: challenge.id, pathId: planPathId }}
							className={tabItem}
							activeProps={tabActive}
							activeOptions={{ includeSearch: false }}
						>
							Plan
						</Link>
					)}
					<Link
						to="/challenges/$challengeId/content"
						params={{ challengeId: challenge.id }}
						className={tabItem}
						activeProps={tabActive}
					>
						Treść
					</Link>
					<Link
						to="/challenges/$challengeId/requirements"
						params={{ challengeId: challenge.id }}
						className={tabItem}
						activeProps={tabActive}
					>
						Wymagania
					</Link>
				</nav>
			</header>

			<HeldEditsNotice
				saver={challengeSaver}
				id={challenge.id}
				describe={describeChallengeConflict}
			/>
			{problems && (
				<IssuesNotice
					title={problems.title}
					issues={problems.issues}
					actions={<Button onClick={() => setProblems(null)}>Zamknij</Button>}
				/>
			)}
			{status === "deleted" && (
				<Notice tone="grey" title="To wyzwanie jest w koszu">
					Nie widać go w aplikacji i nie można go edytować. Przywrócenie
					zamienia je w szkic.
				</Notice>
			)}

			{/* Every tab checks the challenge against the rules and keeps notes in
			    its planning document: no tab before those have loaded. */}
			{ready ? <Outlet /> : <Loading />}
			{json.dialog}
		</div>
	);
}
