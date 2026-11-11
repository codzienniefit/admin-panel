// The twelve colours used for a challenge on the calendar, a day's tint and
// a workout card. Taken from Patryk's planner so existing plans look the same.

export interface PaletteColor {
	id: string;
	label: string;
	hex: string;
}

export const PALETTE: readonly PaletteColor[] = [
	{ id: "red", label: "Czerwony", hex: "#ef4444" },
	{ id: "orange", label: "Pomarańczowy", hex: "#f97316" },
	{ id: "amber", label: "Bursztyn", hex: "#f59e0b" },
	{ id: "yellow", label: "Żółty", hex: "#facc15" },
	{ id: "lime", label: "Limonkowy", hex: "#84cc16" },
	{ id: "green", label: "Zielony", hex: "#22c55e" },
	{ id: "teal", label: "Morski", hex: "#14b8a6" },
	{ id: "cyan", label: "Cyjan", hex: "#22d3ee" },
	{ id: "blue", label: "Niebieski", hex: "#3b82f6" },
	{ id: "indigo", label: "Indygo", hex: "#6366f1" },
	{ id: "violet", label: "Fioletowy", hex: "#a855f7" },
	{ id: "pink", label: "Różowy", hex: "#ec4899" },
];

export const isHexColor = (value: unknown): value is string =>
	typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** A stable colour for something nobody picked a colour for. */
export function paletteColorFor(id: string): string {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}
	return PALETTE[Math.abs(hash) % PALETTE.length]?.hex ?? "#3b82f6";
}

/** Dark or white text, whichever reads better on this background. */
export function readableTextOn(hex: string): "#1d1d1f" | "#ffffff" {
	if (!isHexColor(hex)) return "#1d1d1f";
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65
		? "#1d1d1f"
		: "#ffffff";
}

/** The colour with an alpha channel, for tints: `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
	const clamped = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
	return `${hex}${clamped.toString(16).padStart(2, "0")}`;
}
