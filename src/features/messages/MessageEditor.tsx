import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import { challengesCollection } from "@/data/collections/challenges";
import {
	createMessage,
	messageSaver,
	messagesCollection,
	messageTarget,
} from "@/data/collections/messages";
import {
	blankMessage,
	type Message,
	type NewMessage,
} from "@/data/schemas/message";
import { formatDateTime } from "@/domain/dates";
import {
	isEditable,
	type MessageAction,
	type MessageContent,
	messageActionIssues,
	messageIssues,
	recipientsText,
	requiredGroupValue,
	type TargetGroups,
} from "@/domain/messageRules";
import { useConfig } from "@/features/config/useConfig";
import { ContentField } from "@/features/content/ContentField";
import { applyChange } from "@/features/saving/applyChange";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { useUnsavedGuard } from "@/features/saving/useUnsavedGuard";
import { Button } from "@/ui/Button";
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
import { duplicateMessage, performMessageAction } from "./messageActions";
import { messageStatusMeta, targetGroupMeta } from "./messageMeta";

/** The fields the form edits. Everything else on a message passes through. */
type FormValues = MessageContent;

const FIELDS = [
	"title",
	"from",
	"targetGroup",
	"targetGroupValue",
	"fancyContent",
] as const satisfies ReadonlyArray<keyof FormValues>;

const FIELD_LABELS: Record<string, string> = {
	title: "Opis",
	from: "Nadawca",
	targetGroup: "Odbiorcy",
	targetGroupValue: "Odbiorcy",
	fancyContent: "Treść",
};

function pickFields(source: MessageContent): FormValues {
	return {
		title: source.title,
		from: source.from,
		targetGroup: source.targetGroup,
		targetGroupValue: source.targetGroupValue,
		fancyContent: source.fancyContent,
	};
}

/** What the form holds, in the shape that is stored. */
function normalise(values: FormValues, groups: TargetGroups): FormValues {
	const needsValue = requiredGroupValue(groups, values.targetGroup);
	return {
		...values,
		title: values.title.trim(),
		from: values.from.trim(),
		// A value left over from another group must not travel with this one.
		targetGroupValue: needsValue
			? values.targetGroupValue?.trim() || null
			: null,
	};
}

interface MessageEditorProps {
	/** null writes a new message. */
	messageId: string | null;
	onClose: () => void;
	/** Shows another message in the editor: one just created or copied. */
	onOpen: (messageId: string) => void;
}

export function MessageEditor({
	messageId,
	onClose,
	onOpen,
}: MessageEditorProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ message: messagesCollection }),
	});
	const message = messageId
		? (data?.find((item) => item.id === messageId) ?? null)
		: null;

	// A new message also waits for the list: its sender starts as the one
	// used most recently.
	if (isLoading || (messageId && !message)) {
		return (
			<EditorPlaceholder
				loading={isLoading}
				missingTitle="Nie ma takiej wiadomości"
				missingText="Ta wiadomość nie istnieje. Sprawdź adres albo wybierz wiadomość z listy."
				onClose={onClose}
				size="full"
			/>
		);
	}

	const newest = [...(data ?? [])].sort((a, b) =>
		b.createdAtUtc.localeCompare(a.createdAtUtc),
	)[0];

	return (
		<MessageForm
			// A different message is a different form.
			key={message?.id ?? "new"}
			message={message}
			defaultSender={newest?.from ?? ""}
			onClose={onClose}
			onOpen={onOpen}
		/>
	);
}

interface MessageFormProps {
	message: Message | null;
	defaultSender: string;
	onClose: () => void;
	onOpen: (messageId: string) => void;
}

type SaveResult = "saved" | "unchanged" | "merged" | "failed";

function MessageForm({
	message,
	defaultSender,
	onClose: closeEditor,
	onOpen: openMessage,
}: MessageFormProps) {
	const { draftMessageStates: states, draftMessageTargetGroups: groups } =
		useConfig().internal;
	const [base] = useState<NewMessage>(
		() => message ?? { ...blankMessage(), from: defaultSender },
	);
	const form = useForm<FormValues>({ defaultValues: pickFields(base) });
	const { control, register, formState } = form;
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<{
		title: string;
		issues: readonly ApiIssue[];
	} | null>(null);

	const status = message?.status ?? "draft";
	const editable = isEditable(status);
	const statusMeta = messageStatusMeta(status, states);
	const dirty = editable && formState.isDirty;
	// Leaving another way (the browser's Back, a link in the top bar) asks
	// first. The editor's own buttons have asked or saved already.
	const leave = useUnsavedGuard(
		dirty,
		"Zmiany w tej wiadomości nie zostały zapisane.",
	);
	const onClose = () => {
		leave();
		closeEditor();
	};
	const onOpen = (messageId: string) => {
		leave();
		openMessage(messageId);
	};
	// What is being typed, for the "from / to" line. (useWatch, not
	// form.watch(): the React Compiler cannot compile a component that calls
	// the latter.) The content is not watched here on purpose: its field shows
	// its own preview and problems, and watching it would redraw this whole
	// editor on every keystroke in a block.
	const [typedSender, typedGroup] = useWatch({
		control,
		name: ["from", "targetGroup"],
	});
	const needsValue = requiredGroupValue(groups, typedGroup);

	const show = (title: string, issues: readonly ApiIssue[]) => {
		const elsewhere = placeIssues(form, FIELDS, issues);
		setProblems(elsewhere.length > 0 ? { title, issues: elsewhere } : null);
	};

	const candidateOf = (): NewMessage => ({
		...base,
		...normalise(form.getValues(), groups),
	});

	/**
	 * Writes what is in the form to the draft. Problems end up on screen; the
	 * result only says whether the caller may carry on.
	 */
	const saveDraft = async (): Promise<SaveResult> => {
		form.clearErrors();
		setProblems(null);
		// The same rules the server applies, checked first so that problems
		// show next to their fields without a round trip.
		const rules = (item: MessageContent) => messageIssues(item, groups);

		if (!message) {
			const candidate = candidateOf();
			const issues = rules(candidate);
			if (issues.length > 0) {
				show("Nie można zapisać", issues);
				return "failed";
			}
			const created = await whileBusy(setBusy, () =>
				attempt(() => createMessage(candidate)),
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
				return "failed";
			}
			toast({
				title: "Zapisano jako roboczą",
				description: "Nikt jej nie dostanie, dopóki jej nie wyślesz.",
				tone: "green",
			});
			onOpen(created.value.id);
			return "saved";
		}

		const values = normalise(form.getValues(), groups);
		const applied = await whileBusy(setBusy, () =>
			attempt(() =>
				applyChange(
					messageTarget,
					message,
					(draft) => {
						Object.assign(draft, values);
					},
					{ issuesOf: rules },
				),
			),
		);
		// Thrown: a conflict or a save that kept failing. The saver holds the
		// edits and HeldEditsNotice explains what happened.
		if (!applied.ok) return "failed";
		if (!applied.value.ok) {
			show("Nie można zapisać", applied.value.issues);
			return "failed";
		}
		if (!applied.value.changed) return "unchanged";

		const merged = applied.value.merged;
		// The form now starts from what the server holds.
		const stored = messagesCollection.get(message.id);
		if (stored) form.reset(pickFields(stored));
		return merged ? "merged" : "saved";
	};

	const save = async () => {
		const result = await saveDraft();
		if (result === "failed" || !message) return;
		if (result !== "unchanged") {
			toast({
				title: "Wiadomość zapisana",
				description:
					result === "merged"
						? "Połączono ze zmianami innej osoby."
						: undefined,
				tone: "green",
			});
		}
		onClose();
	};

	const act = async (action: MessageAction) => {
		if (!message) return;
		const outcome = await whileBusy(setBusy, () =>
			performMessageAction(message.id, action, groups),
		);
		if (outcome.result === "refused") show(outcome.title, outcome.issues);
		// Back from the archive it stays open: the next step is usually here.
		if (outcome.result === "done" && action !== "unarchive") onClose();
	};

	const send = async () => {
		if (!message) return;
		form.clearErrors();
		setProblems(null);
		// What is on screen is checked against the sending rules before
		// anything is saved, so the reasons show at once.
		const issues = messageActionIssues(
			{ ...candidateOf(), status: message.status },
			"send",
			groups,
		);
		if (issues.length > 0) {
			show("Nie można wysłać", issues);
			return;
		}
		const result = await saveDraft();
		if (result === "failed") return;
		if (result === "merged") {
			// What would go out is no longer only what this person wrote.
			setProblems({
				title: "Przeczytaj wiadomość jeszcze raz",
				issues: [
					generalIssue(
						"W międzyczasie zmienił ją też ktoś inny i zmiany zostały połączone. Sprawdź całość i dopiero wtedy wyślij.",
					),
				],
			});
			return;
		}
		await act("send");
	};

	const duplicate = async () => {
		if (!message) return;
		const copied = await whileBusy(setBusy, () =>
			attempt(() => duplicateMessage(message)),
		);
		if (!copied.ok) {
			show("Nie można utworzyć kopii", [
				generalIssue(
					"Nie udało się zapisać kopii. Spróbuj ponownie za chwilę.",
				),
			]);
			return;
		}
		toast({ title: "Utworzono kopię roboczą", tone: "green" });
		onOpen(copied.value.id);
	};

	const requestClose = async () => {
		const sure = await confirmDiscard(
			dirty && !busy,
			"Zmiany w tej wiadomości nie zostały zapisane.",
		);
		if (sure) onClose();
	};

	// Actions work on the saved message, so they wait for unsaved input.
	const afterSaving = (label: string) =>
		dirty ? `${label} (najpierw zapisz zmiany)` : label;
	const more: MenuAction[] = [];
	if (message) {
		more.push({
			label: afterSaving("Utwórz kopię roboczą"),
			disabled: dirty || busy,
			onSelect: () => void duplicate(),
		});
	}
	if (message && status === "draft") {
		more.push({
			label: afterSaving("Przenieś do archiwum"),
			destructive: true,
			disabled: dirty || busy,
			onSelect: () => void act("archive"),
		});
	}

	const error = (field: keyof FormValues) => formState.errors[field]?.message;
	const facts = message
		? [
				{ label: "Utworzono", value: formatDateTime(message.createdAtUtc) },
				...(message.sentAtUtc
					? [
							{
								label: "Wysłano",
								value: `${formatDateTime(message.sentAtUtc)}, odbiorcy: ${recipientsText(groups, message.targetGroup)}`,
							},
						]
					: []),
				...(message.archivedAtUtc
					? [
							{
								label: "W archiwum od",
								value: formatDateTime(message.archivedAtUtc),
							},
						]
					: []),
			]
		: [];

	return (
		<Dialog
			open
			onClose={() => void requestClose()}
			title={message ? message.title || "Bez opisu" : "Nowa wiadomość"}
			description={
				message
					? undefined
					: "Zapisze się jako robocza. Wysyłka to osobny krok, po zapisaniu."
			}
			size="full"
			footer={
				<>
					<MoreActions actions={more} />
					<Button size="md" onClick={() => void requestClose()}>
						{editable ? "Anuluj" : "Zamknij"}
					</Button>
					{!message && (
						<Button
							size="md"
							variant="primary"
							disabled={busy}
							onClick={() => void save()}
						>
							{busy ? "Zapisywanie…" : "Zapisz jako roboczą"}
						</Button>
					)}
					{message && status === "draft" && (
						<>
							<Button size="md" disabled={busy} onClick={() => void save()}>
								{busy ? "Zapisywanie…" : "Zapisz roboczą"}
							</Button>
							<Button
								size="md"
								variant="primary"
								disabled={busy}
								onClick={() => void send()}
							>
								Wyślij…
							</Button>
						</>
					)}
					{status === "sent" && (
						<Button
							size="md"
							disabled={busy}
							onClick={() => void act("archive")}
						>
							Przenieś do archiwum
						</Button>
					)}
					{status === "archived" && (
						<Button
							size="md"
							variant="primary"
							disabled={busy}
							onClick={() => void act("unarchive")}
						>
							Przywróć z archiwum
						</Button>
					)}
				</>
			}
		>
			<div className="mx-auto max-w-6xl">
				<form
					// Our own messages, next to the fields, instead of the browser's.
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						// Enter saves the draft. It never sends.
						if (editable) void save();
					}}
					className="flex min-w-0 flex-col gap-5"
				>
					{message && (
						<div className="flex flex-col gap-3">
							<div>
								<Tag tone={statusMeta.tone}>{statusMeta.label}</Tag>
							</div>
							<Facts items={facts} />
						</div>
					)}

					{message && (
						<HeldEditsNotice
							saver={messageSaver}
							id={message.id}
							describe={(location) => FIELD_LABELS[location] ?? location}
							onResolved={(kept) => {
								if (kept === "mine") {
									toast({ title: "Wiadomość zapisana", tone: "green" });
									onClose();
									return;
								}
								const stored = messagesCollection.get(message.id);
								if (stored) form.reset(pickFields(stored));
							}}
						/>
					)}
					{problems && (
						<IssuesNotice title={problems.title} issues={problems.issues} />
					)}
					{status === "sent" && (
						<Notice tone="grey" title="Ta wiadomość została wysłana">
							Odbiorcy już ją mają, więc nie można jej zmienić. Żeby wysłać
							poprawioną wersję, utwórz kopię roboczą (Więcej).
						</Notice>
					)}
					{status === "archived" && (
						<Notice tone="grey" title="Ta wiadomość jest w archiwum">
							{message?.sentAtUtc
								? "Była wysłana i nie można jej zmienić. Po przywróceniu wróci na listę jako wysłana."
								: "Nie została wysłana. Po przywróceniu znów będzie robocza i będzie można ją edytować."}
						</Notice>
					)}
					{editable && (
						<Notice tone="blue" title="Zanim napiszesz">
							Nie pisz o kupowaniu subskrypcji przez sklep z aplikacjami: Apple
							może za to zablokować aplikację. W tekście działają tylko
							pogrubienie i linki.
						</Notice>
					)}

					<fieldset
						disabled={!editable || busy}
						className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
					>
						<div className="md:col-span-2">
							<TextField
								label="Opis"
								required
								hint="Dla zespołu, żeby łatwo znaleźć wiadomość. Niewidoczny w aplikacji."
								error={error("title")}
								{...register("title")}
							/>
						</div>
						<TextField
							label="Nadawca"
							hint="Tak podpisana będzie wiadomość w aplikacji."
							error={error("from")}
							{...register("from")}
						/>
						<Controller
							control={control}
							name="targetGroup"
							render={({ field }) => (
								<Field
									label="Odbiorcy"
									hint="Kto dostanie wiadomość po wysłaniu."
									error={error("targetGroup")}
								>
									{() => (
										<Select
											label="Odbiorcy"
											placeholder="Wybierz odbiorców"
											options={groups.map((group) => ({
												value: group.state,
												label: group.label,
												tone: targetGroupMeta(group.state, groups).tone,
											}))}
											value={field.value}
											onChange={field.onChange}
											invalid={Boolean(error("targetGroup"))}
											disabled={!editable || busy}
											clearable
											className="w-full"
										/>
									)}
								</Field>
							)}
						/>
						{needsValue && (
							<div className="md:col-span-2">
								<Controller
									control={control}
									name="targetGroupValue"
									render={({ field }) => (
										<GroupValueField
											kind={needsValue}
											value={field.value}
											onChange={field.onChange}
											error={error("targetGroupValue")}
											disabled={!editable || busy}
										/>
									)}
								/>
							</div>
						)}
					</fieldset>

					<div className="flex min-w-0 flex-col gap-1.5">
						<Controller
							control={control}
							name="fancyContent"
							render={({ field }) => (
								<ContentField
									label="Treść"
									value={field.value}
									onChange={field.onChange}
									imageFolderId="messages"
									error={error("fancyContent")}
									disabled={!editable || busy}
								/>
							)}
						/>
						{/* The one thing the field's own preview cannot know. */}
						<p className="text-xs text-muted [overflow-wrap:anywhere]">
							Od: {typedSender.trim() || "nie podano nadawcy"} · Do:{" "}
							{recipientsText(groups, typedGroup)}
						</p>
					</div>
				</form>
			</div>
		</Dialog>
	);
}

interface GroupValueFieldProps {
	/** What the backend says the group needs, e.g. "challengeId". */
	kind: string;
	value: string | null;
	onChange: (value: string | null) => void;
	error?: string;
	disabled: boolean;
}

/**
 * The extra value some target groups need. When it is a challenge, it is
 * picked from the list; anything else is typed in.
 */
function GroupValueField({
	kind,
	value,
	onChange,
	error,
	disabled,
}: GroupValueFieldProps) {
	const forChallenge = /challenge/i.test(kind);
	const { data: challenges } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});

	if (!forChallenge) {
		return (
			<TextField
				label="Kogo dotyczy"
				hint="Ta grupa odbiorców wymaga doprecyzowania."
				error={error}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value || null)}
				disabled={disabled}
			/>
		);
	}
	return (
		<Field
			label="Wyzwanie"
			hint="Wiadomość dostaną uczestnicy tego wyzwania."
			error={error}
		>
			{() => (
				<Select
					label="Wyzwanie"
					placeholder="Wybierz wyzwanie"
					options={(challenges ?? [])
						.filter((challenge) => challenge.status === "published")
						.map((challenge) => ({
							value: challenge.id,
							label: challenge.title || "Bez nazwy",
						}))}
					value={value}
					onChange={onChange}
					invalid={Boolean(error)}
					disabled={disabled}
					clearable
					className="w-full"
				/>
			)}
		</Field>
	);
}
