// When moving between addresses leaves the window where it is.
//
// The window stays put whenever the screen you were looking at is still on
// screen afterwards: an editor opening over its list (the list stays mounted
// under it), the editor closing back to that list, a filter or sort changing
// the list's address, a tab that is part of the address (a user's tabs).
// Only a move to another screen (a challenge's page from the list, a
// challenge's tab that is its own page, another section) starts at the top,
// as a new page would.

/**
 * `from` and `to` are the route ids matched for each address, outermost
 * first, as the router matches them.
 */
export function keepsScroll(
	from: readonly string[],
	to: readonly string[],
): boolean {
	const fromScreen = from.at(-1);
	const toScreen = to.at(-1);
	if (fromScreen === undefined || toScreen === undefined) return false;
	// opened over it, or the same screen with another address
	if (to.includes(fromScreen)) return true;
	// closed back to what was under it
	return from.includes(toScreen);
}
