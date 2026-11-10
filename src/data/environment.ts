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

const STORAGE_KEY = "cf.environment";

function isAvailable(value: string | null): value is Environment {
	return ENVIRONMENTS.some((e) => e.value === value && e.available);
}

export function currentEnvironment(): Environment {
	try {
		const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
		if (isAvailable(stored)) return stored;
	} catch {
		// Storage can be blocked; fall through to the default.
	}
	return "test";
}

/**
 * Switches backend. The page reloads so that no data from one environment
 * can stay on screen, or be saved, in another.
 */
export function switchEnvironment(next: Environment): void {
	if (!isAvailable(next) || next === currentEnvironment()) return;
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, next);
	} catch {
		return;
	}
	window.location.reload();
}
