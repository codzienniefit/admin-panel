import type { ReactNode } from "react";

interface AppScreenProps {
	children: ReactNode;
	/** Tailwind height class of the area; content longer than that scrolls. */
	screenClassName?: string;
}

/**
 * Where a preview is drawn: only the content, as wide as the app's screen
 * (375 points), so text wraps where it will wrap there, and long content
 * scrolls inside it the way it does in the hand. No phone, clock or battery
 * around it: nothing that is not part of what the user will read.
 */
export function AppScreen({
	children,
	screenClassName = "h-[min(34rem,60vh)]",
}: AppScreenProps) {
	return (
		<div
			className={`mx-auto w-full max-w-[375px] overflow-y-auto rounded-control border border-line bg-white py-4 ${screenClassName}`}
		>
			{children}
		</div>
	);
}
