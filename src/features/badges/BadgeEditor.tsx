import { useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import {
	badgeSaver,
	badgesCollection,
	badgeTarget,
	createBadge,
	removeBadge,
} from "@/data/collections/badges";
import { type Badge, blankBadge, type NewBadge } from "@/data/schemas/badge";
import {
	type BadgeAssignment,
	badgeIssues,
	badgeRemovalIssues,
	badgeSummary,
	CREATABLE_BADGE_TYPES,
	claimLink,
	isEventBadge,
	SPECIAL_CATEGORIES,
} from "@/domain/badgeRules";
import { formatDateTime } from "@/domain/dates";
import { useConfig } from "@/features/config/useConfig";
import { MediaField } from "@/features/media/MediaField";
import { applyChange, previewChange } from "@/features/saving/applyChange";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useJsonPreview } from "@/features/saving/JsonPreview";
import { useUnsavedGuard } from "@/features/saving/useUnsavedGuard";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { DateTimeField } from "@/ui/DateField";
import { Dialog } from "@/ui/Dialog";
import {
	confirmDiscard,
	EditorPlaceholder,
	MoreActions,
} from "@/ui/EditorParts";
import { Facts } from "@/ui/Facts";
import { Field, TextAreaField, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice, placeIssues } from "@/ui/formIssues";
import type { MenuAction } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { Tag } from "@/ui/Tag";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";
import {
	BADGE_VISIBILITY_META,
	badgeSectionLabel,
	badgeTypeMeta,
	SPECIAL_CATEGORY_LABELS,
} from "./badgeMeta";
import { useBadgeAssignments } from "./useBadgeAssignments";

/** What the form holds; `toFields` turns it into what is stored. */
interface FormValues {
	name: string;
	type: string;
	specialCategory: string | null;
	imageRelativePath: string | null;
	comment: string;
	isHidden: boolean;
	activeFromUtc: string | null;
	activeTillUtc: string | null;
	claimToken: string;
	isClaimLinkActive: boolean;
}

const FIELDS = [
	"name",
	"type",
	"specialCategory",
	"imageRelativePath",
	"comment",
	"isHidden",
	"activeFromUtc",
	"activeTillUtc",
	"claimToken",
	"isClaimLinkActive",
] as const satisfies ReadonlyArray<keyof FormValues & keyof NewBadge>;

const FIELD_LABELS: Record<string, string> = {
	name: "Nazwa",
	type: "Typ",
	specialCategory: "Rodzaj",
	imageRelativePath: "Grafika",
	comment: "Opis",
	isHidden: "Ukryta",
	activeFromUtc: "Widoczna od",
	activeTillUtc: "Widoczna do",
	claimToken: "Kod do zdobycia",
	isClaimLinkActive: "Zdobywanie aktywne",
};

function fromBadge(badge: NewBadge): FormValues {
	return {
		name: badge.name,
		type: badge.type,
		specialCategory: badge.specialCategory,
		imageRelativePath: badge.imageRelativePath || null,
		comment: badge.comment ?? "",
		isHidden: Boolean(badge.isHidden),
		activeFromUtc: badge.activeFromUtc,
		activeTillUtc: badge.activeTillUtc,
		claimToken: badge.claimToken ?? "",
		isClaimLinkActive: Boolean(badge.isClaimLinkActive),
	};
}

/**
 * The stored shape of what the form holds. Fields that do not apply to the
 * chosen type are emptied, so nothing left over from another type is saved.
 */
function toFields(values: FormValues): Pick<NewBadge, (typeof FIELDS)[number]> {
	const manual = values.type === "manual";
	const specialCategory = manual ? values.specialCategory : null;
	const forEvent = isEventBadge({ type: values.type, specialCategory });
	return {
		name: values.name.trim(),
		type: values.type,
		specialCategory,
		imageRelativePath: values.imageRelativePath ?? "",
		comment: values.comment.trim() || null,
		isHidden: values.isHidden,
		activeFromUtc: manual ? null : values.activeFromUtc,
		activeTillUtc: manual ? null : values.activeTillUtc,
		claimToken: forEvent ? values.claimToken.trim() || null : null,
		isClaimLinkActive: forEvent && values.isClaimLinkActive,
	};
}

interface BadgeEditorProps {
	/** null creates a new badge. */
	badgeId: string | null;
	onClose: () => void;
	/** Shows another badge in the editor: one just created. */
	onOpen: (badgeId: string) => void;
}

export function BadgeEditor({ badgeId, onClose, onOpen }: BadgeEditorProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const badge = badgeId
		? (data?.find((item) => item.id === badgeId) ?? null)
		: null;
	// Set while this editor is deleting its own badge, so that the moment the
	// badge disappears does not read as "there is no such badge".
	const [removing, setRemoving] = useState(false);

	if (badgeId && !badge) {
		if (removing) return null;
		return (
			<EditorPlaceholder
				loading={isLoading}
				missingTitle="Nie ma takiej odznaki"
				missingText="Ta odznaka nie istnieje albo została usunięta. Wybierz odznakę z listy."
				onClose={onClose}
			/>
		);
	}

	return (
		<BadgeForm
			// A different badge is a different form.
			key={badge?.id ?? "new"}
			badge={badge}
			others={(data ?? []).filter((item) => item.id !== badge?.id)}
			onClose={onClose}
			onOpen={onOpen}
			onRemoving={setRemoving}
		/>
	);
}

interface BadgeFormProps {
	badge: Badge | null;
	/** Every other badge, for the "code already in use" check. */
	others: readonly Badge[];
	onClose: () => void;
	onOpen: (badgeId: string) => void;
	/** Told before the badge is deleted, and again if that fails. */
	onRemoving: (removing: boolean) => void;
}

// A row of the form: two fields side by side, one under the other on a phone.
// Rows are explicit so that a field that is sometimes absent (the type, on an
// existing badge) cannot push the others out of step.
const ROW = "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2";

function BadgeForm({
	badge,
	others,
	onClose: closeEditor,
	onOpen: openBadge,
	onRemoving,
}: BadgeFormProps) {
	const { badgeTypes, badgeSections } = useConfig().internal;
	const assignments = useBadgeAssignments();
	const assigned = badge ? assignments.of(badge.id) : [];

	const [base] = useState<NewBadge>(() => badge ?? blankBadge());
	const form = useForm<FormValues>({ defaultValues: fromBadge(base) });
	const { control, register, formState } = form;
	const [busy, setBusy] = useState(false);
	// Leaving another way (the browser's Back, a link in the top bar) asks
	// first. The editor's own buttons have asked or saved already.
	const leave = useUnsavedGuard(
		formState.isDirty,
		"Zmiany w tej odznace nie zostały zapisane.",
	);
	const onClose = () => {
		leave();
		closeEditor();
	};
	const onOpen = (nextBadgeId: string) => {
		leave();
		openBadge(nextBadgeId);
	};
	const [problems, setProblems] = useState<{
		title: string;
		issues: readonly ApiIssue[];
	} | null>(null);

	// useWatch, not form.watch(): the React Compiler cannot compile a
	// component that calls the latter.
	const [type, specialCategory, claimToken] = useWatch({
		control,
		name: ["type", "specialCategory", "claimToken"],
	});
	const typedToken = claimToken.trim();
	const manual = type === "manual";
	const forEvent = isEventBadge({ type, specialCategory });
	const typeMeta = badgeTypeMeta(type, badgeTypes);
	const savedToken = badge && isEventBadge(badge) ? badge.claimToken : null;

	const show = (title: string, issues: readonly ApiIssue[]) => {
		const elsewhere = placeIssues(form, FIELDS, issues);
		setProblems(elsewhere.length > 0 ? { title, issues: elsewhere } : null);
	};

	const save = async () => {
		form.clearErrors();
		setProblems(null);
		const candidate: NewBadge = { ...base, ...toFields(form.getValues()) };

		// The same rules the server applies, checked first so that problems
		// show next to their fields without a round trip.
		const issues = badgeIssues(candidate, {
			assignments: assigned,
			takenClaimTokens: new Set(
				others.flatMap((other) =>
					other.claimToken ? [other.claimToken.toLowerCase()] : [],
				),
			),
			storedType: badge?.type,
		});
		if (issues.length > 0) {
			show("Nie można zapisać", issues);
			return;
		}

		// Changes people in the app would notice are asked about, now that it
		// is known they can go through.
		if (badge && candidate.isHidden && !badge.isHidden) {
			const sure = await confirm({
				title: "Ukryć odznakę?",
				description: `Odznaka „${candidate.name}” przestanie być widoczna w aplikacji i zniknie z list wyboru przy treningach i wyzwaniach. Można ją potem pokazać z powrotem.`,
				confirmLabel: "Ukryj",
			});
			if (!sure) return;
		}
		if (savedToken && candidate.claimToken !== savedToken) {
			const sure = await confirm({
				title: "Zmienić kod do zdobycia?",
				description:
					"Linki i kody QR ze starym kodem przestaną działać. Tego, co już wydrukowane lub rozesłane, nie da się poprawić.",
				confirmLabel: "Zmień kod",
				destructive: true,
			});
			if (!sure) return;
		}

		if (!badge) {
			const created = await whileBusy(setBusy, () =>
				attempt(() => createBadge(candidate)),
			);
			if (!created.ok) {
				const { error } = created;
				// A failed create has nothing to hold on to; say so in place.
				show(
					"Nie można zapisać",
					isApiError(error) && error.kind === "validation"
						? error.issues
						: [
								generalIssue(
									"Nie udało się zapisać. Spróbuj ponownie za chwilę.",
								),
							],
				);
				return;
			}
			toast({ title: "Odznaka utworzona", tone: "green" });
			// An event badge stays open: its claim link is what comes next.
			if (isEventBadge(created.value)) onOpen(created.value.id);
			else onClose();
			return;
		}

		const fields = toFields(form.getValues());
		const applied = await whileBusy(setBusy, () =>
			attempt(() =>
				applyChange(badgeTarget, badge, (draft) => {
					Object.assign(draft, fields);
				}),
			),
		);
		// Thrown: a conflict or a save that kept failing. The saver holds the
		// edits and HeldEditsNotice explains what happened.
		if (!applied.ok) return;
		if (!applied.value.ok) {
			show("Nie można zapisać", applied.value.issues);
			return;
		}
		if (!applied.value.changed) {
			onClose();
			return;
		}
		toast({
			title: "Odznaka zapisana",
			description: applied.value.merged
				? "Połączono ze zmianami innej osoby."
				: undefined,
			tone: "green",
		});
		onClose();
	};

	const remove = async () => {
		if (!badge) return;
		form.clearErrors();
		setProblems(null);
		const issues = badgeRemovalIssues(assigned);
		if (issues.length > 0) {
			show("Nie można usunąć", issues);
			return;
		}
		const sure = await confirm({
			title: "Usunąć odznakę na stałe?",
			description: `Odznaki „${badge.name}” nie da się przywrócić, a osoby, które ją zdobyły, przestaną ją widzieć. Jeśli chcesz ją tylko schować w aplikacji, ukryj ją zamiast usuwać.`,
			confirmLabel: "Usuń na stałe",
			destructive: true,
		});
		if (!sure) return;

		// Once it is gone there is nothing left for this form to show.
		onRemoving(true);
		const removed = await whileBusy(setBusy, () =>
			attempt(() => removeBadge(badge.id)),
		);
		if (removed.ok) {
			toast({ title: "Odznaka usunięta", tone: "green" });
			onClose();
			return;
		}
		onRemoving(false);
		const { error } = removed;
		const refused = isApiError(error) && error.kind === "validation";
		const changed = isApiError(error) && error.kind === "conflict";
		show(
			"Nie można usunąć",
			refused
				? error.issues
				: [
						generalIssue(
							changed
								? "Ktoś zmienił tę odznakę w międzyczasie. Na ekranie jest już jej aktualna wersja: sprawdź ją i spróbuj ponownie."
								: "Nie udało się usunąć. Spróbuj ponownie za chwilę.",
						),
					],
		);
	};

	const copyLink = async () => {
		if (!savedToken) return;
		const copied = await copyText(claimLink(savedToken));
		toast(
			copied
				? { title: "Skopiowano link do zdobycia odznaki", tone: "green" }
				: {
						title: "Nie udało się skopiować",
						description: "Zaznacz link i skopiuj go ręcznie.",
						tone: "red",
					},
		);
	};

	const requestClose = async () => {
		const sure = await confirmDiscard(
			formState.isDirty && !busy,
			"Zmiany w tej odznace nie zostały zapisane.",
		);
		if (sure) onClose();
	};

	// Built the way `save` builds it, so the preview shows what a save sends.
	const json = useJsonPreview("odznaki", () => {
		const fields = toFields(form.getValues());
		return badge
			? previewChange(badgeTarget, badge, (draft) => {
					Object.assign(draft, fields);
				})
			: { before: undefined, after: { ...base, ...fields } };
	});

	const more: MenuAction[] = badge
		? [
				json.action,
				{
					label: "Usuń odznakę",
					destructive: true,
					disabled: busy || !assignments.ready,
					onSelect: () => void remove(),
				},
			]
		: [json.action];

	const error = (field: keyof FormValues) => formState.errors[field]?.message;
	const section = badge ? badgeSectionLabel(badge, badgeSections) : null;

	return (
		<Dialog
			open
			onClose={() => void requestClose()}
			title={badge ? badge.name || "Bez nazwy" : "Nowa odznaka"}
			description={
				badge
					? `Zmieniono ${formatDateTime(badge.updatedAtUtc || null)}`
					: "Odznakę za trening lub wyzwanie przypisuje się potem w ich formularzach."
			}
			size="lg"
			footer={
				<>
					<MoreActions actions={more} />
					<Button size="md" onClick={() => void requestClose()}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={busy}
						onClick={() => void save()}
					>
						{busy ? "Zapisywanie…" : badge ? "Zapisz zmiany" : "Utwórz odznakę"}
					</Button>
				</>
			}
		>
			<form
				// Our own messages, next to the fields, instead of the browser's.
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
				className="flex flex-col gap-5"
			>
				{badge && (
					<div className="flex flex-wrap items-center gap-1.5">
						<Tag tone={typeMeta.tone}>{typeMeta.label}</Tag>
						{badge.isHidden && (
							<Tag tone={BADGE_VISIBILITY_META.hidden.tone}>
								{BADGE_VISIBILITY_META.hidden.label}
							</Tag>
						)}
					</div>
				)}

				{badge && (
					<HeldEditsNotice
						saver={badgeSaver}
						id={badge.id}
						describe={(location) => FIELD_LABELS[location] ?? location}
						onResolved={(kept) => {
							if (kept === "mine") {
								toast({ title: "Odznaka zapisana", tone: "green" });
								onClose();
								return;
							}
							const stored = badgesCollection.get(badge.id);
							if (stored) form.reset(fromBadge(stored));
						}}
					/>
				)}
				{problems && (
					<IssuesNotice title={problems.title} issues={problems.issues} />
				)}
				{badge &&
					!(CREATABLE_BADGE_TYPES as readonly string[]).includes(type) && (
						<Notice tone="grey" title="Tę odznakę utworzył system">
							Można zmienić jej nazwę, grafikę, opis i widoczność. Za co jest
							przyznawana, ustala aplikacja.
						</Notice>
					)}

				<fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
					{(!badge || manual) && (
						<div className={ROW}>
							{!badge && (
								<Controller
									control={control}
									name="type"
									render={({ field }) => (
										<Field
											label="Typ"
											hint="Po utworzeniu typu nie można zmienić."
											error={error("type")}
										>
											{() => (
												<Select
													label="Typ"
													options={CREATABLE_BADGE_TYPES.map((id) => {
														const meta = badgeTypeMeta(id, badgeTypes);
														return {
															value: id,
															label: meta.label,
															tone: meta.tone,
														};
													})}
													value={field.value}
													onChange={(value) =>
														field.onChange(value ?? "normal")
													}
													invalid={Boolean(error("type"))}
													disabled={busy}
													className="w-full"
												/>
											)}
										</Field>
									)}
								/>
							)}
							{manual && (
								<Controller
									control={control}
									name="specialCategory"
									render={({ field }) => (
										<Field
											label="Rodzaj"
											error={error("specialCategory")}
											required
										>
											{() => (
												<Select
													label="Rodzaj odznaki ręcznej"
													placeholder="Wybierz rodzaj"
													options={SPECIAL_CATEGORIES.map((id) => ({
														value: id,
														label: SPECIAL_CATEGORY_LABELS[id] ?? id,
													}))}
													value={field.value}
													onChange={field.onChange}
													invalid={Boolean(error("specialCategory"))}
													disabled={busy}
													className="w-full"
												/>
											)}
										</Field>
									)}
								/>
							)}
						</div>
					)}
					<div className={ROW}>
						{/* Two columns that fill the width: what the badge is called on the
					    left, what it looks like and whether it shows on the right. */}
						<div className="flex min-w-0 flex-col gap-4">
							<TextField
								label="Nazwa"
								required
								error={error("name")}
								{...register("name")}
							/>
							<TextAreaField
								label="Opis"
								rows={4}
								hint="Opcjonalny. Notatka dla zespołu."
								error={error("comment")}
								{...register("comment")}
							/>
						</div>
						<div className="flex min-w-0 flex-col gap-4">
							<Controller
								control={control}
								name="imageRelativePath"
								render={({ field }) => (
									<MediaField
										label="Grafika"
										kind="image"
										folderId="badges"
										value={field.value}
										onChange={field.onChange}
										error={error("imageRelativePath")}
										hint="Z folderu „Odznaki”. Plik webp, najwyżej 50 kB."
										disabled={busy}
										thumbnailClassName="size-20"
									/>
								)}
							/>
							<Controller
								control={control}
								name="isHidden"
								render={({ field }) => (
									<Switch
										label="Ukryta"
										hint="Ukrytej odznaki nie widać w aplikacji i nie można jej przypisać do treningu ani wyzwania."
										checked={field.value}
										onChange={field.onChange}
										disabled={busy}
									/>
								)}
							/>
							{error("isHidden") && (
								<p role="alert" className="mt-1.5 text-xs text-danger">
									{error("isHidden")}
								</p>
							)}
						</div>
					</div>

					{!manual && (
						<div className={ROW}>
							<Controller
								control={control}
								name="activeFromUtc"
								render={({ field }) => (
									<DateTimeField
										label="Widoczna od"
										hint="Puste: od razu."
										value={field.value}
										onChange={field.onChange}
										error={error("activeFromUtc")}
										disabled={busy}
									/>
								)}
							/>
							<Controller
								control={control}
								name="activeTillUtc"
								render={({ field }) => (
									<DateTimeField
										label="Widoczna do"
										hint="Puste: bez końca."
										value={field.value}
										onChange={field.onChange}
										error={error("activeTillUtc")}
										disabled={busy}
									/>
								)}
							/>
						</div>
					)}

					{forEvent && (
						<div className={ROW}>
							<TextField
								label="Kod do zdobycia odznaki"
								hint={
									savedToken
										? "Zmiana kodu popsuje stare linki i kody QR."
										: "Od 6 do 32 liter i cyfr. Puste pole: kod nada serwer."
								}
								error={error("claimToken")}
								autoComplete="off"
								spellCheck={false}
								{...register("claimToken")}
							/>
							<div className="md:pt-7">
								<Controller
									control={control}
									name="isClaimLinkActive"
									render={({ field }) => (
										<Switch
											label="Zdobywanie aktywne"
											hint="Wyłączone: kod i link nic nie dają."
											checked={field.value}
											onChange={field.onChange}
											disabled={busy}
										/>
									)}
								/>
							</div>
						</div>
					)}
				</fieldset>

				{savedToken && forEvent && (
					<section aria-label="Link do zdobycia odznaki">
						<h2 className="mb-1.5 text-sm font-semibold">
							Link do zdobycia odznaki
						</h2>
						<div className="flex flex-wrap items-center gap-2">
							<code className="min-w-0 flex-1 rounded-control bg-bg px-3 py-2 text-xs [overflow-wrap:anywhere]">
								{claimLink(savedToken)}
							</code>
							<Button
								disabled={typedToken !== savedToken}
								onClick={() => void copyLink()}
							>
								Skopiuj link
							</Button>
						</div>
						{typedToken !== savedToken && (
							<p className="mt-1.5 text-xs text-muted">
								To link ze starym kodem. Zapisz zmiany, żeby dostać nowy.
							</p>
						)}
					</section>
				)}

				{badge && (
					<section aria-label="Informacje">
						<h2 className="mb-2 text-sm font-semibold">Informacje</h2>
						<Facts
							items={[
								{ label: "Identyfikator", value: badge.id },
								{
									label: "Jak się ją zdobywa",
									value:
										badge.type === "normal" && !assignments.ready
											? "Wczytywanie…"
											: badgeSummary(badge, assigned),
								},
								{
									label: "Sekcja w aplikacji",
									value:
										section ??
										"Jeszcze nieustalona. Aplikacja wybiera ją sama, na podstawie typu odznaki i tego, do czego jest przypisana.",
								},
							]}
						/>
					</section>
				)}

				{badge?.type === "normal" && (
					<section aria-label="Przypisana do">
						<h2 className="mb-2 text-sm font-semibold">Przypisana do</h2>
						{!assignments.ready ? (
							<p className="text-sm text-muted">Wczytywanie…</p>
						) : assigned.length === 0 ? (
							<p className="text-sm text-muted">
								Nigdzie. Odznakę wybiera się w formularzu treningu albo w treści
								wyzwania.
							</p>
						) : (
							<ul className="flex flex-col gap-1.5 text-sm">
								{assigned.map((assignment) => (
									<li
										key={`${assignment.kind}-${assignment.id}-${assignment.role}`}
									>
										<AssignmentLink
											assignment={assignment}
											// A link would leave the form without asking.
											linked={!formState.isDirty}
										/>
									</li>
								))}
							</ul>
						)}
					</section>
				)}
			</form>
			{json.dialog}
		</Dialog>
	);
}

interface AssignmentLinkProps {
	assignment: BadgeAssignment;
	/** False while the form has unsaved input: then it is plain text. */
	linked: boolean;
}

/** One place a badge is assigned, as a link to where it can be changed. */
function AssignmentLink({ assignment, linked }: AssignmentLinkProps) {
	const title = assignment.title || "Bez nazwy";
	const link = "font-semibold text-primary hover:underline";
	return (
		<span className="[overflow-wrap:anywhere]">
			{assignment.kind === "workout" ? "Trening " : "Wyzwanie "}
			{!linked ? (
				<span className="font-semibold">{title}</span>
			) : assignment.kind === "workout" ? (
				<Link
					to="/workouts/$workoutId"
					params={{ workoutId: assignment.id }}
					className={link}
				>
					{title}
				</Link>
			) : (
				<Link
					to="/challenges/$challengeId/content"
					params={{ challengeId: assignment.id }}
					className={link}
				>
					{title}
				</Link>
			)}
			<span className="text-muted">
				{assignment.role === "perfect" && " · za wykonanie w 100%"}
				{assignment.deleted && " · w koszu"}
			</span>
		</span>
	);
}
