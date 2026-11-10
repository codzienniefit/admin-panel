import type { ContentStatus } from "@/data/schemas/challenge";
import { STATUS_META } from "./enums";
import { Tag } from "./Tag";

export function StatusBadge({ status }: { status: ContentStatus }) {
	const { label, tone } = STATUS_META[status];
	return <Tag tone={tone}>{label}</Tag>;
}
