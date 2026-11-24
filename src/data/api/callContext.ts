// Which panel call a request belongs to, for the developer's register.
//
// JavaScript in the browser has no way to follow an async call, so the call
// is noted only while it starts: the register (callLog.ts) runs the client's
// method inside `runInCall`, and the transport reads `currentCall` at once,
// before its first await. That covers every call whose first request starts
// straight away, which is nearly all of them. A request sent later in a call
// that makes several, after waiting for an earlier answer, is left unnamed
// and matched by time instead (exchangeLog.ts, exchangesOf).

let current: number | null = null;

/** Runs `start` with `callId` as the current call, and puts back the one before. */
export function runInCall<T>(callId: number, start: () => T): T {
	const before = current;
	current = callId;
	try {
		return start();
	} finally {
		current = before;
	}
}

/** The call starting right now, if any. */
export const currentCall = (): number | null => current;
