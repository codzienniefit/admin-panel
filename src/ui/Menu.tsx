import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";

export interface MenuAction {
	label: string;
	onSelect: () => void;
	/** Red text, for sign-out, delete and the like. */
	destructive?: boolean;
	disabled?: boolean;
}

interface MenuProps {
	/** Accessible name of the button that opens the menu. */
	label: string;
	/** What the button shows. */
	trigger: ReactNode;
	triggerClassName?: string;
	/** Non-interactive content above the actions, e.g. who is signed in. */
	header?: ReactNode;
	actions: readonly MenuAction[];
	align?: "start" | "end";
}

/** A button that opens a short list of actions. */
export function Menu({
	label,
	trigger,
	triggerClassName = "",
	header,
	actions,
	align = "end",
}: MenuProps) {
	return (
		<BaseMenu.Root>
			<BaseMenu.Trigger
				aria-label={label}
				className={`cursor-pointer outline-none ${triggerClassName}`}
			>
				{trigger}
			</BaseMenu.Trigger>
			<BaseMenu.Portal>
				<BaseMenu.Positioner align={align} sideOffset={8} className="z-50">
					<BaseMenu.Popup className="min-w-52 origin-(--transform-origin) rounded-cell border border-line bg-surface p-1 shadow-menu outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
						{header && (
							<div className="mb-1 border-line border-b px-3 py-2">
								{header}
							</div>
						)}
						{actions.map((action) => (
							<BaseMenu.Item
								key={action.label}
								disabled={action.disabled}
								onClick={action.onSelect}
								className={`flex cursor-pointer items-center rounded-control px-3 py-2 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-hover ${action.destructive ? "text-danger" : "text-ink"}`}
							>
								{action.label}
							</BaseMenu.Item>
						))}
					</BaseMenu.Popup>
				</BaseMenu.Positioner>
			</BaseMenu.Portal>
		</BaseMenu.Root>
	);
}
