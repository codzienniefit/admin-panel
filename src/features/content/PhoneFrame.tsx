import type { ReactNode } from "react";

interface PhoneFrameProps {
	children: ReactNode;
	/** Tailwind height class of the screen; content longer than that scrolls. */
	screenClassName?: string;
}

/**
 * A phone around a preview: the screen is as wide as the app's (375 points),
 * so text wraps where it will wrap there, and long content scrolls inside it
 * the way it does in the hand. A generic handset, not a picture of one model.
 */
export function PhoneFrame({
	children,
	screenClassName = "h-[min(34rem,60vh)]",
}: PhoneFrameProps) {
	return (
		// 375 for the screen plus the two sides of the case.
		<div className="mx-auto w-full max-w-[395px] overflow-hidden rounded-[2.75rem] border-[10px] border-ink bg-white shadow-card">
			<div
				aria-hidden="true"
				className="relative flex h-11 items-center justify-between px-7 text-[13px] font-semibold text-ink"
			>
				<span className="tabular-nums">9:41</span>
				<span className="absolute top-2.5 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-ink" />
				<span className="flex items-center gap-1.5">
					<svg
						viewBox="0 0 18 12"
						aria-hidden="true"
						className="h-3 w-[18px] fill-ink"
					>
						<rect x="0" y="8" width="3" height="4" rx="1" />
						<rect x="5" y="5.5" width="3" height="6.5" rx="1" />
						<rect x="10" y="3" width="3" height="9" rx="1" />
						<rect x="15" y="0" width="3" height="12" rx="1" />
					</svg>
					<svg viewBox="0 0 27 12" aria-hidden="true" className="h-3 w-[27px]">
						<rect
							x="0.5"
							y="0.5"
							width="22"
							height="11"
							rx="3.5"
							className="fill-none stroke-ink/40"
						/>
						<rect
							x="2"
							y="2"
							width="19"
							height="8"
							rx="2"
							className="fill-ink"
						/>
						<rect
							x="24"
							y="4"
							width="2"
							height="4"
							rx="1"
							className="fill-ink/40"
						/>
					</svg>
				</span>
			</div>
			<div className={`overflow-y-auto pt-3 pb-5 ${screenClassName}`}>
				{children}
			</div>
			<div aria-hidden="true" className="flex h-6 items-start justify-center">
				<span className="h-1 w-32 rounded-full bg-ink" />
			</div>
		</div>
	);
}
