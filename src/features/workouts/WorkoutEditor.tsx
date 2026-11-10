import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import { badgesCollection } from "@/data/collections/badges";
import { challengesCollection } from "@/data/collections/challenges";
import {
	createWorkout,
	workoutSaver,
	workoutsCollection,
} from "@/data/collections/workouts";
import type { ContentStatus } from "@/data/schemas/challenge";
import {
	blankWorkout,
	type NewWorkout,
	type Workout,
} from "@/data/schemas/workout";
import { formatDateTime } from "@/domain/dates";
import { deepEqual } from "@/domain/rebase";
import { challengesUsing } from "@/domain/workoutFilters";
import { workoutIssues } from "@/domain/workoutRules";
import { useConfig } from "@/features/config/useConfig";
import { ContentField } from "@/features/content/ContentField";
import { MediaField } from "@/features/media/MediaField";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { DateTimeField } from "@/ui/DateTimeField";
import { Dialog } from "@/ui/Dialog";
import { levelMeta, trainingTypeMeta } from "@/ui/enums";
import { Field, TextField } from "@/ui/Field";
import { Menu, type MenuAction } from "@/ui/Menu";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { Skeleton } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { Switch } from "@/ui/Switch";
import { toast } from "@/ui/toast";

/** The fields the form edits. Everything else on a workout passes through. */
type FormValues = Pick<
	NewWorkout,
	| "title"
	| "internalTitle"
	| "pro"
	| "durationMinutes"
	| "levelId"
	| "equipmentIds"
	| "trainingTypeIds"
	| "videoUrl"
	| "audioRelativePath"
	| "imageRelativePath"
	| "badgeId"
	| "addedAtUtc"
	| "liveAtUtc"
	| "availableAtUtc"
	| "descriptionFancyContent"
>;

const FIELDS: ReadonlyArray<keyof FormValues> = [
	"title",
	"internalTitle",
	"pro",
	"durationMinutes",
	"levelId",
	"equipmentIds",
	"trainingTypeIds",
	"videoUrl",
	"audioRelativePath",
	"imageRelativePath",
	"badgeId",
	"addedAtUtc",
	"liveAtUtc",
	"availableAtUtc",
	"descriptionFancyContent",
];

const FIELD_LABELS: Record<string, string> = {
	title: "Nazwa",
	internalTitle: "Komentarz",
	pro: "Płatny",
	durationMinutes: "Czas",
	levelId: "Poziom",
	equipmentIds: "Sprzęt",
	trainingTypeIds: "Typ",
	videoUrl: "Link",
	audioRelativePath: "Audio",
	imageRelativePath: "Miniaturka",
	badgeId: "Odznaka",
	addedAtUtc: "Data dodania",
	liveAtUtc: "Data live",
	availableAtUtc: "Data premiery",
	descriptionFancyContent: "Opis",
	status: "Status",
};

function pickFields(source: NewWorkout): FormValues {
	const values = {} as Record<string, unknown>;
	for (const field of FIELDS) values[field] = source[field];
	return values as FormValues;
}

/** What the form holds, in the shape that is stored. */
function normalise(values: FormValues): FormValues {
	const blank = (text: string | null) => text?.trim() || null;
	return {
		...values,
		title: values.title.trim(),
		internalTitle: blank(values.internalTitle),
		videoUrl: blank(values.videoUrl),
		durationMinutes: Number(values.durationMinutes) || 0,
	};
}

interface WorkoutEditorProps {
	/** null creates a new workout. */
	workoutId: string | null;
	onClose: () => void;
	/** Called with the id the server gave a new workout. */
	onCreated: (workoutId: string) => void;
}

export function WorkoutEditor({
	workoutId,
	onClose,
	onCreated,
}: WorkoutEditorProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const workout = workoutId
		? (data?.find((item) => item.id === workoutId) ?? null)
		: null;

	if (workoutId && !workout) {
		return (
			<Dialog
				open
				onOpenChange={(open) => !open && onClose()}
				title={isLoading ? "Wczytywanie…" : "Nie ma takiego treningu"}
				description={
					isLoading
						? undefined
						: `Trening ${workoutId} nie istnieje albo został usunięty na stałe.`
				}
				size="lg"
			>
				{isLoading && (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-10" />
						<Skeleton className="h-10" />
						<Skeleton className="h-24" />
					</div>
				)}
			</Dialog>
		);
	}

	return (
		<WorkoutForm
			// A different workout is a different form.
			key={workout?.id ?? "new"}
			workout={workout}
			onClose={onClose}
			onCreated={onCreated}
		/>
	);
}

interface WorkoutFormProps {
	workout: Workout | null;
	onClose: () => void;
	onCreated: (workoutId: string) => void;
}

function WorkoutForm({ workout, onClose, onCreated }: WorkoutFormProps) {
	const config = useConfig().workouts;
	const { data: badges } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const { data: challenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});

	const [base] = useState<NewWorkout>(() => workout ?? blankWorkout());
	const form = useForm<FormValues>({ defaultValues: pickFields(base) });
	const { control, register, formState } = form;
	const [busy, setBusy] = useState(false);
	const [statusProblem, setStatusProblem] = useState<string | null>(null);

	const status: ContentStatus = workout?.status ?? "draft";
	const isDeleted = status === "deleted";
	const usedIn = workout ? challengesUsing(challenges ?? [], workout.id) : [];
	const assignableBadges = (badges ?? []).filter(
		(badge) => badge.type === "normal" && !badge.isHidden,
	);
	const badgeIds = new Set(assignableBadges.map((badge) => badge.id));
	const minMinutes = Math.round(config.duration.fromSeconds / 60);
	const maxMinutes = Math.round(config.duration.toSeconds / 60);

	const showIssues = (issues: readonly ApiIssue[]) => {
		setStatusProblem(null);
		for (const issue of issues) {
			if (FIELDS.includes(issue.path as keyof FormValues)) {
				form.setError(issue.path as keyof FormValues, {
					message: issue.message,
				});
			} else {
				setStatusProblem(issue.message);
			}
		}
	};

	/** Saves the form's fields together with a status. */
	const save = async (nextStatus: ContentStatus) => {
		form.clearErrors();
		setStatusProblem(null);
		const values = normalise(form.getValues());
		const candidate: NewWorkout = { ...base, ...values, status: nextStatus };

		// The same rules the server applies, checked first so that problems
		// show next to their fields without a round trip.
		const issues = workoutIssues(candidate, config, { badgeIds });
		if (issues.length > 0) {
			showIssues(issues);
			return;
		}

		setBusy(true);
		try {
			if (!workout) {
				const created = await createWorkout(candidate);
				toast({ title: "Trening utworzony", tone: "green" });
				onCreated(created.id);
				return;
			}
			const current = workoutsCollection.get(workout.id) ?? workout;
			const changed = [...FIELDS, "status" as const].filter(
				(field) => !deepEqual(current[field], candidate[field]),
			);
			if (changed.length === 0) {
				onClose();
				return;
			}
			await workoutsCollection
				.update(workout.id, (draft) => {
					const target = draft as Record<string, unknown>;
					for (const field of changed) target[field] = candidate[field];
				})
				.when("settled");
			const merged =
				workoutSaver.status.get()[workout.id]?.phase === "saved" &&
				(workoutSaver.status.get()[workout.id] as { mergedWithOthers: boolean })
					.mergedWithOthers;
			toast({
				title: "Trening zapisany",
				description: merged ? "Połączono ze zmianami innej osoby." : undefined,
				tone: "green",
			});
			onClose();
		} catch (error) {
			if (isApiError(error) && error.kind === "validation") {
				showIssues(error.issues);
			} else if (!workout) {
				// A failed create has nothing to hold on to; say so in place.
				setStatusProblem(
					error instanceof Error ? error.message : "Nie udało się zapisać",
				);
			}
			// For an existing workout the saver now holds the edits and
			// HeldEditsNotice explains what happened.
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		const sure = await confirm({
			title: "Usunąć trening?",
			description:
				"Trening trafi do kosza i zniknie z aplikacji. Można go przywrócić.",
			confirmLabel: "Usuń",
			destructive: true,
		});
		if (sure) await save("deleted");
	};

	const requestClose = async () => {
		if (formState.isDirty && !busy) {
			const sure = await confirm({
				title: "Zamknąć bez zapisywania?",
				description: "Zmiany w tym treningu nie zostały zapisane.",
				confirmLabel: "Zamknij bez zapisu",
				destructive: true,
			});
			if (!sure) return;
		}
		onClose();
	};

	const more: MenuAction[] = [];
	if (status === "published") {
		more.push({ label: "Ukryj", onSelect: () => void save("hidden") });
	}
	if (status === "hidden") {
		more.push({
			label: "Cofnij do szkicu",
			onSelect: () => void save("draft"),
		});
	}
	if (workout && !isDeleted) {
		more.push({
			label: usedIn.length ? "Usuń (używany w wyzwaniach)" : "Usuń",
			destructive: true,
			disabled: usedIn.length > 0,
			onSelect: () => void remove(),
		});
	}

	const error = (field: keyof FormValues) => formState.errors[field]?.message;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) void requestClose();
			}}
			title={workout ? workout.title || "Bez nazwy" : "Nowy trening"}
			description={
				workout
					? `${workout.id} · zmieniono ${formatDateTime(workout.updatedAtUtc)}`
					: "Zapisz jako szkic i dokończ później albo opublikuj od razu."
			}
			size="lg"
			footer={
				isDeleted ? (
					<>
						<Button size="md" onClick={onClose}>
							Zamknij
						</Button>
						<Button
							size="md"
							variant="primary"
							disabled={busy}
							onClick={() => void save("draft")}
						>
							Przywróć jako szkic
						</Button>
					</>
				) : (
					<>
						{more.length > 0 && (
							<div className="md:mr-auto">
								<Menu
									label="Więcej akcji"
									trigger="Więcej ▾"
									triggerClassName="h-9 w-full rounded-control border border-line-input px-4 text-sm hover:border-primary md:w-auto"
									align="start"
									actions={more}
								/>
							</div>
						)}
						<Button size="md" onClick={() => void requestClose()}>
							Anuluj
						</Button>
						{status === "draft" ? (
							<>
								<Button
									size="md"
									disabled={busy}
									onClick={() => void save("draft")}
								>
									{busy ? "Zapisywanie…" : "Zapisz szkic"}
								</Button>
								<Button
									size="md"
									variant="primary"
									disabled={busy}
									onClick={() => void save("published")}
								>
									Opublikuj
								</Button>
							</>
						) : (
							<>
								{status === "hidden" && (
									<Button
										size="md"
										disabled={busy}
										onClick={() => void save("published")}
									>
										Opublikuj
									</Button>
								)}
								<Button
									size="md"
									variant="primary"
									disabled={busy}
									onClick={() => void save(status)}
								>
									{busy ? "Zapisywanie…" : "Zapisz zmiany"}
								</Button>
							</>
						)}
					</>
				)
			}
		>
			<div className="flex flex-col gap-5">
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge status={status} />
					{usedIn.length > 0 && (
						<span className="text-xs text-muted">
							Używany w:{" "}
							{usedIn
								.slice(0, 3)
								.map((c) => c.title)
								.join(", ")}
							{usedIn.length > 3 && ` i ${usedIn.length - 3} innych`}
						</span>
					)}
				</div>

				{workout && (
					<HeldEditsNotice
						saver={workoutSaver}
						id={workout.id}
						describe={(location) => FIELD_LABELS[location] ?? location}
						onResolved={(kept) => {
							if (kept === "mine") {
								toast({ title: "Trening zapisany", tone: "green" });
								onClose();
								return;
							}
							const server = workoutsCollection.get(workout.id);
							if (server) form.reset(pickFields(server));
						}}
					/>
				)}
				{statusProblem && (
					<Notice tone="red" role="alert" title="Nie można zapisać">
						{statusProblem}
					</Notice>
				)}
				{isDeleted && (
					<Notice tone="grey" title="Ten trening jest w koszu">
						Nie widać go w aplikacji i nie można go edytować. Przywrócenie
						zamienia go w szkic.
					</Notice>
				)}

				<fieldset
					disabled={isDeleted || busy}
					className="grid grid-cols-1 gap-4 md:grid-cols-2"
				>
					<div className="md:col-span-2">
						<TextField
							label="Nazwa"
							required
							error={error("title")}
							{...register("title")}
						/>
					</div>
					<TextField
						label="Komentarz"
						hint="Niewidoczny w aplikacji."
						error={error("internalTitle")}
						{...register("internalTitle")}
					/>
					<TextField
						label="Czas (min)"
						type="number"
						min={minMinutes}
						max={maxMinutes}
						hint={`Od ${minMinutes} do ${maxMinutes} minut.`}
						error={error("durationMinutes")}
						{...register("durationMinutes", { valueAsNumber: true })}
					/>

					<Controller
						control={control}
						name="levelId"
						render={({ field }) => (
							<Field label="Poziom" error={error("levelId")}>
								{() => (
									<Select
										label="Poziom"
										options={config.trainingLevels.map((level) => ({
											value: level.id,
											label: level.title,
											tone: levelMeta(level.id).tone,
										}))}
										value={field.value}
										onChange={field.onChange}
										invalid={Boolean(error("levelId"))}
										disabled={isDeleted}
										clearable
										className="w-full"
									/>
								)}
							</Field>
						)}
					/>
					<Controller
						control={control}
						name="trainingTypeIds"
						render={({ field }) => (
							<Field label="Typ" error={error("trainingTypeIds")}>
								{() => (
									<MultiSelect
										label="Typ"
										options={config.trainingTypes.map((type) => ({
											value: type.id,
											label: type.title,
											tone: trainingTypeMeta(type.id).tone,
										}))}
										value={field.value}
										onChange={field.onChange}
										invalid={Boolean(error("trainingTypeIds"))}
										disabled={isDeleted}
									/>
								)}
							</Field>
						)}
					/>
					<Controller
						control={control}
						name="equipmentIds"
						render={({ field }) => (
							<Field label="Sprzęt" error={error("equipmentIds")}>
								{() => (
									<MultiSelect
										label="Sprzęt"
										options={config.equipmentTypes.map((item) => ({
											value: item.id,
											label: item.title,
										}))}
										value={field.value}
										onChange={field.onChange}
										placeholder="Brak"
										disabled={isDeleted}
									/>
								)}
							</Field>
						)}
					/>
					<Controller
						control={control}
						name="badgeId"
						render={({ field }) => (
							<Field label="Odznaka za wykonanie" error={error("badgeId")}>
								{() => (
									<Select
										label="Odznaka za wykonanie"
										placeholder="Wybierz odznakę"
										options={assignableBadges.map((badge) => ({
											value: badge.id,
											label: badge.name,
										}))}
										value={field.value}
										onChange={field.onChange}
										disabled={isDeleted}
										clearable
										className="w-full"
									/>
								)}
							</Field>
						)}
					/>

					<div className="md:col-span-2">
						<Controller
							control={control}
							name="pro"
							render={({ field }) => (
								<Switch
									label="Płatny"
									hint="Dostępny tylko w wersji Pro."
									checked={field.value}
									onChange={field.onChange}
									disabled={isDeleted}
								/>
							)}
						/>
					</div>

					<div className="md:col-span-2">
						<TextField
							label="Link do filmu (YouTube)"
							type="url"
							placeholder="https://"
							hint="Trening ma albo film, albo plik audio."
							error={error("videoUrl")}
							{...register("videoUrl")}
						/>
					</div>
					<Controller
						control={control}
						name="imageRelativePath"
						render={({ field }) => (
							<MediaField
								label="Miniaturka"
								kind="image"
								folderId="workouts"
								value={field.value}
								onChange={field.onChange}
								error={error("imageRelativePath")}
								disabled={isDeleted}
							/>
						)}
					/>
					<Controller
						control={control}
						name="audioRelativePath"
						render={({ field }) => (
							<MediaField
								label="Plik audio"
								kind="audio"
								folderId="audio"
								value={field.value}
								onChange={field.onChange}
								error={error("audioRelativePath")}
								disabled={isDeleted}
							/>
						)}
					/>

					<Controller
						control={control}
						name="addedAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Data dodania"
								value={field.value}
								onChange={(value) =>
									field.onChange(value ?? new Date().toISOString())
								}
								disabled={isDeleted}
							/>
						)}
					/>
					<Controller
						control={control}
						name="liveAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Data live"
								value={field.value}
								onChange={field.onChange}
								disabled={isDeleted}
							/>
						)}
					/>
					<Controller
						control={control}
						name="availableAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Data premiery"
								value={field.value}
								onChange={field.onChange}
								disabled={isDeleted}
							/>
						)}
					/>
				</fieldset>

				<Controller
					control={control}
					name="descriptionFancyContent"
					render={({ field }) => (
						<ContentField
							label="Opis"
							editorTitle="Opis treningu"
							value={field.value}
							onChange={field.onChange}
							imageFolderId="workouts"
							error={error("descriptionFancyContent")}
							disabled={isDeleted || busy}
						/>
					)}
				/>
			</div>
		</Dialog>
	);
}
