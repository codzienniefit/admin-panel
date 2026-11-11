import type { ReactNode } from "react";
import type { Tone } from "./tones";

/** The white rounded surface every list item and panel sits on. */
export function Card({
	children,
	className = "",
	tone,
}: {
	children: ReactNode;
	className?: string;
	/** Sets the tone variables, for an accent such as `border-l-(--tone)`. */
	tone?: Tone;
}) {
	return (
		<div
			data-tone={tone}
			className={`rounded-card border border-line bg-surface p-4 md:p-5 ${className}`}
		>
			{children}
		</div>
	);
}
