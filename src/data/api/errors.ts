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

	constructor(
		kind: ApiErrorKind,
		message: string,
		extra: { issues?: readonly ApiIssue[]; current?: TCurrent } = {},
	) {
		super(message);
		this.name = "ApiError";
		this.kind = kind;
		this.issues = extra.issues ?? [];
		this.current = extra.current;
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

export function isConflict<T>(error: unknown): error is ApiError<T> {
	return isApiError(error) && error.kind === "conflict";
}
