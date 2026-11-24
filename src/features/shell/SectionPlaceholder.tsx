import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";

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
		<Page title={title}>
			<EmptyState title={`Ta sekcja powstanie w ${phase}`}>
				{children}
			</EmptyState>
		</Page>
	);
}
