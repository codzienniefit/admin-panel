import type { ApiClient } from "@/data/api/types";
import type { MockKernel } from "./kernel";

// Clearing the app's CDN cache, in the Test environment. There is no CDN
// here, so nothing is purged: the answer says so (`simulated`) and the
// screen tells the person. A forced failure ("Dane testowe…") applies, so
// the refusal can be tried too.

export function cacheApi(kernel: MockKernel): ApiClient["cache"] {
	const { latency, takeFailure, now } = kernel;
	return {
		async purge() {
			await latency();
			takeFailure();
			return { purgedAtUtc: now(), simulated: true };
		},
	};
}
