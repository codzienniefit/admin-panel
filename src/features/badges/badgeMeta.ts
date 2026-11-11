import type { Badge } from "@/data/schemas/badge";
import type { InternalConfig } from "@/data/schemas/config";
import type { EnumMeta } from "@/ui/enums";
import { toneForId } from "@/ui/tones";

// How badge types are shown: one label and one tone each, in the style of
// src/ui/enums.ts (where this belongs; it lives here until it is moved).
// Tones are fixed here; labels come from the backend configuration when it
// has one for the value.

const BADGE_TYPES: Record<string, EnumMeta> = {
	normal: { label: "Trening/Wyzwanie", tone: "blue" },
	milestone: { label: "Powtórzenia", tone: "purple" },
	manual: { label: "Ręczne", tone: "orange" },
	perfections: { label: "Ukończone na 100%", tone: "teal" },
};

export const KNOWN_BADGE_TYPE_IDS = Object.keys(BADGE_TYPES);

export function badgeTypeMeta(
	type: string,
	types: InternalConfig["badgeTypes"],
): EnumMeta {
	const known = BADGE_TYPES[type];
	return {
		// A type nobody knows still shows, as itself, in a stable colour.
		label:
			types.find((item) => item.value === type)?.label ?? known?.label ?? type,
		tone: known?.tone ?? toneForId(type),
	};
}

export const BADGE_VISIBILITY_META = {
	visible: { label: "Widoczna", tone: "green" },
	// The same grey a hidden workout or challenge has.
	hidden: { label: "Ukryta", tone: "grey" },
} as const satisfies Record<string, EnumMeta>;

/** The two kinds of manual badge. The configuration has no labels for them. */
export const SPECIAL_CATEGORY_LABELS: Record<string, string> = {
	event: "Wydarzenie (do zdobycia kodem lub linkiem)",
	specialTraining: "Specjalny trening (przyznawana ręcznie)",
};

/** "Wyzwania › Ukończone", or null when the badge has no section yet. */
export function badgeSectionLabel(
	badge: Pick<Badge, "sectionId" | "subsectionId">,
	sections: InternalConfig["badgeSections"],
): string | null {
	const section = sections.find((item) => item.id === badge.sectionId);
	if (!section) return null;
	const subsection = section.subsections.find(
		(item) => item.id === badge.subsectionId,
	);
	return subsection ? `${section.label} › ${subsection.label}` : section.label;
}
