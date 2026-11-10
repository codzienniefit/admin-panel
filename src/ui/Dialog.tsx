import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { type ReactNode, useEffect, useState } from "react";

interface DialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	children?: ReactNode;
	/** Buttons, right-aligned on desktop and full-width on a phone. */
	footer?: ReactNode;
	/** "full" fills the window, for editors that need room. */
	size?: "sm" | "md" | "lg" | "full";
}

/** A little longer than the closing transition below. */
const EXIT_MS = 250;

const WIDTH = {
	sm: "md:w-[26rem]",
	md: "md:w-[34rem]",
	lg: "md:w-[48rem]",
	full: "md:h-[calc(100dvh-3rem)] md:w-[min(92rem,calc(100vw-3rem))]",
};

/**
 * A modal. Centred on desktop; on a phone it is a sheet rising from the
 * bottom, so the buttons stay within thumb reach.
 */
export function Dialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	footer,
	size = "md",
}: DialogProps) {
	// A closed dialog must leave the page. Left to the library, a dialog opened
	// from inside another one stays mounted after closing: invisible, but still
	// on top and swallowing clicks. So it is removed here, after the closing
	// animation has had time to play.
	const [present, setPresent] = useState(open);
	useEffect(() => {
		if (open) {
			setPresent(true);
			return;
		}
		const timer = setTimeout(() => setPresent(false), EXIT_MS);
		return () => clearTimeout(timer);
	}, [open]);
	if (!open && !present) return null;

	return (
		<BaseDialog.Root open={open} onOpenChange={onOpenChange}>
			<BaseDialog.Portal>
				<BaseDialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black/40 backdrop-blur-sm transition-opacity duration-200 data-closed:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<BaseDialog.Popup
					className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] w-full flex-col rounded-t-dialog bg-surface shadow-menu outline-none transition-[opacity,scale] duration-200 data-closed:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[85dvh] md:max-w-[calc(100vw-3rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-dialog md:data-ending-style:scale-95 md:data-starting-style:scale-95 ${WIDTH[size]}`}
				>
					<div className="flex items-start gap-4 px-5 pt-5 md:px-6 md:pt-6">
						<div className="min-w-0 flex-1">
							<BaseDialog.Title className="text-xl font-semibold tracking-tight">
								{title}
							</BaseDialog.Title>
							{description && (
								<BaseDialog.Description className="mt-1 text-sm text-subtle">
									{description}
								</BaseDialog.Description>
							)}
						</div>
						<BaseDialog.Close
							aria-label="Zamknij"
							className="-mt-1 -mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-xl text-muted hover:bg-hover hover:text-ink"
						>
							×
						</BaseDialog.Close>
					</div>
					{children && (
						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
							{children}
						</div>
					)}
					{footer && (
						<div className="flex flex-col-reverse gap-2 border-line border-t px-5 py-4 md:flex-row md:justify-end md:px-6">
							{footer}
						</div>
					)}
				</BaseDialog.Popup>
			</BaseDialog.Portal>
		</BaseDialog.Root>
	);
}
