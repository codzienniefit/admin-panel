import { useState } from "react";
import { createPortal } from "react-dom";

// A picture shown about three times larger while the pointer rests on its
// thumbnail. Drawn over the page (a list's table would cut it off) and kept
// inside the window; it takes no clicks, so the row under it still opens.

const SCALE = 3;
const GAP = 12;
const MARGIN = 8;

interface Placement {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Beside the thumbnail, on whichever side has room, within the window. */
export function zoomPlacement(
	box: { left: number; top: number; width: number; height: number },
	viewport: { width: number; height: number },
): Placement {
	const width = Math.min(box.width * SCALE, viewport.width - 2 * MARGIN);
	const height = (box.height / box.width) * width;
	const right = box.left + box.width + GAP;
	const left =
		right + width <= viewport.width - MARGIN
			? right
			: Math.max(MARGIN, box.left - GAP - width);
	const centred = box.top + box.height / 2 - height / 2;
	const top = Math.min(
		Math.max(MARGIN, centred),
		Math.max(MARGIN, viewport.height - MARGIN - height),
	);
	return { left, top, width, height };
}

/** Handlers for the thumbnail, and the enlarged picture to render beside it. */
export function useHoverZoom(src: string | null, enabled: boolean) {
	const [placement, setPlacement] = useState<Placement | null>(null);
	const handlers = enabled
		? {
				onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
					const box = event.currentTarget.getBoundingClientRect();
					setPlacement(
						zoomPlacement(box, {
							width: window.innerWidth,
							height: window.innerHeight,
						}),
					);
				},
				onMouseLeave: () => setPlacement(null),
			}
		: {};
	const zoom =
		enabled && src && placement
			? createPortal(
					<img
						src={src}
						alt=""
						aria-hidden="true"
						style={placement}
						className="pointer-events-none fixed z-[60] rounded-control border border-line bg-surface object-cover shadow-menu"
					/>,
					document.body,
				)
			: null;
	return { handlers, zoom };
}
