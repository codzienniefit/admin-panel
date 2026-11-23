import { createStore } from "@/lib/store";
import type { AuthProvider, Session } from "./types";

/**
 * The Test environment on the deployed panel: open only to someone who is signed in for real.
 *
 * On the panel's own address, Test (sample data in the browser) must not be a way in for anyone
 * who opens the page. So before the sample session counts, the real sign-in is asked: only with a
 * real admin session does this sign in as the sample admin. Without one it offers the real sign-in
 * (Google, through the Worker), which comes back here, to Test. On this computer (`npm run dev`,
 * the UI tests) Test is used as it is, without this gate (src/auth/index.ts).
 *
 * @param sample the demo sign-in of the Test environment
 * @param real the sign-in of Produkcja, asked whether someone is signed in for real
 */
export function createGatedTestAuth(
	sample: AuthProvider,
	real: AuthProvider,
): AuthProvider {
	const session = createStore<Session>({ status: "loading" });
	let unlocked = false;
	let checked: Promise<void> | null = null;

	async function check(): Promise<void> {
		await real.ready();
		if (real.session.get().status !== "admin") {
			// the sample session of an earlier visit does not count without a real one
			await sample.signOut();
			session.set({ status: "signedOut" });
			return;
		}
		unlocked = true;
		if (sample.session.get().status !== "admin") await sample.signIn("admin");
		session.set(sample.session.get());
		sample.session.subscribe(() => session.set(sample.session.get()));
	}

	return {
		session,
		ready: () => {
			checked ??= check();
			return checked;
		},
		// Until the real sign-in has happened, the only way in is the real one.
		get methods() {
			return unlocked ? sample.methods : real.methods;
		},
		notice: () => (unlocked ? null : (real.notice?.() ?? null)),
		refusedUid: () => (unlocked ? null : (real.refusedUid?.() ?? null)),
		signIn: (methodId, details) =>
			unlocked
				? sample.signIn(methodId, details)
				: real.signIn(methodId, details),
		async signOut() {
			await sample.signOut();
			await real.signOut();
		},
		getToken: (options) => sample.getToken(options),
	};
}
