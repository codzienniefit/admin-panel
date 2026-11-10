import {
	type InputHTMLAttributes,
	type ReactNode,
	type TextareaHTMLAttributes,
	useId,
} from "react";

// Form fields. A Field gives its control a label, an optional hint and an
// error message, and wires them up for screen readers.

export const controlClass =
	"w-full rounded-control border bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:shadow-focus disabled:cursor-not-allowed disabled:bg-bg disabled:text-muted any-pointer-coarse:text-base";

export const borderFor = (invalid: boolean) =>
	invalid ? "border-danger" : "border-line-input hover:border-primary";

interface FieldShellProps {
	label: string;
	hint?: string;
	error?: string;
	required?: boolean;
	children: (ids: {
		id: string;
		describedBy: string | undefined;
		invalid: boolean;
	}) => ReactNode;
}

/**
 * Label, hint and error around any control. TextField and TextAreaField use
 * it; so do selects, pickers and date fields inside forms.
 */
export function Field({
	label,
	hint,
	error,
	required,
	children,
}: FieldShellProps) {
	const id = useId();
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const describedBy =
		[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
		undefined;

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-semibold">
				{label}
				{required && <span className="ml-0.5 text-danger">*</span>}
			</label>
			{children({ id, describedBy, invalid: Boolean(error) })}
			{hint && !error && (
				<p id={hintId} className="text-xs text-muted">
					{hint}
				</p>
			)}
			{error && (
				<p id={errorId} role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
}

interface CommonProps {
	label: string;
	hint?: string;
	error?: string;
}

type TextFieldProps = CommonProps &
	Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

export function TextField({
	label,
	hint,
	error,
	required,
	...input
}: TextFieldProps) {
	return (
		<Field label={label} hint={hint} error={error} required={required}>
			{({ id, describedBy, invalid }) => (
				<input
					id={id}
					required={required}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
					className={`h-10 ${controlClass} ${borderFor(invalid)}`}
					{...input}
				/>
			)}
		</Field>
	);
}

type TextAreaFieldProps = CommonProps &
	Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

export function TextAreaField({
	label,
	hint,
	error,
	required,
	rows = 4,
	...textarea
}: TextAreaFieldProps) {
	return (
		<Field label={label} hint={hint} error={error} required={required}>
			{({ id, describedBy, invalid }) => (
				<textarea
					id={id}
					rows={rows}
					required={required}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
					className={`resize-y py-2 leading-relaxed ${controlClass} ${borderFor(invalid)}`}
					{...textarea}
				/>
			)}
		</Field>
	);
}
