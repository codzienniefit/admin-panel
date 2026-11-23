import { z } from "zod";
import { createStore } from "@/lib/store";
import type {
	AuthProvider,
	Session,
	SignInDetails,
	SignInMethod,
} from "./types";

// Sign-in for Produkcja. The panel's own Worker does the signing in
// (worker/auth.ts), the backend decides who is an admin, and the session is
// kept in a cookie this code cannot read. So there is no token here and
// nothing to store: this file only asks the Worker who is signed in, or
// sends the browser to Google.

/** Set on every request; the Worker refuses /auth and /api without it. */
const PANEL_HEADER = "x-cf-panel";

const statusSchema = z.looseObject({
	status: z.enum(["signedOut", "admin"]),
	user: z
		.looseObject({
			uid: z.string(),
			email: z.string().nullish(),
			displayName: z.string().nullish(),
		})
		.nullish(),
	methods: z.array(z.string()).default([]),
	/** After a refused sign-in: the person's own user id. */
	refusedUid: z.string().nullish(),
});

const METHODS: Record<string, SignInMethod> = {
	google: {
		id: "google",
		kind: "redirect",
		label: "Zaloguj się przez Google",
		description: "Otworzy stronę logowania Google.",
	},
};

const NOT_CONFIGURED =
	"Logowanie do Produkcji nie jest jeszcze skonfigurowane. Do czasu ustawienia kluczy panel działa w środowisku Test.";
const UNREACHABLE =
	"Nie udało się sprawdzić logowania. Sprawdź połączenie i odśwież stronę.";

export interface ServerAuthOptions {
	fetch?: typeof fetch;
	/** Leaves the page for a sign-in at Google. */
	leave?: (url: string) => void;
}

export function createServerAuth(
	options: ServerAuthOptions = {},
): AuthProvider {
	const request = options.fetch ?? ((input, init) => fetch(input, init));
	const leave = options.leave ?? ((url) => window.location.assign(url));

	const session = createStore<Session>({ status: "loading" });
	let methods: readonly SignInMethod[] = [];
	let notice: string | null = null;
	let refusedUid: string | null = null;
	let checked: Promise<void> | null = null;

	async function call(path: string, init: RequestInit = {}): Promise<Response> {
		return request(path, {
			...init,
			credentials: "same-origin",
			cache: "no-store",
			headers: {
				accept: "application/json",
				[PANEL_HEADER]: "1",
				...init.headers,
			},
		});
	}

	/** Takes over what the Worker says about the session. */
	async function accept(response: Response): Promise<boolean> {
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			return false;
		}
		const parsed = statusSchema.safeParse(body);
		if (!parsed.success) return false;
		const { status, user } = parsed.data;
		methods = parsed.data.methods.flatMap((id) => METHODS[id] ?? []);
		notice = methods.length === 0 ? NOT_CONFIGURED : null;
		refusedUid = parsed.data.refusedUid ?? null;
		if (status === "signedOut" || !user) {
			session.set({ status: "signedOut" });
			return true;
		}
		session.set({
			status,
			user: {
				uid: user.uid,
				email: user.email ?? null,
				displayName: user.displayName ?? user.email ?? "Administrator",
			},
		});
		return true;
	}

	async function check(): Promise<void> {
		let ok = false;
		try {
			const response = await call("/auth/session");
			ok = response.ok && (await accept(response));
		} catch {
			ok = false;
		}
		if (!ok) {
			methods = [];
			notice = UNREACHABLE;
			session.set({ status: "signedOut" });
		}
	}

	return {
		session,
		ready: () => {
			checked ??= check();
			return checked;
		},
		get methods() {
			return methods;
		},
		notice: () => notice,
		refusedUid: () => refusedUid,
		async signIn(methodId: string, details: SignInDetails = {}) {
			const method = methods.find((candidate) => candidate.id === methodId);
			if (!method) throw new Error(`Nieznany sposób logowania: ${methodId}`);
			const target = new URLSearchParams({
				redirect: details.redirect ?? "/",
			});
			leave(`/auth/${method.id}/start?${target.toString()}`);
			// The page is being left; nothing after this matters.
			return new Promise<never>(() => {});
		},
		async signOut() {
			try {
				await call("/auth/signout", { method: "POST" });
			} finally {
				session.set({ status: "signedOut" });
			}
		},
		// The Worker adds the session when it forwards a request.
		getToken: async () => null,
	};
}
