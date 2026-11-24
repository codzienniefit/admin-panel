import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { type ApiIssue, failureText, isApiError } from "@/data/api/errors";
import {
	createOffer,
	offerChoicesQuery,
	offerSaver,
	offersCollection,
	offerTarget,
	setOfferActive,
} from "@/data/collections/offers";
import { queryClient } from "@/data/collections/queryClient";
import { blankOffer, type NewOffer, type Offer } from "@/data/schemas/offer";
import { formatDateTime } from "@/domain/dates";
import {
	normalizeOfferCode,
	OFFER_STATE_TEXT,
	OFFER_SUBTITLE_MAX,
	OFFER_TITLE_MAX,
	offerActivationIssues,
	offerIssues,
	offerState,
} from "@/domain/offerRules";
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
import { Facts } from "@/ui/Facts";
import { Field, TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice, placeIssues } from "@/ui/formIssues";
import type { MenuAction } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { Tag } from "@/ui/Tag";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";
import { OFFER_STATE_META } from "./offerMeta";

/** What the form holds; `toFields` turns it into what is stored. */
interface FormValues {
	code: string;
	offeringId: string | null;
	entitlementId: string | null;
	title: string;
	subtitle: string;
	validFromUtc: string | null;
	expiresAtUtc: string | null;
	androidProductId: string;
	androidBasePlanId: string;
	androidOfferId: string;
	iosProductId: string;
}

const FIELDS = [
	"code",
	"offeringId",
	"entitlementId",
	"title",
	"subtitle",
	"validFromUtc",
	"expiresAtUtc",
	"androidProductId",
	"androidBasePlanId",
	"androidOfferId",
	"iosProductId",
] as const satisfies ReadonlyArray<keyof FormValues>;

/** Where the rules' paths (the stored shape) are in this form. */
const FORM_PATH: Record<string, keyof FormValues> = {
	storeAndroid: "androidProductId",
	"storeAndroid.productId": "androidProductId",
	"storeAndroid.basePlanId": "androidBasePlanId",
	"storeAndroid.offerId": "androidOfferId",
	storeIos: "iosProductId",
	"storeIos.productId": "iosProductId",
};

const FIELD_LABELS: Record<string, string> = {
	code: "Kod",
	offeringId: "Offering",
	entitlementId: "Entitlement",
	title: "Tytuł",
	subtitle: "Podtytuł",
	validFromUtc: "Działa od",
	expiresAtUtc: "Działa do",
	storeAndroid: "Google Play",
	storeIos: "App Store",
};

function fromOffer(offer: NewOffer): FormValues {
	return {
		code: offer.code,
		offeringId: offer.offeringId || null,
		entitlementId: offer.entitlementId,
		title: offer.title ?? "",
		subtitle: offer.subtitle ?? "",
		validFromUtc: offer.validFromUtc,
		expiresAtUtc: offer.expiresAtUtc,
		androidProductId: offer.storeAndroid?.productId ?? "",
		androidBasePlanId: offer.storeAndroid?.basePlanId ?? "",
		androidOfferId: offer.storeAndroid?.offerId ?? "",
		iosProductId: offer.storeIos?.productId ?? "",
	};
}

type EditedFields = Omit<NewOffer, "active">;

/**
 * The stored shape of what the form holds: the code in capitals, texts
 * without the space around them, an empty text as null. A store with every
 * field empty is "no store"; one with some filled in is kept as it is, so
 * the rules say which field is missing.
 */
function toFields(values: FormValues): EditedFields {
	const text = (value: string) => value.trim() || null;
	const android = [
		values.androidProductId,
		values.androidBasePlanId,
		values.androidOfferId,
	].map((value) => value.trim());
	const ios = values.iosProductId.trim();
	return {
		code: normalizeOfferCode(values.code),
		offeringId: values.offeringId?.trim() ?? "",
		entitlementId: values.entitlementId?.trim() || null,
		title: text(values.title),
		subtitle: text(values.subtitle),
		validFromUtc: values.validFromUtc,
		expiresAtUtc: values.expiresAtUtc,
		storeAndroid: android.some(Boolean)
			? {
					productId: android[0] ?? "",
					basePlanId: android[1] ?? "",
					offerId: android[2] ?? "",
				}
			: null,
		storeIos: ios ? { productId: ios } : null,
	};
}

/** The rules' paths moved onto this form's fields. */
const onForm = (issues: readonly ApiIssue[]): ApiIssue[] =>
	issues.map((issue) => ({
		path: FORM_PATH[issue.path] ?? issue.path,
		message: issue.message,
	}));

interface OfferEditorProps {
	/** null creates a new offer. */
	offerId: string | null;
	onClose: () => void;
	/** Shows another offer in the editor: one just created. */
	onOpen: (offerId: string) => void;
}

export function OfferEditor({ offerId, onClose, onOpen }: OfferEditorProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ offer: offersCollection }),
	});
	const offer = offerId
		? (data?.find((item) => item.id === offerId) ?? null)
		: null;

	if (offerId && !offer) {
		return (
			<EditorPlaceholder
				loading={isLoading}
				missingTitle="Nie ma takiej oferty"
				missingText="Ta oferta nie istnieje. Wybierz ofertę z listy."
				onClose={onClose}
			/>
		);
	}

	return (
		<OfferForm
			key={offer?.id ?? "new"}
			offer={offer}
			others={(data ?? []).filter((item) => item.id !== offer?.id)}
			onClose={onClose}
			onOpen={onOpen}
		/>
	);
}

interface OfferFormProps {
	offer: Offer | null;
	others: readonly Offer[];
	onClose: () => void;
	onOpen: (offerId: string) => void;
}

const ROW = "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2";
const ROW3 = "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3";

function OfferForm({
	offer,
	others,
	onClose: closeEditor,
	onOpen: openOffer,
}: OfferFormProps) {
	const [base] = useState<NewOffer>(() => offer ?? blankOffer());
	const form = useForm<FormValues>({ defaultValues: fromOffer(base) });
	const { control, register, formState } = form;
	const [busy, setBusy] = useState(false);
	const choices = useQuery(offerChoicesQuery(), queryClient);
	const leave = useUnsavedGuard(
		formState.isDirty,
		"Zmiany w tej ofercie nie zostały zapisane.",
	);
	const onClose = () => {
		leave();
		closeEditor();
	};
	const onOpen = (nextOfferId: string) => {
		leave();
		openOffer(nextOfferId);
	};
	const [problems, setProblems] = useState<{
		title: string;
		issues: readonly ApiIssue[];
	} | null>(null);
	const [title, subtitle] = useWatch({
		control,
		name: ["title", "subtitle"],
	});

	const now = new Date().toISOString();
	const state = offer ? offerState(offer, now) : "draft";
	const stateMeta = OFFER_STATE_META[state];
	// What a switched-off offer still lacks, as it is stored.
	const missing =
		offer && !offer.active ? offerActivationIssues(offer, { others, now }) : [];

	const show = (heading: string, issues: readonly ApiIssue[]) => {
		const elsewhere = placeIssues(form, FIELDS, onForm(issues));
		setProblems(
			elsewhere.length > 0 ? { title: heading, issues: elsewhere } : null,
		);
	};

	const save = async () => {
		form.clearErrors();
		setProblems(null);
		const fields = toFields(form.getValues());
		const candidate = { ...(offer ?? blankOffer()), ...fields };

		// The rules the server applies, first, next to their fields.
		const issues = offerIssues(candidate, { others, stored: offer, now });
		if (issues.length > 0) {
			show("Nie można zapisać", issues);
			return;
		}

		if (offer?.active && offer.code !== candidate.code) {
			const sure = await confirm({
				title: "Zmienić kod aktywnej oferty?",
				description: `Linki z kodem ${offer.code} przestaną działać od razu: aplikacja odpowie „nieznany kod”. Działać będą tylko linki z kodem ${candidate.code}.`,
				confirmLabel: "Zmień kod",
				destructive: true,
			});
			if (!sure) return;
		}

		if (!offer) {
			const created = await whileBusy(setBusy, () =>
				attempt(() => createOffer({ ...candidate, active: false })),
			);
			if (!created.ok) {
				const { error } = created;
				show(
					"Nie można zapisać",
					isApiError(error) && error.kind === "validation"
						? error.issues
						: [
								generalIssue(
									failureText(
										error,
										"Nie udało się zapisać. Spróbuj ponownie za chwilę.",
									),
								),
							],
				);
				return;
			}
			toast({
				title: "Oferta utworzona",
				description: "Jest wyłączona. Włącz ją, kiedy będzie gotowa.",
				tone: "green",
			});
			// Stays open: switching it on is what comes next.
			onOpen(created.value.id);
			return;
		}

		const applied = await whileBusy(setBusy, () =>
			attempt(() =>
				applyChange(offerTarget, offer, (draft) => {
					Object.assign(draft, fields);
				}),
			),
		);
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
			title: "Oferta zapisana",
			description: applied.value.merged
				? "Połączono ze zmianami innej osoby."
				: undefined,
			tone: "green",
		});
		onClose();
	};

	const switchTo = async (active: boolean) => {
		if (!offer) return;
		form.clearErrors();
		setProblems(null);
		if (formState.isDirty) {
			show(active ? "Nie można włączyć" : "Nie można wyłączyć", [
				generalIssue(
					"Najpierw zapisz albo odrzuć zmiany w formularzu: włącza się i wyłącza ofertę taką, jaka jest zapisana.",
				),
			]);
			return;
		}
		if (active && missing.length > 0) {
			show("Nie można włączyć", missing);
			return;
		}
		const sure = await confirm(
			active
				? {
						title: "Włączyć ofertę?",
						description: `Kod ${offer.code} zacznie działać w aplikacji${offer.validFromUtc ? ` od ${formatDateTime(offer.validFromUtc)}` : " od razu"}. Osoby z linkiem zobaczą „${offer.title ?? ""}” i offering ${offer.offeringId}.`,
						confirmLabel: "Włącz",
					}
				: {
						title: "Wyłączyć ofertę?",
						description: `Kod ${offer.code} przestanie działać od razu: aplikacja odpowie „nieznany kod”. Zakupy, które już policzono, zostają. Ofertę można włączyć z powrotem.`,
						confirmLabel: "Wyłącz",
						destructive: true,
					},
		);
		if (!sure) return;
		const switched = await whileBusy(setBusy, () =>
			attempt(() => setOfferActive(offer.id, active)),
		);
		if (switched.ok) {
			toast({
				title: active ? "Oferta włączona" : "Oferta wyłączona",
				tone: "green",
			});
			return;
		}
		const { error } = switched;
		const changed = isApiError(error) && error.kind === "conflict";
		if (changed) {
			const stored = offersCollection.get(offer.id);
			if (stored) form.reset(fromOffer(stored));
		}
		show(
			active ? "Nie można włączyć" : "Nie można wyłączyć",
			isApiError(error) && error.kind === "validation"
				? error.issues
				: [
						generalIssue(
							changed
								? "Ktoś zmienił tę ofertę w międzyczasie. Na ekranie jest już jej aktualna wersja: sprawdź ją i spróbuj ponownie."
								: failureText(
										error,
										"Nie udało się. Spróbuj ponownie za chwilę.",
									),
						),
					],
		);
	};

	const requestClose = async () => {
		const sure = await confirmDiscard(
			formState.isDirty && !busy,
			"Zmiany w tej ofercie nie zostały zapisane.",
		);
		if (sure) onClose();
	};

	const json = useJsonPreview("oferty", () => {
		const fields = toFields(form.getValues());
		return offer
			? previewChange(offerTarget, offer, (draft) => {
					Object.assign(draft, fields);
				})
			: { before: undefined, after: { ...base, ...fields } };
	});

	const more: MenuAction[] =
		offer?.active === true
			? [
					json.action,
					{
						label: "Wyłącz ofertę",
						destructive: true,
						disabled: busy,
						onSelect: () => void switchTo(false),
					},
				]
			: [json.action];

	const error = (field: keyof FormValues) => formState.errors[field]?.message;
	const offeringIds = choices.data?.offeringIds ?? null;
	const entitlementIds = choices.data?.entitlementIds ?? null;
	// A stored id RevenueCat no longer lists still shows, as itself.
	const withStored = (ids: readonly string[], stored: string | null) =>
		(stored && !ids.includes(stored) ? [stored, ...ids] : ids).map((id) => ({
			value: id,
			label: id,
		}));

	return (
		<Dialog
			open
			onClose={() => void requestClose()}
			title={offer ? offer.code : "Nowa oferta"}
			description={
				offer
					? `Zmieniono ${formatDateTime(offer.updatedAtUtc || null)}`
					: "Nowa oferta jest wyłączona. Włączysz ją, kiedy będzie kompletna."
			}
			size="lg"
			footer={
				<>
					<MoreActions actions={more} />
					<Button size="md" onClick={() => void requestClose()}>
						Anuluj
					</Button>
					{offer && !offer.active && (
						<Button
							size="md"
							disabled={busy}
							onClick={() => void switchTo(true)}
						>
							Włącz ofertę
						</Button>
					)}
					<Button
						size="md"
						variant="primary"
						disabled={busy}
						onClick={() => void save()}
					>
						{busy ? "Zapisywanie…" : offer ? "Zapisz zmiany" : "Utwórz ofertę"}
					</Button>
				</>
			}
		>
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
				className="flex flex-col gap-5"
			>
				{offer && (
					<div className="flex flex-wrap items-center gap-2">
						<Tag tone={stateMeta.tone}>{stateMeta.label}</Tag>
						<span className="text-sm text-subtle">
							{OFFER_STATE_TEXT[state]}
						</span>
					</div>
				)}

				{offer && (
					<HeldEditsNotice
						saver={offerSaver}
						id={offer.id}
						describe={(location) => FIELD_LABELS[location] ?? location}
						onResolved={(kept) => {
							if (kept === "mine") {
								toast({ title: "Oferta zapisana", tone: "green" });
								onClose();
								return;
							}
							const stored = offersCollection.get(offer.id);
							if (stored) form.reset(fromOffer(stored));
						}}
					/>
				)}
				{problems && (
					<IssuesNotice title={problems.title} issues={problems.issues} />
				)}
				{offer &&
					!offer.active &&
					!formState.isDirty &&
					(missing.length > 0 ? (
						<Notice tone="grey" title="Żeby włączyć ofertę, uzupełnij">
							<ul className="list-disc pl-5">
								{missing.map((issue) => (
									<li key={`${issue.path}-${issue.message}`}>
										{issue.message}
									</li>
								))}
							</ul>
						</Notice>
					) : (
						<Notice tone="green" title="Oferta jest gotowa do włączenia">
							Backend sprawdzi jeszcze w RevenueCat, czy offering istnieje.
						</Notice>
					))}

				<fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
					<div className={ROW}>
						<TextField
							label="Kod"
							required
							hint="Od 3 do 32 znaków: litery, cyfry, „-” i „_”. Zapisany wielkimi literami."
							error={error("code")}
							autoComplete="off"
							spellCheck={false}
							{...register("code")}
						/>
						<Controller
							control={control}
							name="offeringId"
							render={({ field }) =>
								offeringIds ? (
									<Field
										label="Offering z RevenueCat"
										required
										error={error("offeringId")}
										hint="Co aplikacja pokaże po otwarciu linku."
									>
										{() => (
											<Select
												label="Offering z RevenueCat"
												placeholder="Wybierz offering"
												options={withStored(
													offeringIds,
													base.offeringId || null,
												)}
												value={field.value}
												onChange={field.onChange}
												invalid={Boolean(error("offeringId"))}
												disabled={busy}
												className="w-full"
											/>
										)}
									</Field>
								) : (
									<TextField
										label="Offering z RevenueCat"
										required
										hint={
											choices.isLoading
												? "Pobieranie listy z RevenueCat…"
												: "Nie udało się pobrać listy z RevenueCat: wpisz identyfikator. Backend sprawdzi go przy włączaniu."
										}
										error={error("offeringId")}
										autoComplete="off"
										spellCheck={false}
										value={field.value ?? ""}
										onChange={(event) => field.onChange(event.target.value)}
										onBlur={field.onBlur}
									/>
								)
							}
						/>
					</div>

					<div className={ROW}>
						<TextField
							label="Tytuł"
							hint={`Nagłówek arkusza w aplikacji. Najwyżej ${OFFER_TITLE_MAX} znaków.`}
							error={error("title")}
							maxLength={OFFER_TITLE_MAX * 2}
							{...register("title")}
						/>
						<TextField
							label="Podtytuł"
							hint={`Linia pod nagłówkiem. Najwyżej ${OFFER_SUBTITLE_MAX} znaków.`}
							error={error("subtitle")}
							maxLength={OFFER_SUBTITLE_MAX * 2}
							{...register("subtitle")}
						/>
					</div>

					{(title.trim() || subtitle.trim()) && (
						<section
							aria-label="Podgląd arkusza"
							className="rounded-card border border-line bg-bg p-4"
						>
							<p className="mb-1 text-xs text-muted">
								Tak zobaczy to osoba z linkiem
							</p>
							<p className="font-semibold [overflow-wrap:anywhere]">
								{title.trim() || "—"}
							</p>
							<p className="text-sm text-subtle [overflow-wrap:anywhere]">
								{subtitle.trim() || "—"}
							</p>
						</section>
					)}

					<div className={ROW}>
						<Controller
							control={control}
							name="validFromUtc"
							render={({ field }) => (
								<DateTimeField
									label="Działa od"
									hint="Puste: od włączenia. Wcześniej kod jest „nieznany”."
									value={field.value}
									onChange={field.onChange}
									error={error("validFromUtc")}
									disabled={busy}
								/>
							)}
						/>
						<Controller
							control={control}
							name="expiresAtUtc"
							render={({ field }) => (
								<DateTimeField
									label="Działa do"
									hint="Puste: bez końca. Potem aplikacja mówi „oferta wygasła”."
									value={field.value}
									onChange={field.onChange}
									error={error("expiresAtUtc")}
									disabled={busy}
								/>
							)}
						/>
					</div>

					<Controller
						control={control}
						name="entitlementId"
						render={({ field }) =>
							entitlementIds ? (
								<Field
									label="Entitlement"
									error={error("entitlementId")}
									hint="Co daje zakup. Puste: Pro."
								>
									{() => (
										<Select
											label="Entitlement"
											placeholder="Pro (domyślnie)"
											options={withStored(entitlementIds, base.entitlementId)}
											value={field.value}
											onChange={field.onChange}
											clearable
											disabled={busy}
											className="w-full md:w-1/2"
										/>
									)}
								</Field>
							) : (
								<TextField
									label="Entitlement"
									hint="Co daje zakup. Puste: Pro."
									error={error("entitlementId")}
									autoComplete="off"
									spellCheck={false}
									value={field.value ?? ""}
									onChange={(event) =>
										field.onChange(event.target.value || null)
									}
									onBlur={field.onBlur}
								/>
							)
						}
					/>

					<section aria-label="Google Play" className="flex flex-col gap-2">
						<h2 className="text-sm font-semibold">Google Play</h2>
						<p className="text-xs text-muted">
							Aplikacja sprawdza przed otwarciem paywalla, czy osoba może
							skorzystać z tej oferty w sklepie. Bez tych danych ktoś, kto już
							miał darmowy okres, zobaczy pełną cenę pod nagłówkiem o darmowym
							miesiącu.
						</p>
						<div className={ROW3}>
							<TextField
								label="Produkt"
								error={error("androidProductId")}
								autoComplete="off"
								spellCheck={false}
								{...register("androidProductId")}
							/>
							<TextField
								label="Plan bazowy"
								error={error("androidBasePlanId")}
								autoComplete="off"
								spellCheck={false}
								{...register("androidBasePlanId")}
							/>
							<TextField
								label="Oferta w Google Play"
								error={error("androidOfferId")}
								autoComplete="off"
								spellCheck={false}
								{...register("androidOfferId")}
							/>
						</div>
					</section>

					<section aria-label="App Store" className="flex flex-col gap-2">
						<h2 className="text-sm font-semibold">App Store</h2>
						<div className={ROW}>
							<TextField
								label="Produkt"
								error={error("iosProductId")}
								autoComplete="off"
								spellCheck={false}
								{...register("iosProductId")}
							/>
						</div>
					</section>
				</fieldset>

				{offer && (
					<Facts
						items={[
							{ label: "Identyfikator", value: offer.id },
							{ label: "Zakupy z tej oferty", value: offer.purchases },
							{
								label: "Utworzono",
								value: formatDateTime(offer.createdAtUtc || null),
							},
						]}
					/>
				)}
			</form>
			{json.dialog}
		</Dialog>
	);
}
