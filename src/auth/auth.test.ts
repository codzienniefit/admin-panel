import { describe, expect, it } from "vitest";
import { createMockAuth } from "./mock";
import { sanitizeRedirect } from "./redirect";

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		data,
	};
}

const noSleep = async () => {};

describe("demo sign-in", () => {
	it("starts signed out", async () => {
		const auth = createMockAuth({ storage: memoryStorage(), sleep: noSleep });
		await auth.ready();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(await auth.getToken()).toBeNull();
	});

	it("lets the admin account in", async () => {
		const auth = createMockAuth({ storage: memoryStorage(), sleep: noSleep });
		await auth.signIn("admin");
		expect(auth.session.get()).toMatchObject({
			status: "admin",
			user: { displayName: "Ada Adminowska" },
		});
		expect(await auth.getToken()).toBe("demo-token:demo-admin");
	});

	it("recognises an account without access", async () => {
		const auth = createMockAuth({ storage: memoryStorage(), sleep: noSleep });
		await auth.signIn("noAccess");
		expect(auth.session.get().status).toBe("forbidden");
	});

	it("remembers the session across a reload", async () => {
		const storage = memoryStorage();
		await createMockAuth({ storage, sleep: noSleep }).signIn("admin");
		const reloaded = createMockAuth({ storage, sleep: noSleep });
		expect(reloaded.session.get().status).toBe("admin");
	});

	it("forgets it on sign-out", async () => {
		const storage = memoryStorage();
		const auth = createMockAuth({ storage, sleep: noSleep });
		await auth.signIn("admin");
		await auth.signOut();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(
			createMockAuth({ storage, sleep: noSleep }).session.get().status,
		).toBe("signedOut");
	});

	it("ignores a tampered stored value", () => {
		const storage = memoryStorage({ "cf.demoUser": "superAdmin" });
		const auth = createMockAuth({ storage, sleep: noSleep });
		expect(auth.session.get()).toEqual({ status: "signedOut" });
	});

	it("rejects an unknown sign-in method", async () => {
		const auth = createMockAuth({ storage: memoryStorage(), sleep: noSleep });
		await expect(auth.signIn("root")).rejects.toThrow();
		expect(auth.session.get().status).toBe("signedOut");
	});

	it("works without any storage", async () => {
		const auth = createMockAuth({ storage: null, sleep: noSleep });
		await auth.signIn("admin");
		expect(auth.session.get().status).toBe("admin");
	});
});

describe("redirect after sign-in", () => {
	it.each([
		["/design", "/design"],
		["/challenges/C1/plan/p-easy?week=2", "/challenges/C1/plan/p-easy?week=2"],
		["/", "/"],
	])("keeps the in-panel path %s", (input, expected) => {
		expect(sanitizeRedirect(input)).toBe(expected);
	});

	it.each([
		["https://evil.example/", "another site"],
		["//evil.example/", "a protocol-relative address"],
		["/\\evil.example", "a backslash trick"],
		["javascript:alert(1)", "a script address"],
		["design", "a relative path"],
		["/login", "the login page itself"],
		["/login?redirect=/x", "the login page with a query"],
		[undefined, "nothing"],
		[42, "a number"],
	])("falls back to the start page for %s (%s)", (input, _why) => {
		expect(sanitizeRedirect(input)).toBe("/");
	});
});
