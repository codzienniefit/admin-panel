/** The look of one tab; links that act as tabs use these too. */
export const tabItem =
	"shrink-0 rounded-control px-3 py-1.5 text-sm text-subtle hover:bg-hover hover:text-ink";
export const tabItemActive = "bg-primary-soft! text-primary!";

export interface TabItem<T extends string> {
	id: T;
	label: string;
}

interface TabsProps<T extends string> {
	/** Accessible name of the group, e.g. "Części profilu". */
	label: string;
	tabs: readonly TabItem<T>[];
	value: T;
	onChange: (id: T) => void;
}

/**
 * A row of tabs whose state lives with the caller (usually in the address).
 * Looks like the section links in the top bar.
 */
export function Tabs<T extends string>({
	label,
	tabs,
	value,
	onChange,
}: TabsProps<T>) {
	return (
		<div
			role="tablist"
			aria-label={label}
			className="scrollbar-none flex gap-1 overflow-x-auto"
		>
			{tabs.map((tab) => {
				const selected = tab.id === value;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => onChange(tab.id)}
						className={`${tabItem} ${selected ? tabItemActive : ""}`}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
