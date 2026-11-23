import type { Store } from "@/lib/store";

export interface AuthUser {
	uid: string;
	email: string | null;
	displayName: string;
}

/**
 * - loading: the provider has not yet said who is signed in
 * - signedOut: nobody is
 * - forbidden: someone is, without the admin claim
 * - admin: someone is, with it
 */
export type Session =
	| { status: "loading" }
	| { status: "signedOut" }
	| { status: "forbidden"; user: AuthUser }
	| { status: "admin"; user: AuthUser };

/** One way of signing in that the login page offers. */
export interface SignInMethod {
	id: string;
	/**
	 * - button: one click signs in (the demo people)
	 * - redirect: one click leaves for another site's sign-in page and comes back
	 */
	kind: "button" | "redirect";
	label: string;
	description: string;
}

/** What a way of signing in may need besides its id. */
export interface SignInDetails {
	/** Where to land afterwards; a path inside the panel. */
	redirect?: string;
}

/**
 * Everything the panel needs from a sign-in system. The Test environment
 * uses the demo implementation (src/auth/mock.ts); Produkcja signs in with
 * Google and the app's Firebase account, through the panel's Worker
 * (src/auth/server.ts).
 *
 * Being "admin" here only decides what the panel shows. The backend checks
 * the session and its own list of admins on every request.
 */
export interface AuthProvider {
	session: Store<Session>;
	/** Resolves once the session has left "loading". */
	ready(): Promise<void>;
	methods: readonly SignInMethod[];
	/** Something the login page should say, e.g. that sign-in is not set up. */
	notice?(): string | null;
	/**
	 * After a sign-in that was refused because the account is not on the
	 * list of admins: the person's own user id, so they can pass it to
	 * whoever keeps the list.
	 */
	refusedUid?(): string | null;
	signIn(methodId: string, details?: SignInDetails): Promise<void>;
	signOut(): Promise<void>;
	/**
	 * The token to send with a request, or null when signed out. With
	 * `forceRefresh` a new one is fetched even if the current one still looks
	 * valid: the backend has just refused it.
	 */
	getToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
}
