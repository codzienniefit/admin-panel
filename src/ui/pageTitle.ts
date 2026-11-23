import { useEffect } from "react";

/**
 * The tab's title. Before sign-in it is a neutral "Logowanie" (index.html, LoginPage): nothing in
 * the page says what is behind it until someone has signed in. Behind sign-in, the panel's name.
 */
export const SIGNED_OUT_TITLE = "Logowanie";
export const SIGNED_IN_TITLE = "Codziennie Fit · Panel";

/** Sets the tab's title while the calling screen is shown. */
export function usePageTitle(title: string): void {
	useEffect(() => {
		document.title = title;
	}, [title]);
}
