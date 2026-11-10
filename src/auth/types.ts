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

/** One way of signing in that the login page offers as a button. */
export interface SignInMethod {
	id: string;
	label: string;
	description: string;
}

/**
 * Everything the panel needs from a sign-in system. The Test environment
 * uses the demo implementation (src/auth/mock.ts); Produkcja will use
 * Firebase behind this same interface, so no screen changes when it arrives.
 *
 * Being "admin" here only decides what the panel shows. The backend checks
 * the claim itself on every request.
 */
export interface AuthProvider {
	session: Store<Session>;
	/** Resolves once the session has left "loading". */
	ready(): Promise<void>;
	methods: readonly SignInMethod[];
	signIn(methodId: string): Promise<void>;
	signOut(): Promise<void>;
	/** The token to send with a request, or null when signed out. */
	getToken(): Promise<string | null>;
}
