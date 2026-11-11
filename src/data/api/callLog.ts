import { createStore, type Store } from "@/lib/store";
import { type ApiErrorKind, isApiError } from "./errors";

// The developer's register of every call the panel makes to the backend:
// what was asked, with what, what came back, how long it took.
//
// It lives in memory only. It is never stored and never sent anywhere, and a
// reload or signing out empties it: answers can hold personal data (the
// user search).

export interface CallEntry {
	id: number;
	/** `Date.now()` when the call started. */
	at: number;
	/** Area and method, e.g. "challenges.save". */
	name: string;
	/** What the call was given, copied at that moment. */
	args: unknown[];
	state: "pending" | "ok" | "failed";
	/**
	 * The HTTP status the answer has or stands for: 200, 409, 500. Null while
	 * the call is running and when there was no answer at all.
	 */
	status: number | null;
	/** For a failed call. */
	kind?: ApiErrorKind | "unknown";
	durationMs: number | null;
	/** The answer; for a failed call, what is known about the failure. */
	result?: unknown;
}

export interface CallLog {
	/** Newest first. */
	entries: readonly CallEntry[];
	/** Failed calls since the register was last looked at. */
	unseenFailures: number;
}

/** How many calls are kept; older ones fall off the end. */
export const CALL_LOG_LIMIT = 300;

const STATUS: Record<ApiErrorKind, number | null> = {
	validation: 422,
	conflict: 409,
	unauthorized: 401,
	forbidden: 403,
	notFound: 404,
	server: 500,
	// The request never got an answer.
	network: null,
};

/** The status a failure stands for. The mock has no HTTP; the kinds map 1:1. */
export function statusOf(error: unknown): {
	status: number | null;
	kind: ApiErrorKind | "unknown";
} {
	return isApiError(error)
		? { status: STATUS[error.kind], kind: error.kind }
		: { status: null, kind: "unknown" };
}

/** How serious an entry is: decides its colour. */
export function severityOf(
	entry: Pick<CallEntry, "state" | "status">,
): "pending" | "ok" | "refused" | "broken" {
	if (entry.state === "pending") return "pending";
	if (entry.state === "ok") return "ok";
	// 4xx: the server understood and said no. Anything else: it did not work.
	return entry.status !== null && entry.status >= 400 && entry.status < 500
		? "refused"
		: "broken";
}

/**
 * A copy of a call's arguments that can be shown as JSON later: files become
 * a description, functions a marker, and nothing the caller changes
 * afterwards changes the record.
 */
export function snapshot(value: unknown, depth = 0): unknown {
	if (typeof value === "function") return "[funkcja]";
	if (typeof value !== "object" || value === null) return value;
	if (typeof Blob !== "undefined" && value instanceof Blob) {
		return {
			plik:
				"name" in value && typeof value.name === "string" ? value.name : null,
			typ: value.type,
			rozmiar: value.size,
		};
	}
	if (depth > 12) return "[zbyt głęboko]";
	if (Array.isArray(value))
		return value.map((item) => snapshot(item, depth + 1));
	return Object.fromEntries(
		Object.entries(value).map(([key, inner]) => [
			key,
			snapshot(inner, depth + 1),
		]),
	);
}

function failureDetails(error: unknown): unknown {
	if (isApiError(error)) {
		return {
			kind: error.kind,
			message: error.message,
			...(error.issues.length > 0 ? { issues: error.issues } : {}),
			...(error.current !== undefined ? { current: error.current } : {}),
		};
	}
	return { message: error instanceof Error ? error.message : String(error) };
}

export const callLog = createStore<CallLog>({ entries: [], unseenFailures: 0 });

/** The register has been looked at: the button stops being red. */
export function markCallsSeen(log: Store<CallLog> = callLog): void {
	log.set((current) =>
		current.unseenFailures === 0 ? current : { ...current, unseenFailures: 0 },
	);
}

export function clearCallLog(log: Store<CallLog> = callLog): void {
	log.set({ entries: [], unseenFailures: 0 });
}

interface Options {
	log?: Store<CallLog>;
	now?: () => number;
}

/**
 * Wraps a client so that every call it makes is written to the register.
 * Behaviour is untouched: the same answers and the same errors come out.
 * Methods that answer at once (an address for a file) are not calls to the
 * backend and are left alone.
 */
export function withCallLog<T extends object>(
	client: T,
	options: Options = {},
): T {
	const log = options.log ?? callLog;
	const now = options.now ?? (() => Date.now());
	let nextId = 1;

	const finish = (id: number, started: number, patch: Partial<CallEntry>) =>
		log.set((current) => ({
			entries: current.entries.map((entry) =>
				entry.id === id
					? { ...entry, ...patch, durationMs: now() - started }
					: entry,
			),
			unseenFailures:
				current.unseenFailures + (patch.state === "failed" ? 1 : 0),
		}));

	const wrap =
		(name: string, area: object, method: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) => {
			const started = now();
			const answer = method.apply(area, args);
			if (!(answer instanceof Promise)) return answer;

			const id = nextId++;
			log.set((current) => ({
				...current,
				entries: [
					{
						id,
						at: started,
						name,
						args: args.map((arg) => snapshot(arg)),
						state: "pending" as const,
						status: null,
						durationMs: null,
					},
					...current.entries,
				].slice(0, CALL_LOG_LIMIT),
			}));
			return answer.then(
				(result: unknown) => {
					finish(id, started, { state: "ok", status: 200, result });
					return result;
				},
				(error: unknown) => {
					finish(id, started, {
						state: "failed",
						...statusOf(error),
						result: failureDetails(error),
					});
					throw error;
				},
			);
		};

	return Object.fromEntries(
		Object.entries(client).map(([areaName, area]) => [
			areaName,
			typeof area === "object" && area !== null
				? Object.fromEntries(
						Object.entries(area).map(([methodName, method]) => [
							methodName,
							typeof method === "function"
								? wrap(
										`${areaName}.${methodName}`,
										area,
										method as (...args: unknown[]) => unknown,
									)
								: method,
						]),
					)
				: area,
		]),
	) as T;
}
