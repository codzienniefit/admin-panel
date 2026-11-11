import { type ApiIssue, isApiError } from "@/data/api/errors";
import { deepEqual } from "@/domain/rebase";
import { attempt } from "@/ui/tasks";
import { toast } from "@/ui/toast";

export type ChangeResult =
	| {
			ok: true;
			changed: boolean;
			/** The save was combined with a change someone else made meanwhile. */
			merged: boolean;
	  }
	| { ok: false; issues: readonly ApiIssue[] };

/** A collection row that can be read and changed; every versioned collection has one. */
export interface ChangeTarget<T> {
	get(id: string): T | undefined;
	/** The latest version seen from the server, without edits still on screen. */
	saved?(id: string): T | undefined;
	update(id: string, apply: (draft: T) => void): Promise<void>;
	/** Whether the last save of this row was merged with someone else's change. */
	wasMerged?(id: string): boolean;
}

interface ApplyOptions<T> {
	/** The shared rule function of the entity; an empty list lets the save go. */
	issuesOf?: (candidate: T) => readonly ApiIssue[];
	/** Toast shown when the change is saved. */
	done?: string;
}

/**
 * The one way a screen changes a saved entity outside an autosaving editor:
 * describe the change, have it checked against the rules, save only the
 * fields that differ, and get back either "saved" or the list of problems.
 *
 * A conflict or a failed save is not returned here: it is thrown after the
 * saver has taken hold of the edits, and the page shows HeldEditsNotice.
 */
export async function applyChange<T extends { id: string }>(
	target: ChangeTarget<T>,
	item: T,
	change: (draft: T) => void,
	{ issuesOf, done }: ApplyOptions<T> = {},
): Promise<ChangeResult> {
	const candidate = structuredClone(item);
	change(candidate);

	const issues = issuesOf?.(candidate) ?? [];
	if (issues.length > 0) return { ok: false, issues };

	const before = (target.get(item.id) ?? item) as Record<string, unknown>;
	const after = candidate as Record<string, unknown>;
	const changed = [
		...new Set([...Object.keys(before), ...Object.keys(after)]),
	].filter((key) => key !== "id" && !deepEqual(before[key], after[key]));
	if (changed.length === 0) return { ok: true, changed: false, merged: false };

	try {
		await target.update(item.id, (draft) => {
			const row = draft as Record<string, unknown>;
			for (const key of changed) {
				if (key in after) row[key] = after[key];
				else delete row[key];
			}
		});
	} catch (error) {
		if (isApiError(error) && error.kind === "validation") {
			return { ok: false, issues: error.issues };
		}
		throw error;
	}
	const merged = target.wasMerged?.(item.id) ?? false;
	if (done) {
		toast({
			title: done,
			description: merged ? "Połączono ze zmianami innej osoby." : undefined,
			tone: "green",
		});
	}
	return { ok: true, changed: true, merged };
}

/**
 * What a change would send, without sending it: the version on the server
 * now, and that entity with the change applied. For the JSON preview, so that
 * what is shown is built exactly as a save builds it.
 */
export function previewChange<T extends { id: string }>(
	target: ChangeTarget<T>,
	item: T,
	change: (draft: T) => void,
): { before: T; after: T } {
	const after = structuredClone(target.get(item.id) ?? item);
	change(after);
	return {
		before: asSent(target.saved?.(item.id) ?? item),
		after: asSent(after),
	};
}

/**
 * A row as it travels to the server. Rows read from a collection carry the
 * library's own bookkeeping (`$key`, `$origin`, `$hasPendingWrites`,
 * `$collectionId`); it never leaves the browser, so it is not shown as data.
 */
export function asSent<T extends object>(row: T): T {
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => !key.startsWith("$")),
	) as T;
}

/**
 * Runs a deliberate save for a screen that shows HeldEditsNotice.
 *
 * Null means the save stopped on a conflict or a failure: the saver holds the
 * edits and the notice explains, so the screen has nothing more to do.
 */
export async function settleChange(
	save: () => Promise<ChangeResult>,
): Promise<ChangeResult | null> {
	const result = await attempt(save);
	return result.ok ? result.value : null;
}

/**
 * The same, for a button with no form around it: problems from the rules
 * become a toast. True when the change went through.
 */
export async function saveOrToast(
	refused: string,
	save: () => Promise<ChangeResult>,
): Promise<boolean> {
	const result = await settleChange(save);
	if (result && !result.ok) toastIssues(refused, result.issues);
	return result?.ok ?? false;
}

/** Shows problems that have no field of their own to sit next to. */
export function toastIssues(title: string, issues: readonly ApiIssue[]): void {
	toast({
		title,
		description: issues
			.slice(0, 4)
			.map((issue) => issue.message)
			.join(" · "),
		tone: "red",
	});
}
