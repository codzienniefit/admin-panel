import { endSession, type PanelUser, startSession, whoAmI } from "./backend";
import {
	cookieKey,
	open,
	sameText,
	seal,
	sha256Base64Url,
	toBase64Url,
	tokenClaims,
} from "./codec";
import {
	canSignIn,
	type Deps,
	missingSettings,
	type PanelEnv,
	type SignInMethodId,
	signInMethods,
} from "./env";
import { type FirebaseFailure, signInWithGoogle } from "./firebase";
import {
	clearCookie,
	cookie,
	failure,
	fromOwnPage,
	json,
	navigatedFromPanel,
	readCookies,
	redirect,
	safeRedirect,
} from "./http";

// Everything under /auth: who is signed in, signing in with Google, signing
// out.
//
// The Worker lets nobody in by itself. It takes the person to Google, turns
// Google's answer into a Firebase token, and hands that to the backend. The
// backend decides (its own list of admins) and creates the session; the
// Worker only keeps it in a cookie the page cannot read. No token is ever in
// an answer.

/** The Firebase session cookie the backend created. */
export const SESSION_COOKIE = "__Host-cf_session";
/** A sign-in on its way to Google and back. */
const ATTEMPT_COOKIE = "__Host-cf_oauth";
/** For ten minutes after the backend refused someone: their own user id, for the login page. */
const REFUSED_COOKIE = "__Host-cf_refused";

/** How long someone has to finish signing in at Google. */
const ATTEMPT_MAX_AGE_S = 10 * 60;
/** How long the refusal page can still show the person's user id. */
const REFUSED_MAX_AGE_S = 10 * 60;

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

interface Attempt {
	v: 1;
	state: string;
	nonce: string;
	/** PKCE verifier. */
	verifier: string;
	redirect: string;
	exp: number;
}

interface Refused {
	v: 1;
	uid: string;
	exp: number;
}

export type AuthStatus = "signedOut" | "admin";

interface StatusBody {
	status: AuthStatus;
	user?: PanelUser;
	/** The ways of signing in that are set up. Empty: sign-in is not configured yet. */
	methods: SignInMethodId[];
	/** After a refused sign-in: the person's own user id, to pass to whoever keeps the list. */
	refusedUid?: string;
	/**
	 * While sign-in is not set up (`methods` empty): the names of the Worker's values that are
	 * missing or not valid, so whoever sets it up sees what is left. Never sent once sign-in works.
	 */
	missing?: string[];
}

/** The status of someone signed out; while sign-in is not set up, with what it still needs. */
function signedOutBody(env: PanelEnv, methods: SignInMethodId[]): StatusBody {
	const missing = methods.length === 0 ? missingSettings(env) : [];
	return missing.length > 0
		? { status: "signedOut", methods, missing }
		: { status: "signedOut", methods };
}

const TEXT = {
	unavailable: "Logowanie jest chwilowo niedostępne. Spróbuj za chwilę.",
	misconfigured:
		"Logowanie nie jest poprawnie skonfigurowane. Daj znać administratorowi.",
	foreign: "Odrzucono żądanie z innej strony.",
};

export const clearSession = (): string[] => [clearCookie(SESSION_COOKIE)];

const random = (deps: Deps) => toBase64Url(deps.randomBytes(32));

const nowSeconds = (deps: Deps) => Math.floor(deps.now() / 1000);

/** Cloudflare's own id of a request, to find it in Cloudflare's records. */
const rayOf = (request: Request) => request.headers.get("cf-ray");

/** Back to the sign-in page with a reason it knows how to word. */
const backToLogin = (reason: string, cookies: string[]) =>
	redirect(`/login?error=${encodeURIComponent(reason)}`, cookies);

// ─── Session ────────────────────────────────────────────────────────────────

async function refusedUid(
	request: Request,
	env: PanelEnv,
	deps: Deps,
): Promise<string | null> {
	const sealed = readCookies(request).get(REFUSED_COOKIE);
	const key = await cookieKey(env.SIGN_IN_COOKIE_KEY);
	if (!sealed || !key) return null;
	const value = await open(key, REFUSED_COOKIE, sealed);
	if (typeof value !== "object" || value === null) return null;
	const data = value as Partial<Refused>;
	if (data.v !== 1 || typeof data.uid !== "string") return null;
	if (typeof data.exp !== "number" || nowSeconds(deps) >= data.exp) return null;
	return data.uid;
}

async function sessionStatus(
	request: Request,
	env: PanelEnv,
	deps: Deps,
): Promise<Response> {
	const methods = signInMethods(env);
	const session = readCookies(request).get(SESSION_COOKIE);
	if (!session) {
		const body = signedOutBody(env, methods);
		const uid = await refusedUid(request, env, deps);
		if (uid) body.refusedUid = uid;
		return json(body);
	}
	if (methods.length === 0) {
		// A cookie from before the settings were taken away.
		return json(signedOutBody(env, methods), 200, clearSession());
	}
	const who = await whoAmI(env, deps, session);
	if (who.ok) {
		const body: StatusBody = { status: "admin", user: who.user, methods };
		return json(body);
	}
	if (who.reason === "signedOut") {
		return json({ status: "signedOut", methods }, 200, clearSession());
	}
	if (who.reason === "misconfigured") {
		deps.log({ event: "backendRefusedWorker", route: "/auth/session" });
		return failure(503, TEXT.misconfigured, "AUTH_MISCONFIGURED");
	}
	// The backend could not be asked. The session is left as it is.
	return failure(503, TEXT.unavailable, "AUTH_UNAVAILABLE");
}

async function signOut(
	request: Request,
	env: PanelEnv,
	deps: Deps,
): Promise<Response> {
	const session = readCookies(request).get(SESSION_COOKIE);
	// The backend ends the session for good; without that a copy of the
	// cookie would keep working until it expires.
	const ended = session ? await endSession(env, deps, session) : true;
	deps.log({ event: "signOut", ended });
	return json({ status: "signedOut", ended }, 200, [
		...clearSession(),
		clearCookie(ATTEMPT_COOKIE, "Lax"),
		clearCookie(REFUSED_COOKIE),
	]);
}

// ─── Google ─────────────────────────────────────────────────────────────────

const callbackUrl = (origin: string) => `${origin}/auth/google/callback`;

/**
 * Sends the browser to Google. What has to be remembered until it comes back
 * (the state that proves the answer belongs to this attempt, the nonce, the
 * PKCE verifier, where to go afterwards) travels in an encrypted cookie that
 * lasts ten minutes.
 */
async function startGoogle(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	origin: string,
): Promise<Response> {
	const key = await cookieKey(env.SIGN_IN_COOKIE_KEY);
	if (!key || !canSignIn(env)) return backToLogin("unavailable", []);
	const url = new URL(request.url);
	const attempt: Attempt = {
		v: 1,
		state: random(deps),
		nonce: random(deps),
		verifier: random(deps),
		redirect: safeRedirect(url.searchParams.get("redirect"), origin),
		exp: nowSeconds(deps) + ATTEMPT_MAX_AGE_S,
	};
	const remembered = cookie(
		ATTEMPT_COOKIE,
		await seal(key, ATTEMPT_COOKIE, attempt, deps.randomBytes),
		// Google comes back with a normal navigation, which Lax allows.
		{ maxAge: ATTEMPT_MAX_AGE_S, sameSite: "Lax" },
	);

	const target = new URL(GOOGLE_AUTHORIZE);
	const params = target.searchParams;
	params.set("client_id", env.GOOGLE_CLIENT_ID?.trim() ?? "");
	params.set("redirect_uri", callbackUrl(origin));
	params.set("response_type", "code");
	params.set("scope", "openid email profile");
	params.set("state", attempt.state);
	params.set("nonce", attempt.nonce);
	params.set("code_challenge", await sha256Base64Url(attempt.verifier));
	params.set("code_challenge_method", "S256");
	params.set("prompt", "select_account");
	return redirect(target.toString(), [remembered, clearCookie(REFUSED_COOKIE)]);
}

/** The attempt this answer belongs to, or null when it belongs to none. */
async function rememberedAttempt(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	state: string | null,
): Promise<Attempt | null> {
	const key = await cookieKey(env.SIGN_IN_COOKIE_KEY);
	const sealed = readCookies(request).get(ATTEMPT_COOKIE);
	if (!key || !sealed || !state) return null;
	const value = await open(key, ATTEMPT_COOKIE, sealed);
	if (typeof value !== "object" || value === null) return null;
	const data = value as Partial<Attempt>;
	if (
		data.v !== 1 ||
		typeof data.state !== "string" ||
		typeof data.nonce !== "string" ||
		typeof data.verifier !== "string" ||
		typeof data.redirect !== "string" ||
		typeof data.exp !== "number"
	) {
		return null;
	}
	if (nowSeconds(deps) >= data.exp) return null;
	return sameText(data.state, state) ? (data as Attempt) : null;
}

/**
 * True when Google's token is what this attempt asked for. It came from
 * Google's own endpoint over TLS, which stands in for checking its
 * signature; Firebase checks the signature again. These checks cost ten
 * lines and mean a wrong token never leaves the Worker.
 */
export function isExpectedGoogleToken(
	idToken: string,
	clientId: string,
	nonce: string,
	now: number,
): boolean {
	const claims = tokenClaims(idToken);
	if (!claims) return false;
	const audience = claims.aud;
	const audienceMatches =
		typeof audience === "string"
			? audience === clientId
			: Array.isArray(audience) && audience.includes(clientId);
	return (
		clientId !== "" &&
		audienceMatches &&
		typeof claims.iss === "string" &&
		GOOGLE_ISSUERS.includes(claims.iss) &&
		typeof claims.exp === "number" &&
		claims.exp > now &&
		typeof claims.nonce === "string" &&
		sameText(claims.nonce, nonce) &&
		claims.email_verified === true
	);
}

async function googleIdToken(
	env: PanelEnv,
	deps: Deps,
	origin: string,
	code: string,
	attempt: Attempt,
): Promise<string | null> {
	const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
	let response: Response;
	try {
		response = await deps.fetch(GOOGLE_TOKEN, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				client_id: clientId,
				client_secret: env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
				redirect_uri: callbackUrl(origin),
				code_verifier: attempt.verifier,
			}).toString(),
		});
	} catch {
		return null;
	}
	if (!response.ok) return null;
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return null;
	}
	const idToken =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>).id_token
			: null;
	if (typeof idToken !== "string") return null;
	return isExpectedGoogleToken(
		idToken,
		clientId,
		attempt.nonce,
		nowSeconds(deps),
	)
		? idToken
		: null;
}

const FIREBASE_REASON: Record<FirebaseFailure, string> = {
	rejected: "failed",
	disabled: "disabled",
	tooManyAttempts: "tooManyAttempts",
	misconfigured: "misconfigured",
	unavailable: "unavailable",
};

async function finishGoogle(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	origin: string,
): Promise<Response> {
	const apiKey = env.FIREBASE_API_KEY?.trim();
	if (!apiKey || !canSignIn(env)) return backToLogin("unavailable", []);
	const answer = new URL(request.url).searchParams;

	// First: does this answer belong to an attempt started in this browser?
	// One that does not (anyone can send a browser here) changes nothing, so
	// it cannot end a sign-in that is under way in another tab.
	const attempt = await rememberedAttempt(
		request,
		env,
		deps,
		answer.get("state"),
	);
	if (!attempt) {
		deps.log({
			event: "refused",
			route: "/auth/google/callback",
			reason: "noAttempt",
			ray: rayOf(request),
		});
		return backToLogin("failed", []);
	}
	// From here the attempt is used up, however it ends.
	const done = [clearCookie(ATTEMPT_COOKIE, "Lax")];
	const end = (
		reason: string,
		cookies: string[] = done,
		uid: string | null = null,
	) => {
		deps.log({ event: "signIn", outcome: reason, uid, ray: rayOf(request) });
		return backToLogin(reason, cookies);
	};
	if (answer.get("error")) return end("cancelled");

	const code = answer.get("code");
	const googleToken = code
		? await googleIdToken(env, deps, origin, code, attempt)
		: null;
	if (!googleToken) return end("failed");

	const firebase = await signInWithGoogle(
		deps,
		apiKey,
		googleToken,
		callbackUrl(origin),
	);
	if (!firebase.ok) return end(FIREBASE_REASON[firebase.reason]);

	// The backend decides. A stranger who got this far has a Firebase account
	// like any user of the app, and gets no cookie here.
	const started = await startSession(env, deps, firebase.value);
	if (started.ok) {
		deps.log({
			event: "signIn",
			outcome: "admin",
			uid: started.user.uid,
			ray: rayOf(request),
		});
		return redirect(attempt.redirect, [
			...done,
			clearCookie(REFUSED_COOKIE),
			cookie(SESSION_COOKIE, started.session, {
				maxAge: started.maxAge,
				sameSite: "Strict",
			}),
		]);
	}
	if (started.reason === "notAdmin") {
		const key = await cookieKey(env.SIGN_IN_COOKIE_KEY);
		const cookies = [...done];
		if (key && started.uid) {
			const refused: Refused = {
				v: 1,
				uid: started.uid,
				exp: nowSeconds(deps) + REFUSED_MAX_AGE_S,
			};
			cookies.push(
				cookie(
					REFUSED_COOKIE,
					await seal(key, REFUSED_COOKIE, refused, deps.randomBytes),
					{ maxAge: REFUSED_MAX_AGE_S, sameSite: "Strict" },
				),
			);
		}
		return end("forbidden", cookies, started.uid);
	}
	if (started.reason === "misconfigured") {
		deps.log({ event: "backendRefusedWorker", route: "/auth/google/callback" });
	}
	return end(started.reason === "refused" ? "failed" : started.reason);
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * @param origin the panel's own address, or null while Produkcja is not
 *   configured; then only the question "who is signed in" is answered
 */
export async function handleAuth(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	origin: string | null,
): Promise<Response> {
	const { pathname } = new URL(request.url);
	const method = request.method;

	if (origin === null) {
		// Not configured: the sign-in page asks, and is told there is no way in.
		if (method === "GET" && pathname === "/auth/session") {
			return json(signedOutBody(env, []));
		}
		return failure(503, TEXT.misconfigured, "NOT_CONFIGURED");
	}

	// Reached by the browser itself navigating, so they cannot carry the
	// panel's header. Starting is allowed from the panel's own page or the
	// address bar; finishing needs the state from the encrypted cookie.
	if (method === "GET" && pathname === "/auth/google/start") {
		// A link on another site must not be able to start a sign-in (and
		// with it replace one that is under way).
		if (!navigatedFromPanel(request)) {
			deps.log({
				event: "refused",
				route: pathname,
				reason: "foreign",
				ray: rayOf(request),
			});
			return backToLogin("failed", []);
		}
		return startGoogle(request, env, deps, origin);
	}
	if (method === "GET" && pathname === "/auth/google/callback") {
		return finishGoogle(request, env, deps, origin);
	}

	// Everything else is asked by the panel's own page and by nothing else.
	if (!fromOwnPage(request, origin)) {
		deps.log({
			event: "refused",
			route: "/auth",
			reason: "foreign",
			ray: rayOf(request),
		});
		return failure(403, TEXT.foreign, "FOREIGN_REQUEST");
	}
	if (method === "GET" && pathname === "/auth/session") {
		return sessionStatus(request, env, deps);
	}
	if (method === "POST" && pathname === "/auth/signout") {
		return signOut(request, env, deps);
	}
	deps.log({
		event: "refused",
		route: "/auth",
		reason: "notFound",
		ray: rayOf(request),
	});
	return failure(404, "Not found", "NOT_FOUND");
}
