import type { ReactNode } from "react";

// A small either-or switch: "Karty | Tabela", "Miesiąc | Rok".

export const segmentedTrack = "flex gap-1 rounded-control bg-hover p-1";
export const segmentedItem =
	"rounded-chip px-3 py-1 text-sm text-subtle hover:text-ink aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:text-ink aria-pressed:shadow-sm aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-sm";

interface SegmentedProps<T extends string> {
	/** Accessible name of the group. */
	label: string;
	options: ReadonlyArray<{ value: T; label: ReactNode }>;
	value: T;
	onChange: (value: T) => void;
	/** Buttons share the width evenly; for a bar that spans its container. */
	stretch?: boolean;
	className?: string;
}

/** Picks one of a few views. For a choice that changes the address, use links styled with segmentedItem. */
export function Segmented<T extends string>({
	label,
	options,
	value,
	onChange,
	stretch = false,
	className = "",
}: SegmentedProps<T>) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would add a legend and its own layout
		<div
			role="group"
			aria-label={label}
			className={`${segmentedTrack} ${className}`}
		>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
					className={`${segmentedItem} ${stretch ? "flex-1" : ""}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
