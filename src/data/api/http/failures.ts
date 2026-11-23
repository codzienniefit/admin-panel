import { ApiError, type ApiIssue } from "@/data/api/errors";

// Turns an answer the backend gave into the one error type the panel knows.
//
// Every panel route answers a failure in one shape (the backend's
// src/common/handlers/panelContract.ts), with `error` written in Polish for
// the person reading it:
//
//   422  { error, errorCode: "VALIDATION", issues: [{ path, code, message }] }
//   409  { error, errorCode, current }
//   404  { error, errorCode: "NOT_FOUND" }
//   428  { error, errorCode: "VERSION_REQUIRED" }
//   413, 429, 502, 503  { error, errorCode }
//   500  { error, errorCode: "SERVER_ERROR" }   a Polish sentence, never the exception
//
// The panel shows those messages as they are. Its own texts below are only
// for an answer that has no `error` (a proxy in between, a network failure).
//
// Nothing is hidden: whenever the panel shows its own words instead of the
// backend's, the message ends with "(Szczegóły: …)": the HTTP status, the
// error code, and whatever the backend did say, even in English, or the
// start of an answer that is not JSON at all. A network failure carries the
// browser's own reason. Every screen shows `message`, so every screen shows
// the details, and `ApiError.details` holds them on their own.
//
// A 409 is "someone changed it meanwhile" only when its code says so
// (CONFLICT, PANEL_DOC_CONFLICT) or it has none. Any other code (IN_USE,
// BADGE_IN_USE, WORKOUT_EXISTS, ALREADY_EXISTS, SENDING_IN_PROGRESS) is a
// refusal: something is in the way, and saving again on top of the stored
// version would not help.

const TEXT = {
	unauthorized: "Sesja wygasła albo nie masz logowania. Zaloguj się ponownie.",
	forbidden: "To konto nie ma dostępu do panelu.",
	notFound: "Nie znaleziono tego w backendzie.",
	conflict: "Ktoś zmienił to w międzyczasie.",
	validation: "Backend odrzucił zapis.",
	blocked: "Backend odmówił: coś stoi temu na przeszkodzie.",
	tooLarge: "Plik jest za duży, żeby go wysłać.",
	noVersion:
		"Panel nie podał wersji, na której opiera się ta zmiana, więc backend jej nie przyjął. To błąd panelu, nie konflikt: odśwież stronę i spróbuj ponownie.",
	failed: "Backend napotkał błąd. Spróbuj ponownie za chwilę.",
	unavailable: "Backend jest chwilowo niedostępny. Spróbuj za chwilę.",
	network: "Brak połączenia z backendem. Sprawdź internet i spróbuj ponownie.",
	timeout: "Backend nie odpowiedział na czas. Spróbuj ponownie.",
	unexpected: "Backend odpowiedział w nieoczekiwany sposób.",
} as const;

/** The codes of a 409 that mean "the stored version is not the one you had". */
const VERSION_CODES: ReadonlySet<string> = new Set([
	"CONFLICT",
	"PANEL_DOC_CONFLICT",
]);

/**
 * The backend's own 500 for the panel (panelServerError): `error` is a Polish sentence written
 * for the person, never the exception's text, so it is shown as it is. It can say more than
 * "something failed", e.g. that part of a message may already have reached users. A 500 without
 * this code may carry raw exception text and is shown in the panel's own words.
 */
const SERVER_ERROR = "SERVER_ERROR";

/** The Worker's own refusal of a write to a section that is not open (worker/proxy.ts). */
const WORKER_READ_ONLY = "READ_ONLY";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** The error envelope of a body; anything else reads as empty. */
function readBody(body: unknown) {
	const record = isRecord(body) ? body : {};
	const issues: ApiIssue[] = [];
	for (const issue of Array.isArray(record.issues) ? record.issues : []) {
		if (!isRecord(issue)) continue;
		const message = text(issue.message);
		if (!message) continue;
		issues.push({
			path: typeof issue.path === "string" ? issue.path : "",
			message,
		});
	}
	return {
		// `message` is what a few older handlers use instead of `error`.
		error: text(record.error) ?? text(record.message),
		errorCode: text(record.errorCode),
		issues,
		/** The entity as stored now, on a conflict. Not validated here. */
		current: record.current,
	};
}

/** How much of a backend text or a non-JSON answer goes into the details. */
const DETAIL_TEXT_MAX = 300;

/** One line, no markup, at most DETAIL_TEXT_MAX characters. */
function oneLine(value: string): string {
	const flat = value
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > DETAIL_TEXT_MAX
		? `${flat.slice(0, DETAIL_TEXT_MAX)}…`
		: flat;
}

/**
 * The technical facts of a failure, in Polish, for when the panel shows its
 * own words: status, code, and what the backend said (or the start of an
 * answer that is not JSON). Never empty when there was an answer.
 */
export function failureDetails(
	status: number | undefined,
	errorCode: string | null,
	said: string | null,
	raw?: string,
): string {
	const parts: string[] = [];
	if (status !== undefined) parts.push(`HTTP ${status}`);
	if (errorCode) parts.push(`kod ${errorCode}`);
	if (said) parts.push(`backend: „${oneLine(said)}”`);
	else if (raw && raw.trim() !== "") parts.push(`odpowiedź: „${oneLine(raw)}”`);
	else if (status !== undefined) parts.push("odpowiedź bez treści");
	return parts.join(", ");
}

/** The panel's own text followed by the facts it stands in for. */
function withDetails(own: string, details: string): string {
	return details ? `${own} (Szczegóły: ${details})` : own;
}

/**
 * Whether the answer as text says something the parsed envelope does not: it
 * is not JSON, it is JSON but not an object (a bare "Bad Request", a list),
 * or its `error`/`message` is not text (`{ error: 500 }`). An empty object,
 * or one whose only content is its code, adds nothing.
 */
function rawWorthShowing(body: unknown): boolean {
	if (body === undefined || !isRecord(body)) return true;
	const notText = (value: unknown) =>
		value !== undefined && value !== null && typeof value !== "string";
	return notText(body.error) || notText(body.message);
}

/** A refusal: shown next to the form, never merged or tried again. */
function refusal(
	status: number,
	message: string,
	issues: readonly ApiIssue[] = [],
	details?: string,
): ApiError {
	return new ApiError("validation", message, {
		status,
		issues: issues.length > 0 ? issues : [{ path: "", message }],
		details,
	});
}

/**
 * The error for an answer with a failure status.
 *
 * @param status the HTTP status
 * @param body the parsed JSON body, or undefined when there was none
 * @param raw the answer as text, for an answer that is not JSON
 */
export function failureFrom(
	status: number,
	body: unknown,
	raw?: string,
): ApiError {
	const { error: said, errorCode, issues, current } = readBody(body);
	// What the backend really answered, for whenever the panel shows its own
	// words instead: nothing it said is lost.
	const details = failureDetails(
		status,
		errorCode,
		said,
		rawWorthShowing(body) ? raw : undefined,
	);
	const own = (text: string) => withDetails(text, details);

	if (status === 401) {
		return new ApiError("unauthorized", own(TEXT.unauthorized), {
			status,
			details,
		});
	}
	if (status === 403) {
		// The Worker's list of open sections and the panel's own disagree: the
		// person is told what is closed, not that they have no access.
		if (errorCode === WORKER_READ_ONLY && said)
			return refusal(status, said, [], details);
		return new ApiError("forbidden", own(TEXT.forbidden), { status, details });
	}
	if (status === 404) {
		return new ApiError("notFound", said ?? own(TEXT.notFound), {
			status,
			details,
		});
	}
	if (status === 409 || status === 412) {
		if (status === 409 && errorCode && !VERSION_CODES.has(errorCode)) {
			return refusal(status, said ?? own(TEXT.blocked), issues, details);
		}
		return new ApiError("conflict", said ?? own(TEXT.conflict), {
			status,
			current,
			details,
		});
	}
	if (status === 400 || status === 422) {
		const joined = issues.map((issue) => issue.message).join("\n");
		return refusal(
			status,
			said ?? (joined || own(TEXT.validation)),
			issues,
			details,
		);
	}
	if (status === 413)
		return refusal(status, said ?? own(TEXT.tooLarge), [], details);
	// A change without the version it is based on: a fault of the panel,
	// shown, not merged like a conflict and not tried again.
	if (status === 428)
		return refusal(status, said ?? own(TEXT.noVersion), [], details);
	// "Too soon": something the person can wait out, when the backend says so.
	if (status === 429 && said) return refusal(status, said, [], details);
	if (status === 429 || status === 502 || status === 503 || status === 504) {
		return new ApiError("server", said ?? own(TEXT.unavailable), {
			status,
			details,
		});
	}
	if (status === 500) {
		// The backend's own 500 is a Polish sentence for the person; any other
		// may be raw exception text, shown only in the details.
		const message =
			errorCode === SERVER_ERROR && said ? said : own(TEXT.failed);
		return new ApiError("server", message, { status, details });
	}
	return new ApiError("server", said ?? own(TEXT.unexpected), {
		status,
		details,
	});
}

/** The request never got an answer. */
export function networkFailure(cause: unknown): ApiError {
	const name =
		cause instanceof Error
			? cause.name
			: isRecord(cause) && typeof cause.name === "string"
				? cause.name
				: "";
	const timedOut = name === "TimeoutError" || name === "AbortError";
	const reason =
		cause instanceof Error
			? cause.message
			: isRecord(cause) && typeof cause.message === "string"
				? cause.message
				: typeof cause === "string"
					? cause
					: "";
	// The browser's own words for why there was no answer (CORS, offline,
	// DNS, a timeout), so that even this failure says what happened.
	const details = [name, reason ? `„${oneLine(reason)}”` : ""]
		.filter((part) => part !== "")
		.join(": ");
	return new ApiError(
		"network",
		withDetails(timedOut ? TEXT.timeout : TEXT.network, details),
		{ details: details || undefined },
	);
}

/** A success status whose body is not what the contract promises. */
export function unexpectedAnswer(
	what: string,
	problems: readonly ApiIssue[] = [],
	status?: number,
): ApiError {
	const first = problems[0];
	const where = first
		? ` (${first.path ? `${first.path}: ` : ""}${first.message})`
		: "";
	return new ApiError("server", `${TEXT.unexpected} ${what}${where}`, {
		status,
		issues: problems,
	});
}
