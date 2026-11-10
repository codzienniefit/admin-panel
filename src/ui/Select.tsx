import { Combobox } from "@base-ui/react/combobox";
import { matchesQuery } from "@/domain/text";
import type { Tone } from "./tones";

// The one dropdown of the panel: tap it, a scrollable list of every option
// appears, typing filters the list. Built on Base UI's combobox, which
// handles focus, keyboard, touch and positioning.

export interface SelectOption<T extends string = string> {
	value: T;
	label: string;
	/** Secondary text on the right, e.g. a duration or "wkrótce". */
	hint?: string;
	/** Coloured dot; pick it through src/ui/enums.ts. */
	tone?: Tone;
	disabled?: boolean;
}

interface SelectProps<T extends string> {
	options: readonly SelectOption<T>[];
	value: T | null;
	onChange: (value: T | null) => void;
	/** Accessible name of the control. */
	label: string;
	placeholder?: string;
	searchPlaceholder?: string;
	emptyText?: string;
	disabled?: boolean;
	invalid?: boolean;
	size?: "sm" | "md";
	/** "quiet" has no border until hovered; for inline actions like "+ Dodaj". */
	variant?: "field" | "quiet";
	/** Shows a button that empties the choice. */
	clearable?: boolean;
	className?: string;
}

/** Matches without Polish diacritics, so "lodz" finds "Łódź". */
export function optionMatches(option: SelectOption, query: string): boolean {
	return matchesQuery(`${option.label} ${option.hint ?? ""}`, query);
}

const TRIGGER_SIZE = {
	sm: "h-8 px-2.5 text-sm",
	md: "h-10 px-3 text-sm",
};

const TRIGGER_VARIANT = {
	field:
		"border bg-surface text-ink hover:border-primary data-popup-open:border-primary data-popup-open:shadow-focus",
	quiet:
		"border border-transparent bg-transparent text-muted hover:border-line-input hover:text-ink data-popup-open:border-primary data-popup-open:text-ink",
};

export function Select<T extends string>({
	options,
	value,
	onChange,
	label,
	placeholder = "Wybierz…",
	searchPlaceholder = "Szukaj…",
	emptyText = "Brak wyników",
	disabled = false,
	invalid = false,
	size = "md",
	variant = "field",
	clearable = false,
	className = "",
}: SelectProps<T>) {
	const selected = options.find((option) => option.value === value) ?? null;
	const showClear = clearable && selected !== null && !disabled;
	const border =
		variant === "quiet" ? "" : invalid ? "border-danger" : "border-line-input";

	return (
		<Combobox.Root
			items={options}
			value={selected}
			onValueChange={(option: SelectOption<T> | null) =>
				onChange(option?.value ?? null)
			}
			itemToStringLabel={(option: SelectOption<T>) => option.label}
			isItemEqualToValue={(a: SelectOption<T>, b: SelectOption<T>) =>
				a.value === b.value
			}
			filter={(option: SelectOption<T>, query: string) =>
				optionMatches(option, query)
			}
			disabled={disabled}
			autoHighlight
		>
			<div className={`relative flex min-w-0 items-center ${className}`}>
				<Combobox.Trigger
					aria-label={label}
					className={`flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-control transition-colors select-none data-disabled:cursor-not-allowed data-disabled:opacity-40 ${TRIGGER_SIZE[size]} ${TRIGGER_VARIANT[variant]} ${border}`}
				>
					<Combobox.Value>
						{(option: SelectOption<T> | null) =>
							option ? (
								<span
									className={`flex min-w-0 items-center gap-2 ${showClear ? "pr-6" : ""}`}
								>
									{option.tone && (
										<span
											data-tone={option.tone}
											className="size-2 shrink-0 rounded-full bg-(--tone)"
										/>
									)}
									<span className="truncate">{option.label}</span>
								</span>
							) : (
								<span className="truncate text-muted">{placeholder}</span>
							)
						}
					</Combobox.Value>
					<Combobox.Icon className="shrink-0 text-muted">
						<ChevronIcon />
					</Combobox.Icon>
				</Combobox.Trigger>
				{showClear && (
					<button
						type="button"
						aria-label={`Wyczyść: ${label}`}
						onClick={() => onChange(null)}
						className="absolute right-7 flex size-6 items-center justify-center rounded-chip text-muted hover:bg-hover hover:text-ink"
					>
						×
					</button>
				)}
			</div>

			<Combobox.Portal>
				<Combobox.Positioner align="start" sideOffset={6} className="z-[60]">
					<Combobox.Popup
						aria-label={label}
						className="flex max-w-(--available-width) min-w-[max(var(--anchor-width),16rem)] origin-(--transform-origin) flex-col overflow-hidden rounded-cell border border-line bg-surface shadow-menu transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
					>
						<div className="border-line border-b p-2">
							{/* 16px text on touch screens stops iOS zooming into the field. */}
							<Combobox.Input
								placeholder={searchPlaceholder}
								className="h-9 w-full rounded-control bg-bg px-3 text-sm text-ink outline-none placeholder:text-muted focus:shadow-focus any-pointer-coarse:text-base"
							/>
						</div>
						<Combobox.Empty>
							<div className="px-3 py-4 text-sm text-muted">{emptyText}</div>
						</Combobox.Empty>
						<Combobox.List className="max-h-[min(20rem,calc(var(--available-height)-4rem))] overflow-y-auto overscroll-contain p-1 empty:p-0">
							{(option: SelectOption<T>) => (
								<Combobox.Item
									key={option.value}
									value={option}
									disabled={option.disabled}
									className="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-primary-soft data-selected:font-semibold"
								>
									<span
										data-tone={option.tone ?? "grey"}
										className={`size-2 shrink-0 rounded-full ${option.tone ? "bg-(--tone)" : "bg-transparent"}`}
									/>
									<span className="min-w-0 flex-1 truncate">
										{option.label}
									</span>
									{option.hint && (
										<span className="shrink-0 text-xs font-normal text-muted">
											{option.hint}
										</span>
									)}
									<Combobox.ItemIndicator className="shrink-0 text-primary">
										<CheckIcon />
									</Combobox.ItemIndicator>
								</Combobox.Item>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	);
}

function ChevronIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="m4 6 4 4 4-4" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="m3 8.5 3.5 3.5L13 4.5" />
		</svg>
	);
}
