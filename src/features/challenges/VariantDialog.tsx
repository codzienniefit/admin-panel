import { useState } from "react";
import { blankPath, type Challenge, type Path } from "@/data/schemas/challenge";
import {
	blankVariantPlanning,
	PREP_STATUSES,
	type PrepStatus,
} from "@/data/schemas/planning";
import { availablePlanTypes, PREP_LABELS } from "@/domain/planningRules";
import { trainingTypeIdsOf } from "@/features/config/useConfig";
import { applyPlanningChange } from "@/features/planner/planningActions";
import { usePlanning } from "@/features/planner/usePlanning";
import { settleChange } from "@/features/saving/applyChange";
import { usePlannerSettings } from "@/features/settings/usePlannerSettings";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { levelMeta, PREP_TONES } from "@/ui/enums";
import { Field, TextAreaField, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice } from "@/ui/formIssues";
import { MultiSelect } from "@/ui/MultiSelect";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { whileBusy } from "@/ui/tasks";
import { applyChallengeChange, newPathId } from "./challengeActions";
import { useChallengeRules } from "./useChallengeRules";

interface VariantDialogProps {
	challenge: Challenge;
	/** The variant being edited; null adds a new one. */
	path: Path | null;
	onClose: () => void;
}

/** Adds a variant, or changes the settings of one. Days are edited in the plan. */
export function VariantDialog({
	challenge,
	path,
	onClose,
}: VariantDialogProps) {
	const { config, context } = useChallengeRules(challenge.id);
	const taken = new Set(
		challenge.paths
			.filter((p) => p.pathId !== path?.pathId)
			.map((p) => p.levelId),
	);
	const levelOptions = config.challengeLevels
		.filter((level) => !taken.has(level.id))
		.map((level) => ({
			value: level.id,
			label: level.title,
			tone: levelMeta(level.id).tone,
		}));

	const [levelId, setLevelId] = useState<string | null>(
		path?.levelId ?? levelOptions[0]?.value ?? null,
	);
	const [copyFrom, setCopyFrom] = useState<string | null>(null);
	const [frequency, setFrequency] = useState(String(path?.frequency ?? 3));
	const [minimumDays, setMinimumDays] = useState(
		String(path?.minimumDaysToComplete ?? 0),
	);
	const [description, setDescription] = useState(path?.description ?? "");
	const [pro, setPro] = useState(Boolean(path?.pro));
	const [difficulty, setDifficulty] = useState<string[]>(
		path?.difficultyLevelsIds ?? [],
	);
	const planning = usePlanning(challenge.id);
	const settings = usePlannerSettings();
	const planned = path ? planning?.variants[path.pathId] : undefined;
	const [planTypeId, setPlanTypeId] = useState<string | null>(
		planned?.planTypeId ?? null,
	);
	const [prepStatus, setPrepStatus] = useState<PrepStatus>(
		planned?.prepStatus ?? "not_started",
	);
	const [prepNote, setPrepNote] = useState(planned?.prepNote ?? "");
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<string[]>([]);
	const planTypes = availablePlanTypes(planning, settings);

	/** Plan type and preparation status live in the planning document. */
	const savePlanning = async (pathId: string) => {
		if (!planning) return;
		await applyPlanningChange(
			planning,
			(draft) => {
				const source = copyFrom ? draft.variants[copyFrom] : undefined;
				const variant = draft.variants[pathId] ?? {
					...blankVariantPlanning(),
					// A copied plan keeps the notes and colours of its days.
					...(source
						? structuredClone({ days: source.days, cards: source.cards })
						: {}),
				};
				variant.planTypeId = planTypeId;
				variant.prepStatus = prepStatus;
				variant.prepNote = prepStatus === "in_progress" ? prepNote.trim() : "";
				draft.variants[pathId] = variant;
			},
			trainingTypeIdsOf(config),
		);
	};

	const save = async () => {
		if (!levelId) {
			setProblems(["Wybierz poziom"]);
			return;
		}
		const settings = {
			levelId,
			frequency: Math.max(1, Number.parseInt(frequency, 10) || 1),
			minimumDaysToComplete: Math.max(0, Number.parseInt(minimumDays, 10) || 0),
			description: description.trim() || null,
			pro,
			difficultyLevelsIds: difficulty,
		};
		const pathId = path?.pathId ?? newPathId();
		setProblems([]);
		const result = await whileBusy(setBusy, () =>
			settleChange(async () => {
				const saved = await applyChallengeChange(
					challenge,
					(draft) => {
						if (path) {
							const target = draft.paths.find((p) => p.pathId === path.pathId);
							if (target) Object.assign(target, settings);
							return;
						}
						const source = draft.paths.find((p) => p.pathId === copyFrom);
						draft.paths.push({
							...blankPath(pathId, levelId, draft.lengthDays),
							...settings,
							// A real copy: the two variants must not share days.
							...(source ? { days: structuredClone(source.days) } : {}),
						});
					},
					{
						config,
						context,
						done: path ? "Wariant zapisany" : "Wariant dodany",
					},
				);
				if (saved.ok) await savePlanning(pathId);
				return saved;
			}),
		);
		// Null: held by the saver; the challenge page shows it.
		if (result && !result.ok) {
			setProblems(result.issues.map((issue) => issue.message));
			return;
		}
		onClose();
	};

	return (
		<Dialog
			open
			onClose={onClose}
			title={path ? "Ustawienia wariantu" : "Nowy wariant"}
			description="Wariant to to samo wyzwanie na jednym poziomie. Treningi w dniach układa się w planie."
			footer={
				<>
					<Button size="md" onClick={onClose}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={busy}
						onClick={() => void save()}
					>
						{busy ? "Zapisywanie…" : path ? "Zapisz" : "Dodaj wariant"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<IssuesNotice
					title="Nie można zapisać"
					issues={problems.map(generalIssue)}
				/>
				<Field
					label="Poziom"
					hint={
						path
							? "Zmiana poziomu wariantu, który ktoś już zaczął, przerwie tym osobom wyzwanie."
							: undefined
					}
				>
					{() => (
						<Select
							label="Poziom"
							options={levelOptions}
							value={levelId}
							onChange={setLevelId}
							emptyText="Wszystkie poziomy są już użyte"
							className="w-full"
						/>
					)}
				</Field>
				{!path && challenge.paths.length > 0 && (
					<Field
						label="Skopiuj dni z"
						hint="Opcjonalnie: nowy wariant zacznie z kopią planu innego wariantu."
					>
						{() => (
							<Select
								label="Skopiuj dni z"
								placeholder="Zacznij od pustego planu"
								options={challenge.paths.map((p) => ({
									value: p.pathId,
									...levelMeta(p.levelId),
								}))}
								value={copyFrom}
								onChange={setCopyFrom}
								clearable
								className="w-full"
							/>
						)}
					</Field>
				)}
				<div className="grid grid-cols-2 gap-4">
					<TextField
						label="Treningi na tydzień"
						type="number"
						min={1}
						value={frequency}
						onChange={(event) => setFrequency(event.target.value)}
					/>
					<TextField
						label="Min. dni do ukończenia"
						type="number"
						min={0}
						value={minimumDays}
						onChange={(event) => setMinimumDays(event.target.value)}
					/>
				</div>
				<TextAreaField
					label="Opis"
					rows={3}
					value={description}
					onChange={(event) => setDescription(event.target.value)}
				/>
				<Field label="Poziomy trudności">
					{() => (
						<MultiSelect
							label="Poziomy trudności"
							options={config.difficultyLevels.map((level) => ({
								value: level.id,
								label: level.title,
							}))}
							value={difficulty}
							onChange={setDifficulty}
							placeholder="Brak"
						/>
					)}
				</Field>
				<Switch
					label="PRO"
					hint="Ten wariant tylko dla wersji Pro."
					checked={pro}
					onChange={setPro}
				/>

				<div className="flex flex-col gap-4 border-line border-t pt-4">
					<p className="text-sm font-semibold">
						Planowanie
						<span className="ml-2 font-normal text-muted">
							tylko dla zespołu
						</span>
					</p>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							label="Rodzaj planu"
							hint="Decyduje, jakie wymagania sprawdza planer."
						>
							{() => (
								<Select
									label="Rodzaj planu"
									placeholder="Bez rodzaju planu"
									options={planTypes.map((type) => ({
										value: type.id,
										label: type.name,
										hint: type.description || undefined,
									}))}
									value={planTypeId}
									onChange={setPlanTypeId}
									disabled={!planning}
									clearable
									className="w-full"
								/>
							)}
						</Field>
						<Field label="Stan przygotowania">
							{() => (
								<Select
									label="Stan przygotowania"
									options={PREP_STATUSES.map((value) => ({
										value,
										label: PREP_LABELS[value],
										tone: PREP_TONES[value],
									}))}
									value={prepStatus}
									onChange={(value) => {
										if (value) setPrepStatus(value);
									}}
									disabled={!planning}
									className="w-full"
								/>
							)}
						</Field>
					</div>
					{prepStatus === "in_progress" && (
						<TextAreaField
							label="Czego brakuje do gotowości"
							rows={2}
							value={prepNote}
							onChange={(event) => setPrepNote(event.target.value)}
						/>
					)}
				</div>
			</div>
		</Dialog>
	);
}
