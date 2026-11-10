import { type ApiIssue, isApiError } from "@/data/api/errors";
import { challengesCollection } from "@/data/collections/challenges";
import type { Challenge } from "@/data/schemas/challenge";
import type { WorkoutConfig } from "@/data/schemas/config";
import {
	type ChallengeContext,
	challengeIssues,
} from "@/domain/challengeRules";
import { deepEqual } from "@/domain/rebase";
import { createStore } from "@/lib/store";
import { toast } from "@/ui/toast";

export type ChangeResult =
	| { ok: true; changed: boolean }
	| { ok: false; issues: readonly ApiIssue[] };

interface ApplyOptions {
	config: WorkoutConfig;
	context: ChallengeContext;
	/** Toast shown when the change is saved. */
	done?: string;
}

/**
 * The one way a screen changes a challenge: describe the change, have it
 * checked against the rules, save it, and get back either "saved" or the
 * list of problems to show.
 *
 * A conflict or a failed save is not returned here. The saver keeps the
 * edits and the challenge page shows what happened (HeldEditsNotice).
 */
export async function applyChallengeChange(
	challenge: Challenge,
	change: (draft: Challenge) => void,
	{ config, context, done }: ApplyOptions,
): Promise<ChangeResult> {
	const candidate = structuredClone(challenge);
	change(candidate);

	const issues = challengeIssues(candidate, config, context);
	if (issues.length > 0) return { ok: false, issues };

	const current = challengesCollection.get(challenge.id) ?? challenge;
	const before = current as Record<string, unknown>;
	const after = candidate as Record<string, unknown>;
	const changed = Object.keys(after).filter(
		(key) => key !== "id" && !deepEqual(before[key], after[key]),
	);
	if (changed.length === 0) return { ok: true, changed: false };

	try {
		await challengesCollection
			.update(challenge.id, (draft) => {
				const target = draft as Record<string, unknown>;
				for (const key of changed) target[key] = after[key];
			})
			.when("settled");
	} catch (error) {
		if (isApiError(error) && error.kind === "validation") {
			return { ok: false, issues: error.issues };
		}
		throw error;
	}
	if (done) toast({ title: done, tone: "green" });
	return { ok: true, changed: true };
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

/**
 * Challenges whose content form has unsaved input. Status actions wait for a
 * save, so that "Opublikuj" never publishes something other than what is on
 * screen.
 */
export const unsavedContent = createStore<ReadonlySet<string>>(new Set());

export function markUnsaved(challengeId: string, unsaved: boolean): void {
	unsavedContent.set((current) => {
		if (current.has(challengeId) === unsaved) return current;
		const next = new Set(current);
		if (unsaved) next.add(challengeId);
		else next.delete(challengeId);
		return next;
	});
}

export const newPathId = (): string =>
	`p-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
