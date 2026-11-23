import { afterEach, describe, expect, it, vi } from "vitest";
import {
	apiOrigin,
	canReachBackend,
	canSignIn,
	MIN_SIGNING_SECRET_LENGTH,
	mediaOrigins,
	type PanelEnv,
	panelOrigin,
	realDeps,
	signInMethods,
	signingSecret,
} from "./env";
import { makeWorld } from "./testSupport";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("an origin setting", () => {
	// The same rule reads PANEL_ORIGIN and API_ORIGIN.
	const read = (value: string | undefined) => ({
		panel: panelOrigin({ PANEL_ORIGIN: value }),
		api: apiOrigin({ API_ORIGIN: value }),
	});

	it("is read as a plain https origin", () => {
		for (const [value, expected] of [
			["https://panel.example.test", "https://panel.example.test"],
			["https://panel.example.test/", "https://panel.example.test"],
			["  https://panel.example.test\n", "https://panel.example.test"],
			["https://PANEL.Example.Test", "https://panel.example.test"],
			["https://panel.example.test:443", "https://panel.example.test"],
			["https://panel.example.test:8443", "https://panel.example.test:8443"],
		] as const) {
			expect(read(value), value).toEqual({ panel: expected, api: expected });
		}
	});

	it("may be plain http only on this machine", () => {
		expect(panelOrigin({ PANEL_ORIGIN: "http://localhost:5173" })).toBe(
			"http://localhost:5173",
		);
		expect(apiOrigin({ API_ORIGIN: "http://127.0.0.1:7071" })).toBe(
			"http://127.0.0.1:7071",
		);
		for (const value of [
			"http://panel.example.test",
			"http://localhost.example.test",
			"http://127.0.0.1.example.test",
			"http://10.0.0.5:7071",
		]) {
			expect(read(value), value).toEqual({ panel: null, api: null });
		}
	});

	it("is null when missing, empty or not an address", () => {
		for (const value of [
			undefined,
			"",
			"   ",
			"panel.example.test",
			"//panel.example.test",
			"not an address",
			"https://",
		]) {
			expect(read(value), String(value)).toEqual({ panel: null, api: null });
		}
	});

	it("is null with anything more than scheme, host and port", () => {
		for (const value of [
			"https://panel.example.test/api",
			"https://panel.example.test/panel/",
			"https://panel.example.test?x=1",
			"https://panel.example.test/#top",
			"https://someone@panel.example.test",
			"https://someone:word@panel.example.test",
			"ftp://panel.example.test",
			"file:///etc/hosts",
			"javascript:alert(1)",
			"data:text/plain,hello",
		]) {
			expect(read(value), value).toEqual({ panel: null, api: null });
		}
	});
});

describe("mediaOrigins", () => {
	const list = (value: string | undefined) => [
		...mediaOrigins({ MEDIA_ORIGINS: value }),
	];

	it("is empty when nothing is set", () => {
		expect(list(undefined)).toEqual([]);
		expect(list("")).toEqual([]);
		expect(list(" , ,\n")).toEqual([]);
	});

	it("reads one or several, separated by commas or spaces", () => {
		expect(list("https://files.example.test")).toEqual([
			"https://files.example.test",
		]);
		expect(
			list(
				"https://files.example.test, https://media.example.test/\nhttps://cdn.example.test",
			),
		).toEqual([
			"https://files.example.test",
			"https://media.example.test",
			"https://cdn.example.test",
		]);
	});

	it("leaves out everything that is not a plain origin", () => {
		expect(
			list(
				"https://files.example.test/container,http://plain.example.test,*,https://*.example.test/x,files.example.test,https://ok.example.test",
			),
		).toEqual(["https://ok.example.test"]);
	});
});

describe("signingSecret", () => {
	it("is the secret when it has at least 32 characters", () => {
		expect(MIN_SIGNING_SECRET_LENGTH).toBe(32);
		const exactly = "x".repeat(32);
		expect(signingSecret({ PANEL_SIGNING_SECRET: exactly })).toBe(exactly);
		expect(signingSecret({ PANEL_SIGNING_SECRET: "x".repeat(64) })).toBe(
			"x".repeat(64),
		);
	});

	it("is null when missing or shorter", () => {
		for (const value of [undefined, "", "   ", "short", "x".repeat(31)]) {
			expect(
				signingSecret({ PANEL_SIGNING_SECRET: value }),
				String(value),
			).toBeNull();
		}
	});

	it("does not count the space around it", () => {
		// As pasted into a prompt with a line break after it.
		expect(signingSecret({ PANEL_SIGNING_SECRET: `${"x".repeat(32)}\n` })).toBe(
			"x".repeat(32),
		);
		expect(
			signingSecret({ PANEL_SIGNING_SECRET: `  ${"x".repeat(31)}  ` }),
		).toBeNull();
		expect(signingSecret({ PANEL_SIGNING_SECRET: " ".repeat(40) })).toBeNull();
	});
});

describe("what is configured", () => {
	const complete = () => makeWorld().env;
	const without = (name: keyof PanelEnv): PanelEnv => {
		const env = complete();
		delete env[name];
		return env;
	};

	it("the backend can be reached with its address and a signing secret", () => {
		expect(canReachBackend(complete())).toBe(true);
		expect(canReachBackend(without("API_ORIGIN"))).toBe(false);
		expect(canReachBackend(without("PANEL_SIGNING_SECRET"))).toBe(false);
		expect(
			canReachBackend({ ...complete(), PANEL_SIGNING_SECRET: "x".repeat(31) }),
		).toBe(false);
		expect(
			canReachBackend({ ...complete(), API_ORIGIN: "api.example.test" }),
		).toBe(false);
		// Nothing else is needed for it.
		expect(
			canReachBackend({
				API_ORIGIN: "https://api.example.test",
				PANEL_SIGNING_SECRET: "x".repeat(32),
			}),
		).toBe(true);
	});

	it("signing in needs every setting but the media addresses", () => {
		expect(canSignIn(complete())).toBe(true);
		expect(signInMethods(complete())).toEqual(["google"]);
		expect(canSignIn(without("MEDIA_ORIGINS"))).toBe(true);
		for (const name of [
			"PANEL_ORIGIN",
			"API_ORIGIN",
			"FIREBASE_API_KEY",
			"GOOGLE_CLIENT_ID",
			"GOOGLE_CLIENT_SECRET",
			"SIGN_IN_COOKIE_KEY",
			"PANEL_SIGNING_SECRET",
		] as const) {
			expect(canSignIn(without(name)), name).toBe(false);
			expect(signInMethods(without(name)), name).toEqual([]);
			expect(canSignIn({ ...complete(), [name]: "   " }), name).toBe(false);
		}
	});

	it("nothing is configured in an empty environment", () => {
		expect(panelOrigin({})).toBeNull();
		expect(apiOrigin({})).toBeNull();
		expect(canReachBackend({})).toBe(false);
		expect(canSignIn({})).toBe(false);
		expect(signInMethods({})).toEqual([]);
	});

	it("offers no way in while the cookie key is not a key", () => {
		// Set is not enough: a value that is not 32 bytes of base64 would let
		// the page offer Google and every attempt end as "unavailable".
		const hex = Array.from({ length: 32 }, () => "ab").join("");
		for (const value of [
			"change-me",
			"x".repeat(44),
			btoa("only 16 bytes!!!"),
			btoa("x".repeat(31)),
			btoa("x".repeat(33)),
			btoa("x".repeat(64)),
			hex,
			`${btoa("x".repeat(32))}!`,
			"not base64 at all",
		]) {
			const env = { ...complete(), SIGN_IN_COOKIE_KEY: value };
			expect(canSignIn(env), value).toBe(false);
			expect(signInMethods(env), value).toEqual([]);
		}
	});

	it("takes the cookie key as base64 or base64url, padded or not", () => {
		// 32 bytes that need both `+` and `/` in base64.
		const standard = btoa(String.fromCharCode(...new Uint8Array(32).fill(251)));
		expect(standard).toContain("+");
		const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
		for (const value of [
			standard,
			standard.replace(/=+$/, ""),
			urlSafe,
			urlSafe.replace(/=+$/, ""),
			`  ${standard}\n`,
		]) {
			expect(
				signInMethods({ ...complete(), SIGN_IN_COOKIE_KEY: value }),
				value,
			).toEqual(["google"]);
		}
	});
});

describe("realDeps", () => {
	it("tells the time in milliseconds", () => {
		const before = Date.now();
		const now = realDeps.now();
		expect(now).toBeGreaterThanOrEqual(before);
		expect(now).toBeLessThanOrEqual(Date.now());
	});

	it("makes random bytes of the length asked, different each time", () => {
		const first = realDeps.randomBytes(32);
		const second = realDeps.randomBytes(32);
		expect(first).toHaveLength(32);
		expect(realDeps.randomBytes(12)).toHaveLength(12);
		expect([...first]).not.toEqual([...second]);
	});

	it("writes a log entry as one line of JSON", () => {
		const written = vi.spyOn(console, "log").mockImplementation(() => {});
		realDeps.log({ event: "refused", reason: "host" });
		expect(written).toHaveBeenCalledTimes(1);
		expect(written.mock.calls[0]).toEqual([
			'{"event":"refused","reason":"host"}',
		]);
	});

	it("fetches with the runtime's fetch", async () => {
		const answer = new Response("made up");
		const stand = vi.fn(async () => answer);
		vi.stubGlobal("fetch", stand);
		const init = { method: "POST", redirect: "manual" } as const;
		expect(await realDeps.fetch("https://api.example.test/x", init)).toBe(
			answer,
		);
		expect(stand).toHaveBeenCalledWith("https://api.example.test/x", init);
	});
});
