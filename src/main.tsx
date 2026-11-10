import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import { ErrorScreen } from "./ui/ErrorScreen";
import "./styles/app.css";

const router = createRouter({
	routeTree,
	// Hovering or touching a link loads its route before the click lands.
	defaultPreload: "intent",
	// No screen ever shows a raw error: every route falls back to this.
	defaultErrorComponent: ({ error, reset }) => (
		<ErrorScreen error={error} onRetry={reset} />
	),
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
