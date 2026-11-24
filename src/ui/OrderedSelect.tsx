import { Button } from "./Button";
import { Select, type SelectOption } from "./Select";

// A short list where the order matters: picked one by one, shown numbered in
// the order they were picked, moved up or down, removed. For lists of a few
// items (the challenges recommended next: the first is the next plan, the
// second the alternative). MultiSelect is for sets, where order means nothing.

interface OrderedSelectProps<T extends string> {
	options: readonly SelectOption<T>[];
	/** In order: the first is the first shown. */
	value: readonly T[];
	onChange: (value: T[]) => void;
	/** Names the list for screen readers and the add control. */
	label: string;
	/** No more can be added once the list has this many. */
	max?: number;
	disabled?: boolean;
	invalid?: boolean;
	/** Shown when the list is empty. */
	emptyText?: string;
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
	const next = [...list];
	const [item] = next.splice(from, 1);
	if (item !== undefined) next.splice(to, 0, item);
	return next;
};

export function OrderedSelect<T extends string>({
	options,
	value,
	onChange,
	label,
	max,
	disabled = false,
	invalid = false,
	emptyText = "Brak",
}: OrderedSelectProps<T>) {
	const byValue = new Map(options.map((option) => [option.value, option]));
	const remaining = options.filter((option) => !value.includes(option.value));
	const full = max !== undefined && value.length >= max;

	return (
		<div className="flex flex-col gap-2">
			{value.length === 0 ? (
				<p className="text-sm text-muted">{emptyText}</p>
			) : (
				<ol
					aria-label={label}
					className={`flex flex-col divide-y divide-line rounded-control border ${invalid ? "border-danger" : "border-line-input"}`}
				>
					{value.map((item, index) => {
						const option = byValue.get(item);
						const name = option?.label ?? item;
						return (
							<li
								key={item}
								className="flex items-center gap-2 px-2 py-1.5 text-sm"
							>
								<span className="w-5 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
									{index + 1}.
								</span>
								<span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
									{name}
									{option?.hint && (
										<span className="ml-2 font-mono text-xs text-muted">
											{option.hint}
										</span>
									)}
									{!option && (
										<span className="ml-2 text-xs text-danger">
											nie ma takiego
										</span>
									)}
								</span>
								<Button
									variant="ghost"
									aria-label={`Przesuń wyżej: ${name}`}
									title="Wyżej"
									disabled={disabled || index === 0}
									onClick={() => onChange(move(value, index, index - 1))}
								>
									↑
								</Button>
								<Button
									variant="ghost"
									aria-label={`Przesuń niżej: ${name}`}
									title="Niżej"
									disabled={disabled || index === value.length - 1}
									onClick={() => onChange(move(value, index, index + 1))}
								>
									↓
								</Button>
								<Button
									variant="ghost"
									aria-label={`Usuń z listy: ${name}`}
									title="Usuń z listy"
									disabled={disabled}
									onClick={() =>
										onChange(value.filter((_, at) => at !== index))
									}
								>
									×
								</Button>
							</li>
						);
					})}
				</ol>
			)}
			{!full && (
				<Select
					label={`Dodaj: ${label}`}
					options={remaining}
					value={null}
					onChange={(added) => {
						if (added !== null) onChange([...value, added]);
					}}
					placeholder="Dodaj…"
					emptyText="Nie ma już czego dodać"
					disabled={disabled || remaining.length === 0}
				/>
			)}
			{full && (
				<p className="text-xs text-muted">
					Najwyżej {max}. Usuń jedno, żeby dodać inne.
				</p>
			)}
		</div>
	);
}
