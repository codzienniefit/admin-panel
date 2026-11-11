import { PALETTE } from "@/domain/palette";

interface ColorPaletteProps {
	/** Accessible name of the group, e.g. "Kolor dnia". */
	label: string;
	/** `#rrggbb`, or null for no colour. */
	value: string | null;
	onChange: (value: string | null) => void;
	/** What "no colour" means here, e.g. "Automatyczny". */
	noneLabel?: string;
	/** The colour "none" results in, shown as a dot on that button. */
	noneColor?: string;
	disabled?: boolean;
}

/** The twelve planner colours as swatches, plus "none". */
export function ColorPalette({
	label,
	value,
	onChange,
	noneLabel = "Bez koloru",
	noneColor,
	disabled = false,
}: ColorPaletteProps) {
	const current = value?.toLowerCase() ?? null;
	return (
		<fieldset disabled={disabled} className="min-w-0">
			<legend className="mb-1.5 text-sm font-semibold">{label}</legend>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					aria-pressed={current === null}
					onClick={() => onChange(null)}
					className={`flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-xs ${
						current === null
							? "border-primary bg-primary-soft text-primary"
							: "border-line-input bg-surface text-subtle hover:border-primary"
					}`}
				>
					{noneColor && (
						<span
							aria-hidden="true"
							className="size-3 shrink-0 rounded-full"
							style={{ backgroundColor: noneColor }}
						/>
					)}
					{noneLabel}
				</button>
				{PALETTE.map((color) => (
					<button
						key={color.id}
						type="button"
						title={color.label}
						aria-label={color.label}
						aria-pressed={current === color.hex}
						onClick={() => onChange(color.hex)}
						style={{ backgroundColor: color.hex }}
						className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${
							current === color.hex
								? "border-ink shadow-focus"
								: "border-surface"
						}`}
					/>
				))}
			</div>
		</fieldset>
	);
}
