import { auth } from "@/auth";
import { currentEnvironment } from "@/data/environment";
import { currentCall } from "./callContext";
import { withCallLog } from "./callLog";
import { capabilitiesFor } from "./capabilities";
import { recordExchange } from "./exchangeLog";
import { createHttpApi } from "./http";
import { createTransport } from "./http/transport";
import { createMockApi } from "./mock";
import type { ApiClient } from "./types";

/** Where the Worker forwards to the backend from (worker/proxy.ts). */
const API_BASE = "/api";

/**
 * The backend says the session is over (or the account lost access). The
 * page is loaded again at the sign-in page, so nothing that was read for
 * the previous session stays in memory.
 */
function sessionEnded(): void {
	const { pathname, search } = window.location;
	if (pathname === "/login") return;
	const target = new URLSearchParams({ redirect: `${pathname}${search}` });
	window.location.assign(`/login?${target.toString()}`);
}

// One ApiClient per environment (src/data/environment.ts): "test" is the
// in-process mock, "production" the real backend over HTTP.
function createApi(): ApiClient {
	const environment = currentEnvironment();
	if (environment === "test") return createMockApi();
	return createHttpApi({
		capabilities: capabilitiesFor(environment),
		transport: createTransport({
			baseUrl: API_BASE,
			getToken: (options) => auth.getToken(options),
			onUnauthorized: sessionEnded,
			record: (request, { callId }) => recordExchange(request, { callId }),
			currentCall,
		}),
	});
}

// Every call goes through the developer's register (callLog.ts), whichever
// backend is behind it.
export const api: ApiClient = withCallLog(createApi());
