import {
	createRouter,
	type ParsedLocation,
	RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { keepsScroll } from "./domain/scrollKeeping";
import { routeTree } from "./routeTree.gen";
import { ErrorScreen } from "./ui/ErrorScreen";
import "./styles/app.css";

// Decided as each move starts, from where it comes and where it goes; read
// when the new screen is drawn. The router itself would scroll to the top on
// every move, an editor opening over a list included.
let keepScroll = false;

const router = createRouter({
	routeTree,
	// Back and forward return to where each screen was; a move that keeps the
	// screen you were on leaves the window alone (see keepsScroll).
	scrollRestoration: () => !keepScroll,
	// Hovering or touching a link loads its route before the click lands.
	defaultPreload: "intent",
	// No screen ever shows a raw error: every route falls back to this.
	defaultErrorComponent: ({ error, reset }) => (
		<ErrorScreen error={error} onRetry={reset} />
	),
});

const screensOf = (location: ParsedLocation): string[] =>
	router.matchRoutes(location).map((match) => match.routeId);

router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
	keepScroll =
		fromLocation !== undefined &&
		keepsScroll(screensOf(fromLocation), screensOf(toLocation));
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
