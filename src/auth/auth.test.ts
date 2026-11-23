import { describe, expect, it } from "vitest";
import { memoryStorage } from "@/lib/storage";
import { createMockAuth } from "./mock";
import { sanitizeRedirect } from "./redirect";

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
		["/apiary", "/apiary"],
		["/authors/1", "/authors/1"],
		["/workouts?q=żółw#top", "/workouts?q=żółw#top"],
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
		["/login#x", "the login page with a fragment"],
		["/api/manageUsers", "one of the Worker's addresses"],
		["/auth/google/start", "the sign-in start"],
		["/AUTH/google/start", "the sign-in start in capitals"],
		["/x/../api/files?path=a.html", "a way round to /api"],
		["/./auth/google/start", "a way round to /auth"],
		["/x/..%2fapi", "an encoded slash"],
		["/%2e%2e/api/files", "encoded dots"],
		["/%2E%2E/auth", "encoded dots in capitals"],
		["/a\u0000b", "a control character"],
		[undefined, "nothing"],
		[42, "a number"],
	])("falls back to the start page for %s (%s)", (input, _why) => {
		expect(sanitizeRedirect(input)).toBe("/");
	});
});
