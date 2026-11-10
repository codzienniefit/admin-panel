import { useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { ApiIssue } from "@/data/api/errors";
import type { Challenge } from "@/data/schemas/challenge";
import { resizeDays, workoutsLostByResize } from "@/domain/challengeRules";
import { plural } from "@/domain/text";
import { ContentField } from "@/features/content/ContentField";
import { MediaField } from "@/features/media/MediaField";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { DateTimeField } from "@/ui/DateTimeField";
import { Field, TextField } from "@/ui/Field";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { applyChallengeChange, markUnsaved } from "./challengeActions";
import { useChallengeRules } from "./useChallengeRules";

/** What the form holds. Lists of ids typed by hand are kept as text. */
interface FormValues {
	title: string;
	subtitle: string;
	internalTitle: string;
	categoryId: string | null;
	goalsIds: string[];
	difficultyLevelsIds: string[];
	addedAtUtc: string;
	liveAtUtc: string | null;
	endsAtUtc: string | null;
	availableAtUtc: string | null;
	lengthDays: number;
	visibleDaysUpFront: string;
	pro: boolean;
	unlockedBy: string;
	offeringId: string;
	discountedFor: string;
	offeringDiscountedId: string;
	badgeId: string | null;
	perfectCompletionBadgeId: string | null;
	imageRelativePath: string | null;
	descriptionFancyContent: Challenge["descriptionFancyContent"];
	recommendedNext: string[];
}

const fromChallenge = (challenge: Challenge): FormValues => ({
	title: challenge.title,
	subtitle: challenge.subtitle ?? "",
	internalTitle: challenge.internalTitle ?? "",
	categoryId: challenge.categoryId,
	goalsIds: challenge.goalsIds,
	difficultyLevelsIds: challenge.difficultyLevelsIds,
	addedAtUtc: challenge.addedAtUtc,
	liveAtUtc: challenge.liveAtUtc,
	endsAtUtc: challenge.endsAtUtc,
	availableAtUtc: challenge.availableAtUtc,
	lengthDays: challenge.lengthDays,
	visibleDaysUpFront:
		challenge.visibleDaysUpFront === null
			? ""
			: String(challenge.visibleDaysUpFront),
	pro: challenge.pro,
	unlockedBy: challenge.unlockedByEntitlementIds.join(", "),
	offeringId: challenge.offeringId ?? "",
	discountedFor: challenge.discountedForEntitlementIds.join(", "),
	offeringDiscountedId: challenge.offeringDiscountedId ?? "",
	badgeId: challenge.badgeId,
	perfectCompletionBadgeId: challenge.perfectCompletionBadgeId,
	imageRelativePath: challenge.imageRelativePath,
	descriptionFancyContent: challenge.descriptionFancyContent,
	recommendedNext: challenge.recommendedNext.map((item) => item.id),
});

const ids = (text: string) =>
	text
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
const blank = (text: string) => text.trim() || null;

/** Writes the form's values onto a challenge. */
function applyValues(draft: Challenge, values: FormValues) {
	draft.title = values.title.trim();
	draft.subtitle = values.subtitle.trim();
	draft.internalTitle = blank(values.internalTitle);
	draft.categoryId = values.categoryId;
	draft.goalsIds = values.goalsIds;
	draft.difficultyLevelsIds = values.difficultyLevelsIds;
	draft.addedAtUtc = values.addedAtUtc;
	draft.liveAtUtc = values.liveAtUtc;
	draft.endsAtUtc = values.endsAtUtc;
	draft.availableAtUtc = values.availableAtUtc;
	draft.visibleDaysUpFront =
		values.visibleDaysUpFront.trim() === ""
			? null
			: Number(values.visibleDaysUpFront);
	draft.pro = values.pro;
	// Access ids only mean something on a paid challenge.
	draft.unlockedByEntitlementIds = values.pro ? ids(values.unlockedBy) : [];
	draft.offeringId = values.pro ? blank(values.offeringId) : null;
	draft.discountedForEntitlementIds = values.pro
		? ids(values.discountedFor)
		: [];
	draft.offeringDiscountedId = values.pro
		? blank(values.offeringDiscountedId)
		: null;
	draft.badgeId = values.badgeId;
	draft.perfectCompletionBadgeId = values.perfectCompletionBadgeId;
	draft.imageRelativePath = values.imageRelativePath;
	draft.descriptionFancyContent = values.descriptionFancyContent;
	// Keep whatever else the backend stores on an entry that stays.
	draft.recommendedNext = values.recommendedNext.map(
		(id) => draft.recommendedNext.find((item) => item.id === id) ?? { id },
	);

	const lengthDays = Math.max(1, Math.round(Number(values.lengthDays)) || 1);
	if (lengthDays !== draft.lengthDays) {
		draft.lengthDays = lengthDays;
		for (const path of draft.paths) {
			path.days = resizeDays(path.days, lengthDays);
		}
	}
}

/** Which form field a problem belongs next to. */
const FIELD_OF: Record<string, keyof FormValues> = {
	unlockedByEntitlementIds: "unlockedBy",
	discountedForEntitlementIds: "discountedFor",
};

/** The second tab of a challenge: everything about it except the plans. */
export function ChallengeContentForm({ challenge }: { challenge: Challenge }) {
	const { config, context, badges, challenges } = useChallengeRules(
		challenge.id,
	);
	const form = useForm<FormValues>({ defaultValues: fromChallenge(challenge) });
	const { control, register, formState, watch } = form;
	const [busy, setBusy] = useState(false);
	const [other, setOther] = useState<readonly ApiIssue[]>([]);
	const readOnly = challenge.status === "deleted";
	const paid = watch("pro");
	const dirty = formState.isDirty;

	// Status actions in the page header wait while this form has unsaved input.
	useEffect(() => {
		markUnsaved(challenge.id, dirty);
		return () => markUnsaved(challenge.id, false);
	}, [challenge.id, dirty]);

	// Leaving the tab or the page with unsaved input asks first.
	useBlocker({
		disabled: !dirty,
		enableBeforeUnload: dirty,
		shouldBlockFn: async () => {
			const leave = await confirm({
				title: "Porzucić niezapisane zmiany?",
				description: "Zmiany w treści wyzwania nie zostały zapisane.",
				confirmLabel: "Porzuć zmiany",
				cancelLabel: "Zostań",
				destructive: true,
			});
			return !leave;
		},
	});

	const showIssues = (issues: readonly ApiIssue[]) => {
		const elsewhere: ApiIssue[] = [];
		for (const issue of issues) {
			const field = (FIELD_OF[issue.path] ?? issue.path) as keyof FormValues;
			if (field in form.getValues()) {
				form.setError(field, { message: issue.message });
			} else {
				elsewhere.push(issue);
			}
		}
		setOther(elsewhere);
	};

	const save = async () => {
		form.clearErrors();
		setOther([]);
		const values = form.getValues();

		const lengthDays = Math.max(1, Math.round(Number(values.lengthDays)) || 1);
		const lost = workoutsLostByResize(challenge.paths, lengthDays);
		if (lost > 0) {
			const sure = await confirm({
				title: "Skrócić wyzwanie?",
				description: `Z planów zniknie ${plural(lost, "trening", "treningi", "treningów")} z dni po ${lengthDays}.`,
				confirmLabel: "Skróć",
				destructive: true,
			});
			if (!sure) return;
		}

		setBusy(true);
		try {
			const result = await applyChallengeChange(
				challenge,
				(draft) => applyValues(draft, values),
				{ config, context, done: "Zapisano" },
			);
			if (result.ok) form.reset(values);
			else showIssues(result.issues);
		} catch {
			// Held by the saver; the notice above the tabs explains.
		} finally {
			setBusy(false);
		}
	};

	const error = (field: keyof FormValues) => formState.errors[field]?.message;
	const others = challenges.filter(
		(c) => c.id !== challenge.id && c.status !== "deleted",
	);

	return (
		<form
			// Our own messages, next to the fields, instead of the browser's.
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
			className="flex flex-col gap-4 pb-20"
		>
			{other.length > 0 && (
				<Notice tone="red" role="alert" title="Nie można zapisać">
					<ul className="list-disc pl-5">
						{other.map((issue) => (
							<li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
						))}
					</ul>
				</Notice>
			)}

			<fieldset
				disabled={readOnly || busy}
				className="grid min-w-0 items-start gap-4 xl:grid-cols-2"
			>
				<Card className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Podstawowe</h2>
					<TextField
						label="Nazwa"
						required
						error={error("title")}
						{...register("title")}
					/>
					<TextField
						label="Podtytuł"
						required
						error={error("subtitle")}
						{...register("subtitle")}
					/>
					<TextField
						label="Komentarz"
						hint="Niewidoczny w aplikacji."
						{...register("internalTitle")}
					/>
					<Controller
						control={control}
						name="categoryId"
						render={({ field }) => (
							<Field
								label="Kategoria"
								hint="Dotyczy planów. Wyzwanie z datą premiery jej nie potrzebuje."
								error={error("categoryId")}
							>
								{() => (
									<Select
										label="Kategoria"
										placeholder="Bez kategorii"
										options={config.challengeCategories.map((c) => ({
											value: c.id,
											label: c.title,
										}))}
										value={field.value}
										onChange={field.onChange}
										disabled={readOnly}
										clearable
										className="w-full"
									/>
								)}
							</Field>
						)}
					/>
					<Controller
						control={control}
						name="goalsIds"
						render={({ field }) => (
							<Field label="Cele" error={error("goalsIds")}>
								{() => (
									<MultiSelect
										label="Cele"
										options={config.challengeGoals.map((g) => ({
											value: g.id,
											label: g.title,
										}))}
										value={field.value}
										onChange={field.onChange}
										placeholder="Brak"
										disabled={readOnly}
									/>
								)}
							</Field>
						)}
					/>
					<Controller
						control={control}
						name="difficultyLevelsIds"
						render={({ field }) => (
							<Field
								label="Poziomy trudności"
								error={error("difficultyLevelsIds")}
							>
								{() => (
									<MultiSelect
										label="Poziomy trudności"
										options={config.difficultyLevels.map((d) => ({
											value: d.id,
											label: d.title,
										}))}
										value={field.value}
										onChange={field.onChange}
										placeholder="Brak"
										disabled={readOnly}
									/>
								)}
							</Field>
						)}
					/>
				</Card>

				<Card className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Terminy i czas trwania</h2>
					<Controller
						control={control}
						name="liveAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Data premiery"
								hint="Z datą premiery to wyzwanie, bez niej plan. Ustaw godzinę 13:00: wyzwanie i tak jest dostępne od północy, a to chroni przed błędem „dołączenia w dniu 2”."
								value={field.value}
								onChange={field.onChange}
								disabled={readOnly}
							/>
						)}
					/>
					<Controller
						control={control}
						name="endsAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Data ukrycia"
								hint="Kiedy wyzwanie znika z listy wyzwań."
								value={field.value}
								onChange={field.onChange}
								disabled={readOnly}
							/>
						)}
					/>
					<Controller
						control={control}
						name="availableAtUtc"
						render={({ field }) => (
							<DateTimeField
								label="Widoczne od"
								value={field.value}
								onChange={field.onChange}
								disabled={readOnly}
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
								disabled={readOnly}
							/>
						)}
					/>
					<div className="grid grid-cols-2 gap-4">
						<TextField
							label="Czas trwania (dni)"
							type="number"
							min={1}
							hint="Plany wariantów dopasują się do tej liczby."
							error={error("lengthDays")}
							{...register("lengthDays", { valueAsNumber: true })}
						/>
						<TextField
							label="Widoczne dni do przodu"
							type="number"
							min={0}
							max={100}
							hint="Od 0 do 100."
							error={error("visibleDaysUpFront")}
							{...register("visibleDaysUpFront")}
						/>
					</div>
				</Card>

				<Card className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Dostęp</h2>
					<Controller
						control={control}
						name="pro"
						render={({ field }) => (
							<Switch
								label="Płatne"
								hint="Włącz, jeśli dostęp wymaga wykupienia osobnego produktu."
								checked={field.value}
								onChange={field.onChange}
								disabled={readOnly}
							/>
						)}
					/>
					{paid && (
						<>
							<TextField
								label="Entitlementy odblokowujące"
								placeholder="id1, id2"
								hint="Identyfikatory po przecinku. Pierwszy to ten, który daje zakup tego wyzwania."
								error={error("unlockedBy")}
								{...register("unlockedBy")}
							/>
							<TextField
								label="Offering w najwyższej cenie"
								error={error("offeringId")}
								{...register("offeringId")}
							/>
							<TextField
								label="Entitlementy widzące cenę ze zniżką"
								placeholder="id1, id2"
								error={error("discountedFor")}
								{...register("discountedFor")}
							/>
							<TextField
								label="Offering przeceniony"
								error={error("offeringDiscountedId")}
								{...register("offeringDiscountedId")}
							/>
						</>
					)}
				</Card>

				<Card className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Odznaki i co dalej</h2>
					{(
						[
							["badgeId", "Odznaka za wykonanie"],
							["perfectCompletionBadgeId", "Odznaka za wykonanie w 100%"],
						] as const
					).map(([name, label]) => (
						<Controller
							key={name}
							control={control}
							name={name}
							render={({ field }) => (
								<Field label={label} error={error(name)}>
									{() => (
										<Select
											label={label}
											placeholder="Wybierz odznakę"
											options={badges.map((badge) => ({
												value: badge.id,
												label: badge.name,
											}))}
											value={field.value}
											onChange={field.onChange}
											disabled={readOnly}
											clearable
											className="w-full"
										/>
									)}
								</Field>
							)}
						/>
					))}
					<Controller
						control={control}
						name="recommendedNext"
						render={({ field }) => (
							<Field
								label="Polecane dalej"
								hint="Co zaproponować po ukończeniu tego wyzwania."
								error={error("recommendedNext")}
							>
								{() => (
									<MultiSelect
										label="Polecane dalej"
										options={others.map((c) => ({
											value: c.id,
											label: c.title,
											hint: c.id,
										}))}
										value={field.value}
										onChange={field.onChange}
										placeholder="Brak"
										disabled={readOnly}
									/>
								)}
							</Field>
						)}
					/>
				</Card>

				<Card className="xl:col-span-2">
					<div className="grid gap-4 lg:grid-cols-2">
						<Controller
							control={control}
							name="imageRelativePath"
							render={({ field }) => (
								<MediaField
									label="Miniaturka"
									kind="image"
									folderId="challenges"
									value={field.value}
									onChange={field.onChange}
									error={error("imageRelativePath")}
									disabled={readOnly}
								/>
							)}
						/>
						<Controller
							control={control}
							name="descriptionFancyContent"
							render={({ field }) => (
								<ContentField
									label="Opis"
									editorTitle="Opis wyzwania"
									value={field.value}
									onChange={field.onChange}
									imageFolderId="challenges"
									error={error("descriptionFancyContent")}
									disabled={readOnly || busy}
								/>
							)}
						/>
					</div>
				</Card>
			</fieldset>

			{!readOnly && (
				<div className="fixed inset-x-0 bottom-0 z-30 border-line border-t bg-surface/95 backdrop-blur">
					<div className="mx-auto flex max-w-[1500px] items-center justify-end gap-3 px-4 py-3 md:px-6">
						<span className="text-sm text-muted">
							{dirty ? "Niezapisane zmiany" : "Brak zmian"}
						</span>
						<Button
							size="md"
							disabled={!dirty || busy}
							onClick={() => form.reset(fromChallenge(challenge))}
						>
							Cofnij zmiany
						</Button>
						<Button
							type="submit"
							variant="primary"
							size="md"
							disabled={!dirty || busy}
						>
							{busy ? "Zapisywanie…" : "Zapisz zmiany"}
						</Button>
					</div>
				</div>
			)}
		</form>
	);
}
