import { STORAGE_KEY as DEMO_USER_KEY } from "../../src/auth/mock";
import {
	DEFAULT_ENVIRONMENT,
	STORAGE_KEY as ENVIRONMENT_KEY,
} from "../../src/data/environment";

// Where the UI tests run: the panel's TEST environment, and nowhere else.
//
// The Test environment is sample data inside the browser. Nothing here can
// point a test at a real backend: the only environment a test browser is
// ever started with is the one below, and e2e/support/test.ts refuses every
// request that would leave this machine.

if (DEFAULT_ENVIRONMENT !== "test") {
	throw new Error("UI tests run in the Test environment only.");
}

const PORT = 4317;
export const BASE_URL = `http://localhost:${PORT}`;

/** Serves the build that would be deployed, with its security headers. */
export const SERVER_COMMAND = `npm run build && npx vite preview --port ${PORT} --strictPort`;

const profile = (entries: Record<string, string>) => ({
	cookies: [],
	origins: [
		{
			origin: BASE_URL,
			localStorage: Object.entries(entries).map(([name, value]) => ({
				name,
				value,
			})),
		},
	],
});

/** A browser with the Test environment chosen and nobody signed in. */
export const SIGNED_OUT = profile({ [ENVIRONMENT_KEY]: DEFAULT_ENVIRONMENT });

/** The same, with the demo administrator signed in. Every test starts here. */
export const SIGNED_IN = profile({
	[ENVIRONMENT_KEY]: DEFAULT_ENVIRONMENT,
	[DEMO_USER_KEY]: "admin",
});
