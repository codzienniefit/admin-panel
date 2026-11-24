export type ApiErrorKind =
	| "validation"
	| "conflict"
	| "unauthorized"
	| "forbidden"
	| "notFound"
	| "network"
	| "server";

export interface ApiIssue {
	/** Dotted path of the field, e.g. "title" or "paths.0.days.3". */
	path: string;
	message: string;
}

/**
 * The one error type every ApiClient adapter throws. Screens branch on
 * `kind`, never on status codes or message text.
 */
export class ApiError<TCurrent = unknown> extends Error {
	readonly kind: ApiErrorKind;
	/** Field-level problems, for kind "validation". */
	readonly issues: readonly ApiIssue[];
	/** The server's current version of the entity, for kind "conflict". */
	readonly current: TCurrent | undefined;
	/**
	 * The HTTP status the backend really answered with, when there was one.
	 * It can differ from what `kind` stands for (a 409 that is a refusal is
	 * "validation"). For the developer's register only; screens branch on
	 * `kind`.
	 */
	readonly status: number | undefined;
	/**
	 * What the backend really answered, in one Polish line (status, code, its
	 * own text even in English, or the start of a non-JSON answer), or the
	 * browser's reason when there was no answer. Already part of `message`
	 * whenever the panel shows its own words instead of the backend's.
	 */
	readonly details: string | undefined;
	/**
	 * The backend answered with success, but the body is not what the panel
	 * expects (not JSON, or a field of the wrong shape). Kind "server".
	 */
	readonly unexpected: boolean;

	constructor(
		kind: ApiErrorKind,
		message: string,
		extra: {
			issues?: readonly ApiIssue[];
			current?: TCurrent;
			status?: number;
			details?: string;
			unexpected?: boolean;
		} = {},
	) {
		super(message);
		this.name = "ApiError";
		this.kind = kind;
		this.issues = extra.issues ?? [];
		this.current = extra.current;
		this.status = extra.status;
		this.details = extra.details;
		this.unexpected = extra.unexpected ?? false;
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

/** The text to show for a failure: the error's own, or the fallback with what was thrown. */
export function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message
		? error.message
		: failureText(error, fallback);
}

/** How much of a thrown value's own text goes into the details. */
const THROWN_TEXT_MAX = 300;

function short(value: string): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > THROWN_TEXT_MAX
		? `${flat.slice(0, THROWN_TEXT_MAX)}…`
		: flat;
}

/**
 * What to show for a failure the screen has its own words for: those words,
 * followed by what really happened, so that no failure is ever shown as a
 * bare "something went wrong".
 *
 * - from the backend or the network: its details (HTTP status, code, what
 *   the backend said even in English, or the browser's reason);
 * - anything else thrown (a bug in the panel): its name and its own text,
 *   in English as it is.
 */
export function failureText(error: unknown, own: string): string {
	let details = "";
	if (error instanceof ApiError) {
		details =
			error.details ??
			(error.message && error.message !== own ? error.message : "");
	} else if (error instanceof Error) {
		details = error.message
			? `${error.name}: „${short(error.message)}”`
			: error.name;
	} else if (typeof error === "string") {
		// a blank text has nothing to add
		if (error.trim() !== "") details = `„${short(error)}”`;
	} else if (error !== undefined && error !== null) {
		try {
			details = short(JSON.stringify(error) ?? String(error));
		} catch {
			details = String(error);
		}
	}
	return details ? `${own} (Szczegóły: ${details})` : own;
}

export function isConflict<T>(error: unknown): error is ApiError<T> {
	return isApiError(error) && error.kind === "conflict";
}
