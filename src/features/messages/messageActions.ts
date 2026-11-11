import { type ApiIssue, isApiError } from "@/data/api/errors";
import {
	createMessage,
	messagesCollection,
	runMessageAction,
} from "@/data/collections/messages";
import type { Message } from "@/data/schemas/message";
import {
	type MessageAction,
	messageActionIssues,
	recipientsText,
	type TargetGroups,
} from "@/domain/messageRules";
import { type ConfirmOptions, confirm } from "@/ui/confirm";
import { generalIssue } from "@/ui/formIssues";
import { toast } from "@/ui/toast";

// The one way a screen sends, archives or brings back a message: the rules
// are checked, the person is asked, and only then the request is made, once.

export type ActionOutcome =
	| { result: "done"; message: Message }
	/** The person said no, or the same action was already under way. */
	| { result: "cancelled" }
	| { result: "refused"; title: string; issues: readonly ApiIssue[] };

const REFUSED: Record<MessageAction, string> = {
	send: "Nie można wysłać",
	archive: "Nie można przenieść do archiwum",
	unarchive: "Nie można przywrócić z archiwum",
};

const DONE: Record<MessageAction, string> = {
	send: "Wiadomość wysłana",
	archive: "Wiadomość w archiwum",
	unarchive: "Wiadomość przywrócona z archiwum",
};

/** What is asked before the action; null when it needs no question. */
function question(
	message: Message,
	action: MessageAction,
	groups: TargetGroups,
): ConfirmOptions | null {
	const title = message.title.trim() || "bez opisu";
	if (action === "send") {
		return {
			title: "Wysłać wiadomość?",
			description: `Wiadomość „${title}” dostaną: ${recipientsText(groups, message.targetGroup)}. Wysłanej wiadomości nie można poprawić ani cofnąć.`,
			confirmLabel: "Wyślij teraz",
			cancelLabel: "Jeszcze nie",
		};
	}
	if (action === "archive") {
		return {
			title: "Przenieść do archiwum?",
			description:
				message.status === "sent"
					? `Wiadomość „${title}” zniknie z listy w panelu. Archiwum niczego nie cofa: odbiorcy już ją dostali. Można ją stamtąd przywrócić.`
					: `Robocza wiadomość „${title}” zniknie z listy i nie zostanie wysłana. Można ją przywrócić z archiwum.`,
			confirmLabel: "Przenieś do archiwum",
			destructive: true,
		};
	}
	return null;
}

const CHANGED_MEANWHILE = generalIssue(
	"Ktoś zmienił tę wiadomość w międzyczasie. Na ekranie jest już jej aktualna wersja: sprawdź ją i spróbuj ponownie.",
);

function failure(action: MessageAction, error: unknown): ApiIssue[] {
	if (isApiError(error)) {
		if (error.kind === "validation") return [...error.issues];
		if (error.kind === "conflict") return [CHANGED_MEANWHILE];
		if (error.kind === "notFound") {
			return [generalIssue("Tej wiadomości już nie ma.")];
		}
	}
	return [
		generalIssue(
			action === "send"
				? "Nie udało się wysłać. Zanim spróbujesz ponownie, odśwież stronę i sprawdź, czy wiadomość nie ma już statusu „Wysłana”."
				: "Nie udało się. Spróbuj ponownie za chwilę.",
		),
	];
}

/** Messages with a question open or a request under way. */
const busy = new Set<string>();

export async function performMessageAction(
	messageId: string,
	action: MessageAction,
	groups: TargetGroups,
): Promise<ActionOutcome> {
	// A second click while the first is still being handled does nothing.
	if (busy.has(messageId)) return { result: "cancelled" };
	busy.add(messageId);
	try {
		const message = messagesCollection.get(messageId);
		if (!message) {
			return {
				result: "refused",
				title: REFUSED[action],
				issues: [generalIssue("Tej wiadomości już nie ma.")],
			};
		}
		const issues = messageActionIssues(message, action, groups);
		if (issues.length > 0) {
			return { result: "refused", title: REFUSED[action], issues };
		}

		const ask = question(message, action, groups);
		if (ask && !(await confirm(ask))) return { result: "cancelled" };

		// The question may have been open for a while. What was confirmed must
		// still be what is about to be sent.
		if (messagesCollection.get(messageId)?.etag !== message.etag) {
			return {
				result: "refused",
				title: REFUSED[action],
				issues: [CHANGED_MEANWHILE],
			};
		}

		try {
			const saved = await runMessageAction(messageId, action);
			toast({ title: DONE[action], tone: "green" });
			return { result: "done", message: saved };
		} catch (error) {
			return {
				result: "refused",
				title: REFUSED[action],
				issues: failure(action, error),
			};
		}
	} finally {
		busy.delete(messageId);
	}
}

/** A new draft with the same content. Nothing about the original changes. */
export function duplicateMessage(message: Message): Promise<Message> {
	return createMessage({
		title: `${message.title} (kopia)`,
		from: message.from,
		targetGroup: message.targetGroup,
		targetGroupValue: message.targetGroupValue,
		fancyContent: structuredClone(message.fancyContent),
		createdAtUtc: new Date().toISOString(),
	});
}
