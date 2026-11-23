import { readStored, writeStored } from "@/lib/storage";
import type { Tone } from "@/ui/tones";

// Which backend the panel talks to. Chosen on the sign-in page and in the
// top bar.
//
// "test" is the in-process sample data: everything can be tried there and
// nothing leaves the browser. "production" is the real backend, behind a
// real sign-in. Picking it here protects nothing by itself: who may read and
// write is decided by the Worker's session and by the backend.

export type Environment = "test" | "production";

export interface EnvironmentInfo {
	value: Environment;
	label: string;
	hint: string;
	tone: Tone;
	available: boolean;
}

export const ENVIRONMENTS: readonly EnvironmentInfo[] = [
	{
		value: "test",
		label: "Test",
		hint: "dane przykładowe",
		tone: "amber",
		available: true,
	},
	{
		value: "production",
		label: "Produkcja",
		hint: "prawdziwe dane",
		tone: "green",
		available: true,
	},
];

export const STORAGE_KEY = "cf.environment";
/** Where the panel starts on this computer, and where the automated UI tests always run. */
export const DEFAULT_ENVIRONMENT: Environment = "test";

/**
 * True when the panel runs on this computer (`npm run dev`, the UI tests), false on its deployed
 * address. On the deployed panel nothing before sign-in shows the Test environment: the panel
 * starts in Produkcja, the sign-in page has no environment switch, and Test opens only after a
 * real sign-in (src/auth/testGate.ts).
 */
export function onThisComputer(): boolean {
	const host = globalThis.location?.hostname;
	if (host === undefined) return true;
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "[::1]" ||
		host === "::1" ||
		host.endsWith(".localhost")
	);
}

/** Where the panel starts: Test on this computer, Produkcja on its deployed address. */
export function defaultEnvironment(): Environment {
	return onThisComputer() ? DEFAULT_ENVIRONMENT : "production";
}

function isAvailable(value: string | null): value is Environment {
	return ENVIRONMENTS.some((e) => e.value === value && e.available);
}

export function currentEnvironment(): Environment {
	const stored = readStored(STORAGE_KEY);
	return isAvailable(stored) ? stored : defaultEnvironment();
}

/**
 * Switches backend. The page reloads so that no data from one environment
 * can stay on screen, or be saved, in another.
 */
export function switchEnvironment(next: Environment): void {
	if (!isAvailable(next) || next === currentEnvironment()) return;
	if (writeStored(STORAGE_KEY, next)) window.location.reload();
}
