import { readStored, writeStored } from "@/lib/storage";
import type { Tone } from "@/ui/tones";

// Which backend the panel talks to. Chosen in the top bar.
//
// "test" is the in-process sample data: everything can be tried there and
// nothing leaves the browser. "production" joins the list with the live
// slices in docs/ROADMAP.md; until then it is shown but cannot be picked.

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
		hint: "wkrótce",
		tone: "green",
		available: false,
	},
];

export const STORAGE_KEY = "cf.environment";
/** Where the panel starts, and where the automated UI tests always run. */
export const DEFAULT_ENVIRONMENT: Environment = "test";

function isAvailable(value: string | null): value is Environment {
	return ENVIRONMENTS.some((e) => e.value === value && e.available);
}

export function currentEnvironment(): Environment {
	const stored = readStored(STORAGE_KEY);
	return isAvailable(stored) ? stored : DEFAULT_ENVIRONMENT;
}

/**
 * Switches backend. The page reloads so that no data from one environment
 * can stay on screen, or be saved, in another.
 */
export function switchEnvironment(next: Environment): void {
	if (!isAvailable(next) || next === currentEnvironment()) return;
	if (writeStored(STORAGE_KEY, next)) window.location.reload();
}
