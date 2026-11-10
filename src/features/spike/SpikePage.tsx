import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { mockControls } from "@/data/api/mock/controls";
import {
	challengeSaver,
	challengesCollection,
} from "@/data/collections/challenges";
import { workoutsCollection } from "@/data/collections/workouts";
import { type DaySlot, type ScheduleOp, toWeeks } from "@/domain/schedule";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { levelMeta } from "@/ui/enums";
import { Notice } from "@/ui/Notice";
import { SaveStatusText } from "@/ui/SaveStatusText";
import { Skeleton, useDelayedLoading } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { DayCell } from "./DayCell";
import { dispatchEdit, plannerHistory, redo, undo } from "./plannerSession";

// Phase 0 spike screen. It exists to try the data layer by hand: edit a
// schedule, watch it autosave, force a conflict or a failure. It is not the
// planner; drag and drop, notes and requirements come in Phase 5.

interface SpikePageProps {
	challengeId: string;
	/** The variant to open on. */
	initialPathId?: string;
	/** Inside a challenge page: its header already shows title and status. */
	embedded?: boolean;
}

export function SpikePage({
	challengeId,
	initialPathId,
	embedded = false,
}: SpikePageProps) {
	const { data: found, isLoading } = useLiveQuery({
		query: (q) =>
			q
				.from({ challenge: challengesCollection })
				.where(({ challenge }) => eq(challenge.id, challengeId)),
	});
	const { data: workouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const showSkeleton = useDelayedLoading(isLoading);
	const [pathId, setPathId] = useState<string | null>(initialPathId ?? null);
	const [selected, setSelected] = useState<DaySlot | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);

	const challenge = found?.[0];
	if (!challenge) {
		return showSkeleton ? <PlannerSkeleton /> : null;
	}

	const path =
		challenge.paths.find((p) => p.pathId === pathId) ?? challenge.paths[0];
	if (!path) return <p className="text-muted">To wyzwanie nie ma wariantów.</p>;

	const allWorkouts = workouts ?? [];
	const workoutById = new Map(allWorkouts.map((w) => [w.id, w]));

	const edit = (op: ScheduleOp) => {
		setRefusal(dispatchEdit(challenge.id, op));
		setSelected(null);
	};

	return (
		<div className="mx-auto max-w-[1500px]">
			<header className="mb-4 flex flex-wrap items-center gap-3">
				{embedded ? (
					<h2 className="text-lg font-semibold">Plan</h2>
				) : (
					<>
						<h1 className="text-2xl font-semibold tracking-tight">
							{challenge.title}
						</h1>
						<StatusBadge status={challenge.status} />
					</>
				)}
				<div className="ml-auto flex flex-wrap items-center gap-3">
					<SaveStatus challengeId={challenge.id} />
					<HistoryButtons challengeId={challenge.id} />
				</div>
			</header>

			<div className={`mb-4 empty:hidden ${embedded ? "hidden" : ""}`}>
				<HeldEditsNotice
					saver={challengeSaver}
					id={challenge.id}
					describe={describeConflict}
				/>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				{challenge.paths.map((p) => {
					const level = levelMeta(p.levelId);
					const active = p.pathId === path.pathId;
					return (
						<button
							key={p.pathId}
							type="button"
							data-tone={level.tone}
							aria-pressed={active}
							onClick={() => {
								setPathId(p.pathId);
								setSelected(null);
							}}
							className={`flex items-center gap-2 rounded-control border px-3.5 py-1.5 text-sm transition-colors ${
								active
									? "border-(--tone) bg-(--tone-soft) font-semibold text-(--tone-ink)"
									: "border-line bg-surface text-subtle hover:border-(--tone)"
							}`}
						>
							<span className="size-2 rounded-full bg-(--tone)" />
							{level.label}
						</button>
					);
				})}
				<span className="text-sm text-muted">
					{selected
						? "Wybierz dzień, do którego przenieść trening."
						: "Kliknij trening, żeby go zaznaczyć."}
				</span>
			</div>

			{refusal && (
				<div className="mb-4">
					<Notice tone="amber" title={refusal} />
				</div>
			)}

			<div className="flex flex-col gap-4">
				{toWeeks(path.days).map((week, w) => (
					<section
						key={week[0]?.dayIndex ?? w}
						className="rounded-card border border-line bg-surface p-3 md:p-4"
					>
						<h2 className="mb-3 px-0.5 text-lg font-semibold">
							Tydzień {w + 1}
						</h2>
						<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
							{week.map((day) => (
								<DayCell
									key={day.dayIndex}
									pathId={path.pathId}
									dayIndex={day.dayIndex}
									workoutIds={day.workoutIds}
									workoutById={workoutById}
									allWorkouts={allWorkouts}
									selected={selected}
									onSelect={setSelected}
									onEdit={edit}
								/>
							))}
						</div>
					</section>
				))}
			</div>

			{!embedded && <MockControlsPanel />}
		</div>
	);
}

function HistoryButtons({ challengeId }: { challengeId: string }) {
	const history = useStore(plannerHistory)[challengeId];
	return (
		<div className="flex gap-2">
			<Button
				disabled={!history?.undo.length}
				onClick={() => undo(challengeId)}
			>
				Cofnij
			</Button>
			<Button
				disabled={!history?.redo.length}
				onClick={() => redo(challengeId)}
			>
				Ponów
			</Button>
		</div>
	);
}

function SaveStatus({ challengeId }: { challengeId: string }) {
	const status = useStore(challengeSaver.status)[challengeId];
	return <SaveStatusText status={status} />;
}

/** "paths[p-easy].days[4].workoutIds" → "dzień 4" */
function describeConflict(location: string): string {
	const day = /\.days\[(\d+)\]/.exec(location)?.[1];
	return day ? `dzień ${day}` : location;
}

function MockControlsPanel() {
	const controls = useStore(mockControls);
	const slow = controls.minLatencyMs >= 1000;
	const renameFirstWorkout = () => {
		if (!workoutsCollection.get("W1")) return;
		workoutsCollection.update("W1", (draft) => {
			draft.title = draft.title.endsWith(" ★")
				? draft.title.slice(0, -2)
				: `${draft.title} ★`;
		});
	};
	const toggleConflict = (mode: "otherField" | "sameFields") =>
		mockControls.set((c) => ({
			...c,
			conflictNextSave: c.conflictNextSave === mode ? null : mode,
		}));

	return (
		<section className="mt-8 rounded-card border border-line border-dashed p-4">
			<h2 className="text-sm font-semibold">Sterowanie danymi testowymi</h2>
			<p className="mt-1 text-xs text-muted">
				Każdy przełącznik działa na jeden najbliższy zapis.
			</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<Button
					aria-pressed={slow}
					onClick={() =>
						mockControls.set((c) => ({
							...c,
							minLatencyMs: slow ? 150 : 1500,
							maxLatencyMs: slow ? 400 : 2500,
						}))
					}
				>
					Wolny serwer: {slow ? "tak" : "nie"}
				</Button>
				<Button
					aria-pressed={controls.failNextSave}
					onClick={() =>
						mockControls.set((c) => ({ ...c, failNextSave: !c.failNextSave }))
					}
				>
					Błąd zapisu: {controls.failNextSave ? "tak" : "nie"}
				</Button>
				<Button
					aria-pressed={controls.conflictNextSave === "otherField"}
					onClick={() => toggleConflict("otherField")}
				>
					Ktoś zmienia tytuł:{" "}
					{controls.conflictNextSave === "otherField" ? "tak" : "nie"}
				</Button>
				<Button
					aria-pressed={controls.conflictNextSave === "sameFields"}
					onClick={() => toggleConflict("sameFields")}
				>
					Ktoś zmienia ten sam dzień:{" "}
					{controls.conflictNextSave === "sameFields" ? "tak" : "nie"}
				</Button>
				<Button onClick={renameFirstWorkout}>Zmień nazwę treningu W1</Button>
			</div>
		</section>
	);
}

function PlannerSkeleton() {
	return (
		<div className="mx-auto max-w-[1500px]">
			<Skeleton className="mb-6 h-8 w-64" />
			{[1, 2].map((week) => (
				<div
					key={week}
					className="mb-4 rounded-card border border-line bg-surface p-4"
				>
					<Skeleton className="mb-3 h-6 w-28" />
					<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
						{[1, 2, 3, 4, 5, 6, 7].map((day) => (
							<Skeleton key={day} className="h-40" />
						))}
					</div>
				</div>
			))}
		</div>
	);
}
