import type { InternalConfig } from "@/data/schemas/config";
import type { MessageStatus } from "@/data/schemas/message";
import type { EnumMeta } from "@/ui/enums";
import { toneForId } from "@/ui/tones";

// How message statuses and target groups are shown: one label and one tone
// each, in the style of src/ui/enums.ts (where this belongs; it lives here
// until it is moved). Tones are fixed here; labels come from the backend
// configuration when it has one for the value.

export const MESSAGE_STATUS_META: Record<MessageStatus, EnumMeta> = {
	draft: { label: "Robocza", tone: "amber" },
	sent: { label: "Wysłana", tone: "green" },
	archived: { label: "Zarchiwizowana", tone: "grey" },
};

export const MESSAGE_STATUSES = Object.keys(
	MESSAGE_STATUS_META,
) as MessageStatus[];

export function messageStatusMeta(
	status: MessageStatus,
	states: InternalConfig["draftMessageStates"],
): EnumMeta {
	const known = MESSAGE_STATUS_META[status];
	return {
		label: states.find((item) => item.state === status)?.label ?? known.label,
		tone: known.tone,
	};
}

const TARGET_GROUPS: Record<string, EnumMeta> = {
	all: { label: "Wszyscy", tone: "blue" },
	// The same colour "Pro" has on workouts and challenges.
	subscribers: { label: "Pro", tone: "indigo" },
	nonSubscribers: { label: "Darmowi", tone: "teal" },
};

export function targetGroupMeta(
	groupId: string,
	groups: InternalConfig["draftMessageTargetGroups"],
): EnumMeta {
	const known = TARGET_GROUPS[groupId];
	return {
		// A group nobody knows still shows, as itself, in a stable colour.
		label:
			groups.find((group) => group.state === groupId)?.label ??
			known?.label ??
			groupId,
		tone: known?.tone ?? toneForId(groupId),
	};
}
