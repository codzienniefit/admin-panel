import { describe, expect, it } from "vitest";
import { zoomPlacement } from "./HoverZoom";

const viewport = { width: 1200, height: 800 };

describe("zoomPlacement", () => {
	it("puts the picture three times larger to the right, centred on it", () => {
		expect(
			zoomPlacement({ left: 100, top: 300, width: 60, height: 40 }, viewport),
		).toEqual({ left: 172, top: 260, width: 180, height: 120 });
	});

	it("goes to the left when the right side has no room", () => {
		const placed = zoomPlacement(
			{ left: 1100, top: 300, width: 60, height: 40 },
			viewport,
		);
		expect(placed.left).toBe(1100 - 12 - 180);
	});

	it("stays inside the window at the top and the bottom", () => {
		expect(
			zoomPlacement({ left: 100, top: 0, width: 60, height: 40 }, viewport).top,
		).toBe(8);
		expect(
			zoomPlacement({ left: 100, top: 790, width: 60, height: 40 }, viewport)
				.top,
		).toBe(800 - 8 - 120);
	});
});
