import { describe, expect, it, vi } from "vitest";
import { createServerAuth } from "./server";

// The Produkcja sign-in talks to the panel's Worker and to nothing else. Here
// the Worker is a function that answers; no request leaves the test.

type Handler = (
	path: string,
	init: RequestInit,
) => Response | Promise<Response>;

const answer = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

function setup(handler: Handler) {
	const calls: { path: string; init: RequestInit }[] = [];
	const leave = vi.fn();
	const auth = createServerAuth({
		fetch: async (input, init = {}) => {
			const path = String(input);
			calls.push({ path, init });
			return handler(path, init);
		},
		leave,
	});
	return { auth, calls, leave };
}

const ADMIN = {
	status: "admin",
	user: { uid: "u1", email: "ada@example.test", displayName: "Ada" },
	methods: ["google"],
};
const SIGNED_OUT = { status: "signedOut", methods: ["google"] };

const headersOf = (init: RequestInit) =>
	new Headers(init.headers as Record<string, string>);

describe("asking the Worker who is signed in", () => {
	it("starts as loading and asks once, however often it is awaited", async () => {
		const { auth, calls } = setup(() => answer(SIGNED_OUT));
		expect(auth.session.get()).toEqual({ status: "loading" });
		await Promise.all([auth.ready(), auth.ready()]);
		await auth.ready();
		expect(calls.map((call) => call.path)).toEqual(["/auth/session"]);
		expect(auth.session.get()).toEqual({ status: "signedOut" });
	});

	it("marks its requests as the panel's own and sends the cookie same-origin", async () => {
		const { auth, calls } = setup(() => answer(SIGNED_OUT));
		await auth.ready();
		const init = calls[0]?.init ?? {};
		expect(headersOf(init).get("x-cf-panel")).toBe("1");
		expect(init.credentials).toBe("same-origin");
		expect(init.cache).toBe("no-store");
	});

	it("takes over an admin session", async () => {
		const { auth } = setup(() => answer(ADMIN));
		await auth.ready();
		expect(auth.session.get()).toEqual({
			status: "admin",
			user: { uid: "u1", email: "ada@example.test", displayName: "Ada" },
		});
	});

	it("is signed out when the Worker says a status it does not know", async () => {
		const { auth } = setup(() => answer({ ...ADMIN, status: "forbidden" }));
		await auth.ready();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
	});

	it("passes on the user id of someone whose sign-in was refused", async () => {
		const { auth } = setup(() =>
			answer({ ...SIGNED_OUT, refusedUid: "uid-of-a-stranger" }),
		);
		await auth.ready();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(auth.refusedUid?.()).toBe("uid-of-a-stranger");
	});

	it("has no refused user id to pass on otherwise", async () => {
		const { auth } = setup(() => answer(SIGNED_OUT));
		await auth.ready();
		expect(auth.refusedUid?.()).toBeNull();
	});

	it("names a person by e-mail when there is no name", async () => {
		const { auth } = setup(() =>
			answer({ ...ADMIN, user: { uid: "u1", email: "ada@example.test" } }),
		);
		await auth.ready();
		expect(auth.session.get()).toMatchObject({
			user: { displayName: "ada@example.test" },
		});
	});

	it("offers the ways of signing in the Worker has, in its order", async () => {
		const { auth } = setup(() => answer(ADMIN));
		await auth.ready();
		expect(auth.methods.map((method) => [method.id, method.kind])).toEqual([
			["google", "redirect"],
		]);
		expect(auth.notice?.()).toBeNull();
	});

	it("ignores a way of signing in it does not know", async () => {
		const { auth } = setup(() =>
			answer({
				status: "signedOut",
				methods: ["google", "password", "apple", "carrier-pigeon"],
			}),
		);
		await auth.ready();
		expect(auth.methods.map((method) => method.id)).toEqual(["google"]);
	});

	it("says so when sign-in is not configured", async () => {
		const { auth } = setup(() => answer({ status: "signedOut", methods: [] }));
		await auth.ready();
		expect(auth.methods).toEqual([]);
		expect(auth.notice?.()).toMatch(/nie jest jeszcze skonfigurowane/);
	});

	it.each([
		["the Worker fails", () => answer({ error: "x" }, 503)],
		["the answer is a web page", () => new Response("<!doctype html>")],
		["the answer has another shape", () => answer({ hello: "world" })],
		[
			"the network is down",
			() => {
				throw new TypeError("offline");
			},
		],
	])("is signed out, with a notice, when %s", async (_name, handler) => {
		const { auth } = setup(handler);
		await auth.ready();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(auth.methods).toEqual([]);
		expect(auth.notice?.()).toMatch(/Nie udało się sprawdzić logowania/);
	});

	it("never has a token to give", async () => {
		const { auth } = setup(() => answer(ADMIN));
		await auth.ready();
		expect(await auth.getToken()).toBeNull();
		expect(await auth.getToken({ forceRefresh: true })).toBeNull();
	});
});

describe("signing in at Google", () => {
	it("leaves for the Worker's start address with where to come back to", async () => {
		const { auth, leave, calls } = setup(() => answer(SIGNED_OUT));
		await auth.ready();
		void auth.signIn("google", { redirect: "/workouts?q=joga" });
		await Promise.resolve();
		expect(leave).toHaveBeenCalledWith(
			"/auth/google/start?redirect=%2Fworkouts%3Fq%3Djoga",
		);
		// No request of its own: the browser goes there.
		expect(calls).toHaveLength(1);
	});

	it("comes back to the start page when nothing else was asked for", async () => {
		const { auth, leave } = setup(() => answer(SIGNED_OUT));
		await auth.ready();
		void auth.signIn("google");
		await Promise.resolve();
		expect(leave).toHaveBeenCalledWith("/auth/google/start?redirect=%2F");
	});

	it.each(["password", "apple", "carrier-pigeon"])(
		"refuses %s: it is not a way of signing in",
		async (method) => {
			const { auth, calls, leave } = setup(() =>
				answer({ status: "signedOut", methods: ["google", method] }),
			);
			await auth.ready();
			await expect(auth.signIn(method)).rejects.toThrow(/Nieznany sposób/);
			expect(leave).not.toHaveBeenCalled();
			expect(calls).toHaveLength(1);
		},
	);

	it("never sends a password or a token anywhere", async () => {
		const { auth, calls } = setup(() => answer(SIGNED_OUT));
		await auth.ready();
		void auth.signIn("google", { redirect: "/" });
		await Promise.resolve();
		for (const call of calls) {
			expect(call.init.body).toBeUndefined();
			expect(headersOf(call.init).get("authorization")).toBeNull();
		}
	});
});

describe("signing out", () => {
	it("tells the Worker and forgets the session", async () => {
		const { auth, calls } = setup((path) =>
			path === "/auth/session"
				? answer(ADMIN)
				: answer({ status: "signedOut" }),
		);
		await auth.ready();
		await auth.signOut();
		expect(calls[1]?.path).toBe("/auth/signout");
		expect(calls[1]?.init.method).toBe("POST");
		expect(auth.session.get()).toEqual({ status: "signedOut" });
	});

	it("forgets the session even when the Worker cannot be reached", async () => {
		const { auth } = setup((path) => {
			if (path === "/auth/session") return answer(ADMIN);
			throw new TypeError("offline");
		});
		await auth.ready();
		await expect(auth.signOut()).rejects.toThrow();
		expect(auth.session.get()).toEqual({ status: "signedOut" });
	});
});
