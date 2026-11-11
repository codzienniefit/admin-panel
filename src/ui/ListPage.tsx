import type { InputHTMLAttributes, ReactNode } from "react";
import { Loading, useDelayedLoading } from "./Loading";

interface ListPageProps {
	title: string;
	/** The main button, top right: "Nowa wiadomość". */
	action?: ReactNode;
	/** Search box and selects; they wrap onto more lines on a phone. */
	filters?: ReactNode;
	/** One line under the filters, e.g. "12 wiadomości". */
	summary?: string;
	/** True until the list has arrived. */
	loading: boolean;
	/** The list itself, usually a Table with its own empty state. */
	children: ReactNode;
}

/**
 * The frame of a list screen: heading, main action, filters, a count, and
 * the rows.
 *
 * A list shows everything its filters match. There is no "show more": the
 * catalogue is hundreds of items, not millions, and a row that exists but is
 * not on screen reads as a row that does not exist.
 */
export function ListPage({
	title,
	action,
	filters,
	summary,
	loading,
	children,
}: ListPageProps) {
	const showLoading = useDelayedLoading(loading);

	return (
		<div className="mx-auto max-w-[1400px]">
			<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
				{action}
			</header>

			{filters && <div className="mb-3 flex flex-wrap gap-2">{filters}</div>}
			{summary !== undefined && (
				<p className="mb-3 text-xs text-muted">
					{loading ? "Wczytywanie…" : summary}
				</p>
			)}

			{loading
				? showLoading && (
						<div className="flex flex-col gap-2">
							{[1, 2, 3, 4, 5, 6].map((n) => (
								<Loading key={n} />
							))}
						</div>
					)
				: children}
		</div>
	);
}

type SearchInputProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type" | "className" | "value" | "onChange"
> & {
	/** Accessible name: the box has no visible label. */
	label: string;
	value: string;
	onChange: (value: string) => void;
};

/** The search box of a filter row. */
export function SearchInput({
	label,
	value,
	onChange,
	...input
}: SearchInputProps) {
	return (
		<input
			type="search"
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="h-10 min-w-56 flex-[2] rounded-control border border-line-input bg-surface px-3 text-sm outline-none placeholder:text-muted hover:border-primary focus:border-primary focus:shadow-focus any-pointer-coarse:text-base"
			{...input}
		/>
	);
}
