// What the sign-in page says when a sign-in at Google came back without a session. The Worker
// shows the same words on its own sign-in page (worker/loginPage.ts), before any of the panel's
// code is downloaded; returnProblems.test.ts keeps the two copies equal.

/** Why a sign-in at Google came back without a session, by the code the Worker sends back with. */
export const RETURN_PROBLEMS: Readonly<Record<string, string>> = {
	forbidden: "To konto nie ma dostępu.",
	cancelled: "Logowanie zostało przerwane.",
	disabled: "To konto jest zablokowane.",
	tooManyAttempts: "Za dużo prób. Spróbuj ponownie za kilka minut.",
	unavailable: "Logowanie jest chwilowo niedostępne. Spróbuj za chwilę.",
	misconfigured:
		"Logowanie nie jest poprawnie skonfigurowane. Daj znać administratorowi.",
};

/** The notice's title, and the text for a code the page does not know. */
export const SIGN_IN_FAILED = "Nie udało się zalogować";

/** Before the refused person's own user id. */
export const REFUSED_UID_HINT =
	"Żeby dostać dostęp, przekaż ten identyfikator osobie, która go nadaje:";

/** The text for a code, or null when there is none. */
export function returnProblem(code: string | undefined): string | null {
	if (!code) return null;
	return Object.hasOwn(RETURN_PROBLEMS, code)
		? (RETURN_PROBLEMS[code] ?? null)
		: `${SIGN_IN_FAILED}.`;
}
