import { fromLocalInput, toLocalInput } from "@/domain/dates";
import { borderFor, controlClass, Field } from "./Field";

interface DateTimeFieldProps {
	label: string;
	/** UTC ISO string, or null when empty. */
	value: string | null;
	onChange: (value: string | null) => void;
	hint?: string;
	error?: string;
	disabled?: boolean;
	/** Minutes between selectable times. */
	stepMinutes?: number;
}

/** A date and time, edited in local time and stored as UTC. */
export function DateTimeField({
	label,
	value,
	onChange,
	hint,
	error,
	disabled,
	stepMinutes = 15,
}: DateTimeFieldProps) {
	return (
		<Field label={label} hint={hint} error={error}>
			{({ id, describedBy, invalid }) => (
				<div className="flex gap-2">
					<input
						id={id}
						type="datetime-local"
						step={stepMinutes * 60}
						value={toLocalInput(value)}
						onChange={(event) => onChange(fromLocalInput(event.target.value))}
						disabled={disabled}
						aria-invalid={invalid || undefined}
						aria-describedby={describedBy}
						className={`h-10 ${controlClass} ${borderFor(invalid)}`}
					/>
					{value && !disabled && (
						<button
							type="button"
							aria-label={`Wyczyść: ${label}`}
							onClick={() => onChange(null)}
							className="flex size-10 shrink-0 items-center justify-center rounded-control border border-line-input text-muted hover:border-primary hover:text-ink"
						>
							×
						</button>
					)}
				</div>
			)}
		</Field>
	);
}
