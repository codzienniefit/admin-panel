import {
	ApiError,
	errorMessage,
	isApiError,
	isConflict,
} from "@/data/api/errors";
import type { SaveOptions, Versioned } from "@/data/api/types";
import { deepEqual, rebase } from "@/domain/rebase";
import { sleep as realSleep } from "@/lib/sleep";
import { createStore, type Store } from "@/lib/store";

// The one path every save of a versioned entity takes.
//
// What is sent is never "the object as this screen holds it". It is the
// latest version known from the server with only this user's changes laid on
// top (domain/rebase). That gives three properties at once:
//
//   - fields this build does not know are sent back untouched;
//   - a change someone else made to another field is kept, not overwritten
//     with a stale copy;
//   - a real conflict (the same field changed on both sides) stops the save
//     and is handed to the user instead of being decided silently.
//
// TanStack DB rolls optimistic changes back when a save fails. For an editor
// that would throw the user's work away, so on failure and on conflict the
// edits are kept here until the user retries, applies or discards them.

export type { Versioned } from "@/data/api/types";

export type SaveStatus =
	| { phase: "idle" }
	| { phase: "dirty" }
	| { phase: "saving" }
	| { phase: "saved"; at: number; mergedWithOthers: boolean }
	| { phase: "error"; message: string }
	| { phase: "conflict" };

/** Edits that could not be saved, kept so the user does not lose them. */
export interface HeldEdits<T> {
	id: string;
	reason: "conflict" | "error";
	/** What the edits were based on. */
	base: T;
	/** The user's version at the moment the save stopped. */
	mine: T;
	/** The server's version (for a conflict: the one that clashed). */
	theirs: T;
	/** Locations changed on both sides; empty for reason "error". */
	conflicts: string[];
	message: string;
}

export interface SaverConfig<T extends Versioned> {
	save(item: T, options: SaveOptions): Promise<T>;
	/** Puts a confirmed server version into the collection's synced rows. */
	writeBack(item: T): Promise<void> | void;
	/** The version currently on screen, optimistic edits included. */
	readVisible(id: string): T | undefined;
	/**
	 * Changes the item in the collection, as a user edit would. Used to put
	 * held edits back; the collection's own handler then saves them.
	 */
	update(id: string, change: (draft: T) => void): Promise<void>;
	sleep?: (ms: number) => Promise<void>;
}

export interface Saver<T extends Versioned> {
	/** Latest versions seen from the server; called by the collection's fetch. */
	remember(items: readonly T[]): void;
	/** The latest version of one entity seen from the server, if any. */
	known(id: string): T | undefined;
	/** Saves `mine`, which was edited starting from `base`. */
	persist(base: T, mine: T): Promise<void>;
	markDirty(id: string): void;
	status: Store<Readonly<Record<string, SaveStatus>>>;
	held: Store<HeldEdits<T> | null>;
	/**
	 * Puts held edits back on top of the server's version and saves again.
	 * With "mine", this user's values win where both sides changed the same
	 * thing; with "theirs", only the non-conflicting edits are kept.
	 */
	reapplyHeld(prefer: "mine" | "theirs"): Promise<void>;
	dismissHeld(): void;
}

const MAX_REBASES = 3;
const TRANSIENT_RETRIES = 2;

export function createSaver<T extends Versioned>(
	config: SaverConfig<T>,
): Saver<T> {
	const sleep = config.sleep ?? realSleep;
	const server = new Map<string, T>();
	const queues = new Map<string, Promise<unknown>>();
	const status = createStore<Readonly<Record<string, SaveStatus>>>({});
	const held = createStore<HeldEdits<T> | null>(null);

	const setStatus = (id: string, next: SaveStatus) =>
		status.set((all) => ({ ...all, [id]: next }));

	async function saveWithRetry(item: T, etag: string): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			try {
				return await config.save(item, { etag });
			} catch (error) {
				const transient =
					isApiError(error) &&
					(error.kind === "network" || error.kind === "server");
				if (!transient || attempt >= TRANSIENT_RETRIES) throw error;
				await sleep(300 * (attempt + 1));
			}
		}
	}

	async function hold(
		reason: HeldEdits<T>["reason"],
		base: T,
		mine: T,
		theirs: T,
		conflicts: string[],
		message: string,
	) {
		// Later edits may still be on screen in transactions that are about to
		// be rolled back with this one; keep those too.
		const visible = config.readVisible(mine.id) ?? mine;
		await config.writeBack(theirs);
		held.set({
			id: mine.id,
			reason,
			base,
			mine: visible,
			theirs,
			conflicts,
			message,
		});
		setStatus(
			mine.id,
			reason === "conflict"
				? { phase: "conflict" }
				: { phase: "error", message },
		);
	}

	async function run(base: T, mine: T): Promise<void> {
		const id = mine.id;
		setStatus(id, { phase: "saving" });
		let mergedWithOthers = false;

		for (let round = 0; round <= MAX_REBASES; round++) {
			const theirs = server.get(id) ?? base;
			const { merged, conflicts } = rebase(base, mine, theirs);
			if (theirs.etag !== base.etag) mergedWithOthers = true;

			if (conflicts.length > 0) {
				const message = "Ktoś inny zmienił to samo w międzyczasie";
				await hold("conflict", base, mine, theirs, conflicts, message);
				throw new ApiError<T>("conflict", message, { current: theirs });
			}

			try {
				const saved = await saveWithRetry(merged, theirs.etag);
				server.set(id, saved);
				await config.writeBack(saved);
				setStatus(id, { phase: "saved", at: Date.now(), mergedWithOthers });
				return;
			} catch (error) {
				if (isConflict<T>(error) && error.current) {
					// The server moved on. Take its version and merge again.
					server.set(id, error.current);
					continue;
				}
				if (isApiError(error) && error.kind === "validation") {
					// The server refused the content. Nothing to retry: whoever
					// started the save (a form) shows the problems next to the
					// fields and still has the user's input.
					setStatus(id, { phase: "idle" });
					throw error;
				}
				const message = errorMessage(error, "Nie udało się zapisać");
				await hold("error", base, mine, theirs, [], message);
				throw error;
			}
		}

		const theirs = server.get(id) ?? base;
		const message = "Zbyt wiele równoczesnych zmian, spróbuj ponownie";
		await hold("error", base, mine, theirs, [], message);
		throw new ApiError<T>("conflict", message, { current: theirs });
	}

	return {
		remember(items) {
			for (const item of items) server.set(item.id, item);
		},
		known: (id) => server.get(id),
		persist(base, mine) {
			// One save at a time per entity, in order: a second save must start
			// from the etag the first one produced.
			const previous = queues.get(mine.id) ?? Promise.resolve();
			const next = previous.catch(() => undefined).then(() => run(base, mine));
			queues.set(mine.id, next);
			return next;
		},
		markDirty(id) {
			const current = status.get()[id]?.phase;
			if (current !== "saving") setStatus(id, { phase: "dirty" });
		},
		status,
		held,
		async reapplyHeld(prefer) {
			const current = held.get();
			if (!current) return;
			const theirs = server.get(current.id) ?? current.theirs;
			const { merged } = rebase(current.base, current.mine, theirs, { prefer });
			held.set(null);
			setStatus(current.id, { phase: "idle" });
			if (deepEqual(merged, theirs)) return;
			await config.update(current.id, (draft) => {
				const target = draft as Record<string, unknown>;
				const source = merged as Record<string, unknown>;
				for (const key of Object.keys(source)) {
					if (key === "id" || deepEqual(target[key], source[key])) continue;
					target[key] = structuredClone(source[key]);
				}
			});
		},
		dismissHeld() {
			const current = held.get();
			if (!current) return;
			held.set(null);
			setStatus(current.id, { phase: "idle" });
		},
	};
}
