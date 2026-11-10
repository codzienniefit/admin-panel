import type { ReactNode } from "react";
import type { Tone } from "./tones";

interface NoticeProps {
	tone: Tone;
	title: string;
	children?: ReactNode;
	/** Buttons shown under the text. */
	actions?: ReactNode;
	/** "alert" interrupts a screen reader; "status" waits its turn. */
	role?: "alert" | "status";
}

/** A tinted box for something the user should read: a conflict, a failure, a hint. */
export function Notice({
	tone,
	title,
	children,
	actions,
	role = "status",
}: NoticeProps) {
	return (
		<div
			data-tone={tone}
			role={role}
			className="rounded-card border border-(--tone) bg-(--tone-soft) p-4"
		>
			<h2 className="font-semibold text-(--tone-ink)">{title}</h2>
			{children && <div className="mt-1 text-sm text-subtle">{children}</div>}
			{actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
		</div>
	);
}
