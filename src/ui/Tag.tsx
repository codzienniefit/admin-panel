import type { ReactNode } from "react";
import type { Tone } from "./tones";

interface TagProps {
	tone: Tone;
	children: ReactNode;
	/** "soft" is a tinted pill; "dot" is a coloured dot beside plain text. */
	variant?: "soft" | "dot";
	title?: string;
}

/** A small coloured label. Pick the tone through src/ui/enums.ts. */
export function Tag({ tone, children, variant = "soft", title }: TagProps) {
	if (variant === "dot") {
		return (
			<span
				data-tone={tone}
				title={title}
				className="inline-flex items-center gap-1.5 text-xs text-subtle"
			>
				<span className="size-2 shrink-0 rounded-full bg-(--tone)" />
				{children}
			</span>
		);
	}
	return (
		<span
			data-tone={tone}
			title={title}
			className="inline-flex items-center whitespace-nowrap rounded-chip bg-(--tone-soft) px-2 py-0.5 text-xs font-semibold text-(--tone-ink)"
		>
			{children}
		</span>
	);
}
