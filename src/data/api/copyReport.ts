import { currentEnvironment } from "@/data/environment";
import { copyText } from "@/lib/clipboard";
import { type CallEntry, callLog } from "./callLog";
import { exchangeLog } from "./exchangeLog";
import { buildIssueReport, pageContext, reportText } from "./issueReport";

/** How many recent failed calls an error screen's report carries. */
const RECENT_FAILURES = 10;

/**
 * Puts the issue report for these calls (and the error a screen caught) on
 * the clipboard. False when the browser refuses.
 */
export function copyIssueReport(input: {
	calls: readonly CallEntry[];
	error?: unknown;
}): Promise<boolean> {
	const report = buildIssueReport({
		calls: input.calls,
		allCalls: callLog.get().entries,
		exchanges: exchangeLog.get(),
		error: input.error,
		context: pageContext(currentEnvironment()),
	});
	return copyText(reportText(report));
}

/** The latest failed calls, oldest first: what an error screen reports. */
export function recentFailures(): CallEntry[] {
	return callLog
		.get()
		.entries.filter((entry) => entry.state === "failed")
		.slice(0, RECENT_FAILURES)
		.reverse();
}
