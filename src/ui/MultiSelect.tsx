import { Combobox } from "@base-ui/react/combobox";
import { optionMatches, type SelectOption } from "./Select";

interface MultiSelectProps<T extends string> {
	options: readonly SelectOption<T>[];
	value: readonly T[];
	onChange: (value: T[]) => void;
	/** Accessible name of the control. */
	label: string;
	placeholder?: string;
	searchPlaceholder?: string;
	emptyText?: string;
	disabled?: boolean;
	invalid?: boolean;
	className?: string;
}

/**
 * The dropdown for picking several values. Same behaviour as Select: tap, a
 * scrollable list of everything, type to filter. The list stays open while
 * values are being ticked.
 */
export function MultiSelect<T extends string>({
	options,
	value,
	onChange,
	label,
	placeholder = "Wybierz…",
	searchPlaceholder = "Szukaj…",
	emptyText = "Brak wyników",
	disabled = false,
	invalid = false,
	className = "",
}: MultiSelectProps<T>) {
	const selected = options.filter((option) => value.includes(option.value));

	return (
		<Combobox.Root
			items={options}
			multiple
			value={selected}
			onValueChange={(next: SelectOption<T>[]) =>
				onChange(next.map((option) => option.value))
			}
			itemToStringLabel={(option: SelectOption<T>) => option.label}
			isItemEqualToValue={(a: SelectOption<T>, b: SelectOption<T>) =>
				a.value === b.value
			}
			filter={(option: SelectOption<T>, query: string) =>
				optionMatches(option, query)
			}
			disabled={disabled}
		>
			<Combobox.Trigger
				aria-label={label}
				className={`flex min-h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-control border bg-surface px-2 py-1.5 text-left text-sm transition-colors select-none hover:border-primary data-disabled:cursor-not-allowed data-disabled:opacity-40 data-popup-open:border-primary data-popup-open:shadow-focus ${invalid ? "border-danger" : "border-line-input"} ${className}`}
			>
				<span className="flex min-w-0 flex-1 flex-wrap gap-1">
					{selected.length === 0 ? (
						<span className="px-1 text-muted">{placeholder}</span>
					) : (
						selected.map((option) => (
							<span
								key={option.value}
								data-tone={option.tone ?? "grey"}
								className="inline-flex items-center rounded-chip bg-(--tone-soft) px-2 py-0.5 text-xs font-semibold text-(--tone-ink)"
							>
								{option.label}
							</span>
						))
					)}
				</span>
				<Combobox.Icon className="shrink-0 text-muted">
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
				</Combobox.Icon>
			</Combobox.Trigger>

			<Combobox.Portal>
				<Combobox.Positioner align="start" sideOffset={6} className="z-[60]">
					<Combobox.Popup
						aria-label={label}
						className="flex max-w-(--available-width) min-w-[max(var(--anchor-width),16rem)] origin-(--transform-origin) flex-col overflow-hidden rounded-cell border border-line bg-surface shadow-menu transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
					>
						<div className="border-line border-b p-2">
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
									className="group flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-primary-soft"
								>
									<span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-line-input text-white group-data-selected:border-primary group-data-selected:bg-primary">
										<Combobox.ItemIndicator>
											<svg
												width="11"
												height="11"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.6"
												strokeLinecap="round"
												strokeLinejoin="round"
												aria-hidden="true"
											>
												<path d="m3 8.5 3.5 3.5L13 4.5" />
											</svg>
										</Combobox.ItemIndicator>
									</span>
									{option.tone && (
										<span
											data-tone={option.tone}
											className="size-2 shrink-0 rounded-full bg-(--tone)"
										/>
									)}
									<span className="min-w-0 flex-1 truncate">
										{option.label}
									</span>
								</Combobox.Item>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	);
}
