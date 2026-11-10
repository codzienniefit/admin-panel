// Stand-ins for real files: pictures drawn as SVG and one short tone, all as
// data: addresses, so the Test environment never touches the network.

function hash(text: string): number {
	let value = 0;
	for (let i = 0; i < text.length; i++) {
		value = (value * 31 + text.charCodeAt(i)) | 0;
	}
	return Math.abs(value);
}

/** A picture unique to the path: same path, same colours. */
export function placeholderImage(path: string): string {
	const hue = hash(path) % 360;
	const square = path.startsWith("badges/");
	const [width, height] = square ? [300, 300] : [600, 400];
	const name = (path.split("/").pop() ?? path).replace(/\.[a-z0-9]+$/i, "");
	const label = name.length > 26 ? `${name.slice(0, 25)}…` : name;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 70% 82%)"/>
<stop offset="1" stop-color="hsl(${(hue + 50) % 360} 65% 66%)"/>
</linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<circle cx="${width * 0.78}" cy="${height * 0.3}" r="${height * 0.22}" fill="rgba(255,255,255,.28)"/>
<text x="${width / 2}" y="${height - 28}" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-size="${square ? 20 : 26}" font-weight="600" fill="rgba(0,0,0,.55)">${label}</text>
</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
	return `data:${mimeType};base64,${toBase64(bytes)}`;
}

let tone: string | null = null;

/** Half a second of a quiet tone, so "play" does something audible. */
export function placeholderAudio(): string {
	if (tone) return tone;
	const rate = 8000;
	const samples = rate / 2;
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) {
			bytes[offset + i] = text.charCodeAt(i);
		}
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + samples, true);
	ascii(8, "WAVEfmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, rate, true);
	view.setUint32(28, rate, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true); // 8-bit
	ascii(36, "data");
	view.setUint32(40, samples, true);
	for (let i = 0; i < samples; i++) {
		const fade = Math.min(1, (samples - i) / 800, i / 200);
		bytes[44 + i] =
			128 + Math.round(40 * fade * Math.sin((i / rate) * 2 * Math.PI * 440));
	}
	tone = toDataUrl(bytes, "audio/wav");
	return tone;
}
