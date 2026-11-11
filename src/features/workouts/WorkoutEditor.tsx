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
	workoutTarget,
} from "@/data/collections/workouts";
import type { ContentStatus } from "@/data/schemas/challenge";
import {
	blankWorkout,
	type NewWorkout,
	type Workout,
} from "@/data/schemas/workout";
import { formatDateTime } from "@/domain/dates";
import { challengesUsing } from "@/domain/workoutFilters";
import { workoutIssues } from "@/domain/workoutRules";
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
import { levelMeta, trainingTypeMeta } from "@/ui/enums";
import { Field, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice, placeIssues } from "@/ui/formIssues";
import type { MenuAction } from "@/ui/Menu";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { StatusBadge } from "@/ui/StatusBadge";
import { Switch } from "@/ui/Switch";
import { attempt, whileBusy } from "@/ui/tasks";
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
			<EditorPlaceholder
				loading={isLoading}
				missingTitle="Nie ma takiego treningu"
				missingText={`Trening ${workoutId} nie istnieje albo został usunięty na stałe.`}
				onClose={onClose}
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
	const minMinutes = Math.round(config.duration.fromSeconds / 60);
	const maxMinutes = Math.round(config.duration.toSeconds / 60);

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
			workoutIssues(item, config, loadingBadges ? {} : { badgeIds });

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
						: [
								generalIssue(
									error instanceof Error
										? error.message
										: "Nie udało się zapisać",
								),
							],
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
				title: "Trening zapisany",
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
				"Trening trafi do kosza i zniknie z aplikacji. Można go przywrócić.",
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

	const more: MenuAction[] = [json.action];
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
			onClose={() => void requestClose()}
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
			{json.dialog}
		</Dialog>
	);
}
