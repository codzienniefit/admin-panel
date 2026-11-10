import { trainingTypeMeta } from "./enums";

interface WorkoutChipProps {
	title: string;
	durationMinutes?: number;
	trainingTypeIds?: readonly string[];
	selected?: boolean;
	onSelect?: () => void;
	onRemove?: () => void;
	/** Used in the remove button's accessible name, e.g. "z dnia 3". */
	removeContext?: string;
}

/**
 * A workout placed in a day. The stripe on the left takes the colour of the
 * workout's first training type; every type gets a dot.
 */
export function WorkoutChip({
	title,
	durationMinutes,
	trainingTypeIds = [],
	selected = false,
	onSelect,
	onRemove,
	removeContext = "",
}: WorkoutChipProps) {
	const types = trainingTypeIds.map((id) => ({ id, ...trainingTypeMeta(id) }));
	const main = types[0]?.tone ?? "grey";

	return (
		<div
			data-tone={main}
			className={`flex items-stretch overflow-hidden rounded-chip border text-left text-xs ${
				selected
					? "border-primary bg-primary-soft shadow-focus"
					: "border-line bg-surface-alt"
			}`}
		>
			<span className="w-1 shrink-0 bg-(--tone)" aria-hidden="true" />
			<button
				type="button"
				onClick={onSelect}
				aria-pressed={selected}
				className="min-w-0 flex-1 px-2 py-1.5 text-left"
			>
				<span className="line-clamp-2 leading-snug">{title}</span>
				<span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
					{types.map((type) => (
						<span
							key={type.id}
							data-tone={type.tone}
							title={type.label}
							className="size-1.5 rounded-full bg-(--tone)"
						/>
					))}
					{durationMinutes !== undefined && <span>{durationMinutes} min</span>}
				</span>
			</button>
			{onRemove && (
				<button
					type="button"
					aria-label={`Usuń ${title} ${removeContext}`.trim()}
					onClick={onRemove}
					className="shrink-0 px-2 text-muted hover:bg-danger-soft hover:text-danger"
				>
					×
				</button>
			)}
		</div>
	);
}
