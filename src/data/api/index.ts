import { currentEnvironment } from "@/data/environment";
import { withCallLog } from "./callLog";
import { createMockApi } from "./mock";
import type { ApiClient } from "./types";

// One ApiClient per environment (src/data/environment.ts). Only "test", the
// in-process mock, exists so far.
function createApi(): ApiClient {
	const environment = currentEnvironment();
	if (environment === "test") return createMockApi();
	throw new Error(`Środowisko "${environment}" nie jest jeszcze dostępne.`);
}

// Every call goes through the developer's register (callLog.ts), whichever
// backend is behind it.
export const api: ApiClient = withCallLog(createApi());
