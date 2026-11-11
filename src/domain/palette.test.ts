import { describe, expect, it } from "vitest";
import {
	isHexColor,
	PALETTE,
	paletteColorFor,
	readableTextOn,
	withAlpha,
} from "./palette";

describe("planner palette", () => {
	it("has twelve distinct colours", () => {
		expect(PALETTE).toHaveLength(12);
		expect(new Set(PALETTE.map((c) => c.hex)).size).toBe(12);
		expect(PALETTE.every((c) => isHexColor(c.hex))).toBe(true);
	});

	it("recognises #rrggbb only", () => {
		expect(isHexColor("#22C55E")).toBe(true);
		for (const bad of ["22c55e", "#2c5", "#22c55e80", "red", "", null, 5]) {
			expect(isHexColor(bad)).toBe(false);
		}
	});

	it("gives the same id the same colour, from the palette", () => {
		expect(paletteColorFor("C12")).toBe(paletteColorFor("C12"));
		expect(PALETTE.map((c) => c.hex)).toContain(paletteColorFor("C12"));
		expect(PALETTE.map((c) => c.hex)).toContain(paletteColorFor(""));
	});

	it("picks dark text on light colours and white on dark ones", () => {
		expect(readableTextOn("#facc15")).toBe("#1d1d1f");
		expect(readableTextOn("#ffffff")).toBe("#1d1d1f");
		expect(readableTextOn("#6366f1")).toBe("#ffffff");
		expect(readableTextOn("#000000")).toBe("#ffffff");
		expect(readableTextOn("nonsense")).toBe("#1d1d1f");
	});

	it("adds an alpha channel, clamped", () => {
		expect(withAlpha("#22c55e", 0.5)).toBe("#22c55e80");
		expect(withAlpha("#22c55e", 2)).toBe("#22c55eff");
		expect(withAlpha("#22c55e", -1)).toBe("#22c55e00");
	});
});
