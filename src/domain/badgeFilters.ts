import type { Badge } from "@/data/schemas/badge";
import { matchesQuery } from "./text";

export type BadgeSort = "name" | "updated";
export type BadgeVisibility = "visible" | "hidden";

export interface BadgeFilters {
	q?: string;
	type?: string;
	/** Section id from the backend configuration. */
	section?: string;
	/** Absent: both. */
	visibility?: BadgeVisibility;
	sort?: BadgeSort;
}

const byName = new Intl.Collator("pl", { sensitivity: "base", numeric: true });

/** The badges a list should show for these filters, in order. */
export function filterBadges(
	badges: readonly Badge[],
	filters: BadgeFilters,
): Badge[] {
	const { q, type, section, visibility, sort = "name" } = filters;

	const shown = badges.filter((badge) => {
		if (type && badge.type !== type) return false;
		if (section && badge.sectionId !== section) return false;
		if (visibility && Boolean(badge.isHidden) !== (visibility === "hidden")) {
			return false;
		}
		if (
			q &&
			!matchesQuery(`${badge.name} ${badge.comment ?? ""} ${badge.id}`, q)
		) {
			return false;
		}
		return true;
	});

	return shown.sort((a, b) => {
		if (sort === "updated") {
			const updated = b.updatedAtUtc.localeCompare(a.updatedAtUtc);
			if (updated !== 0) return updated;
		}
		return byName.compare(a.name, b.name);
	});
}
