import type { Deps } from "./env";

// The one call to Firebase Authentication the Worker makes, over its REST
// API: turning Google's token into a Firebase token for the same person. It
// needs the project's Web API key and nothing else: no service account, no
// private key.
//
// The Firebase token goes straight to the backend, which turns it into a
// session (backend.ts). The refresh token Firebase sends along is never
// read: the Worker keeps no long-lived credential of anyone.

const SIGN_IN_WITH_IDP =
	"https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp";

export type FirebaseFailure =
	/** Firebase did not accept Google's token, or the account cannot sign in. */
	| "rejected"
	| "disabled"
	| "tooManyAttempts"
	/** The key or Google sign-in is not set up in Firebase. */
	| "misconfigured"
	/** Firebase could not be reached or failed itself. */
	| "unavailable";

export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; reason: FirebaseFailure };

function reasonFor(status: number, message: string): FirebaseFailure {
	const code = message.split(/[\s:]/)[0] ?? "";
	if (code === "USER_DISABLED") return "disabled";
	if (code.startsWith("TOO_MANY_ATTEMPTS") || status === 429) {
		return "tooManyAttempts";
	}
	if (
		code === "OPERATION_NOT_ALLOWED" ||
		code === "CONFIGURATION_NOT_FOUND" ||
		code === "INVALID_IDP_RESPONSE_CONFIG" ||
		code === "PROJECT_NOT_FOUND" ||
		code.startsWith("API_KEY") ||
		// "API key not valid. Please pass a valid API key." comes as a 400.
		/api key/i.test(message) ||
		status === 403
	) {
		return "misconfigured";
	}
	if (status >= 500) return "unavailable";
	return "rejected";
}

/**
 * Exchanges an id token issued by Google for a Firebase id token. Firebase
 * checks Google's token itself: its signature and that it was issued for
 * this project's client.
 *
 * An account that Firebase asks to confirm (an e-mail already used with
 * another way of signing in) or that has Firebase's own second factor
 * answers without a token; that is a refusal here, not a way in.
 */
export async function signInWithGoogle(
	deps: Deps,
	apiKey: string,
	googleIdToken: string,
	requestUri: string,
): Promise<Result<string>> {
	let response: Response;
	try {
		response = await deps.fetch(
			`${SIGN_IN_WITH_IDP}?key=${encodeURIComponent(apiKey)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					postBody: new URLSearchParams({
						id_token: googleIdToken,
						providerId: "google.com",
					}).toString(),
					requestUri,
					returnSecureToken: true,
					returnIdpCredential: false,
				}),
			},
		);
	} catch {
		return { ok: false, reason: "unavailable" };
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	const record =
		typeof body === "object" && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: {};
	if (!response.ok) {
		const error = record.error;
		const message =
			typeof error === "object" && error !== null && "message" in error
				? String((error as { message: unknown }).message)
				: "";
		return { ok: false, reason: reasonFor(response.status, message) };
	}
	return typeof record.idToken === "string" && record.idToken !== ""
		? { ok: true, value: record.idToken }
		: { ok: false, reason: "rejected" };
}
