import { describe, expect, it } from "vitest";
import {
	cookieKey,
	fromBase64,
	hmacSha256Hex,
	open,
	sameText,
	seal,
	sha256Base64Url,
	sha256Hex,
	toBase64Url,
	tokenClaims,
} from "./codec";
import { fakeIdToken, randomKey } from "./testSupport";

const randomBytes = (size: number) =>
	crypto.getRandomValues(new Uint8Array(size));

const base64Of = (size: number) =>
	btoa(String.fromCharCode(...randomBytes(size)));

async function freshKey(): Promise<CryptoKey> {
	const key = await cookieKey(randomKey());
	if (!key) throw new Error("test key refused");
	return key;
}

describe("base64url", () => {
	it("round-trips every byte value", () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
		const text = toBase64Url(bytes);
		expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(fromBase64(text)).toEqual(bytes);
	});

	it("reads base64 and base64url, padded or not", () => {
		// 0xfb 0xff 0xfe is "+//+" in base64 and "-__-" in base64url.
		const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
		expect(fromBase64("+//+")).toEqual(bytes);
		expect(fromBase64("-__-")).toEqual(bytes);
		expect(fromBase64("YQ==")).toEqual(new Uint8Array([97]));
		expect(fromBase64("YQ")).toEqual(new Uint8Array([97]));
		expect(fromBase64("YWI=")).toEqual(new Uint8Array([97, 98]));
		expect(fromBase64("  YWI=\n")).toEqual(new Uint8Array([97, 98]));
	});

	it("reads nothing as no bytes", () => {
		expect(fromBase64("")).toEqual(new Uint8Array(0));
		expect(fromBase64("==")).toEqual(new Uint8Array(0));
	});

	it("refuses what is not base64", () => {
		for (const text of [
			"a", // one character is not a whole byte
			"abcde",
			"ab cd",
			"ab\ncd",
			"a$b=",
			"a=b",
			"====",
			"YQ===",
			"=YQ",
			"żółw",
			"YQ.YQ",
			"%59%51",
		]) {
			expect(fromBase64(text), JSON.stringify(text)).toBeNull();
		}
	});
});

describe("hashes", () => {
	it("sha256Hex matches the published test vector", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("sha256Hex hashes the text as UTF-8", async () => {
		// "ż" is two bytes (c5 bc) in UTF-8; the hash is of those two bytes.
		expect(await sha256Hex("ż")).not.toBe(await sha256Hex("z"));
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("sha256Hex hashes bytes as they are, the same as the text they spell", async () => {
		const bytes = new TextEncoder().encode("zażółć");
		const buffer = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(buffer).set(bytes);
		expect(await sha256Hex(buffer)).toBe(await sha256Hex("zażółć"));
		expect(await sha256Hex(new ArrayBuffer(0))).toBe(await sha256Hex(""));
		// Bytes that are no text at all.
		const binary = new ArrayBuffer(3);
		new Uint8Array(binary).set([0xff, 0x00, 0xfe]);
		expect(await sha256Hex(binary)).toMatch(/^[0-9a-f]{64}$/);
		expect(await sha256Hex(binary)).not.toBe(await sha256Hex(""));
	});

	it("sha256Base64Url matches the PKCE example of RFC 7636", async () => {
		expect(
			await sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});
});

describe("hmacSha256Hex", () => {
	it("matches test case 2 of RFC 4231", async () => {
		expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
			"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
		);
	});

	it("differs for another key and for another text", async () => {
		const made = await hmacSha256Hex("made up key one", "text");
		expect(made).toMatch(/^[0-9a-f]{64}$/);
		expect(await hmacSha256Hex("made up key two", "text")).not.toBe(made);
		expect(await hmacSha256Hex("made up key one", "text ")).not.toBe(made);
		expect(await hmacSha256Hex("made up key one", "text")).toBe(made);
	});
});

describe("sameText", () => {
	it("is true only for identical text", () => {
		expect(sameText("", "")).toBe(true);
		expect(sameText("abc", "abc")).toBe(true);
		expect(sameText("zażółć", "zażółć")).toBe(true);
		expect(sameText("abc", "abd")).toBe(false);
		expect(sameText("abc", "Abc")).toBe(false);
		expect(sameText("abc", "abcd")).toBe(false);
		expect(sameText("abcd", "abc")).toBe(false);
		expect(sameText("abc", "")).toBe(false);
		expect(sameText("", "abc")).toBe(false);
		// A longer text that only adds a zero byte is still different.
		expect(sameText("abc", "abc\u0000")).toBe(false);
		expect(sameText("zazolc", "zażółć")).toBe(false);
	});
});

describe("cookieKey", () => {
	it("accepts exactly 32 bytes, as base64 or base64url, padded or not", async () => {
		const standard = base64Of(32);
		const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
		for (const text of [
			standard,
			standard.replace(/=+$/, ""),
			urlSafe,
			urlSafe.replace(/=+$/, ""),
			`  ${standard}\n`,
			btoa(String.fromCharCode(...new Uint8Array(32))),
		]) {
			const key = await cookieKey(text);
			expect(key, text.length.toString()).not.toBeNull();
			expect(key?.extractable).toBe(false);
		}
	});

	it("refuses every other length", async () => {
		for (const size of [0, 1, 16, 24, 31, 33, 48, 64]) {
			expect(await cookieKey(base64Of(size)), `${size} bytes`).toBeNull();
		}
	});

	it("refuses what is missing or not base64", async () => {
		const hex = [...randomBytes(32)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		for (const text of [
			undefined,
			"",
			"   ",
			"change-me",
			"not base64 at all!",
			// 32 bytes written as hex is 64 characters, which reads as 48 bytes.
			hex,
			`${base64Of(32)}!`,
		]) {
			expect(await cookieKey(text), String(text)).toBeNull();
		}
	});
});

describe("seal and open", () => {
	const value = { v: 1, uid: "uid-1", name: "Żaneta", nested: [1, 2, 3] };

	it("returns what was sealed", async () => {
		const key = await freshKey();
		const sealed = await seal(key, "__Host-a", value, randomBytes);
		expect(await open(key, "__Host-a", sealed)).toEqual(value);
	});

	it("produces text a cookie can carry, and hides the value", async () => {
		const key = await freshKey();
		const sealed = await seal(key, "__Host-a", value, randomBytes);
		expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(sealed).not.toContain("uid-1");
		expect(sealed).not.toContain(
			toBase64Url(new TextEncoder().encode("uid-1")),
		);
	});

	it("never produces the same text twice for the same value", async () => {
		const key = await freshKey();
		const first = await seal(key, "__Host-a", value, randomBytes);
		const second = await seal(key, "__Host-a", value, randomBytes);
		expect(first).not.toBe(second);
		// The first 12 bytes are the nonce, and it must differ.
		expect(first.slice(0, 16)).not.toBe(second.slice(0, 16));
	});

	it("refuses a value sealed for another purpose", async () => {
		const key = await freshKey();
		const sealed = await seal(key, "__Host-cf_oauth", value, randomBytes);
		expect(await open(key, "__Host-cf_refused", sealed)).toBeNull();
		expect(await open(key, "__Host-cf_session", sealed)).toBeNull();
		expect(await open(key, "", sealed)).toBeNull();
		expect(await open(key, "__Host-cf_oauth ", sealed)).toBeNull();
		expect(await open(key, "__Host-cf_oauth", sealed)).toEqual(value);
	});

	it("refuses a value sealed with another key", async () => {
		const sealed = await seal(await freshKey(), "__Host-a", value, randomBytes);
		expect(await open(await freshKey(), "__Host-a", sealed)).toBeNull();
	});

	it("refuses the text with any one character changed", async () => {
		const key = await freshKey();
		const sealed = await seal(key, "__Host-a", value, randomBytes);
		const original = fromBase64(sealed);
		let refused = 0;
		for (let i = 0; i < sealed.length; i++) {
			const swapped = sealed[i] === "A" ? "B" : "A";
			const changed = sealed.slice(0, i) + swapped + sealed.slice(i + 1);
			// The last character of base64 can carry bits that belong to no
			// byte; a change there that leaves every byte as it was is the
			// same sealed value, not a tampered one.
			if (String(fromBase64(changed)) === String(original)) continue;
			expect(await open(key, "__Host-a", changed), `at ${i}`).toBeNull();
			refused++;
		}
		expect(refused).toBeGreaterThanOrEqual(sealed.length - 1);
	});

	it("refuses a shortened or lengthened text", async () => {
		const key = await freshKey();
		const sealed = await seal(key, "__Host-a", value, randomBytes);
		for (const text of [
			"",
			sealed.slice(0, 8),
			sealed.slice(0, 16),
			sealed.slice(0, -4),
			sealed.slice(4),
			`${sealed}AAAA`,
			sealed + sealed,
			"not base64 !!",
		]) {
			expect(await open(key, "__Host-a", text)).toBeNull();
		}
	});

	it("opens only JSON: sealed bytes that are not JSON are refused", async () => {
		const key = await freshKey();
		const iv = randomBytes(12);
		const sealed = await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv,
				additionalData: new TextEncoder().encode("__Host-a"),
			},
			key,
			new TextEncoder().encode("not json"),
		);
		const out = new Uint8Array(12 + sealed.byteLength);
		out.set(iv, 0);
		out.set(new Uint8Array(sealed), 12);
		expect(await open(key, "__Host-a", toBase64Url(out))).toBeNull();
	});

	it("uses the random bytes it is given as the nonce, 12 of them", async () => {
		const key = await freshKey();
		const asked: number[] = [];
		const fixed = (size: number) => {
			asked.push(size);
			return new Uint8Array(size).fill(7);
		};
		const sealed = await seal(key, "__Host-a", value, fixed);
		expect(asked).toEqual([12]);
		expect(fromBase64(sealed)?.slice(0, 12)).toEqual(
			new Uint8Array(12).fill(7),
		);
	});

	it("refuses a nonce alone, with nothing sealed after it", async () => {
		const key = await freshKey();
		expect(
			await open(key, "__Host-a", toBase64Url(randomBytes(12))),
		).toBeNull();
		expect(
			await open(key, "__Host-a", toBase64Url(randomBytes(28))),
		).toBeNull();
	});
});

describe("tokenClaims", () => {
	it("reads the claims of a token", () => {
		expect(tokenClaims(fakeIdToken({ sub: "u1", admin: true }))).toEqual({
			sub: "u1",
			admin: true,
		});
	});

	it("reads without checking the signature, so it proves nothing", () => {
		// Why the Worker never lets anyone in on what this returns.
		const real = fakeIdToken({ sub: "u1" });
		const forged = `${real.split(".").slice(0, 2).join(".")}.anything`;
		expect(tokenClaims(forged)).toEqual({ sub: "u1" });
	});

	it("answers null for anything that is not a token with an object inside", () => {
		const part = (value: unknown) =>
			toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
		for (const text of [
			"",
			"garbage",
			".",
			"..",
			"a.b.c",
			"a.!!!.c",
			"a..c",
			`a.${toBase64Url(new TextEncoder().encode("not json"))}.c`,
			`a.${part([1, 2])}.c`,
			`a.${part("text")}.c`,
			`a.${part(null)}.c`,
			`a.${part(7)}.c`,
			// The claims in the wrong place.
			`${part({ sub: "u1" })}`,
		]) {
			expect(tokenClaims(text), JSON.stringify(text)).toBeNull();
		}
	});
});
