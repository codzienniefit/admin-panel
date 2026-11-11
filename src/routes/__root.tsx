import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { ConfirmHost } from "@/ui/confirm";
import { ErrorScreen } from "@/ui/ErrorScreen";
import { LoadingOverlay } from "@/ui/Loading";
import { ToastViewport } from "@/ui/toast";

export const Route = createRootRoute({
	component: Root,
	notFoundComponent: NotFound,
	errorComponent: ({ error, reset }) => (
		<ErrorScreen error={error} onRetry={reset} />
	),
});

function Root() {
	return (
		<>
			<Outlet />
			<LoadingOverlay />
			<ToastViewport />
			<ConfirmHost />
		</>
	);
}

function NotFound() {
	return (
		<div className="mx-auto max-w-md px-4 py-16 text-center">
			<h1 className="text-2xl font-semibold">Nie ma takiej strony</h1>
			<p className="mt-2 text-muted">
				Sprawdź adres albo wróć do listy wyzwań.
			</p>
			<Link
				to="/challenges"
				className="mt-6 inline-block rounded-control bg-primary px-5 py-2.5 text-white hover:bg-primary-hover"
			>
				Wyzwania
			</Link>
		</div>
	);
}
