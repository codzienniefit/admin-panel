import { describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";
import type { CallEntry } from "./callLog";
import { ApiError } from "./errors";
import {
	BODY_LIMIT,
	type Exchange,
	exchangesDuring,
	exchangesOf,
	keptBody,
	recordExchange,
	shownUrl,
} from "./exchangeLog";
import {
	buildIssueReport,
	errorReport,
	REPORT_BODY_LIMIT,
	REPORT_FORMAT,
	type ReportContext,
	reportText,
} from "./issueReport";

const T0 = Date.parse("2026-11-24T12:00:00.000Z");

function clock(start = T0) {
	let at = start;
	return {
		now: () => at,
		advance: (ms: number) => {
			at += ms;
		},
	};
}

const context: ReportContext = {
	now: T0 + 10_000,
	page: "https://panel.codzienniefitapp.com/workouts",
	environment: "production",
	userAgent: "test-agent",
	build: "/assets/index-abc.js",
};

function call(patch: Partial<CallEntry>): CallEntry {
	return {
		id: 1,
		at: T0,
		name: "workouts.list",
		args: [],
		state: "failed",
		status: null,
		kind: "unexpected",
		durationMs: 438,
		result: {
			kind: "server",
			unexpected: true,
			message: "Backend odpowiedział…",
		},
		...patch,
	};
}

function exchange(patch: Partial<Exchange>): Exchange {
	return {
		id: 1,
		callId: null,
		startedAt: T0 + 5,
		durationMs: 420,
		request: {
			method: "GET",
			url: "/api/manageWorkouts",
			headers: { accept: "application/json", "x-cf-panel": "1" },
			body: null,
		},
		response: {
			status: 200,
			headers: { "content-type": "application/json", "cf-ray": "abc-WAW" },
			body: JSON.stringify([
				{ id: "5fauJdypS9Y", descriptionFancyContent: [{}] },
			]),
		},
		error: null,
		...patch,
	};
}

describe("the exchange log", () => {
	it("records a request when it leaves and its answer when it comes", () => {
		const log = createStore<readonly Exchange[]>([]);
		const time = clock();
		const finish = recordExchange(
			{
				method: "POST",
				url: "/api/manageWorkouts",
				headers: { "content-type": "application/json" },
				body: '{"title":"x"}',
			},
			{ log, now: time.now },
		);
		expect(log.get()).toHaveLength(1);
		expect(log.get()[0]).toMatchObject({
			durationMs: null,
			response: null,
			error: null,
		});
		time.advance(120);
		finish({ response: { status: 422, headers: { "x-a": "1" }, body: "{}" } });
		expect(log.get()[0]).toMatchObject({
			startedAt: T0,
			durationMs: 120,
			response: { status: 422, headers: { "x-a": "1" }, body: "{}" },
		});
	});

	it("records why there was no answer", () => {
		const log = createStore<readonly Exchange[]>([]);
		const time = clock();
		const finish = recordExchange(
			{ method: "GET", url: "/api/x", headers: {}, body: null },
			{ log, now: time.now },
		);
		time.advance(30_000);
		finish({ error: "TimeoutError: signal timed out" });
		expect(log.get()[0]).toMatchObject({
			durationMs: 30_000,
			response: null,
			error: "TimeoutError: signal timed out",
		});
	});

	it("never keeps a key: authorization and cookies are hidden both ways", () => {
		const log = createStore<readonly Exchange[]>([]);
		recordExchange(
			{
				method: "GET",
				url: "/api/x",
				headers: { Authorization: "Bearer secret", accept: "application/json" },
				body: null,
			},
			{ log },
		)({
			response: { status: 200, headers: { "set-cookie": "a=b" }, body: "" },
		});
		const [entry] = log.get();
		expect(entry?.request.headers).toEqual({
			Authorization: "[ukryte]",
			accept: "application/json",
		});
		expect(entry?.response?.headers).toEqual({ "set-cookie": "[ukryte]" });
		expect(JSON.stringify(entry)).not.toContain("secret");
	});

	it("cuts a body that is too long, and says so", () => {
		const text = "x".repeat(BODY_LIMIT + 10);
		expect(keptBody(text)).toHaveLength(
			BODY_LIMIT + `… [ucięto: ${text.length} znaków]`.length,
		);
		expect(keptBody("krótko")).toBe("krótko");
	});

	it("finds the exchanges that started while a call ran, oldest first", () => {
		const all = [
			exchange({ id: 3, startedAt: T0 + 500 }),
			exchange({ id: 2, startedAt: T0 + 10 }),
			exchange({ id: 1, startedAt: T0 - 1 }),
		];
		expect(exchangesDuring(all, T0, T0 + 438).map((e) => e.id)).toEqual([2]);
	});

	it("gives a call its own exchanges, and never another call's", () => {
		const all = [
			// sent in this call's name, even after it ended by the clock
			exchange({ id: 1, callId: 1, startedAt: T0 + 900 }),
			// another call's, though it started while this one ran
			exchange({ id: 2, callId: 2, startedAt: T0 + 10 }),
			// no one's name, while this call ran: a later request of its own
			exchange({ id: 3, callId: null, startedAt: T0 + 300 }),
			// no one's name, after this call ended
			exchange({ id: 4, callId: null, startedAt: T0 + 600 }),
		];
		expect(
			exchangesOf(all, { id: 1, at: T0 }, T0 + 438).map((e) => e.id),
		).toEqual([3, 1]);
	});

	it("shows an address without the origin and with the query readable", () => {
		expect(shownUrl("/api/files?path=workouts%2Fa%20b.webp")).toBe(
			"/api/files?path=workouts/a b.webp",
		);
		expect(shownUrl("https://panel.example/api/panel/manageWorkouts/W89")).toBe(
			"/api/panel/manageWorkouts/W89",
		);
		expect(shownUrl("/api/x?q=100%")).toBe("/api/x?q=100%");
	});
});

describe("the issue report", () => {
	it("carries the call, every exchange with real status and times, and where it happened", () => {
		const report = buildIssueReport({
			calls: [call({})],
			allCalls: [call({})],
			exchanges: [exchange({})],
			context,
		});
		expect(report).toMatchObject({
			format: REPORT_FORMAT,
			copiedAt: "2026-11-24T12:00:10.000Z",
			page: context.page,
			environment: "production",
			build: "/assets/index-abc.js",
			userAgent: "test-agent",
			calls: [
				{
					name: "workouts.list",
					startedAt: "2026-11-24T12:00:00.000Z",
					durationMs: 438,
					state: "failed",
					kind: "unexpected",
					error: { unexpected: true },
					exchanges: [
						{
							startedAt: "2026-11-24T12:00:00.005Z",
							durationMs: 420,
							request: { method: "GET", url: "/api/manageWorkouts" },
							response: {
								status: 200,
								headers: { "cf-ray": "abc-WAW" },
								// JSON bodies come as JSON, not as a string
								body: [{ id: "5fauJdypS9Y", descriptionFancyContent: [{}] }],
							},
						},
					],
				},
			],
		});
		expect(report.calls[0]).not.toHaveProperty("concurrentCalls");
		expect(JSON.parse(reportText(report))).toEqual(report);
	});

	it("names the calls that ran at the same time, since some exchanges may be theirs", () => {
		const mine = call({ id: 1 });
		const parallel = call({
			id: 2,
			name: "badges.list",
			at: T0 + 100,
			durationMs: 50,
		});
		const before = call({
			id: 3,
			name: "config.get",
			at: T0 - 1000,
			durationMs: 10,
		});
		const report = buildIssueReport({
			calls: [mine],
			allCalls: [mine, parallel, before],
			exchanges: [],
			context,
		});
		expect(report.calls[0]?.concurrentCalls).toEqual(["badges.list"]);
	});

	it("keeps a text body as text and cuts a long one", () => {
		const long = "y".repeat(REPORT_BODY_LIMIT + 1);
		const report = buildIssueReport({
			calls: [call({})],
			allCalls: [],
			exchanges: [
				exchange({
					id: 1,
					response: {
						status: 502,
						headers: {},
						body: "<html>Bad gateway</html>",
					},
				}),
				exchange({
					id: 2,
					startedAt: T0 + 6,
					response: { status: 200, headers: {}, body: long },
				}),
			],
			context,
		});
		const [first, second] = report.calls[0]?.exchanges ?? [];
		expect(first?.response?.body).toBe("<html>Bad gateway</html>");
		expect(String(second?.response?.body)).toMatch(
			/… \[ucięto: 50001 znaków\]$/,
		);
	});

	it("an exchange with no answer carries the browser's reason", () => {
		const report = buildIssueReport({
			calls: [call({})],
			allCalls: [],
			exchanges: [
				exchange({ response: null, error: "TypeError: Failed to fetch" }),
			],
			context,
		});
		expect(report.calls[0]?.exchanges[0]).toMatchObject({
			response: null,
			error: "TypeError: Failed to fetch",
		});
	});

	it("carries what an error screen caught", () => {
		const error = new ApiError(
			"server",
			"Backend odpowiedział w nieoczekiwany sposób.",
			{
				issues: [
					{
						path: "descriptionFancyContent.3.type",
						message: "expected string",
					},
				],
				unexpected: true,
			},
		);
		const report = buildIssueReport({
			calls: [],
			allCalls: [],
			exchanges: [],
			error,
			context,
		});
		expect(report.error).toMatchObject({
			name: "ApiError",
			kind: "server",
			unexpected: true,
			issues: [{ path: "descriptionFancyContent.3.type" }],
		});
		expect(errorReport("napis")).toEqual({ value: "napis" });
		expect(errorReport(new TypeError("x"))).toMatchObject({
			name: "TypeError",
			message: "x",
		});
	});
});
