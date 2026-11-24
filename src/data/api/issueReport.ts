import type { CallEntry } from "./callLog";
import { isApiError } from "./errors";
import { type Exchange, exchangesOf } from "./exchangeLog";

// One JSON with everything needed to investigate a failure away from the
// screen: what the panel was asked to do, every HTTP request it sent for it
// and what came back (status, headers, body, times), the error as the panel
// understood it, and where it happened. Built only when someone presses
// "Kopiuj szczegóły"; it goes to their clipboard and nowhere else.
//
// It can hold personal data (a user search, an account): share it like the
// screen it came from.

export const REPORT_FORMAT = "codziennie-fit-panel/issue@1";

/** Each body in a report is cut to this many characters. */
export const REPORT_BODY_LIMIT = 50_000;

export interface ReportContext {
	/** `Date.now()`. */
	now: number;
	page: string;
	environment: string;
	userAgent: string;
	/** The build's script name: tells which deploy the page was. */
	build: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A body as JSON when it is JSON, otherwise its text, cut to the limit. */
function body(text: string | null | undefined): unknown {
	if (text === null || text === undefined || text === "") return null;
	if (text.length <= REPORT_BODY_LIMIT) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return `${text.slice(0, REPORT_BODY_LIMIT)}… [ucięto: ${text.length} znaków]`;
}

function exchangeReport(entry: Exchange) {
	return {
		startedAt: iso(entry.startedAt),
		durationMs: entry.durationMs,
		request: {
			method: entry.request.method,
			url: entry.request.url,
			headers: entry.request.headers,
			body:
				typeof entry.request.body === "string"
					? body(entry.request.body)
					: entry.request.body,
		},
		response:
			entry.response === null
				? null
				: {
						status: entry.response.status,
						headers: entry.response.headers,
						body: body(entry.response.body),
					},
		...(entry.error !== null ? { error: entry.error } : {}),
	};
}

/** When a call ended, or now for one still running. */
const endOf = (call: CallEntry, now: number) =>
	call.durationMs === null ? now : call.at + call.durationMs;

function callReport(
	call: CallEntry,
	allCalls: readonly CallEntry[],
	exchanges: readonly Exchange[],
	now: number,
) {
	const end = endOf(call, now);
	const concurrent = allCalls
		.filter(
			(other) =>
				other.id !== call.id && other.at <= end && endOf(other, now) >= call.at,
		)
		.map((other) => other.name);
	return {
		name: call.name,
		startedAt: iso(call.at),
		durationMs: call.durationMs,
		state: call.state,
		/** The status the panel shows; the real ones are in `exchanges`. */
		status: call.status,
		...(call.kind ? { kind: call.kind } : {}),
		args: call.args,
		[call.state === "failed" ? "error" : "result"]: call.result ?? null,
		/** This call's requests, oldest first (see exchangesOf). */
		exchanges: exchangesOf(exchanges, call, end).map(exchangeReport),
		...(concurrent.length > 0
			? {
					/** Calls that ran at the same time: some exchanges may be theirs. */
					concurrentCalls: concurrent,
				}
			: {}),
	};
}

/** What a thrown value says about itself. */
export function errorReport(error: unknown) {
	if (isApiError(error)) {
		return {
			name: error.name,
			kind: error.kind,
			...(error.unexpected ? { unexpected: true } : {}),
			...(error.status !== undefined ? { status: error.status } : {}),
			message: error.message,
			...(error.details ? { details: error.details } : {}),
			...(error.issues.length > 0 ? { issues: error.issues } : {}),
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return { value: String(error) };
}

export function buildIssueReport(input: {
	/** The calls the report is about. */
	calls: readonly CallEntry[];
	/** Every call in the register, to name the ones that ran at the same time. */
	allCalls: readonly CallEntry[];
	exchanges: readonly Exchange[];
	/** What a screen caught, when the report comes from an error screen. */
	error?: unknown;
	context: ReportContext;
}) {
	const { context } = input;
	return {
		format: REPORT_FORMAT,
		copiedAt: iso(context.now),
		page: context.page,
		environment: context.environment,
		build: context.build,
		userAgent: context.userAgent,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		...(input.error !== undefined ? { error: errorReport(input.error) } : {}),
		calls: input.calls.map((call) =>
			callReport(call, input.allCalls, input.exchanges, context.now),
		),
	};
}

/** The context of the page this runs in. */
export function pageContext(environment: string): ReportContext {
	const script = document.querySelector<HTMLScriptElement>(
		'script[type="module"][src]',
	);
	return {
		now: Date.now(),
		page: window.location.href,
		environment,
		userAgent: navigator.userAgent,
		build: script ? new URL(script.src).pathname : null,
	};
}

/** The report as text for the clipboard. */
export function reportText(
	report: ReturnType<typeof buildIssueReport>,
): string {
	return JSON.stringify(report, null, 2);
}
