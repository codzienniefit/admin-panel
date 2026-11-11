import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { errorMessage } from "@/data/api/errors";
import { createWorkout, workoutsCollection } from "@/data/collections/workouts";
import { blankWorkout } from "@/data/schemas/workout";
import { searchWorkouts } from "@/domain/workoutSearch";
import { useConfig } from "@/features/config/useConfig";
import { MediaImage } from "@/features/media/MediaImage";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { STATUS_META, trainingTypeMeta } from "@/ui/enums";
import { TextField } from "@/ui/Field";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { Switch } from "@/ui/Switch";
import { Tag } from "@/ui/Tag";
import { attempt } from "@/ui/tasks";
import { workoutFormat } from "@/ui/WorkoutCard";

interface AddWorkoutDialogProps {
	/** Where the workout goes, in words: "dzień 4" or "brudnopis". */
	targetLabel: string;
	/** Workouts already there; they are shown but cannot be added again. */
	presentIds: ReadonlySet<string>;
	/** False once the target cannot take another workout. */
	hasRoom: boolean;
	/** Returns why the workout was refused, or null when it was added. */
	onPick: (workoutId: string) => string | null;
	onClose: () => void;
}

const DEFAULT_MIN = 5;
const DEFAULT_MAX = 70;

/**
 * Picks workouts from the catalogue, or creates a draft workout on the spot
 * for something that is not recorded yet. Stays open, so several can be added.
 */
export function AddWorkoutDialog({
	targetLabel,
	presentIds,
	hasRoom,
	onPick,
	onClose,
}: AddWorkoutDialogProps) {
	const config = useConfig().workouts;
	const { data: workouts } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const [query, setQuery] = useState("");
	const [byDuration, setByDuration] = useState(false);
	const [minMinutes, setMinMinutes] = useState(String(DEFAULT_MIN));
	const [maxMinutes, setMaxMinutes] = useState(String(DEFAULT_MAX));
	const [typeIds, setTypeIds] = useState<string[]>([]);
	const [creating, setCreating] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const results = searchWorkouts(workouts ?? [], {
		query,
		typeIds,
		...(byDuration
			? {
					minMinutes: Number(minMinutes) || 0,
					maxMinutes: Number(maxMinutes) || Number.POSITIVE_INFINITY,
				}
			: {}),
	});

	const pick = (workoutId: string) => setProblem(onPick(workoutId));

	return (
		<Dialog
			open
			onClose={onClose}
			title="Dodaj trening"
			description={`Cel: ${targetLabel}. Okno zostaje otwarte, można dodać kilka.`}
			size="lg"
			footer={
				<Button size="md" variant="primary" onClick={onClose}>
					Gotowe
				</Button>
			}
		>
			<div className="flex flex-col gap-3">
				{problem && <Notice tone="amber" role="alert" title={problem} />}
				{!hasRoom && (
					<Notice
						tone="blue"
						title={`Nic więcej się tu nie zmieści: ${targetLabel}`}
					/>
				)}

				<div className="grid gap-3 md:grid-cols-[1fr_16rem]">
					<TextField
						label="Szukaj w katalogu"
						placeholder="np. brzuch, joga, W12"
						autoFocus
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<div className="flex flex-col gap-1.5">
						<span className="text-sm font-semibold">Typ</span>
						<MultiSelect
							label="Typ treningu"
							options={config.trainingTypes.map((type) => ({
								value: type.id,
								label: type.title,
								tone: trainingTypeMeta(type.id).tone,
							}))}
							value={typeIds}
							onChange={setTypeIds}
							placeholder="Wszystkie"
						/>
					</div>
				</div>

				<div className="flex flex-wrap items-end gap-3">
					<Switch
						label="Filtruj po czasie"
						checked={byDuration}
						onChange={setByDuration}
					/>
					{byDuration && (
						<div className="flex items-end gap-2">
							<div className="w-24">
								<TextField
									label="Od (min)"
									type="number"
									min={0}
									value={minMinutes}
									onChange={(event) => setMinMinutes(event.target.value)}
								/>
							</div>
							<div className="w-24">
								<TextField
									label="Do (min)"
									type="number"
									min={0}
									value={maxMinutes}
									onChange={(event) => setMaxMinutes(event.target.value)}
								/>
							</div>
						</div>
					)}
					<span className="ml-auto text-sm text-muted">
						Wyników: {results.length}
					</span>
				</div>

				{workouts === undefined ? (
					<p className="py-8 text-center text-sm text-muted">Wczytywanie…</p>
				) : results.length === 0 ? (
					<p className="rounded-cell bg-bg px-3 py-8 text-center text-sm text-muted">
						Nic nie pasuje. Zmień wyszukiwanie albo utwórz szkic treningu
						poniżej.
					</p>
				) : (
					<ul className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto pr-1">
						{results.map((workout) => {
							const present = presentIds.has(workout.id);
							return (
								<li key={workout.id}>
									<button
										type="button"
										disabled={present || !hasRoom}
										onClick={() => pick(workout.id)}
										className="flex w-full items-center gap-3 rounded-cell border border-line bg-surface p-2 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-55"
									>
										<MediaImage
											path={workout.imageRelativePath}
											placeholder="brak"
											className="aspect-video w-20 shrink-0 rounded-chip"
											imageClassName="bg-hover object-cover"
											placeholderClassName="bg-bg text-[10px] text-muted"
										/>
										<span className="min-w-0 flex-1">
											<span className="line-clamp-1 text-sm font-medium">
												{workout.title || "Bez nazwy"}
											</span>
											<span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
												<span>{workout.id}</span>
												<span>· {workout.durationMinutes} min</span>
												<span>· {workoutFormat(workout)}</span>
												{workout.trainingTypeIds.map((id) => {
													const type = trainingTypeMeta(id);
													return (
														<Tag key={id} tone={type.tone} variant="dot">
															{type.label}
														</Tag>
													);
												})}
												{workout.status !== "published" && (
													<Tag tone={STATUS_META[workout.status].tone}>
														{STATUS_META[workout.status].label}
													</Tag>
												)}
											</span>
										</span>
										<span className="shrink-0 text-xs font-semibold text-primary">
											{present ? "już jest" : "Dodaj"}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}

				{creating ? (
					<DraftWorkoutForm
						suggestedTitle={query}
						onCreated={(workoutId) => {
							setCreating(false);
							pick(workoutId);
						}}
						onCancel={() => setCreating(false)}
					/>
				) : (
					<div className="flex flex-wrap items-center gap-3 border-line border-t pt-3">
						<p className="text-sm text-muted">
							Treningu jeszcze nie ma w katalogu?
						</p>
						<Button disabled={!hasRoom} onClick={() => setCreating(true)}>
							Utwórz szkic treningu
						</Button>
					</div>
				)}
			</div>
		</Dialog>
	);
}

/** A workout that only has a name so far: enough to plan with. */
function DraftWorkoutForm({
	suggestedTitle,
	onCreated,
	onCancel,
}: {
	suggestedTitle: string;
	onCreated: (workoutId: string) => void;
	onCancel: () => void;
}) {
	const config = useConfig().workouts;
	const [title, setTitle] = useState(suggestedTitle.trim());
	const [minutes, setMinutes] = useState("20");
	const [typeIds, setTypeIds] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const create = async () => {
		if (!title.trim()) {
			setProblem("Nazwa jest wymagana");
			return;
		}
		setBusy(true);
		setProblem(null);
		const created = await attempt(() =>
			createWorkout({
				...blankWorkout(),
				title: title.trim(),
				durationMinutes: Math.max(0, Math.round(Number(minutes)) || 0),
				trainingTypeIds: typeIds,
			}),
		);
		if (!created.ok) {
			setProblem(
				errorMessage(created.error, "Nie udało się utworzyć treningu"),
			);
			setBusy(false);
			return;
		}
		onCreated(created.value.id);
	};

	return (
		<div className="flex flex-col gap-3 rounded-cell border border-line bg-bg p-3">
			<p className="text-sm font-semibold">Nowy szkic treningu</p>
			{problem && <Notice tone="red" role="alert" title={problem} />}
			<div className="grid gap-3 md:grid-cols-[1fr_7rem_14rem]">
				<TextField
					label="Nazwa"
					required
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<TextField
					label="Minuty"
					type="number"
					min={0}
					value={minutes}
					onChange={(event) => setMinutes(event.target.value)}
				/>
				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-semibold">Typ</span>
					<MultiSelect
						label="Typ treningu"
						options={config.trainingTypes.map((type) => ({
							value: type.id,
							label: type.title,
							tone: trainingTypeMeta(type.id).tone,
						}))}
						value={typeIds}
						onChange={setTypeIds}
						placeholder="Wybierz"
					/>
				</div>
			</div>
			<p className="text-xs text-muted">
				Szkic trafi do katalogu treningów. Resztę (nagranie, miniaturkę, opis)
				uzupełnisz tam później; wyzwania nie da się opublikować, dopóki trening
				jest szkicem.
			</p>
			<div className="flex justify-end gap-2">
				<Button onClick={onCancel} disabled={busy}>
					Anuluj
				</Button>
				<Button variant="primary" onClick={() => void create()} disabled={busy}>
					{busy ? "Tworzenie…" : "Utwórz i dodaj"}
				</Button>
			</div>
		</div>
	);
}
