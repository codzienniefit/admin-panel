import { afterEach, describe, expect, it, vi } from "vitest";
import {
	currentEnvironment,
	defaultEnvironment,
	onThisComputer,
} from "@/data/environment";
import { createStore } from "@/lib/store";
import { createMockAuth } from "./mock";
import { createGatedTestAuth } from "./testGate";
import type { AuthProvider, Session, SignInMethod } from "./types";

// On the deployed panel, the Test environment opens only behind a real sign-in.

const GOOGLE: SignInMethod = {
	id: "google",
	kind: "redirect",
	label: "Zaloguj się przez Google",
	description: "Otworzy stronę logowania Google.",
};

function realAuth(status: "admin" | "signedOut", notice: string | null = null) {
	const session = createStore<Session>(
		status === "admin"
			? {
					status: "admin",
					user: { uid: "real-uid", email: null, displayName: "Admin" },
				}
			: { status: "signedOut" },
	);
	const real: AuthProvider = {
		session,
		ready: vi.fn().mockResolvedValue(undefined),
		methods: [GOOGLE],
		notice: () => notice,
		refusedUid: () => (status === "signedOut" ? "someone-uid" : null),
		signIn: vi.fn().mockResolvedValue(undefined),
		signOut: vi.fn().mockResolvedValue(undefined),
		getToken: vi.fn().mockResolvedValue("real-token"),
	};
	return real;
}

const sampleAuth = () =>
	createMockAuth({ storage: null, sleep: () => Promise.resolve() });

describe("the Test environment behind a real sign-in", () => {
	it("is not a way in without a real session: only the real sign-in is offered", async () => {
		const sample = sampleAuth();
		await sample.signIn("admin"); // a sample session left from before
		const real = realAuth("signedOut");
		const auth = createGatedTestAuth(sample, real);

		expect(auth.session.get()).toEqual({ status: "loading" });
		await auth.ready();

		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(sample.session.get()).toEqual({ status: "signedOut" });
		expect(auth.methods).toEqual([GOOGLE]);
		expect(auth.refusedUid?.()).toBe("someone-uid");
		await auth.signIn("google", { redirect: "/challenges" });
		expect(real.signIn).toHaveBeenCalledWith("google", {
			redirect: "/challenges",
		});
	});

	it("passes on the real sign-in's notice while locked", async () => {
		const auth = createGatedTestAuth(
			sampleAuth(),
			realAuth("signedOut", "Logowanie nie jest skonfigurowane"),
		);
		await auth.ready();
		expect(auth.notice?.()).toBe("Logowanie nie jest skonfigurowane");
	});

	it("opens as the sample admin once someone is signed in for real", async () => {
		const sample = sampleAuth();
		const real = realAuth("admin", "anything");
		const auth = createGatedTestAuth(sample, real);

		await auth.ready();

		expect(auth.session.get()).toMatchObject({ status: "admin" });
		expect(auth.session.get()).toEqual(sample.session.get());
		expect(auth.notice?.()).toBeNull();
		expect(auth.refusedUid?.()).toBeNull();
		expect(await auth.getToken()).toMatch(/^demo-token:/);
		expect(real.signIn).not.toHaveBeenCalled();
	});

	it("signs out of both", async () => {
		const sample = sampleAuth();
		const real = realAuth("admin");
		const auth = createGatedTestAuth(sample, real);
		await auth.ready();

		await auth.signOut();

		expect(auth.session.get()).toEqual({ status: "signedOut" });
		expect(real.signOut).toHaveBeenCalled();
	});

	it("asks the real sign-in once, however often it is asked to be ready", async () => {
		const real = realAuth("admin");
		const auth = createGatedTestAuth(sampleAuth(), real);
		await Promise.all([auth.ready(), auth.ready()]);
		await auth.ready();
		expect(real.ready).toHaveBeenCalledTimes(1);
	});
});

describe("where the panel starts", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const at = (hostname: string) =>
		vi.stubGlobal("location", { hostname } as Location);

	it("starts in Test on this computer", () => {
		for (const host of ["localhost", "127.0.0.1", "panel.localhost"]) {
			at(host);
			expect(onThisComputer(), host).toBe(true);
			expect(defaultEnvironment(), host).toBe("test");
		}
	});

	it("starts in Produkcja on its deployed address", () => {
		for (const host of [
			"admin-panel.marta-100.workers.dev",
			"studio-x7k2.codzienniefitapp.com",
		]) {
			at(host);
			expect(onThisComputer(), host).toBe(false);
			expect(defaultEnvironment(), host).toBe("production");
			expect(currentEnvironment(), host).toBe("production");
		}
	});
});
