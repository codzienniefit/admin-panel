import type { ReactNode } from "react";

interface EmptyStateProps {
	title: string;
	children?: ReactNode;
	/** A button or link offering the obvious next step. */
	action?: ReactNode;
}

/** Shown where a list or a section has nothing in it yet. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center rounded-card border border-line border-dashed px-6 py-12 text-center">
			<h2 className="text-lg font-semibold">{title}</h2>
			{children && (
				<p className="mt-1 max-w-md text-sm text-muted">{children}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
