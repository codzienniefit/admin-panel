import type { Message, MessageStatus } from "@/data/schemas/message";
import { matchesQuery } from "./text";

export type MessageSort = "created" | "sent" | "title";

export interface MessageFilters {
	q?: string;
	/** Absent: everything except the archive. "archived": the archive only. */
	status?: MessageStatus;
	/** Target group id. */
	group?: string;
	sort?: MessageSort;
}

const byTitle = new Intl.Collator("pl", { sensitivity: "base", numeric: true });

/** The messages a list should show for these filters, in order. */
export function filterMessages(
	messages: readonly Message[],
	filters: MessageFilters,
): Message[] {
	const { q, status, group, sort = "created" } = filters;

	const shown = messages.filter((message) => {
		if (status ? message.status !== status : message.status === "archived") {
			return false;
		}
		if (group && message.targetGroup !== group) return false;
		if (
			q &&
			!matchesQuery(`${message.title} ${message.from} ${message.id}`, q)
		) {
			return false;
		}
		return true;
	});

	return shown.sort((a, b) => {
		if (sort === "title") return byTitle.compare(a.title, b.title);
		if (sort === "sent") {
			// Unsent messages have no date to sort by; they go last.
			const sent = (b.sentAtUtc ?? "").localeCompare(a.sentAtUtc ?? "");
			if (sent !== 0) return sent;
		}
		return (
			b.createdAtUtc.localeCompare(a.createdAtUtc) ||
			byTitle.compare(a.title, b.title)
		);
	});
}
