import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { challengesCollection } from "@/data/collections/challenges";
import { workoutsCollection } from "@/data/collections/workouts";
import type {
	UserChallengeAttempt,
	UserWorkoutCompletion,
} from "@/data/schemas/user";
import { formatDate, formatDateTime } from "@/domain/dates";
import { attemptState, progressSummary } from "@/domain/userRules";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta } from "@/ui/enums";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import { ATTEMPT_STATE_META } from "./userMeta";
import { useUserProgress } from "./useUsers";

const PAGE = 20;

/** What a person has done in the app. Read-only. */
export function UserProgressTab({ uid }: { uid: string }) {
	const progress = useUserProgress(uid);
	const { data: workouts, isLoading: loadingWorkouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const { data: challenges, isLoading: loadingChallenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	const loading = progress.isLoading || loadingWorkouts || loadingChallenges;
	const showLoading = useDelayedLoading(loading);
	const [limit, setLimit] = useState(PAGE);

	if (loading) {
		return showLoading ? (
			<div className="flex flex-col gap-3">
				<Loading />
				<Loading />
				<Loading />
				<Loading />
			</div>
		) : null;
	}
	if (!progress.data) {
		return (
			<Notice
				tone="red"
				role="alert"
				title="Nie udało się wczytać wykonań"
				actions={
					<Button onClick={() => void progress.refetch()}>
						Spróbuj ponownie
					</Button>
				}
			>
				Sprawdź połączenie i spróbuj jeszcze raz.
			</Notice>
		);
	}

	const summary = progressSummary(progress.data);
	const workoutTitle = new Map((workouts ?? []).map((w) => [w.id, w.title]));
	const challengeById = new Map((challenges ?? []).map((c) => [c.id, c]));
	const done = progress.data.workouts;
	const shown = done.slice(0, limit);

	if (summary.workoutsDone === 0 && summary.challengesStarted === 0) {
		return (
			<EmptyState title="Jeszcze nic tu nie ma">
				Ta osoba nie wykonała dotąd żadnego treningu i nie zaczęła żadnego
				wyzwania. Wykonania pojawią się tu same, gdy zacznie ćwiczyć.
			</EmptyState>
		);
	}

	const attemptColumns: Column<UserChallengeAttempt>[] = [
		{
			key: "challenge",
			header: "Wyzwanie",
			primary: true,
			cell: (attempt) => (
				<span className="[overflow-wrap:anywhere]">
					{challengeById.get(attempt.challengeId)?.title || (
						<span className="font-normal text-muted">Usunięte wyzwanie</span>
					)}
				</span>
			),
		},
		{
			key: "level",
			header: "Wariant",
			cell: (attempt) => {
				if (!attempt.levelId) return <span className="text-muted">—</span>;
				const level = levelMeta(attempt.levelId);
				return <Tag tone={level.tone}>{level.label}</Tag>;
			},
		},
		{
			key: "state",
			header: "Stan",
			cell: (attempt) => {
				const meta = ATTEMPT_STATE_META[attemptState(attempt)];
				return <Tag tone={meta.tone}>{meta.label}</Tag>;
			},
		},
		{
			key: "days",
			header: "Wykonane dni",
			align: "end",
			cell: (attempt) => {
				const length = challengeById.get(attempt.challengeId)?.lengthDays;
				return length
					? `${attempt.completedDays} z ${length}`
					: attempt.completedDays;
			},
		},
		{
			key: "started",
			header: "Początek",
			align: "end",
			cell: (attempt) => (
				<span className="text-subtle">{formatDate(attempt.startedAtUtc)}</span>
			),
		},
		{
			key: "ended",
			header: "Koniec",
			align: "end",
			cell: (attempt) => (
				<span className="text-subtle">
					{formatDate(attempt.completedAtUtc ?? attempt.abortedAtUtc)}
				</span>
			),
		},
	];

	const workoutColumns: Column<UserWorkoutCompletion>[] = [
		{
			key: "workout",
			header: "Trening",
			primary: true,
			cell: (item) => (
				<span className="[overflow-wrap:anywhere]">
					{workoutTitle.get(item.workoutId) || (
						<span className="font-normal text-muted">Usunięty trening</span>
					)}
				</span>
			),
		},
		{
			key: "when",
			header: "Wykonano",
			align: "end",
			cell: (item) => (
				<span className="text-subtle">
					{formatDateTime(item.completedAtUtc)}
				</span>
			),
		},
	];

	const figures = [
		{ label: "Wykonane treningi", value: summary.workoutsDone },
		{ label: "Rozpoczęte wyzwania", value: summary.challengesStarted },
		{ label: "Ukończone wyzwania", value: summary.challengesCompleted },
		{ label: "Wyzwania w trakcie", value: summary.challengesActive },
		{ label: "Ostatni trening", value: formatDate(summary.lastWorkoutAtUtc) },
	];

	return (
		<div className="flex flex-col gap-5">
			<Card>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
					{figures.map((figure) => (
						<div key={figure.label} className="flex flex-col-reverse">
							<dt className="text-xs text-muted">{figure.label}</dt>
							<dd className="text-xl font-semibold">{figure.value}</dd>
						</div>
					))}
				</dl>
			</Card>

			<section aria-label="Wyzwania">
				<h2 className="mb-2 text-lg font-semibold">Wyzwania</h2>
				<Table
					columns={attemptColumns}
					rows={progress.data.challenges}
					rowKey={(attempt) => `${attempt.challengeId}-${attempt.startedAtUtc}`}
					empty={
						<p className="text-sm text-muted">
							Ta osoba nie zaczęła jeszcze żadnego wyzwania.
						</p>
					}
				/>
			</section>

			<section aria-label="Ostatnie treningi">
				<h2 className="mb-2 text-lg font-semibold">Ostatnie treningi</h2>
				<Table
					columns={workoutColumns}
					rows={shown}
					rowKey={(item) => `${item.workoutId}-${item.completedAtUtc}`}
					empty={
						<p className="text-sm text-muted">
							Ta osoba nie wykonała jeszcze żadnego treningu.
						</p>
					}
				/>
				{done.length > shown.length && (
					<div className="mt-4 flex justify-center">
						<Button onClick={() => setLimit(limit + PAGE)}>
							Pokaż kolejne ({done.length - shown.length} pozostało)
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}
