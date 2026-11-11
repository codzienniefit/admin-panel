import { deepEqual, KEYED_ARRAYS, type KeyedArrayRule } from "./rebase";

// What differs between two JSON documents: the version on the server and the
// one about to be sent. Used by the JSON preview, where only the changed
// properties should be on screen.
//
// Lists of things with an identity (variants by pathId, days by dayIndex,
// plan types and folders by id: the same lists the merge knows) are compared
// item by item. Any other list counts as one value: it changed or it did not.
//
// Pure: no React, no storage.

type Obj = Record<string, unknown>;

export interface JsonChange {
	/** Where, e.g. "title" or "paths[p-easy].days[3].workoutIds". */
	path: string;
	/** `undefined` when the property was not there. */
	before: unknown;
	/** `undefined` when the property is gone. */
	after: unknown;
}

export interface JsonDiff {
	changes: JsonChange[];
	/**
	 * The two documents reduced to what differs: the old values and the new
	 * ones. An item of a keyed list keeps its identity, so it can be told which
	 * variant or day a value belongs to. `undefined` when nothing differs.
	 */
	before: unknown;
	after: unknown;
}

const ABSENT = Symbol("absent");
type Part = unknown | typeof ABSENT;

const isObj = (value: unknown): value is Obj =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const present = (part: Part): unknown => (part === ABSENT ? undefined : part);

interface Found {
	before: Part;
	after: Part;
}

/** Compares two values; null when they are the same. */
function diffValue(
	before: Part,
	after: Part,
	rule: KeyedArrayRule | undefined,
	rules: Record<string, KeyedArrayRule>,
	where: string,
	changes: JsonChange[],
): Found | null {
	if (before !== ABSENT && after !== ABSENT && deepEqual(before, after)) {
		return null;
	}
	if (rule && Array.isArray(before) && Array.isArray(after)) {
		const keyed = diffKeyedArray(before, after, rule, where, changes);
		if (keyed) return keyed;
	} else if (isObj(before) && isObj(after)) {
		return diffObject(before, after, rules, where, changes);
	}
	changes.push({ path: where, before: present(before), after: present(after) });
	return { before, after };
}

function diffObject(
	before: Obj,
	after: Obj,
	rules: Record<string, KeyedArrayRule>,
	where: string,
	changes: JsonChange[],
): Found | null {
	const partBefore: Obj = {};
	const partAfter: Obj = {};
	let differs = false;
	// In the order of the new document, then what was removed.
	const keys = new Set([...Object.keys(after), ...Object.keys(before)]);
	for (const key of keys) {
		const found = diffValue(
			key in before ? before[key] : ABSENT,
			key in after ? after[key] : ABSENT,
			rules[key],
			rules,
			where ? `${where}.${key}` : key,
			changes,
		);
		if (!found) continue;
		differs = true;
		if (found.before !== ABSENT) partBefore[key] = found.before;
		if (found.after !== ABSENT) partAfter[key] = found.after;
	}
	return differs ? { before: partBefore, after: partAfter } : null;
}

/**
 * Item by item, matched by identity. Null when the list cannot be compared
 * that way (an item without the key, a key used twice, or the same items in
 * another order): the caller then treats it as one changed value.
 */
function diffKeyedArray(
	before: unknown[],
	after: unknown[],
	rule: KeyedArrayRule,
	where: string,
	changes: JsonChange[],
): Found | null {
	const index = (items: unknown[]): Map<string, Obj> | null => {
		const byKey = new Map<string, Obj>();
		for (const item of items) {
			if (!isObj(item) || !(rule.key in item)) return null;
			const identity = String(item[rule.key]);
			if (byKey.has(identity)) return null;
			byKey.set(identity, item);
		}
		return byKey;
	};
	const old = index(before);
	const next = index(after);
	if (!old || !next) return null;

	const shared = (keys: Iterable<string>, other: Map<string, Obj>) =>
		[...keys].filter((key) => other.has(key));
	if (
		shared(old.keys(), next).join("\n") !== shared(next.keys(), old).join("\n")
	) {
		return null;
	}

	const partBefore: unknown[] = [];
	const partAfter: unknown[] = [];
	const found: JsonChange[] = [];
	for (const identity of new Set([...next.keys(), ...old.keys()])) {
		const was = old.get(identity);
		const is = next.get(identity);
		const here = `${where}[${identity}]`;
		if (was && is) {
			const inside = diffObject(was, is, rule.children ?? {}, here, found);
			if (!inside) continue;
			const tag = { [rule.key]: is[rule.key] };
			partBefore.push({ ...tag, ...(inside.before as Obj) });
			partAfter.push({ ...tag, ...(inside.after as Obj) });
			continue;
		}
		found.push({ path: here, before: was, after: is });
		if (was) partBefore.push(was);
		if (is) partAfter.push(is);
	}
	changes.push(...found);
	return { before: partBefore, after: partAfter };
}

/** What differs between two documents; empty when they are the same. */
export function jsonDiff(before: unknown, after: unknown): JsonDiff {
	const changes: JsonChange[] = [];
	const found = diffValue(before, after, undefined, KEYED_ARRAYS, "", changes);
	return {
		changes,
		before: found ? present(found.before) : undefined,
		after: found ? present(found.after) : undefined,
	};
}
