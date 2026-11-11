import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
} from "@dnd-kit/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { challengesCollection } from "@/data/collections/challenges";
import { planningSaver } from "@/data/collections/planning";
import { workoutsCollection } from "@/data/collections/workouts";
import type { Challenge } from "@/data/schemas/challenge";
import { blankVariantPlanning } from "@/data/schemas/planning";
import { addDays, dayOfInstant } from "@/domain/calendarDates";
import { challengeIssues } from "@/domain/challengeRules";
import {
	addToScratchpadStep,
	addWorkoutStep,
	cardPlanningOf,
	dayPlanningOf,
	moveDayNoteStep,
	moveWorkoutStep,
	type PlannerState,
	type PlannerStep,
	removeFromScratchpadStep,
	removeWorkoutStep,
	setCardStep,
	setDayStep,
	toScratchpadStep,
} from "@/domain/plannerOps";
import { availablePlanTypes, resolveConditions } from "@/domain/planningRules";
import { MAX_WORKOUTS_PER_DAY, toWeeks } from "@/domain/schedule";
import { validateWeek, type WeekInput } from "@/domain/weekValidation";
import { markUnsaved } from "@/features/challenges/challengeActions";
import { useChallengeRules } from "@/features/challenges/useChallengeRules";
import { VariantDialog } from "@/features/challenges/VariantDialog";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { usePlannerSettings } from "@/features/settings/usePlannerSettings";
import { useStore } from "@/lib/store";
import { useDragSensors } from "@/lib/useDragSensors";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta, trainingTypeMeta } from "@/ui/enums";
import { TextAreaField } from "@/ui/Field";
import { generalIssue, IssuesNotice } from "@/ui/formIssues";
import { Menu } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { toast } from "@/ui/toast";
import { WorkoutCard } from "@/ui/WorkoutCard";
import { AddWorkoutDialog } from "./AddWorkoutDialog";
import { DetailsDialog } from "./DetailsDialog";
import type { DragSource, DropTarget } from "./dragTypes";
import { MoveDialog } from "./MoveDialog";
import { type DayHandlers, PlannerDay } from "./PlannerDay";
import { PlannerToolbar } from "./PlannerToolbar";
import {
	discardStaged,
	dispatchStep,
	editPlanning,
	plannerClipboard,
	redo,
	saveStaged,
	stagedSchedules,
	undo,
} from "./plannerSession";
import { rememberPlan, useRecentPlans } from "./recentPlans";
import { Scratchpad } from "./Scratchpad";
import { usePlanning } from "./usePlanning";
import { WeekSection } from "./WeekSection";

type DialogState =
	| {
			kind: "add";
			target: { kind: "day"; dayIndex: number } | { kind: "scratchpad" };
	  }
	| { kind: "day"; dayIndex: number }
	| { kind: "card"; dayIndex: number; workoutId: string }
	| { kind: "move"; dayIndex: number; index: number }
	| { kind: "variant" }
	| null;

interface PlannerPageProps {
	challenge: Challenge;
	pathId: string;
	/** The week shown on a phone, from 1. Wider screens show every week. */
	week: number;
	onWeekChange: (week: number) => void;
	onOpenWorkout: (workoutId: string) => void;
	onOpenPlan: (challengeId: string, pathId: string) => void;
}

const scopeLabel = (scope: string) =>
	scope === "all" ? "wszystkie treningi" : trainingTypeMeta(scope).label;

const isTyping = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The plan of one variant: weeks of seven days, the scratchpad, the notes. */
export function PlannerPage({
	challenge,
	pathId,
	week,
	onWeekChange,
	onOpenWorkout,
	onOpenPlan,
}: PlannerPageProps) {
	const planning = usePlanning(challenge.id);
	const settings = usePlannerSettings();
	const { config, context } = useChallengeRules(challenge.id);
	const { data: workouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const { data: challenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	const clipboard = useStore(plannerClipboard);
	const isStaged = useStore(stagedSchedules).has(challenge.id);
	const recent = useRecentPlans();
	const [dialog, setDialog] = useState<DialogState>(null);
	const [dragging, setDragging] = useState<DragSource | null>(null);
	const [saveProblems, setSaveProblems] = useState<string[]>([]);
	const sensors = useDragSensors();

	const path = challenge.paths.find((p) => p.pathId === pathId);
	const pathExists = path !== undefined;
	const challengeId = challenge.id;
	const readOnly = challenge.status === "deleted";

	useEffect(() => {
		if (pathExists) rememberPlan(challengeId, pathId);
	}, [challengeId, pathId, pathExists]);

	// The challenge header's status actions wait while changes are staged.
	useEffect(() => {
		markUnsaved(challengeId, isStaged);
		return () => markUnsaved(challengeId, false);
	}, [challengeId, isStaged]);

	const refuse = (reason: string | null) => {
		if (reason) toast({ title: reason, tone: "amber" });
	};

	const saveSchedule = async () => {
		// Checked here first: a refusal from the server would drop the staged
		// changes, and these rules are the same ones the server applies.
		const issues = challengeIssues(challenge, config, context);
		if (issues.length > 0) {
			setSaveProblems(issues.map((issue) => issue.message));
			return;
		}
		setSaveProblems([]);
		const sure = await confirm({
			title: "Zapisać zmiany w planie?",
			description:
				challenge.status === "published"
					? "Wyzwanie jest opublikowane: zmiany będą od razu widoczne w aplikacji."
					: "Wyzwanie jest ukryte: zmiany zobaczą osoby, które już je zaczęły.",
			confirmLabel: "Zapisz zmiany",
		});
		if (!sure) return;
		// A rule only the server knows: the changes stay staged, with its reasons.
		const refused = await saveStaged(challengeId);
		if (refused) setSaveProblems(refused.map((issue) => issue.message));
	};

	const discardSchedule = async () => {
		const sure = await confirm({
			title: "Odrzucić zmiany w planie?",
			description: "Plan wróci do ostatniej zapisanej wersji.",
			confirmLabel: "Odrzuć zmiany",
			destructive: true,
		});
		if (sure) {
			discardStaged(challengeId);
			setSaveProblems([]);
		}
	};

	// Keyboard shortcuts. Inside a text field the keys keep their usual
	// meaning: Ctrl+Z there undoes typing, not the plan.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key === "s") {
				event.preventDefault();
				if (stagedSchedules.get().has(challengeId)) {
					document.getElementById("planner-save")?.click();
				}
				return;
			}
			if (key !== "z" || isTyping(event.target)) return;
			event.preventDefault();
			const reason = event.shiftKey ? redo(challengeId) : undo(challengeId);
			if (reason) toast({ title: reason, tone: "amber" });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [challengeId]);

	// Staged changes are lost when leaving, so leaving asks first. Moving
	// between the variants of the same challenge keeps them.
	useBlocker({
		disabled: !isStaged,
		enableBeforeUnload: isStaged,
		shouldBlockFn: async ({ next }) => {
			if (next.pathname.startsWith(`/challenges/${challengeId}/plan/`)) {
				return false;
			}
			const leave = await confirm({
				title: "Porzucić niezapisane zmiany planu?",
				description:
					"Zmiany w planie tego wyzwania nie zostały zapisane i przepadną.",
				confirmLabel: "Porzuć zmiany",
				cancelLabel: "Zostań",
				destructive: true,
			});
			if (leave) discardStaged(challengeId);
			return !leave;
		},
	});

	if (!path) {
		return (
			<EmptyState
				title="Nie ma takiego wariantu"
				action={
					<Link
						to="/challenges/$challengeId"
						params={{ challengeId }}
						className="text-primary hover:underline"
					>
						Wróć do przeglądu wyzwania
					</Link>
				}
			>
				Wariant mógł zostać usunięty.
			</EmptyState>
		);
	}

	const state: PlannerState = { paths: challenge.paths, planning };
	const act = (step: PlannerStep) => refuse(dispatchStep(challengeId, step));
	const workoutById = new Map((workouts ?? []).map((w) => [w.id, w]));
	const titleOf = (workoutId: string) =>
		workoutById.get(workoutId)?.title || workoutId;
	const dayOf = (dayIndex: number) =>
		path.days.find((day) => day.dayIndex === dayIndex);

	const variantPlanning = planning?.variants[path.pathId];
	const planType = availablePlanTypes(planning, settings).find(
		(type) => type.id === variantPlanning?.planTypeId,
	);
	const conditions = resolveConditions(planning, planType);
	const weeks = toWeeks(path.days);
	const weekInputs: WeekInput[] = weeks.map((days) =>
		days.map((day) => ({
			workouts: day.workoutIds.map((id) => ({
				typeIds: workoutById.get(id)?.trainingTypeIds ?? [],
			})),
		})),
	);
	const activeWeek = Math.min(Math.max(1, week), Math.max(1, weeks.length));
	const start = dayOfInstant(challenge.liveAtUtc);
	const level = levelMeta(path.levelId);

	const handlers: DayHandlers = {
		add: (dayIndex) =>
			setDialog({ kind: "add", target: { kind: "day", dayIndex } }),
		paste: (dayIndex) => {
			if (clipboard)
				act(addWorkoutStep(state, path.pathId, dayIndex, clipboard));
		},
		details: (dayIndex) => setDialog({ kind: "day", dayIndex }),
		clear: (dayIndex) => {
			const count = dayOf(dayIndex)?.workoutIds.length ?? 0;
			// From the last one down, so each position is still right when used.
			act(
				Array.from({ length: count }, (_, i) => count - 1 - i).flatMap(
					(index) => removeWorkoutStep(state, path.pathId, { dayIndex, index }),
				),
			);
		},
		cardDetails: (dayIndex, workoutId) =>
			setDialog({ kind: "card", dayIndex, workoutId }),
		cardMove: (dayIndex, index) => setDialog({ kind: "move", dayIndex, index }),
		cardCopy: (workoutId) => {
			plannerClipboard.set(workoutId);
			toast({
				title: "Skopiowano trening",
				description: "Wklej go z menu „⋯” dowolnego dnia.",
			});
		},
		cardToScratchpad: (dayIndex, index) =>
			act(toScratchpadStep(state, path.pathId, { dayIndex, index })),
		cardShift: (dayIndex, index, by) =>
			act(
				moveWorkoutStep(
					state,
					path.pathId,
					{ dayIndex, index },
					{ dayIndex, index: index + by },
				),
			),
		cardRemove: (dayIndex, index) =>
			act(removeWorkoutStep(state, path.pathId, { dayIndex, index })),
		cardOpen: onOpenWorkout,
	};

	const moveNote = async (fromDay: number, toDay: number) => {
		if (fromDay === toDay) return;
		if (dayPlanningOf(planning, path.pathId, toDay)?.note) {
			const sure = await confirm({
				title: `Zastąpić notatkę dnia ${toDay}?`,
				description: "Ten dzień ma już notatkę. Przeniesiona ją zastąpi.",
				confirmLabel: "Zastąp",
			});
			if (!sure) return;
		}
		act(moveDayNoteStep(state, path.pathId, fromDay, toDay));
	};

	const onDragStart = (event: DragStartEvent) =>
		setDragging((event.active.data.current as DragSource | undefined) ?? null);

	const onDragEnd = (event: DragEndEvent) => {
		setDragging(null);
		const source = event.active.data.current as DragSource | undefined;
		const target = event.over?.data.current as DropTarget | undefined;
		if (!source || !target) return;

		if (source.kind === "note") {
			if (target.kind === "day")
				void moveNote(source.dayIndex, target.dayIndex);
			return;
		}
		if (source.kind === "scratch") {
			// Scratchpad → day copies: the workout stays in the scratchpad.
			if (target.kind === "day") {
				act(
					addWorkoutStep(state, path.pathId, target.dayIndex, source.workoutId),
				);
			}
			return;
		}
		const from = { dayIndex: source.dayIndex, index: source.index };
		if (target.kind === "scratchpad") {
			act(toScratchpadStep(state, path.pathId, from));
		} else if (target.dayIndex !== source.dayIndex) {
			act(
				moveWorkoutStep(state, path.pathId, from, {
					dayIndex: target.dayIndex,
					index: dayOf(target.dayIndex)?.workoutIds.length ?? 0,
				}),
			);
		}
	};

	const otherRecent = recent
		.filter(
			(plan) => plan.challengeId !== challengeId || plan.pathId !== pathId,
		)
		.flatMap((plan) => {
			const other = (challenges ?? []).find((c) => c.id === plan.challengeId);
			const otherPath = other?.paths.find((p) => p.pathId === plan.pathId);
			return other && otherPath
				? [
						{
							label: `${other.title || other.id} · ${levelMeta(otherPath.levelId).label}`,
							onSelect: () => onOpenPlan(plan.challengeId, plan.pathId),
						},
					]
				: [];
		});

	const moving =
		dialog?.kind === "move"
			? dayOf(dialog.dayIndex)?.workoutIds[dialog.index]
			: undefined;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="text-lg font-semibold">Plan: {level.label}</h2>
				{otherRecent.length > 0 && (
					<Menu
						label="Ostatnio otwierane plany"
						trigger="Ostatnio otwierane ▾"
						triggerClassName="rounded-control px-2 py-1 text-sm text-muted hover:bg-hover hover:text-ink"
						actions={otherRecent}
						align="start"
					/>
				)}
			</div>

			<PlannerToolbar
				challenge={challenge}
				path={path}
				planTypeName={planType?.name ?? null}
				prepStatus={variantPlanning?.prepStatus ?? "not_started"}
				readOnly={readOnly}
				onUndo={() => refuse(undo(challengeId))}
				onRedo={() => refuse(redo(challengeId))}
				onSaveStaged={() => void saveSchedule()}
				onDiscardStaged={() => void discardSchedule()}
				onSettings={() => setDialog({ kind: "variant" })}
			/>
			{/* Target of the Ctrl+S shortcut, so it runs the same checks as the button. */}
			<button
				id="planner-save"
				type="button"
				hidden
				tabIndex={-1}
				onClick={() => void saveSchedule()}
			/>

			{readOnly && (
				<Notice tone="grey" title="Wyzwanie jest w koszu">
					Plan jest tylko do odczytu. Przywróć wyzwanie, żeby go zmieniać.
				</Notice>
			)}
			{!readOnly && challenge.status !== "draft" && (
				<Notice
					tone="blue"
					title={
						challenge.status === "published"
							? "Wyzwanie jest opublikowane"
							: "Wyzwanie jest ukryte"
					}
				>
					Zmiany w dniach zapisują się dopiero po kliknięciu „Zapisz zmiany”, bo
					od razu trafiają do aplikacji. Notatki, kolory i brudnopis zapisują
					się same.
				</Notice>
			)}
			<IssuesNotice
				title="Nie można zapisać planu"
				issues={saveProblems.map(generalIssue)}
			/>
			<HeldEditsNotice
				saver={planningSaver}
				id={challengeId}
				describe={describePlanningConflict}
			/>

			{planning && (
				<TextAreaField
					key={path.pathId}
					label="Notatki do planu"
					rows={3}
					maxLength={5000}
					placeholder="Założenia, co jeszcze trzeba nagrać, uwagi do kolejności…"
					hint="Tylko dla zespołu. Zapisują się same."
					disabled={readOnly}
					defaultValue={variantPlanning?.notes ?? ""}
					onChange={(event) => {
						const text = event.target.value;
						editPlanning(challengeId, (draft) => {
							const variant =
								draft.variants[path.pathId] ?? blankVariantPlanning();
							variant.notes = text;
							draft.variants[path.pathId] = variant;
						});
					}}
				/>
			)}

			{weeks.length > 1 && (
				<div className="sticky top-14 z-20 flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-2 py-1.5 md:hidden">
					<Button
						disabled={activeWeek <= 1}
						onClick={() => onWeekChange(activeWeek - 1)}
						aria-label="Poprzedni tydzień"
					>
						‹
					</Button>
					<span className="text-sm font-semibold">
						Tydzień {activeWeek} z {weeks.length}
					</span>
					<Button
						disabled={activeWeek >= weeks.length}
						onClick={() => onWeekChange(activeWeek + 1)}
						aria-label="Następny tydzień"
					>
						›
					</Button>
				</div>
			)}

			<DndContext
				sensors={sensors}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragging(null)}
			>
				{weeks.map((days, w) => {
					const input = weekInputs[w] ?? [];
					const result = validateWeek(
						input,
						conditions,
						{ prev: weekInputs[w - 1], next: weekInputs[w + 1] },
						scopeLabel,
					);
					return (
						<WeekSection
							key={days[0]?.dayIndex ?? w}
							number={w + 1}
							workouts={result.total}
							minutes={days.reduce(
								(sum, day) =>
									sum +
									day.workoutIds.reduce(
										(inner, id) =>
											inner + (workoutById.get(id)?.durationMinutes ?? 0),
										0,
									),
								0,
							)}
							result={result}
							hiddenOnPhone={w + 1 !== activeWeek}
						>
							{days.map((day) => (
								<PlannerDay
									key={day.dayIndex}
									dayIndex={day.dayIndex}
									date={start ? addDays(start, day.dayIndex - 1) : null}
									workoutIds={day.workoutIds}
									workoutById={workoutById}
									planning={dayPlanningOf(planning, path.pathId, day.dayIndex)}
									cardOf={(workoutId) =>
										cardPlanningOf(
											planning,
											path.pathId,
											day.dayIndex,
											workoutId,
										)
									}
									clipboardTitle={clipboard ? titleOf(clipboard) : null}
									readOnly={readOnly}
									handlers={handlers}
								/>
							))}
						</WeekSection>
					);
				})}

				<Scratchpad
					workoutIds={planning?.scratchpad ?? []}
					workoutById={workoutById}
					readOnly={readOnly}
					onAdd={() =>
						setDialog({ kind: "add", target: { kind: "scratchpad" } })
					}
					onRemove={(workoutId) =>
						act(removeFromScratchpadStep(state, workoutId))
					}
					onCopy={handlers.cardCopy}
					onOpen={onOpenWorkout}
				/>

				<DragOverlay dropAnimation={null}>
					{dragging?.kind === "note" ? (
						<div
							data-tone="amber"
							className="max-w-48 rounded-chip bg-(--tone-soft) px-2 py-1 text-[11px] text-(--tone-ink) shadow-menu"
						>
							📝 {dayPlanningOf(planning, path.pathId, dragging.dayIndex)?.note}
						</div>
					) : dragging ? (
						<WorkoutCard
							workout={workoutById.get(dragging.workoutId)}
							fallbackTitle={dragging.workoutId}
							className="w-48 shadow-menu"
						/>
					) : null}
				</DragOverlay>
			</DndContext>

			{dialog?.kind === "add" && (
				<AddWorkoutDialog
					targetLabel={
						dialog.target.kind === "day"
							? `dzień ${dialog.target.dayIndex}`
							: "brudnopis"
					}
					presentIds={
						new Set(
							dialog.target.kind === "day"
								? (dayOf(dialog.target.dayIndex)?.workoutIds ?? [])
								: (planning?.scratchpad ?? []),
						)
					}
					hasRoom={
						dialog.target.kind !== "day" ||
						(dayOf(dialog.target.dayIndex)?.workoutIds.length ?? 0) <
							MAX_WORKOUTS_PER_DAY
					}
					onPick={(workoutId) =>
						dispatchStep(
							challengeId,
							dialog.target.kind === "day"
								? addWorkoutStep(
										state,
										path.pathId,
										dialog.target.dayIndex,
										workoutId,
									)
								: addToScratchpadStep(state, workoutId),
						)
					}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "day" && (
				<DetailsDialog
					title={`Dzień ${dialog.dayIndex}`}
					note={
						dayPlanningOf(planning, path.pathId, dialog.dayIndex)?.note ?? ""
					}
					color={
						dayPlanningOf(planning, path.pathId, dialog.dayIndex)?.tint ?? null
					}
					colorLabel="Kolor dnia"
					onSave={({ note, color }) =>
						act(
							setDayStep(state, path.pathId, dialog.dayIndex, {
								note,
								tint: color ?? "",
							}),
						)
					}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "card" && (
				<DetailsDialog
					title={titleOf(dialog.workoutId)}
					description={`Dzień ${dialog.dayIndex}. Dotyczy tylko tego miejsca w planie.`}
					note={
						cardPlanningOf(
							planning,
							path.pathId,
							dialog.dayIndex,
							dialog.workoutId,
						)?.note ?? ""
					}
					color={
						cardPlanningOf(
							planning,
							path.pathId,
							dialog.dayIndex,
							dialog.workoutId,
						)?.color ?? null
					}
					colorLabel="Kolor karty"
					onSave={({ note, color }) =>
						act(
							setCardStep(
								state,
								path.pathId,
								dialog.dayIndex,
								dialog.workoutId,
								{ note, color: color ?? "" },
							),
						)
					}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "move" && moving && (
				<MoveDialog
					workoutTitle={titleOf(moving)}
					workoutId={moving}
					fromDay={dialog.dayIndex}
					days={path.days}
					onMove={(toDay) =>
						act(
							moveWorkoutStep(
								state,
								path.pathId,
								{ dayIndex: dialog.dayIndex, index: dialog.index },
								{
									dayIndex: toDay,
									index: dayOf(toDay)?.workoutIds.length ?? 0,
								},
							),
						)
					}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "variant" && (
				<VariantDialog
					challenge={challenge}
					path={path}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}

/** "variants.p-easy.days.4.note" → "notatka dnia 4" */
function describePlanningConflict(location: string): string {
	if (location.startsWith("scratchpad")) return "brudnopis";
	const day = /\.days\.(\d+)/.exec(location)?.[1];
	if (day) return `notatka lub kolor dnia ${day}`;
	const card = /\.cards\.(\d+):/.exec(location)?.[1];
	if (card) return `notatka lub kolor treningu w dniu ${card}`;
	if (location.endsWith(".notes")) return "notatki do planu";
	if (location === "note") return "notatka wyzwania";
	return location;
}
