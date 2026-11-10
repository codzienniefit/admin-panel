import type { ReactNode } from "react";

/** The white rounded surface every list item and panel sits on. */
export function Card({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`rounded-card border border-line bg-surface p-4 md:p-5 ${className}`}
		>
			{children}
		</div>
	);
}
