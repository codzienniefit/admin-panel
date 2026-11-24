import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { type ApiIssue, errorMessage, isApiError } from "@/data/api/errors";
import { badgesCollection } from "@/data/collections/badges";
import { challengesCollection } from "@/data/collections/challenges";
import {
	createWorkout,
	workoutSaver,
	workoutsCollection,
	workoutTarget,
} from "@/data/collections/workouts";
import type { ContentStatus } from "@/data/schemas/challenge";
import {
	blankWorkout,
	type NewWorkout,
	type Workout,
} from "@/data/schemas/workout";
import { formatDateTime } from "@/domain/dates";
import { restoredAs, restoreStatusFor } from "@/domain/statusRules";
import { challengesUsing } from "@/domain/workoutFilters";
import {
	DURATION_MAX,
	DURATION_MIN,
	statusChangeFrom,
	workoutIssues,
} from "@/domain/workoutRules";
import { useConfig } from "@/features/config/useConfig";
import { ContentField } from "@/features/content/ContentField";
import { MediaField } from "@/features/media/MediaField";
import { applyChange, previewChange } from "@/features/saving/applyChange";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useJsonPreview } from "@/features/saving/JsonPreview";
import { useUnsavedGuard } from "@/features/saving/useUnsavedGuard";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { DateTimeField } from "@/ui/DateField";
import { Dialog } from "@/ui/Dialog";
import {
	confirmDiscard,
	EditorPlaceholder,
	MoreActions,
} from "@/ui/EditorParts";
import {
	FORMAT_META,
	levelMeta,
	RECORDING_STATUS_META,
	trainingTypeMeta,
} from "@/ui/enums";
import { Field, TextAreaField, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice, placeIssues } from "@/ui/formIssues";
import type { MenuAction } from "@/ui/Menu";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { StatusBadge } from "@/ui/StatusBadge";
import { Switch } from "@/ui/Switch";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";
import type { Tone } from "@/ui/tones";

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
	| "recordingStatus"
	| "format"
	| "runningDescription"
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
	"recordingStatus",
	"format",
	"runningDescription",
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
	recordingStatus: "Status nagrania",
	format: "Format",
	runningDescription: "Opis biegania",
	status: "Status",
};

/** Longest running description the backend takes (PANEL_MAX there). */
const RUNNING_DESCRIPTION_MAX = 2000;

/** The options of a choice, plus a stored value this build does not know. */
function withStored(
	meta: Record<string, { label: string; tone: Tone }>,
	stored: string | null | undefined,
) {
	const options = Object.entries(meta).map(([value, item]) => ({
		value,
		label: item.label,
		tone: item.tone,
	}));
	return stored && !(stored in meta)
		? [...options, { value: stored, label: stored, tone: "grey" as Tone }]
		: options;
}

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
		// Absent stays absent: a backend without these fields refuses them.
		...(values.runningDescription === undefined
			? {}
			: { runningDescription: blank(values.runningDescription) }),
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
			<EditorPlaceholder
				loading={isLoading}
				missingTitle="Nie ma takiego treningu"
				missingText={`Trening ${workoutId} nie istnieje albo został usunięty na stałe.`}
				onClose={onClose}
				size="full"
			/>
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
	const { data: badges, isLoading: loadingBadges } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const { data: challenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});

	const [base] = useState<NewWorkout>(() => workout ?? blankWorkout());
	const form = useForm<FormValues>({ defaultValues: pickFields(base) });
	const { control, register, formState } = form;
	const format = form.watch("format");
	const runningDescription = form.watch("runningDescription");
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<readonly ApiIssue[]>([]);
	const leave = useUnsavedGuard(
		formState.isDirty,
		"Zmiany w tym treningu nie zostały zapisane.",
	);

	const status: ContentStatus = workout?.status ?? "draft";
	const isDeleted = status === "deleted";
	const usedIn = workout ? challengesUsing(challenges ?? [], workout.id) : [];
	const assignableBadges = (badges ?? []).filter(
		(badge) => badge.type === "normal" && !badge.isHidden,
	);
	const badgeIds = new Set(assignableBadges.map((badge) => badge.id));
	// Not the config's `duration`: that is the range of the app's filter, and
	// a real workout can be shorter or longer.
	const minMinutes = DURATION_MIN;
	const maxMinutes = DURATION_MAX;

	const showIssues = (issues: readonly ApiIssue[]) =>
		setProblems(placeIssues(form, FIELDS, issues));

	/** Saves the form's fields together with a status. */
	const save = async (nextStatus: ContentStatus) => {
		form.clearErrors();
		setProblems([]);
		const values = normalise(form.getValues());
		const candidate: NewWorkout = { ...base, ...values, status: nextStatus };
		// Until the badge list has arrived the badge is not checked here (every
		// badge would look unknown); the server checks it either way.
		const rules = (item: NewWorkout) =>
			workoutIssues(item, config, {
				...(loadingBadges ? {} : { badgeIds }),
				statusChangeFrom: statusChangeFrom(workout, item),
			});

		if (!workout) {
			// The same rules the server applies, checked first so that problems
			// show next to their fields without a round trip.
			const issues = rules(candidate);
			if (issues.length > 0) {
				showIssues(issues);
				return;
			}
			const created = await whileBusy(setBusy, () =>
				attempt(() => createWorkout(candidate)),
			);
			if (!created.ok) {
				// A failed create has nothing to hold on to; say so in place.
				const { error } = created;
				showIssues(
					isApiError(error) && error.kind === "validation"
						? error.issues
						: [generalIssue(errorMessage(error, "Nie udało się zapisać"))],
				);
				return;
			}
			toast({ title: "Trening utworzony", tone: "green" });
			leave();
			onCreated(created.value.id);
			return;
		}

		const applied = await whileBusy(setBusy, () =>
			attempt(() =>
				applyChange(
					workoutTarget,
					workout,
					(draft) => {
						Object.assign(draft, values, { status: nextStatus });
					},
					{ issuesOf: rules },
				),
			),
		);
		// A conflict or a failed save: the saver now holds the edits and
		// HeldEditsNotice explains what happened.
		if (!applied.ok) return;
		if (!applied.value.ok) {
			showIssues(applied.value.issues);
			return;
		}
		if (applied.value.changed) {
			toast({
				title:
					workout?.status === "deleted"
						? restoredAs(workout, "workout")
						: "Trening zapisany",
				description: applied.value.merged
					? "Połączono ze zmianami innej osoby."
					: undefined,
				tone: "green",
			});
		}
		leave();
		onClose();
	};

	const remove = async () => {
		const sure = await confirm({
			title: "Usunąć trening?",
			description:
				"Trening trafi do kosza i zniknie z aplikacji. Później można go przywrócić z kosza.",
			confirmLabel: "Usuń",
			destructive: true,
		});
		if (sure) await save("deleted");
	};

	const requestClose = async () => {
		const sure = await confirmDiscard(
			formState.isDirty && !busy,
			"Zmiany w tym treningu nie zostały zapisane.",
		);
		if (!sure) return;
		leave();
		onClose();
	};

	// Built the way `save` builds it, so the preview shows what a save sends.
	const json = useJsonPreview("treningu", () => {
		const values = normalise(form.getValues());
		return workout
			? previewChange(workoutTarget, workout, (draft) => {
					Object.assign(draft, values);
				})
			: { before: undefined, after: { ...base, ...values } };
	});

	// a workout the app has shown comes back hidden, never as a draft
	const restoreTarget = workout ? restoreStatusFor(workout) : "draft";
	const more: MenuAction[] = [json.action];
	if (status === "published") {
		more.push({ label: "Ukryj", onSelect: () => void save("hidden") });
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
			onClose={() => void requestClose()}
			title={workout ? workout.title || "Bez nazwy" : "Nowy trening"}
			description={
				workout
					? `${workout.id} · zmieniono ${formatDateTime(workout.updatedAtUtc)}`
					: "Zapisz jako szkic i dokończ później albo opublikuj od razu."
			}
			size="full"
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
							onClick={() => void save(restoreTarget)}
						>
							{restoreTarget === "hidden"
								? "Przywróć jako ukryty"
								: "Przywróć jako szkic"}
						</Button>
					</>
				) : (
					<>
						<MoreActions actions={more} />
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
				<IssuesNotice title="Nie można zapisać" issues={problems} />
				{isDeleted && (
					<Notice tone="grey" title="Ten trening jest w koszu">
						Nie widać go w aplikacji i nie można go edytować.{" "}
						{restoreTarget === "hidden"
							? "Był już opublikowany, więc wraca jako ukryty: osoby, które go miały, nadal go widzą, nowe go nie znajdą. Opublikujesz go ponownie, kiedy będzie gotowy."
							: "Nigdy nie był opublikowany, więc wraca jako szkic."}
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

					<Controller
						control={control}
						name="recordingStatus"
						render={({ field }) => (
							<Field
								label="Status nagrania"
								hint="Dla zespołu; aplikacja tego nie pokazuje."
								error={error("recordingStatus")}
							>
								{() => (
									<Select
										label="Status nagrania"
										placeholder="Nie ustawiono"
										options={withStored(RECORDING_STATUS_META, field.value)}
										value={field.value ?? null}
										onChange={field.onChange}
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
						name="format"
						render={({ field }) => (
							<Field
								label="Format"
								hint="Premiera, live albo bieganie; dla zespołu."
								error={error("format")}
							>
								{() => (
									<Select
										label="Format"
										placeholder="Nie ustawiono"
										options={withStored(FORMAT_META, field.value)}
										value={field.value ?? null}
										onChange={field.onChange}
										disabled={isDeleted}
										clearable
										className="w-full"
									/>
								)}
							</Field>
						)}
					/>
					{(format === "running" || runningDescription) && (
						<div className="md:col-span-2">
							<TextAreaField
								label="Opis biegania"
								hint="Dla zespołu: tempo, dystans, jak biec."
								maxLength={RUNNING_DESCRIPTION_MAX}
								rows={3}
								error={error("runningDescription")}
								disabled={isDeleted}
								{...register("runningDescription")}
							/>
						</div>
					)}

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
			{json.dialog}
		</Dialog>
	);
}
