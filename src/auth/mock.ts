import { createStore } from "@/lib/store";
import type { AuthProvider, AuthUser, Session, SignInMethod } from "./types";

// Sign-in for the Test environment: two made-up people, no passwords, no
// network. It exists so that the guard, the "no access" screen and sign-out
// are real code from the start.

type DemoId = "admin" | "noAccess";

const USERS: Record<DemoId, { user: AuthUser; admin: boolean }> = {
	admin: {
		user: {
			uid: "demo-admin",
			email: "ada@example.test",
			displayName: "Ada Adminowska",
		},
		admin: true,
	},
	noAccess: {
		user: {
			uid: "demo-user",
			email: "ula@example.test",
			displayName: "Ula Użytkowniczka",
		},
		admin: false,
	},
};

const METHODS: readonly SignInMethod[] = [
	{
		id: "admin",
		label: "Wejdź jako administratorka",
		description: "Konto przykładowe z dostępem do panelu.",
	},
	{
		id: "noAccess",
		label: "Wejdź jako osoba bez dostępu",
		description: "Konto przykładowe bez uprawnień, żeby zobaczyć odmowę.",
	},
];

const STORAGE_KEY = "cf.demoUser";

const isDemoId = (value: unknown): value is DemoId =>
	value === "admin" || value === "noAccess";

function sessionFor(id: DemoId | null): Session {
	if (!id) return { status: "signedOut" };
	const { user, admin } = USERS[id];
	return admin ? { status: "admin", user } : { status: "forbidden", user };
}

export interface MockAuthOptions {
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
	sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultStorage(): MockAuthOptions["storage"] {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function createMockAuth(options: MockAuthOptions = {}): AuthProvider {
	const storage =
		options.storage === undefined ? defaultStorage() : options.storage;
	const sleep = options.sleep ?? realSleep;

	const read = (): DemoId | null => {
		try {
			const stored = storage?.getItem(STORAGE_KEY);
			return isDemoId(stored) ? stored : null;
		} catch {
			return null;
		}
	};

	// Known at once, so this provider is never in the "loading" state.
	const session = createStore<Session>(sessionFor(read()));

	return {
		session,
		ready: () => Promise.resolve(),
		methods: METHODS,
		async signIn(methodId) {
			if (!isDemoId(methodId)) {
				throw new Error(`Nieznany sposób logowania: ${methodId}`);
			}
			await sleep(350);
			try {
				storage?.setItem(STORAGE_KEY, methodId);
			} catch {
				// Without storage the session simply lasts until a reload.
			}
			session.set(sessionFor(methodId));
		},
		async signOut() {
			try {
				storage?.removeItem(STORAGE_KEY);
			} catch {
				// Nothing to clear.
			}
			session.set({ status: "signedOut" });
		},
		async getToken() {
			const current = session.get();
			return current.status === "admin" || current.status === "forbidden"
				? `demo-token:${current.user.uid}`
				: null;
		},
	};
}
