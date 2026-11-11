import { describe, expect, it } from "vitest";
import { placeholderAudio, placeholderImage, toDataUrl } from "./mediaUrls";

const SVG_PREFIX = "data:image/svg+xml;utf8,";

/** The SVG text inside a placeholder picture. */
function svgOf(url: string): string {
	expect(url.startsWith(SVG_PREFIX)).toBe(true);
	return decodeURIComponent(url.slice(SVG_PREFIX.length));
}

/** The bytes inside a base64 data address. */
function bytesOf(url: string): Uint8Array {
	const base64 = url.slice(url.indexOf(",") + 1);
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
	String.fromCharCode(...bytes.subarray(from, to));

describe("placeholderImage", () => {
	it("is a picture that needs no network", () => {
		const url = placeholderImage("workouts/poranna-joga.webp");
		expect(url.startsWith(SVG_PREFIX)).toBe(true);
		expect(url).not.toMatch(/https?:/);
		const svg = svgOf(url);
		expect(svg.startsWith("<svg ")).toBe(true);
		expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
	});

	it("is the same for the same path and differs between paths", () => {
		const joga = placeholderImage("workouts/poranna-joga.webp");
		expect(placeholderImage("workouts/poranna-joga.webp")).toBe(joga);
		expect(placeholderImage("workouts/hiit-na-schodach.webp")).not.toBe(joga);
	});

	it("keeps a name with markup characters as text", () => {
		const svg = svgOf(placeholderImage("workouts/R&B <mix>.webp"));
		expect(svg).toContain(">R&amp;B &lt;mix&gt;</text>");
	});

	it("shows the file name without folder and extension", () => {
		expect(svgOf(placeholderImage("workouts/poranna-joga.webp"))).toContain(
			">poranna-joga</text>",
		);
		expect(svgOf(placeholderImage("okladka.v2.PNG"))).toContain(
			">okladka.v2</text>",
		);
		expect(
			svgOf(placeholderImage("challenges/2026/wiosna/start.webp")),
		).toContain(">start</text>");
	});

	it("cuts a long name short", () => {
		const exactly26 = "abcdefghijklmnopqrstuvwxyz";
		expect(svgOf(placeholderImage(`workouts/${exactly26}.webp`))).toContain(
			`>${exactly26}</text>`,
		);
		expect(svgOf(placeholderImage(`workouts/${exactly26}0.webp`))).toContain(
			">abcdefghijklmnopqrstuvwxy…</text>",
		);
	});

	it("is square for a badge and wide for everything else", () => {
		expect(svgOf(placeholderImage("badges/wiosenny-biegacz.webp"))).toContain(
			'viewBox="0 0 300 300"',
		);
		expect(svgOf(placeholderImage("workouts/poranna-joga.webp"))).toContain(
			'viewBox="0 0 600 400"',
		);
		expect(svgOf(placeholderImage("moje/badges/x.webp"))).toContain(
			'viewBox="0 0 600 400"',
		);
	});

	it("draws valid colours for any path", () => {
		for (const path of ["", "a", "workouts/zażółć.webp", "x".repeat(5000)]) {
			const hues = [
				...svgOf(placeholderImage(path)).matchAll(/hsl\((\d+) /g),
			].map((match) => Number(match[1]));
			expect(hues).toHaveLength(2);
			for (const hue of hues) {
				expect(hue).toBeGreaterThanOrEqual(0);
				expect(hue).toBeLessThan(360);
			}
		}
	});
});

describe("toDataUrl", () => {
	it("encodes bytes as base64 with their type", () => {
		const bytes = new TextEncoder().encode("Zdjęcie z Łodzi");
		const url = toDataUrl(bytes, "image/webp");
		expect(url.startsWith("data:image/webp;base64,")).toBe(true);
		expect(bytesOf(url)).toEqual(bytes);
		expect(toDataUrl(Uint8Array.of(72, 101, 108, 108, 111), "text/plain")).toBe(
			"data:text/plain;base64,SGVsbG8=",
		);
	});

	it("encodes nothing as an empty address", () => {
		expect(toDataUrl(new Uint8Array(), "image/png")).toBe(
			"data:image/png;base64,",
		);
	});

	it("keeps every byte value", () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
		expect(bytesOf(toDataUrl(bytes, "application/octet-stream"))).toEqual(
			bytes,
		);
	});

	it("handles a file larger than one chunk", () => {
		const bytes = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7) % 256);
		const back = bytesOf(toDataUrl(bytes, "image/webp"));
		expect(back.length).toBe(bytes.length);
		expect(back).toEqual(bytes);
	});
});

describe("placeholderAudio", () => {
	it("is half a second of 8-bit mono sound in a WAV file", () => {
		const url = placeholderAudio();
		expect(url.startsWith("data:audio/wav;base64,")).toBe(true);

		const bytes = bytesOf(url);
		const view = new DataView(bytes.buffer);
		expect(bytes.length).toBe(44 + 4000);
		expect(ascii(bytes, 0, 4)).toBe("RIFF");
		expect(view.getUint32(4, true)).toBe(bytes.length - 8);
		expect(ascii(bytes, 8, 16)).toBe("WAVEfmt ");
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(8000);
		expect(view.getUint16(34, true)).toBe(8);
		expect(ascii(bytes, 36, 40)).toBe("data");
		expect(view.getUint32(40, true)).toBe(4000);
	});

	it("is quiet, and silent at both ends", () => {
		const samples = bytesOf(placeholderAudio()).subarray(44);
		expect(samples[0]).toBe(128);
		expect(samples.at(-1)).toBeGreaterThanOrEqual(127);
		expect(samples.at(-1)).toBeLessThanOrEqual(129);
		expect(Math.max(...samples)).toBeLessThanOrEqual(168);
		expect(Math.min(...samples)).toBeGreaterThanOrEqual(88);
		// It does make a sound.
		expect(Math.max(...samples)).toBeGreaterThan(150);
	});

	it("is built once and handed out again", () => {
		expect(placeholderAudio()).toBe(placeholderAudio());
	});
});
