import { challengeTarget } from "@/data/collections/challenges";
import type { Challenge } from "@/data/schemas/challenge";
import type { WorkoutConfig } from "@/data/schemas/config";
import {
	type ChallengeContext,
	challengeIssues,
} from "@/domain/challengeRules";
import {
	applyChange,
	asSent,
	type ChangeResult,
} from "@/features/saving/applyChange";
import { newId } from "@/lib/ids";
import { createStore } from "@/lib/store";

export type { ChangeResult } from "@/features/saving/applyChange";
export { toastIssues } from "@/features/saving/applyChange";

interface ApplyOptions {
	config: WorkoutConfig;
	context: ChallengeContext;
	/** Toast shown when the change is saved. */
	done?: string;
}

/** Changes a challenge through the shared path, checked by the challenge rules. */
export function applyChallengeChange(
	challenge: Challenge,
	change: (draft: Challenge) => void,
	{ config, context, done }: ApplyOptions,
): Promise<ChangeResult> {
	return applyChange(challengeTarget, challenge, change, {
		issuesOf: (candidate) => challengeIssues(candidate, config, context),
		done,
	});
}

/**
 * Challenges with unsaved input on screen: the content form, or schedule
 * changes staged in the planner. Status actions wait for a save, so that
 * "Opublikuj" never publishes something other than what is on screen.
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

export const newPathId = (): string => newId("p");

// A screen holding unsaved input for a challenge (the content form) says here
// what a save would send, so the JSON preview in the page header shows that
// and not only what is already saved.
const candidates = new Map<string, () => Challenge>();

/** Returns the function that takes the offer back. */
export function offerCandidate(
	challengeId: string,
	build: () => Challenge,
): () => void {
	candidates.set(challengeId, build);
	return () => {
		if (candidates.get(challengeId) === build) candidates.delete(challengeId);
	};
}

/**
 * The challenge on the server now, and what a save would send: the unsaved
 * form if there is one, else what is on screen (staged plan changes included).
 */
export function challengeVersions(challenge: Challenge): {
	before: Challenge;
	after: Challenge;
} {
	return {
		before: asSent(challengeTarget.saved(challenge.id) ?? challenge),
		after: asSent(candidates.get(challenge.id)?.() ?? challenge),
	};
}
