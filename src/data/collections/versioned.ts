import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, type PendingMutation } from "@tanstack/react-db";
import type { SaveOptions } from "@/data/api/types";
import { queryClient } from "./queryClient";
import { createSaver, type Versioned } from "./saver";

interface VersionedCollectionConfig<T extends Versioned> {
	/** Collection id and query key. */
	name: string;
	list(): Promise<T[]>;
	save(item: T, options: SaveOptions): Promise<T>;
}

/**
 * The single copy of one kind of versioned entity, wired to its saver.
 *
 * Every entity that is saved with an etag is built with this, so they all
 * behave the same: screens read with live queries, write with update(), and
 * each save is merged onto the latest server version (see saver.ts).
 */
export function createVersionedCollection<T extends Versioned>(
	config: VersionedCollectionConfig<T>,
) {
	/** Persists the updates of one transaction through the saver. */
	async function persistMutations(
		mutations: ReadonlyArray<PendingMutation<T>>,
	): Promise<void> {
		for (const mutation of mutations) {
			if (mutation.type !== "update") continue;
			await saver.persist(mutation.original as T, mutation.modified);
		}
	}

	const collection = createCollection(
		queryCollectionOptions<T>({
			id: config.name,
			queryKey: [config.name],
			queryClient,
			queryFn: async () => {
				const list = await config.list();
				saver.remember(list);
				return list;
			},
			getKey: (item) => item.id,
			onUpdate: ({ transaction }) => persistMutations(transaction.mutations),
		}),
	);

	/** Changes a row as a user edit would, and resolves once it is saved. */
	async function change(id: string, apply: (draft: T) => void): Promise<void> {
		await collection.update(id, (draft) => apply(draft as T)).when("settled");
	}

	const saver = createSaver<T>({
		save: config.save,
		writeBack: (item) => collection.utils.writeUpsert(item),
		readVisible: (id) => collection.get(id),
		update: change,
	});

	/**
	 * Adds a row the server has just created. Not optimistic: the server
	 * assigns the id, so the row appears once it answers.
	 */
	async function addCreated(saved: T): Promise<T> {
		saver.remember([saved]);
		await collection.utils.writeInsert(saved);
		return saved;
	}

	return {
		collection,
		saver,
		persistMutations,
		addCreated,
		/** What applyChange (features/saving) needs to change a row. */
		target: {
			get: (id: string) => collection.get(id),
			saved: (id: string) => saver.known(id),
			update: change,
			wasMerged: (id: string) => {
				const last = saver.status.get()[id];
				return last?.phase === "saved" && last.mergedWithOthers;
			},
		},
	};
}
