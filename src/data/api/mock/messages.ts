import { ApiError } from "@/data/api/errors";
import type { ApiClient, SaveOptions } from "@/data/api/types";
import {
	type Message,
	messageSchema,
	newMessageSchema,
} from "@/data/schemas/message";
import {
	afterMessageAction,
	type MessageAction,
	messageActionIssues,
	messageEditIssues,
	messageIssues,
} from "@/domain/messageRules";
import { internalConfigFixture } from "./configFixtures";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, disagree, type MockKernel } from "./kernel";
import { buildMessageFixtures } from "./messageFixtures";

// Messages to app users. Sending here only changes the status: nothing is
// delivered to anyone. The rules around it are the real ones, so the panel
// is exercised exactly as it will be against the backend.

const groups = internalConfigFixture.draftMessageTargetGroups;

export function messagesApi(kernel: MockKernel): ApiClient["messages"] {
	const table = kernel.table<Message>(
		"messages",
		buildMessageFixtures,
		(message) => message.id,
	);

	const find = (messageId: string): Message => {
		const stored = table.get(messageId);
		if (!stored) throw new ApiError("notFound", "Nie ma takiej wiadomości");
		return stored;
	};

	/** Send, archive and unarchive: the only ways a status changes. */
	async function act(
		messageId: string,
		options: SaveOptions,
		action: MessageAction,
	): Promise<Message> {
		await kernel.latency();
		kernel.takeFailure();
		const stored = find(messageId);
		// Whatever another admin did, the person acting has not seen it.
		const touch = (row: Message) => {
			row.title = `${row.title} (zmienione przez innego admina)`;
		};
		kernel.takeConcurrentChange<Message>(stored, stored, {
			otherField: touch,
			sameFields: touch,
		});
		kernel.checkEtag(stored, options.etag);
		kernel.reject(messageActionIssues(stored, action, groups));
		return kernel.store(table, {
			...stored,
			...afterMessageAction(stored, action, kernel.now()),
		});
	}

	return {
		async list() {
			await kernel.latency();
			return messageSchema.array().parse(copy([...table.values()]));
		},
		async create(message) {
			await kernel.latency();
			kernel.takeFailure();
			const fields = newMessageSchema.parse(copy(message));
			kernel.reject(messageIssues(fields, groups));
			const id = kernel.freeId("M", table);
			return kernel.store(table, {
				...fields,
				id,
				etag: "",
				status: "draft",
				sentAtUtc: null,
				archivedAtUtc: null,
				updatedAtUtc: kernel.now(),
				[UNKNOWN_FIELD]: "message:new",
			});
		},
		async save(message, options) {
			await kernel.latency();
			kernel.takeFailure();
			const incoming = messageSchema.parse(copy(message));
			const stored = find(incoming.id);
			kernel.takeConcurrentChange<Message>(stored, incoming, {
				otherField: (row) => {
					row.from = `${row.from} (inny admin)`.trim();
				},
				sameFields: disagree,
			});
			kernel.checkEtag(stored, options.etag);
			kernel.reject([
				...messageEditIssues(stored.status),
				...messageIssues(incoming, groups),
			]);
			return kernel.store(table, {
				...incoming,
				// The server's own: a save cannot send, archive or re-date.
				status: stored.status,
				createdAtUtc: stored.createdAtUtc,
				sentAtUtc: stored.sentAtUtc,
				archivedAtUtc: stored.archivedAtUtc,
			});
		},
		send: (messageId, options) => act(messageId, options, "send"),
		archive: (messageId, options) => act(messageId, options, "archive"),
		unarchive: (messageId, options) => act(messageId, options, "unarchive"),
	};
}
