import { useSyncExternalStore } from "react";

// A minimal observable value for the few bits of client state that are not
// server data (mock controls, save status, undo history). Server data lives
// in collections, never here.
export interface Store<T> {
	get(): T;
	set(next: T | ((prev: T) => T)): void;
	subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(next) {
			const resolved =
				typeof next === "function" ? (next as (prev: T) => T)(value) : next;
			if (Object.is(resolved, value)) return;
			value = resolved;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function useStore<T>(store: Store<T>): T {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
