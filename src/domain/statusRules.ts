import type { ContentStatus } from "@/data/schemas/common";

// What a challenge's or a workout's status may become, as the backend has it
// (its contentStatus.ts): a draft means "not published yet".
//
//   - something the app has shown (published or hidden, now or before) is never
//     a draft again: it can be hidden;
//   - a deleted item is only restored: as a draft if the app never showed it,
//     as hidden if it did (people who had it keep it, nobody new finds it).

export type StatusNoun = "challenge" | "workout";

interface Item {
	status: ContentStatus;
	/** From the backend: the app has shown it. Absent on an older backend. */
	wasPublic?: boolean;
}

const isPublic = (status: ContentStatus) =>
	status === "published" || status === "hidden";

/** The app has shown it, now or before. */
export function wasShown(item: Item): boolean {
	return item.wasPublic === true || isPublic(item.status);
}

/** What a deleted item comes back as. */
export function restoreStatusFor(item: Item): ContentStatus {
	return wasShown(item) ? "hidden" : "draft";
}

const TEXT = {
	challenge: {
		oncePublished:
			"To wyzwanie było już opublikowane: można je ukryć, ale nie cofnąć do szkicu",
		restoreAsDraft:
			"Usunięte wyzwanie można tylko przywrócić, jako szkic: nigdy nie było opublikowane",
		restoreAsHidden:
			"Usunięte wyzwanie można tylko przywrócić, jako ukryte: było już opublikowane",
	},
	workout: {
		oncePublished:
			"Ten trening był już opublikowany: można go ukryć, ale nie cofnąć do szkicu",
		restoreAsDraft:
			"Usunięty trening można tylko przywrócić, jako szkic: nigdy nie był opublikowany",
		restoreAsHidden:
			"Usunięty trening można tylko przywrócić, jako ukryty: był już opublikowany",
	},
} as const;

/** Why `stored` may not become `target`, in the backend's words; null when it may. */
export function statusMoveProblem(
	stored: Item | undefined,
	target: ContentStatus,
	noun: StatusNoun,
): string | null {
	if (!stored || stored.status === target) return null;
	if (stored.status === "deleted") {
		if (target === restoreStatusFor(stored)) return null;
		return wasShown(stored)
			? TEXT[noun].restoreAsHidden
			: TEXT[noun].restoreAsDraft;
	}
	if (target === "draft" && isPublic(stored.status)) {
		return TEXT[noun].oncePublished;
	}
	return null;
}

/** "przywrócone jako ukryte" / "przywrócony jako szkic": for the toast after a restore. */
export function restoredAs(item: Item, noun: StatusNoun): string {
	const hidden = restoreStatusFor(item) === "hidden";
	if (noun === "challenge") {
		return hidden
			? "Wyzwanie przywrócone jako ukryte"
			: "Wyzwanie przywrócone jako szkic";
	}
	return hidden
		? "Trening przywrócony jako ukryty"
		: "Trening przywrócony jako szkic";
}
