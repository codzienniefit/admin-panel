// The one door to the browser's localStorage.
//
// Storage can be missing (tests, a worker) or blocked (private mode, a full
// quota), and every call can throw. Nothing in the panel may break because of
// that, so everything that keeps a value across reloads goes through here.
//
// Never for tokens or personal data: see docs/SECURITY.md.

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's storage, or null where there is none. */
export function browserStorage(): StorageLike | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** The stored text, or null when there is none or storage is unavailable. */
export function readStored(
	key: string,
	storage: StorageLike | null = browserStorage(),
): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Stores a text. False when it could not be kept. */
export function writeStored(
	key: string,
	value: string,
	storage: StorageLike | null = browserStorage(),
): boolean {
	if (!storage) return false;
	try {
		storage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export function removeStored(
	key: string,
	storage: StorageLike | null = browserStorage(),
): void {
	try {
		storage?.removeItem(key);
	} catch {
		// Nothing stored, nothing to remove.
	}
}

/** Stored JSON, parsed; null when missing or not JSON. Validate the result. */
export function readStoredJson(
	key: string,
	storage: StorageLike | null = browserStorage(),
): unknown {
	const raw = readStored(key, storage);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

/** A storage that lives in memory, for tests. */
export function memoryStorage(
	initial: Record<string, string> = {},
): StorageLike & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
	};
}
