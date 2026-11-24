// "Polecane dalej": what the app suggests after a challenge. The backend has a
// hard-coded default list for many plans (its src/config/planRecommendations.ts,
// sent to the panel as `defaultRecommendedNext`); a list saved for the
// challenge replaces it. The defaults are meant to go from the backend's code
// one day, so only a real change is stored: a list left exactly as the
// defaults (same challenges, same order) is saved empty, and the app goes on
// using the defaults.

const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((id, index) => id === b[index]);

/** The list the form starts with: the challenge's own, or the defaults while it has none. */
export function startingRecommendations(
	own: readonly string[],
	defaults: readonly string[],
): string[] {
	return [...(own.length > 0 ? own : defaults)];
}

/** True while the list is the defaults: nothing of the challenge's own is stored. */
export function isDefaultRecommendations(
	chosen: readonly string[],
	defaults: readonly string[],
): boolean {
	return defaults.length > 0 && same(chosen, defaults);
}

/** What to store for the challenge: nothing while the list is the defaults. */
export function storedRecommendations(
	chosen: readonly string[],
	defaults: readonly string[],
): string[] {
	return isDefaultRecommendations(chosen, defaults) ? [] : [...chosen];
}
