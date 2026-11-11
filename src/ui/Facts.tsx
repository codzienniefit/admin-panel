import type { ReactNode } from "react";

export interface Fact {
	label: string;
	value: ReactNode;
}

/**
 * Read-only details as label and value pairs: two columns from tablet width
 * up, stacked on a phone.
 */
export function Facts({ items }: { items: readonly Fact[] }) {
	return (
		<dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
			{items.map((item) => (
				<div key={item.label} className="contents">
					<dt className="text-muted">{item.label}</dt>
					<dd className="min-w-0 [overflow-wrap:anywhere]">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}
