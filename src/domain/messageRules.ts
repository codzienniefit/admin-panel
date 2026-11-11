import type { ApiIssue } from "@/data/api/errors";
import type { InternalConfig } from "@/data/schemas/config";
import type {
	Message,
	MessageStatus,
	NewMessage,
} from "@/data/schemas/message";
import { contentErrors } from "./contentBlocks";

// What makes a message acceptable, and what may happen to it. One set of
// rules, used by the form, by the actions and by the mock server.
//
// A draft may be incomplete: it only needs a description to be found again.
// Sending needs the full set, because a sent message reaches real people and
// cannot be corrected.

export const MESSAGE_TITLE_MIN = 3;
export const SENDER_MIN = 3;

export type TargetGroups = InternalConfig["draftMessageTargetGroups"];

/** The part of a message a person writes. */
export type MessageContent = Pick<
	NewMessage,
	"title" | "from" | "targetGroup" | "targetGroupValue" | "fancyContent"
>;

export type MessageAction = "send" | "archive" | "unarchive";

const findGroup = (groups: TargetGroups, id: string | null) =>
	groups.find((group) => group.state === id) ?? null;

/**
 * What the chosen group needs on top of its own name (the backend names the
 * kind of value, e.g. a challenge), or null when it needs nothing.
 */
export function requiredGroupValue(
	groups: TargetGroups,
	groupId: string | null,
): string | null {
	return findGroup(groups, groupId)?.requiresTargetGroupValue ?? null;
}

/**
 * Problems with a message. "draft" is what saving needs; "send" is what
 * sending needs.
 */
export function messageIssues(
	message: MessageContent,
	groups: TargetGroups,
	purpose: "draft" | "send" = "draft",
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	const add = (path: string, text: string) =>
		issues.push({ path, message: text });
	const title = message.title.trim();
	const sender = message.from.trim();
	const group = findGroup(groups, message.targetGroup);

	if (!title) add("title", "Opis jest wymagany");
	if (message.targetGroup && !group) {
		add("targetGroup", "Tej grupy odbiorców nie ma już do wyboru");
	}
	if (purpose === "draft") return issues;

	if (title && title.length < MESSAGE_TITLE_MIN) {
		add("title", `Opis musi mieć co najmniej ${MESSAGE_TITLE_MIN} znaki`);
	}
	if (!sender) {
		add("from", "Podaj nadawcę");
	} else if (sender.length < SENDER_MIN) {
		add("from", `Nadawca musi mieć co najmniej ${SENDER_MIN} znaki`);
	}
	if (!message.targetGroup) add("targetGroup", "Wybierz odbiorców");
	if (group?.requiresTargetGroupValue && !message.targetGroupValue?.trim()) {
		add("targetGroupValue", "Wskaż, kogo dokładnie dotyczy ta grupa");
	}
	if (message.fancyContent.length === 0) {
		add("fancyContent", "Wiadomość nie ma treści");
	} else {
		const broken = contentErrors(message.fancyContent).length;
		if (broken > 0) {
			add(
				"fancyContent",
				`Treść ma błędy (${broken}), przez które źle wyświetli się w aplikacji. Otwórz edytor treści`,
			);
		}
	}
	return issues;
}

/** Only a draft can be changed; what was sent stays as it was delivered. */
export const isEditable = (status: MessageStatus): boolean =>
	status === "draft";

/** Why the content of a message in this status cannot be changed. */
export function messageEditIssues(status: MessageStatus): ApiIssue[] {
	if (isEditable(status)) return [];
	return [
		{
			path: "status",
			message:
				status === "sent"
					? "Wysłanej wiadomości nie można już zmieniać"
					: "Wiadomości w archiwum nie można zmieniać",
		},
	];
}

/** Why an action cannot be carried out on this message; empty when it can. */
export function messageActionIssues(
	message: Pick<Message, "status"> & MessageContent,
	action: MessageAction,
	groups: TargetGroups,
): ApiIssue[] {
	const refuse = (text: string): ApiIssue[] => [
		{ path: "status", message: text },
	];
	if (action === "send") {
		if (message.status === "sent") {
			return refuse("Ta wiadomość została już wysłana");
		}
		if (message.status === "archived") {
			return refuse(
				"Wiadomości z archiwum nie można wysłać. Najpierw ją przywróć",
			);
		}
		return messageIssues(message, groups, "send");
	}
	if (action === "archive") {
		return message.status === "archived"
			? refuse("Ta wiadomość jest już w archiwum")
			: [];
	}
	return message.status === "archived"
		? []
		: refuse("Tej wiadomości nie ma w archiwum");
}

/**
 * The status and dates an action leaves behind. A message that leaves the
 * archive goes back to what it was: sent if it had been sent, a draft if not.
 */
export function afterMessageAction(
	message: Pick<Message, "status" | "sentAtUtc" | "archivedAtUtc">,
	action: MessageAction,
	now: string,
): Pick<Message, "status" | "sentAtUtc" | "archivedAtUtc"> {
	if (action === "send") {
		return { status: "sent", sentAtUtc: now, archivedAtUtc: null };
	}
	if (action === "archive") {
		return {
			status: "archived",
			sentAtUtc: message.sentAtUtc,
			archivedAtUtc: now,
		};
	}
	return {
		status: message.sentAtUtc ? "sent" : "draft",
		sentAtUtc: message.sentAtUtc,
		archivedAtUtc: null,
	};
}

const RECIPIENTS: Record<string, string> = {
	all: "wszyscy użytkownicy aplikacji",
	subscribers: "użytkownicy z aktywnym Pro",
	nonSubscribers: "użytkownicy bez Pro",
};

/** Who gets the message, in words for the question asked before sending. */
export function recipientsText(
	groups: TargetGroups,
	groupId: string | null,
): string {
	if (!groupId) return "nikt (nie wybrano odbiorców)";
	const group = findGroup(groups, groupId);
	return RECIPIENTS[groupId] ?? group?.label ?? "nieznana grupa odbiorców";
}
