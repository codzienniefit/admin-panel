// Bytes, text and base64url, and the cookie encryption built on them.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Accepts base64 and base64url, with or without padding; null when it is neither. */
export function fromBase64(text: string): Uint8Array | null {
	const normal = text.trim().replace(/-/g, "+").replace(/_/g, "/");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normal)) return null;
	try {
		const binary = atob(normal.replace(/=+$/, ""));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		typeof data === "string" ? encoder.encode(data) : data,
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function sha256Base64Url(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
	return toBase64Url(new Uint8Array(digest));
}

/** Compares without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}
	return difference === 0;
}

/** HMAC-SHA256 of a text, as hex. */
export async function hmacSha256Hex(
	secret: string,
	text: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(text));
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** The AES-256 key in SIGN_IN_COOKIE_KEY, or null when it is not 32 bytes of base64. */
export async function cookieKey(
	secret: string | undefined,
): Promise<CryptoKey | null> {
	const bytes = secret ? fromBase64(secret) : null;
	if (bytes?.length !== 32) return null;
	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

const IV_BYTES = 12;

/**
 * Encrypts a value for a cookie. AES-GCM both hides it and makes any change
 * detectable; `purpose` (the cookie's name) is bound in, so a value sealed
 * for one cookie is refused in another.
 */
export async function seal(
	key: CryptoKey,
	purpose: string,
	value: unknown,
	randomBytes: (length: number) => Uint8Array,
): Promise<string> {
	const iv = randomBytes(IV_BYTES);
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
		key,
		encoder.encode(JSON.stringify(value)),
	);
	const out = new Uint8Array(IV_BYTES + sealed.byteLength);
	out.set(iv, 0);
	out.set(new Uint8Array(sealed), IV_BYTES);
	return toBase64Url(out);
}

/** The value, or null for anything not sealed with this key for this purpose. */
export async function open(
	key: CryptoKey,
	purpose: string,
	text: string,
): Promise<unknown> {
	const bytes = fromBase64(text);
	if (!bytes || bytes.length <= IV_BYTES) return null;
	try {
		const plain = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: bytes.slice(0, IV_BYTES),
				additionalData: encoder.encode(purpose),
			},
			key,
			bytes.slice(IV_BYTES),
		);
		return JSON.parse(decoder.decode(plain));
	} catch {
		return null;
	}
}

/**
 * The claims of a token, read without checking its signature. Only for a
 * token this Worker received straight from Google's or Firebase's own
 * endpoint over TLS. Never a ground for letting anyone in: the backend
 * verifies every token and session itself.
 */
export function tokenClaims(token: string): Record<string, unknown> | null {
	const payload = token.split(".")[1];
	const bytes = payload ? fromBase64(payload) : null;
	if (!bytes) return null;
	try {
		const claims: unknown = JSON.parse(decoder.decode(bytes));
		return typeof claims === "object" &&
			claims !== null &&
			!Array.isArray(claims)
			? (claims as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
