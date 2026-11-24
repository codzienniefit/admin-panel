import type { ReactNode } from "react";
import { type Refresh, RefreshButton } from "./RefreshButton";

// The frame of every section page (Wyzwania, Treningi, Media, Użytkownicy,
// Ustawienia, …): one width and one title row, so switching tabs never moves
// the title or the content's edges.

/** How wide a section page grows, centred in the window. */
export const PAGE_FRAME = "mx-auto w-full max-w-[1400px]";

interface PageProps {
	title: ReactNode;
	/** Right after the title: a view switch. */
	beside?: ReactNode;
	/** The main button, at the right end of the title row: "Nowy trening". */
	action?: ReactNode;
	/** One line under the title. */
	description?: ReactNode;
	/** Fetches what the page shows again: an "Odśwież" button beside the action. */
	onRefresh?: Refresh;
	children: ReactNode;
}

export function Page({
	title,
	beside,
	action,
	description,
	onRefresh,
	children,
}: PageProps) {
	return (
		<div className={PAGE_FRAME}>
			<header className="mb-5 flex flex-col gap-1">
				{/* As tall as a button, with or without one: the title row is the
				    same on every tab. */}
				<div className="flex min-h-10 flex-wrap items-center gap-3">
					<h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
					{beside}
					{(onRefresh || action) && (
						<div className="ml-auto flex items-center gap-2">
							{onRefresh && <RefreshButton onRefresh={onRefresh} />}
							{action}
						</div>
					)}
				</div>
				{description && <p className="text-sm text-muted">{description}</p>}
			</header>
			{children}
		</div>
	);
}
