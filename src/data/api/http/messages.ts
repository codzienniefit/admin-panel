import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import {
	assertWritable,
	needsStoredCopy,
	refuse,
} from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import {
	type Message,
	messageSchema,
	type NewMessage,
} from "@/data/schemas/message";
import {
	checkSave,
	conform,
	fingerprint,
	isBackendEtag,
	isoInstantOrNull,
	withCurrent,
} from "./shared";
import type { Transport } from "./transport";

// Messages to app users: `manageMessageDrafts` of the backend
// (src/handlers/admin/draftMessagesHandler.ts; DraftMessageAdminDto).
//
// Two things to know about it. Before the editing contract a draft had no id
// of its own in a save: the backend found it by `createdAtUtc`, so that exact
// value is sent back every time (with the contract, `id` names it and
// `createdAtUtc` is ignored for a message that exists). And a message has no
// "last changed" time, so where the backend sends no etag its version here
// is a fingerprint of what it says.

export const wireMessageSchema = z.looseObject({
	id: z.string(),
	etag: z.string().nullish(),
	title: z.string().nullish(),
	from: z.string().nullish(),
	status: z.string(),
	createdAtUtc: z.string(),
	sentAtUtc: z.string().nullish(),
	archivedAtUtc: z.string().nullish(),
	updatedAtUtc: z.string().nullish(),
});

/**
 * A message's version where the backend sends none. The list and the answer
 * to a save describe the same message with slightly different shapes (a
 * field omitted in one is null in the other), so the fingerprint is taken
 * over the meaning, not over the bytes.
 */
export function messageVersion(message: Message): string {
	return `h:${fingerprint([
		message.id,
		message.title,
		message.from,
		message.status,
		message.targetGroup ?? null,
		message.targetGroupValue ?? null,
		message.fancyContent.map((block) => [
			block.type,
			block.content,
			block.metadata?.imageRelativePath ?? null,
			block.metadata?.heightToWidthRatio ?? null,
		]),
		message.createdAtUtc,
		message.sentAtUtc ?? null,
		message.archivedAtUtc ?? null,
	])}`;
}

export function toMessage(raw: unknown): Message {
	const wire = conform(wireMessageSchema, raw, "Wiadomość");
	const message = conform(
		messageSchema,
		{
			...wire,
			etag: wire.etag ?? "",
			title: wire.title ?? "",
			from: wire.from ?? "",
			// The latest thing that happened to it.
			updatedAtUtc:
				wire.updatedAtUtc ??
				wire.archivedAtUtc ??
				wire.sentAtUtc ??
				wire.createdAtUtc,
		},
		`Wiadomość ${wire.id}`,
	);
	if (!wire.etag) message.etag = messageVersion(message);
	return message;
}

/** What the backend owns: never sent back as if the panel had set it. */
const SERVER_OWNED = [
	"etag",
	"status",
	"sentAtUtc",
	"archivedAtUtc",
	"updatedAtUtc",
	// Set by the backend while a send of the draft is under way.
	"sendingStartedAtUtc",
] as const;

/**
 * The request body for a save: DraftMessageUpsertAdminRequestDto.
 *
 * @param capabilities with `etag` on (the editing contract), an empty group
 *   value is sent as null: left out, the backend would keep the stored one
 */
export function fromMessage(
	message: Message | NewMessage,
	capabilities?: Pick<Capabilities, "etag">,
): Record<string, unknown> {
	// Fields this build does not know go back as they came.
	const body: Record<string, unknown> = { ...message };
	for (const key of SERVER_OWNED) delete body[key];
	// Names the draft on the panel's routes; Retool's do not look at it.
	if (typeof message.id !== "string") delete body.id;
	if (message.targetGroupValue == null) {
		if (capabilities?.etag) body.targetGroupValue = null;
		else delete body.targetGroupValue;
	}
	if (capabilities?.etag) {
		// A description or a sender with a space before or after it is
		// refused, not trimmed: it is sent without.
		for (const field of ["title", "from"] as const) {
			if (typeof body[field] === "string") body[field] = body[field].trim();
		}
		// A full instant: the moment the draft was made, never a bare date.
		body.createdAtUtc = isoInstantOrNull(body.createdAtUtc);
	}
	// `createdAtUtc` is the draft's identity. Never a new time on a save.
	return body;
}

const listSchema = z.looseObject({ messages: z.array(z.unknown()) });
const actionSchema = z.looseObject({ message: z.unknown().nullish() });

const CREATED_TWICE =
	"Wiadomość z dokładnie tą datą utworzenia już istnieje. Spróbuj ponownie.";

const MARK = { field: "Opis wewnętrzny", path: "title" } as const;

export function messagesArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["messages"] {
	async function list(): Promise<Message[]> {
		const answer = await transport.request({
			path: ["manageMessageDrafts", "list"],
			schema: listSchema,
			what: "Lista wiadomości",
		});
		return answer.messages.map(toMessage);
	}

	async function find(match: (message: Message) => boolean): Promise<Message> {
		const found = (await list()).find(match);
		if (!found) throw new ApiError("notFound", "Nie ma takiej wiadomości.");
		return found;
	}
	const read = (id: string) => find((message) => message.id === id);

	/** Calls one of the POST actions and returns the message it left. */
	async function act(
		action: "upsert" | "archive" | "publish" | "unarchive",
		body: Record<string, unknown>,
		headers: Record<string, string>,
		fallback: () => Promise<Message>,
	): Promise<Message> {
		const answer = await transport.request({
			method: "POST",
			path: ["manageMessageDrafts", action],
			body,
			headers,
			schema: actionSchema,
			what: "Zapis wiadomości",
		});
		// The backend can answer a successful save without the message.
		return answer.message ? toMessage(answer.message) : fallback();
	}

	/** The checks before an action on a stored message, and the action. */
	async function onStored(
		area: "messages" | "sendMessage",
		action: "archive" | "publish" | "unarchive",
		messageId: string,
		etag: string,
	): Promise<Message> {
		// Sending reaches real people, so it has no test mode: it is on or off.
		assertWritable(
			capabilities,
			area,
			area === "sendMessage"
				? null
				: {
						texts: [],
						...MARK,
					},
		);
		// The backend needs the version of the message an action is based on
		// (428 without one) and checks it itself: `If-Match`, 409 with the
		// stored message. So the list is read first only where the [TEST] mark
		// of the stored message has to be seen, or where there is no version
		// the backend could check and the comparison has to be made here.
		const versioned = capabilities.etag && isBackendEtag(etag);
		if (!versioned || needsStoredCopy(capabilities, area)) {
			const stored = await read(messageId);
			assertWritable(
				capabilities,
				area,
				area === "sendMessage"
					? null
					: {
							texts: [stored.title],
							...MARK,
						},
			);
			if (stored.etag !== etag) {
				throw new ApiError("conflict", "Ktoś zmienił to w międzyczasie.", {
					current: stored,
				});
			}
		}
		return withCurrent(
			// `dryRun` is spelled out: the action is meant for real, whatever a
			// route does when it is left out.
			() =>
				act(
					action,
					// The id exactly as stored: one with a space around it is
					// refused, not looked up without it.
					{ id: messageId.trim(), dryRun: false },
					versioned ? { "if-match": etag } : {},
					() => read(messageId),
				),
			toMessage,
			() => read(messageId),
		);
	}

	return {
		list,
		async create(message) {
			assertWritable(capabilities, "messages", {
				texts: [message.title],
				...MARK,
			});
			// The backend treats a save with a known `createdAtUtc` as a change
			// to that draft. A new message must not land on an existing one:
			// with the editing contract the backend refuses that itself when
			// asked to create only (409 ALREADY_EXISTS); before it, the panel
			// has to look first.
			if (!capabilities.etag) {
				const taken = (await list()).some(
					(existing) => existing.createdAtUtc === message.createdAtUtc,
				);
				if (taken) refuse(CREATED_TWICE);
			}
			return act(
				"upsert",
				fromMessage(message, capabilities),
				capabilities.etag ? { "if-none-match": "*" } : {},
				() => find((saved) => saved.createdAtUtc === message.createdAtUtc),
			);
		},
		async save(message, options) {
			if (message.status !== "draft") {
				refuse("Wysłanej ani zarchiwizowanej wiadomości nie można zmienić.");
			}
			const headers = await checkSave({
				capabilities,
				area: "messages",
				incoming: message,
				etag: options.etag,
				readStored: () => read(message.id),
				markOf: (item) => item.title,
				...MARK,
			});
			return withCurrent(
				() =>
					act("upsert", fromMessage(message, capabilities), headers, () =>
						read(message.id),
					),
				toMessage,
				() => read(message.id),
			);
		},
		send: (messageId, options) =>
			onStored("sendMessage", "publish", messageId, options.etag),
		archive: (messageId, options) =>
			onStored("messages", "archive", messageId, options.etag),
		async unarchive(messageId, options) {
			if (!capabilities.messageUnarchive) {
				refuse(
					"Produkcja nie potrafi jeszcze przywracać wiadomości z archiwum.",
				);
			}
			return onStored("messages", "unarchive", messageId, options.etag);
		},
	};
}
