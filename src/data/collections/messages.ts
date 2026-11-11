import { api } from "@/data/api";
import { ApiError, isConflict } from "@/data/api/errors";
import type { Message, NewMessage } from "@/data/schemas/message";
import type { MessageAction } from "@/domain/messageRules";
import { createVersionedCollection } from "./versioned";

// The single copy of every message, archived ones included (the archive is a
// filter, not a separate list).
//
// Edits to a draft go through the saver like any other entity. Sending,
// archiving and bringing back do not: they are requests of their own, made
// for exactly the version on screen and never merged or retried silently.
const messages = createVersionedCollection<Message>({
	name: "messages",
	list: () => api.messages.list(),
	save: (message, options) => api.messages.save(message, options),
});

export const messagesCollection = messages.collection;
export const messageSaver = messages.saver;
export const messageTarget = messages.target;

export async function createMessage(input: NewMessage): Promise<Message> {
	return messages.addCreated(await api.messages.create(input));
}

/** Puts a version that came from the server into the collection. */
function accept(message: Message): void {
	messages.saver.remember([message]);
	messagesCollection.utils.writeUpsert(message);
}

const running = new Map<string, Promise<Message>>();

/**
 * Sends, archives or brings back one message.
 *
 * While a request for a message is under way, asking again returns that same
 * request: two clicks can never become two sends. The request carries the
 * etag of the version on screen, so if someone changed the message in the
 * meantime it fails as a conflict (and the newer version is shown) instead of
 * sending something nobody confirmed.
 */
export function runMessageAction(
	messageId: string,
	action: MessageAction,
): Promise<Message> {
	const underWay = running.get(messageId);
	if (underWay) return underWay;

	const request = (async () => {
		const current = messagesCollection.get(messageId);
		if (!current) throw new ApiError("notFound", "Nie ma takiej wiadomości");
		try {
			const saved = await api.messages[action](messageId, {
				etag: current.etag,
			});
			accept(saved);
			return saved;
		} catch (error) {
			if (isConflict<Message>(error) && error.current) accept(error.current);
			throw error;
		}
	})();
	running.set(messageId, request);
	const done = () => running.delete(messageId);
	request.then(done, done);
	return request;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
