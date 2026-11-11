import { Link } from "@tanstack/react-router";
import { challengeSaver } from "@/data/collections/challenges";
import { planningSaver } from "@/data/collections/planning";
import type { SaveStatus } from "@/data/collections/saver";
import type { Challenge, Path } from "@/data/schemas/challenge";
import type { PrepStatus } from "@/data/schemas/planning";
import { PREP_LABELS } from "@/domain/planningRules";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { levelMeta, PREP_TONES } from "@/ui/enums";
import { SaveStatusText } from "@/ui/SaveStatusText";
import { Tag } from "@/ui/Tag";
import { plannerHistory, stagedSchedules } from "./plannerSession";

const RANK: Record<SaveStatus["phase"], number> = {
	conflict: 5,
	error: 5,
	saving: 4,
	dirty: 3,
	saved: 2,
	idle: 1,
};

/** One status for the two documents the planner saves: the more urgent wins. */
function combine(
	a: SaveStatus | undefined,
	b: SaveStatus | undefined,
): SaveStatus | undefined {
	if (!a) return b;
	if (!b) return a;
	if (a.phase === "saved" && b.phase === "saved") {
		return {
			phase: "saved",
			at: Math.max(a.at, b.at),
			mergedWithOthers: a.mergedWithOthers || b.mergedWithOthers,
		};
	}
	return RANK[a.phase] >= RANK[b.phase] ? a : b;
}

interface PlannerToolbarProps {
	challenge: Challenge;
	path: Path;
	planTypeName: string | null;
	prepStatus: PrepStatus;
	readOnly: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onSaveStaged: () => void;
	onDiscardStaged: () => void;
	onSettings: () => void;
}

export function PlannerToolbar({
	challenge,
	path,
	planTypeName,
	prepStatus,
	readOnly,
	onUndo,
	onRedo,
	onSaveStaged,
	onDiscardStaged,
	onSettings,
}: PlannerToolbarProps) {
	const history = useStore(plannerHistory)[challenge.id];
	const isStaged = useStore(stagedSchedules).has(challenge.id);
	const status = combine(
		useStore(challengeSaver.status)[challenge.id],
		useStore(planningSaver.status)[challenge.id],
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{challenge.paths.map((variant) => {
					const level = levelMeta(variant.levelId);
					const active = variant.pathId === path.pathId;
					return (
						<Link
							key={variant.pathId}
							to="/challenges/$challengeId/plan/$pathId"
							params={{ challengeId: challenge.id, pathId: variant.pathId }}
							data-tone={level.tone}
							aria-current={active ? "page" : undefined}
							className={`flex items-center gap-2 rounded-control border px-3.5 py-1.5 text-sm transition-colors ${
								active
									? "border-(--tone) bg-(--tone-soft) font-semibold text-(--tone-ink)"
									: "border-line bg-surface text-subtle hover:border-(--tone)"
							}`}
						>
							<span className="size-2 rounded-full bg-(--tone)" />
							{level.label}
						</Link>
					);
				})}
				<Tag tone="indigo" title="Rodzaj planu">
					{planTypeName ?? "Bez rodzaju planu"}
				</Tag>
				<Tag tone={PREP_TONES[prepStatus]} title="Stan przygotowania">
					{PREP_LABELS[prepStatus]}
				</Tag>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<SaveStatusText
					status={
						isStaged && status?.phase !== "saving" ? { phase: "dirty" } : status
					}
				/>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{!readOnly && (
						<>
							<Button
								disabled={!history?.undo.length}
								onClick={onUndo}
								title="Cofnij (Ctrl/⌘ + Z)"
							>
								Cofnij
							</Button>
							<Button
								disabled={!history?.redo.length}
								onClick={onRedo}
								title="Ponów (Ctrl/⌘ + Shift + Z)"
							>
								Ponów
							</Button>
							<Button onClick={onSettings}>Ustawienia wariantu</Button>
						</>
					)}
					{isStaged && (
						<>
							<Button onClick={onDiscardStaged}>Odrzuć zmiany</Button>
							<Button
								variant="primary"
								onClick={onSaveStaged}
								title="Zapisz (Ctrl/⌘ + S)"
							>
								Zapisz zmiany
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
