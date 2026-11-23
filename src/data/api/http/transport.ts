import type { z } from "zod";
import type { ApiIssue } from "@/data/api/errors";
import { ApiError, isApiError } from "@/data/api/errors";
import { failureFrom, networkFailure, unexpectedAnswer } from "./failures";

// The one place the panel makes HTTP requests to the backend.
//
// Every request goes to the panel's own origin, under /api; the Worker
// forwards it (worker/index.ts). So there is no CORS, no backend address in
// the browser bundle, and the Content-Security-Policy stays `connect-src
// 'self'`.
//
// Who is asking is known to the Worker from the session cookie; the browser
// holds no token (docs/SECURITY.md). `getToken` exists for a sign-in system
// that does hand the page a token; when it returns one it is sent, and
// refreshed once after a 401.
//
// What this adds to a bare request: a time limit, a JSON body both ways, the
// answer checked against a schema, and every failure turned into an ApiError.

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined;

/** What is put on the wire. */
export interface WireRequest {
	method: Method;
	url: string;
	headers: Record<string, string>;
	body?: string | Blob;
	timeoutMs: number;
	/** Called with a fraction from 0 to 1 while the body is being sent. */
	onProgress?: (fraction: number) => void;
}

/** What came back, before anyone looked at what it means. */
export interface WireAnswer {
	status: number;
	text: string;
	/** The `ETag` response header. */
	etag: string | null;
}

/** Performs one request. Rejects only when there was no answer at all. */
export type Sender = (request: WireRequest) => Promise<WireAnswer>;

export interface RequestOptions<T> {
	method?: Method;
	/**
	 * Path segments after the base, e.g. ["manageChallenges", id]. Each one is
	 * encoded, so an id can never change which endpoint is called.
	 */
	path: readonly string[];
	query?: Record<string, QueryValue>;
	/** Sent as JSON. */
	body?: unknown;
	/** Sent as it is, with its own content type (an upload). */
	file?: Blob;
	headers?: Record<string, string>;
	/**
	 * What the answer has to look like. Without one the parsed body is
	 * returned unchecked, as `unknown`.
	 */
	schema?: z.ZodType<T>;
	/** Names the answer in the message when it does not fit the schema. */
	what?: string;
	timeoutMs?: number;
	onProgress?: (fraction: number) => void;
}

export interface Answer<T> {
	data: T;
	status: number;
	/** The `ETag` header of the answer, when the backend sent one. */
	etag: string | null;
}

export interface Transport {
	/** The answer's body. */
	request<T = unknown>(options: RequestOptions<T>): Promise<T>;
	/** The answer's body together with its status and ETag. */
	send<T = unknown>(options: RequestOptions<T>): Promise<Answer<T>>;
	/** The address of a path, for links the browser loads itself (images). */
	url(path: readonly string[], query?: Record<string, QueryValue>): string;
}

export interface TransportOptions {
	/** Where the API lives, e.g. "/api". */
	baseUrl: string;
	/** The token to send, or null when nobody is signed in. */
	getToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
	/** Called when the backend refuses even a freshly fetched token. */
	onUnauthorized?: () => void;
	send?: Sender;
	/** Used when a request reports progress; fetch cannot. */
	upload?: Sender;
}

/** Marks a request as made by the panel's own code. */
export const PANEL_HEADER = "x-cf-panel";

export const DEFAULT_TIMEOUT_MS = 30_000;
/** The upload goes through a Function that also re-packs video. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export function buildUrl(
	baseUrl: string,
	path: readonly string[],
	query: Record<string, QueryValue> = {},
): string {
	const base = baseUrl.replace(/\/+$/, "");
	const segments = path.map((segment) => {
		// Encoding cannot protect these three: a browser resolves "." and ".."
		// away even when they are written as %2e, and an empty segment is no
		// segment at all. Each would call another endpoint than the one meant.
		if (segment === "" || segment === "." || segment === "..") {
			throw new ApiError(
				"notFound",
				"Nieprawidłowy identyfikator: nie da się o niego zapytać backendu.",
			);
		}
		return encodeURIComponent(segment);
	});
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === null || value === undefined) continue;
		params.set(key, String(value));
	}
	const search = params.toString();
	return `${base}/${segments.join("/")}${search ? `?${search}` : ""}`;
}

/** The body as JSON, or undefined when it is empty or not JSON. */
export function parseBody(text: string): unknown {
	if (text.trim() === "") return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function schemaProblems(error: z.ZodError): ApiIssue[] {
	return error.issues.slice(0, 20).map((issue) => ({
		path: issue.path.join("."),
		message: issue.message,
	}));
}

export const fetchSender: Sender = async (request) => {
	const response = await fetch(request.url, {
		method: request.method,
		headers: request.headers,
		body: request.body,
		signal: AbortSignal.timeout(request.timeoutMs),
		// The session cookie goes to the panel's own address and nowhere else.
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
	});
	return {
		status: response.status,
		text: await response.text(),
		etag: response.headers.get("etag"),
	};
};

/** fetch cannot report how much of a body has been sent; XMLHttpRequest can. */
export const xhrSender: Sender = (request) =>
	new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(request.method, request.url);
		xhr.timeout = request.timeoutMs;
		xhr.withCredentials = false;
		for (const [name, value] of Object.entries(request.headers)) {
			xhr.setRequestHeader(name, value);
		}
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) {
				request.onProgress?.(Math.min(1, event.loaded / event.total));
			}
		};
		xhr.onload = () =>
			resolve({
				status: xhr.status,
				text: xhr.responseText,
				etag: xhr.getResponseHeader("etag"),
			});
		xhr.onerror = () => reject(new TypeError("Network request failed"));
		xhr.ontimeout = () =>
			reject(Object.assign(new Error("Timed out"), { name: "TimeoutError" }));
		xhr.onabort = () =>
			reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
		xhr.send(request.body ?? null);
	});

export function createTransport(options: TransportOptions): Transport {
	const send = options.send ?? fetchSender;
	const upload = options.upload ?? xhrSender;

	async function exchange<T>(
		request: RequestOptions<T>,
		token: string | null,
	): Promise<WireAnswer> {
		const headers: Record<string, string> = {
			accept: "application/json",
			// A form on another site cannot set a header; the Worker refuses
			// any request to /api without this one (see worker/guard.ts).
			[PANEL_HEADER]: "1",
			...request.headers,
		};
		if (token) headers.authorization = `Bearer ${token}`;
		let body: string | Blob | undefined;
		if (request.file) {
			body = request.file;
			headers["content-type"] = request.file.type || "application/octet-stream";
		} else if (request.body !== undefined) {
			body = JSON.stringify(request.body);
			headers["content-type"] = "application/json";
		}
		const wire: WireRequest = {
			method: request.method ?? "GET",
			url: buildUrl(options.baseUrl, request.path, request.query),
			headers,
			body,
			timeoutMs:
				request.timeoutMs ??
				(request.file ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
			onProgress: request.onProgress,
		};
		try {
			return await (request.onProgress ? upload : send)(wire);
		} catch (cause) {
			throw isApiError(cause) ? cause : networkFailure(cause);
		}
	}

	async function sendChecked<T>(
		request: RequestOptions<T>,
	): Promise<Answer<T>> {
		let token = await options.getToken();
		let answer = await exchange(request, token);

		// A token is good for an hour and a tab can stay open for a day: ask
		// for a fresh one once before deciding the person is signed out.
		if (answer.status === 401 && token) {
			token = await options.getToken({ forceRefresh: true });
			if (token) answer = await exchange(request, token);
		}
		if (answer.status === 401) options.onUnauthorized?.();

		const body = parseBody(answer.text);
		if (answer.status < 200 || answer.status >= 300) {
			throw failureFrom(answer.status, body, answer.text);
		}

		const what = request.what ?? request.path.join("/");
		// A success that is not JSON is not the backend talking (a web page
		// from something in between, most likely). Never taken for "saved".
		if (body === undefined && answer.text.trim() !== "") {
			throw unexpectedAnswer(`${what}: to nie jest JSON.`, [], answer.status);
		}
		if (!request.schema) {
			return { data: body as T, status: answer.status, etag: answer.etag };
		}
		const parsed = request.schema.safeParse(body);
		if (!parsed.success) {
			throw unexpectedAnswer(
				`${what}: dane nie pasują do oczekiwanych.`,
				schemaProblems(parsed.error),
				answer.status,
			);
		}
		return { data: parsed.data, status: answer.status, etag: answer.etag };
	}

	return {
		send: sendChecked,
		request: async (request) => (await sendChecked(request)).data,
		url: (path, query) => buildUrl(options.baseUrl, path, query),
	};
}
