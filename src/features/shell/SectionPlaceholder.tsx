import { EmptyState } from "@/ui/EmptyState";

/** A section that has its place in the menu but is built in a later phase. */
export function SectionPlaceholder({
	title,
	phase,
	children,
}: {
	title: string;
	phase: string;
	children: string;
}) {
	return (
		<div className="mx-auto max-w-6xl">
			<h1 className="mb-6 text-3xl font-semibold tracking-tight">{title}</h1>
			<EmptyState title={`Ta sekcja powstanie w ${phase}`}>
				{children}
			</EmptyState>
		</div>
	);
}
