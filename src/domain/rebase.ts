// Three-way merge used on every save.
//
//   base   what this user started editing from
//   mine   base plus this user's edits
//   theirs the latest version known from the server
//
// The result is `theirs` with only the parts this user actually changed laid
// on top. Fields changed on one side merge silently; a field changed
// differently on both sides is a conflict. Fields the panel has no schema for
// are carried along from `theirs`, so they are never lost.
//
// Pure: no React, no storage.

type Json = unknown;
type Obj = Record<string, Json>;

export interface RebaseResult<T> {
	merged: T;
	/** Human-readable locations, e.g. "title" or "paths[p1].days[3]". */
	conflicts: string[];
}

export interface RebaseOptions {
	/** Keys the server owns; always taken from `theirs`. */
	serverOwned?: readonly string[];
	/** Which side wins a conflict in `merged`. Conflicts are still reported. */
	prefer?: "theirs" | "mine";
}

const DEFAULT_SERVER_OWNED = ["etag", "updatedAtUtc"] as const;

export function deepEqual(a: Json, b: Json): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	}
	const ao = a as Obj;
	const bo = b as Obj;
	const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
	for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
	return true;
}

function isObj(v: Json): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Arrays of objects that share an identity key merge item by item. */
interface KeyedArrayRule {
	key: string;
	/** Nested keyed arrays inside each item. */
	children?: Record<string, KeyedArrayRule>;
}

const CHALLENGE_RULES: Record<string, KeyedArrayRule> = {
	paths: { key: "pathId", children: { days: { key: "dayIndex" } } },
};

function mergeObject(
	base: Obj,
	mine: Obj,
	theirs: Obj,
	rules: Record<string, KeyedArrayRule>,
	where: string,
	opts: Required<RebaseOptions>,
	conflicts: string[],
): Obj {
	const merged: Obj = { ...theirs };
	const keys = new Set([...Object.keys(base), ...Object.keys(mine)]);

	for (const k of keys) {
		if (opts.serverOwned.includes(k)) continue;
		const mineChanged = !deepEqual(base[k], mine[k]);
		if (!mineChanged) continue;
		const theirsChanged = !deepEqual(base[k], theirs[k]);
		const here = where ? `${where}.${k}` : k;

		if (!theirsChanged || deepEqual(mine[k], theirs[k])) {
			setOrDelete(merged, k, mine, k in mine);
			continue;
		}

		const rule = rules[k];
		if (
			rule &&
			Array.isArray(base[k]) &&
			Array.isArray(mine[k]) &&
			Array.isArray(theirs[k])
		) {
			merged[k] = mergeKeyedArray(
				base[k] as Json[],
				mine[k] as Json[],
				theirs[k] as Json[],
				rule,
				here,
				opts,
				conflicts,
			);
			continue;
		}

		conflicts.push(here);
		if (opts.prefer === "mine") setOrDelete(merged, k, mine, k in mine);
	}
	return merged;
}

function setOrDelete(target: Obj, k: string, source: Obj, present: boolean) {
	if (present) target[k] = source[k];
	else delete target[k];
}

function mergeKeyedArray(
	base: Json[],
	mine: Json[],
	theirs: Json[],
	rule: KeyedArrayRule,
	where: string,
	opts: Required<RebaseOptions>,
	conflicts: string[],
): Json[] {
	const idOf = (v: Json) => (isObj(v) ? String(v[rule.key]) : undefined);
	const index = (list: Json[]) => {
		const map = new Map<string, Obj>();
		for (const v of list) {
			const id = idOf(v);
			if (id !== undefined && isObj(v)) map.set(id, v);
		}
		return map;
	};
	const baseById = index(base);
	const mineById = index(mine);
	const theirsById = index(theirs);

	// Items are matched by identity. If either side added, removed or
	// reordered items, the list as a whole is one unit: merging item by item
	// could silently resurrect or drop an entry.
	const ids = (list: Json[]) => list.map(idOf).join("\u0000");
	if (ids(base) !== ids(mine) || ids(base) !== ids(theirs)) {
		conflicts.push(where);
		return opts.prefer === "mine" ? mine : theirs;
	}

	return theirs.map((theirItem) => {
		const id = idOf(theirItem);
		const b = id === undefined ? undefined : baseById.get(id);
		const m = id === undefined ? undefined : mineById.get(id);
		const t = id === undefined ? undefined : theirsById.get(id);
		if (!b || !m || !t) return theirItem;
		return mergeObject(
			b,
			m,
			t,
			rule.children ?? {},
			`${where}[${id}]`,
			opts,
			conflicts,
		);
	});
}

export function rebase<T extends object>(
	base: T,
	mine: T,
	theirs: T,
	options: RebaseOptions = {},
): RebaseResult<T> {
	const opts: Required<RebaseOptions> = {
		serverOwned: options.serverOwned ?? DEFAULT_SERVER_OWNED,
		prefer: options.prefer ?? "theirs",
	};
	const conflicts: string[] = [];
	const merged = mergeObject(
		base as Obj,
		mine as Obj,
		theirs as Obj,
		CHALLENGE_RULES,
		"",
		opts,
		conflicts,
	);
	return { merged: merged as T, conflicts };
}
