import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

interface PopoverProps {
	/** Accessible name of the button that opens it. */
	label: string;
	/** What the button shows. */
	trigger: ReactNode;
	triggerClassName?: string;
	/** Heading inside the popup. */
	title?: string;
	children: ReactNode;
	align?: "start" | "center" | "end";
	/** For a popover that something else also closes, e.g. picking a value. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/** A button that opens a small panel next to it: details, a short list, a palette. */
export function Popover({
	label,
	trigger,
	triggerClassName = "",
	title,
	children,
	align = "start",
	open,
	onOpenChange,
}: PopoverProps) {
	return (
		<BasePopover.Root open={open} onOpenChange={onOpenChange}>
			<BasePopover.Trigger
				aria-label={label}
				className={`cursor-pointer outline-none focus-visible:shadow-focus ${triggerClassName}`}
			>
				{trigger}
			</BasePopover.Trigger>
			<BasePopover.Portal>
				{/* The popup is never taller than the room there is (it scrolls
				    instead of leaving the screen), and keeps off the edges. */}
				<BasePopover.Positioner
					align={align}
					sideOffset={8}
					collisionPadding={8}
					className="z-50"
				>
					<BasePopover.Popup className="max-h-(--available-height) max-w-[min(22rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-y-auto rounded-cell border border-line bg-surface p-3 text-sm shadow-menu outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
						{title && (
							<BasePopover.Title className="mb-2 text-sm font-semibold">
								{title}
							</BasePopover.Title>
						)}
						{children}
					</BasePopover.Popup>
				</BasePopover.Positioner>
			</BasePopover.Portal>
		</BasePopover.Root>
	);
}
