import { createStore, type Store } from "@/lib/store";

// Every HTTP request the panel sent to /api and what came back: the wire-level
// half of the developer's register (callLog.ts holds the other half, one entry
// per panel call). It is what a copied issue report (issueReport.ts) carries.
//
// Memory only, like the call log: never stored, never sent anywhere, gone on
// reload. Answers can hold personal data (the user search).

export interface ExchangeRequest {
	method: string;
	/** As sent: the panel's own address, /api/… with the query. */
	url: string;
	headers: Record<string, string>;
	/** The JSON text sent, a description of a file, or null. */
	body: string | { file: string | null; type: string; size: number } | null;
}

export interface ExchangeResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface Exchange {
	id: number;
	/** `Date.now()` when the request left. */
	startedAt: number;
	/** Null while the request is running. */
	durationMs: number | null;
	request: ExchangeRequest;
	/** Null when there was no answer (yet, or at all). */
	response: ExchangeResponse | null;
	/** Why there was no answer: the browser's error. */
	error: string | null;
}

/** How many exchanges are kept; older ones fall off the end. */
export const EXCHANGE_LOG_LIMIT = 300;

/** Bodies longer than this are cut, so one big list cannot fill the memory. */
export const BODY_LIMIT = 200_000;

export const exchangeLog = createStore<readonly Exchange[]>([]);

export function clearExchangeLog(
	log: Store<readonly Exchange[]> = exchangeLog,
): void {
	log.set([]);
}

/** A body as kept in the log: the start of it, with a note when it was cut. */
export function keptBody(text: string): string {
	return text.length > BODY_LIMIT
		? `${text.slice(0, BODY_LIMIT)}… [ucięto: ${text.length} znaków]`
		: text;
}

/** Header values that are a key to something are never kept. */
const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie"]);

export function keptHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [
			name,
			SECRET_HEADERS.has(name.toLowerCase()) ? "[ukryte]" : value,
		]),
	);
}

/**
 * Starts an entry for a request that is leaving now. The returned function
 * finishes it with the answer, or with the reason there was none.
 */
export function recordExchange(
	request: ExchangeRequest,
	options: { log?: Store<readonly Exchange[]>; now?: () => number } = {},
): (outcome: { response: ExchangeResponse } | { error: string }) => void {
	const log = options.log ?? exchangeLog;
	const now = options.now ?? (() => Date.now());
	const startedAt = now();
	const id = nextId++;
	log.set((current) =>
		[
			{
				id,
				startedAt,
				durationMs: null,
				request: { ...request, headers: keptHeaders(request.headers) },
				response: null,
				error: null,
			},
			...current,
		].slice(0, EXCHANGE_LOG_LIMIT),
	);
	return (outcome) => {
		const durationMs = now() - startedAt;
		log.set((current) =>
			current.map((entry) =>
				entry.id !== id
					? entry
					: "response" in outcome
						? {
								...entry,
								durationMs,
								response: {
									status: outcome.response.status,
									headers: keptHeaders(outcome.response.headers),
									body: keptBody(outcome.response.body),
								},
							}
						: { ...entry, durationMs, error: outcome.error },
			),
		);
	};
}

let nextId = 1;

/**
 * The exchanges that started while a call ran, oldest first. JavaScript
 * cannot tell which call a request belongs to, so calls running at the same
 * time can add their own; the report names those calls.
 */
export function exchangesDuring(
	exchanges: readonly Exchange[],
	from: number,
	to: number,
): Exchange[] {
	return exchanges
		.filter((entry) => entry.startedAt >= from && entry.startedAt <= to)
		.sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
}
