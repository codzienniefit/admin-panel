import type { ReactNode } from "react";

export interface Column<T> {
	key: string;
	header: string;
	cell: (row: T) => ReactNode;
	/** Right-align numbers and dates. */
	align?: "start" | "end";
	/** The column that names the row; it becomes the card title on a phone. */
	primary?: boolean;
}

interface TableProps<T> {
	columns: readonly Column<T>[];
	rows: readonly T[];
	rowKey: (row: T) => string;
	onRowClick?: (row: T) => void;
	/** Shown instead of the table when there are no rows. */
	empty?: ReactNode;
}

/**
 * A list of records. A real table from tablet width up; on a phone each row
 * becomes a card with the primary column as its title.
 */
export function Table<T>({
	columns,
	rows,
	rowKey,
	onRowClick,
	empty,
}: TableProps<T>) {
	if (rows.length === 0 && empty) return <>{empty}</>;

	const primary = columns.find((column) => column.primary) ?? columns[0];
	const secondary = columns.filter((column) => column !== primary);
	const clickable = onRowClick ? "cursor-pointer hover:bg-surface-alt" : "";

	return (
		<>
			<div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr className="border-line border-b bg-surface-alt text-left text-xs text-muted">
							{columns.map((column) => (
								<th
									key={column.key}
									scope="col"
									className={`px-4 py-2.5 font-semibold ${column.align === "end" ? "text-right" : ""}`}
								>
									{column.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={rowKey(row)}
								onClick={onRowClick ? () => onRowClick(row) : undefined}
								className={`border-line border-b last:border-b-0 ${clickable}`}
							>
								{columns.map((column) => (
									<td
										key={column.key}
										className={`px-4 py-3 align-middle ${column.align === "end" ? "whitespace-nowrap text-right" : ""} ${column === primary ? "font-semibold" : ""}`}
									>
										{column.cell(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<ul className="flex flex-col gap-2 md:hidden">
				{rows.map((row) => (
					<li key={rowKey(row)}>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: the whole card opens the record; the title inside is the keyboard target on desktop */}
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
						<div
							onClick={onRowClick ? () => onRowClick(row) : undefined}
							className={`rounded-cell border border-line bg-surface p-3 ${clickable}`}
						>
							{primary && (
								<div className="font-semibold">{primary.cell(row)}</div>
							)}
							<dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
								{secondary.map((column) => (
									<div key={column.key} className="contents">
										<dt className="text-xs text-muted">{column.header}</dt>
										<dd className="min-w-0">{column.cell(row)}</dd>
									</div>
								))}
							</dl>
						</div>
					</li>
				))}
			</ul>
		</>
	);
}
