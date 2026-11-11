import { ApiError, type ApiIssue } from "@/data/api/errors";
import type { Versioned } from "@/data/api/types";
import { sleep as realSleep } from "@/lib/sleep";
import {
	browserStorage,
	readStoredJson,
	type StorageLike,
	writeStored,
} from "@/lib/storage";
import type { Store } from "@/lib/store";
import { type MockControls, mockControls } from "./controls";
import { buildFixtures, type Fixtures } from "./fixtures";
import { SNAPSHOT_KEY } from "./persistence";

// What every part of the mock server shares: the clock, latency, forced
// failures and conflicts, version numbers, and keeping the sample data across
// reloads. Each area (challenges, planning, messages…) is a separate module
// built on this, so they all behave the same way.

/** A row as the server keeps it. */
export interface Stored extends Versioned {
	updatedAtUtc: string;
}

export interface MockApiOptions {
	fixtures?: Fixtures;
	controls?: Store<MockControls>;
	/** Where edits are kept across reloads; null keeps them in memory only. */
	storage?: StorageLike | null;
	/** Injected in tests so they do not wait on real timers. */
	sleep?: (ms: number) => Promise<void>;
	now?: () => string;
}

interface Snapshot {
	dataset: string;
	version: number;
	/** One entry per table or value, by name. */
	slots: Record<string, unknown>;
}

/** What "another admin" does to a row when a conflict is forced. */
export interface ConcurrentChange<T> {
	/** Changes something this user did not touch. */
	otherField(stored: T): void;
	/** Changes the very things this user is saving. */
	sameFields(stored: T, incoming: T): void;
}

export interface Slot<T> {
	get(): T;
	set(value: T): void;
}

/** Everything crossing the boundary is copied, as JSON over HTTP would be. */
export const copy = <T>(value: T): T => structuredClone(value);

export function createKernel(options: MockApiOptions = {}) {
	const controls = options.controls ?? mockControls;
	const sleep = options.sleep ?? realSleep;
	const now = options.now ?? (() => new Date().toISOString());
	const storage =
		options.storage === undefined ? browserStorage() : options.storage;
	const dataset = controls.get().dataset;
	const restored = options.fixtures ? null : readSnapshot(storage, dataset);

	let built: Fixtures | null = options.fixtures ?? null;
	/** The starting data; generated only when something needs it. */
	const seed = (): Fixtures => {
		built ??= buildFixtures(dataset);
		return built;
	};

	let version = restored?.version ?? 1;
	const nextEtag = () => String(++version);

	const writers = new Map<string, { read(): unknown; droppable: boolean }>();

	function persist() {
		if (!storage) return;
		const snapshot = (everything: boolean): Snapshot => ({
			dataset,
			version,
			slots: Object.fromEntries(
				[...writers]
					.filter(([, writer]) => everything || !writer.droppable)
					.map(([name, writer]) => [name, writer.read()]),
			),
		});
		// A refusal is most likely the storage quota. The records matter more
		// than the uploaded pictures, so try again without what can be dropped;
		// failing that, keep working in memory.
		if (!writeStored(SNAPSHOT_KEY, JSON.stringify(snapshot(true)), storage)) {
			writeStored(SNAPSHOT_KEY, JSON.stringify(snapshot(false)), storage);
		}
	}

	/**
	 * A named value that survives a reload. `droppable` values are the first
	 * to go when the browser's storage is full.
	 */
	function slot<T>(name: string, initial: () => T, droppable = false): Slot<T> {
		const kept = restored?.slots[name];
		let value = kept === undefined ? initial() : (kept as T);
		writers.set(name, { read: () => value, droppable });
		return {
			get: () => value,
			set: (next) => {
				value = next;
			},
		};
	}

	/** A named list of rows that survives a reload, as a map by key. */
	function table<T>(
		name: string,
		initial: () => readonly T[],
		keyOf: (row: T) => string,
	): Map<string, T> {
		const kept = restored?.slots[name];
		const rows = Array.isArray(kept) ? (kept as T[]) : initial();
		const map = new Map(rows.map((row) => [keyOf(row), copy(row)]));
		writers.set(name, { read: () => [...map.values()], droppable: false });
		return map;
	}

	async function latency() {
		const { minLatencyMs, maxLatencyMs } = controls.get();
		const span = Math.max(0, maxLatencyMs - minLatencyMs);
		await sleep(minLatencyMs + Math.random() * span);
	}

	function takeFailure() {
		if (!controls.get().failNextSave) return;
		controls.set((c) => ({ ...c, failNextSave: false }));
		throw new ApiError("server", "Symulowany błąd serwera");
	}

	/** Plays the part of another admin saving just before this request. */
	function takeConcurrentChange<T extends Stored>(
		stored: T,
		incoming: T,
		change: ConcurrentChange<T>,
	) {
		const mode = controls.get().conflictNextSave;
		if (!mode) return;
		controls.set((c) => ({ ...c, conflictNextSave: null }));
		change[mode](stored, incoming);
		stored.etag = nextEtag();
		stored.updatedAtUtc = now();
	}

	function checkEtag<T extends Stored>(stored: T | undefined, etag: string) {
		if (stored && stored.etag !== etag) {
			throw new ApiError<T>(
				"conflict",
				"Ktoś inny zapisał ten element w międzyczasie",
				{ current: copy(stored) },
			);
		}
	}

	function reject(issues: readonly ApiIssue[]) {
		if (issues.length === 0) return;
		throw new ApiError("validation", issues.map((i) => i.message).join("\n"), {
			issues: [...issues],
		});
	}

	/** Stores a new version of a row and returns it as the server would. */
	function store<T extends Stored>(table: Map<string, T>, incoming: T): T {
		const saved = { ...copy(incoming), etag: nextEtag(), updatedAtUtc: now() };
		table.set(saved.id, saved);
		persist();
		return copy(saved);
	}

	/** The first unused id of the form `prefix` + number. */
	function freeId(prefix: string, taken: ReadonlyMap<string, unknown>) {
		for (let n = 1; ; n++) {
			if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
		}
	}

	return {
		dataset,
		seed,
		now,
		nextEtag,
		persist,
		slot,
		table,
		latency,
		takeFailure,
		takeConcurrentChange,
		checkEtag,
		reject,
		store,
		freeId,
	};
}

export type MockKernel = ReturnType<typeof createKernel>;

const SERVER_OWNED = new Set(["id", "etag", "updatedAtUtc"]);

/**
 * Makes `stored` differ from `incoming` exactly where `incoming` differs from
 * it: the forced "someone else changed the same thing" case, for any shape of
 * document.
 */
export function disagree(stored: unknown, incoming: unknown): void {
	if (!isRecord(stored) || !isRecord(incoming)) return;
	for (const key of Object.keys(incoming)) {
		if (SERVER_OWNED.has(key)) continue;
		const theirs = incoming[key];
		const ours = stored[key];
		if (JSON.stringify(theirs) === JSON.stringify(ours)) continue;
		if (isRecord(theirs) && isRecord(ours)) {
			disagree(ours, theirs);
		} else if (typeof theirs === "string") {
			stored[key] =
				`${typeof ours === "string" ? ours : ""} (inny admin)`.trim();
		} else if (typeof theirs === "number") {
			stored[key] = theirs + 5;
		} else if (typeof theirs === "boolean") {
			stored[key] = !theirs;
		} else if (Array.isArray(theirs)) {
			stored[key] = [...(Array.isArray(ours) ? ours : []), "inny-admin"];
		} else if (isRecord(theirs)) {
			stored[key] = alter(copy(theirs));
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A copy of a record with every text in it changed. */
function alter(record: Record<string, unknown>): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		changed[key] =
			typeof value === "string"
				? `${value} (inny admin)`
				: isRecord(value)
					? alter(value)
					: value;
	}
	return changed;
}

function readSnapshot(
	storage: StorageLike | null,
	dataset: string,
): Snapshot | null {
	const snapshot = readStoredJson(SNAPSHOT_KEY, storage);
	if (!isRecord(snapshot) || snapshot.dataset !== dataset) return null;
	if (!isRecord(snapshot.slots) || typeof snapshot.version !== "number") {
		return null;
	}
	return {
		dataset,
		version: snapshot.version,
		slots: snapshot.slots,
	};
}
