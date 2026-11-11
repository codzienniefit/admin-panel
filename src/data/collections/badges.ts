import { api } from "@/data/api";
import { ApiError, isConflict } from "@/data/api/errors";
import type { Badge, NewBadge } from "@/data/schemas/badge";
import { createVersionedCollection } from "./versioned";

// The single copy of every badge definition, hidden ones included. Where a
// badge is assigned is not kept here: screens work it out from the workouts
// and challenges collections (domain/badgeRules).
const badges = createVersionedCollection<Badge>({
	name: "badges",
	list: () => api.badges.list(),
	save: (badge, options) => api.badges.save(badge, options),
});

export const badgesCollection = badges.collection;
export const badgeSaver = badges.saver;
export const badgeTarget = badges.target;

export async function createBadge(input: NewBadge): Promise<Badge> {
	return badges.addCreated(await api.badges.create(input));
}

/** Deletes a badge for good. The server refuses while it is assigned. */
export async function removeBadge(badgeId: string): Promise<void> {
	const current = badgesCollection.get(badgeId);
	if (!current) throw new ApiError("notFound", "Nie ma takiej odznaki");
	try {
		await api.badges.remove(badgeId, { etag: current.etag });
	} catch (error) {
		// Someone changed it since it was loaded: show what it is now.
		if (isConflict<Badge>(error) && error.current) {
			badges.saver.remember([error.current]);
			badgesCollection.utils.writeUpsert(error.current);
		}
		throw error;
	}
	badgesCollection.utils.writeDelete(badgeId);
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
