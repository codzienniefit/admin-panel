import { createFileRoute, redirect } from "@tanstack/react-router";

// The panel opens on the challenges list.
export const Route = createFileRoute("/_app/")({
	beforeLoad: () => {
		throw redirect({ to: "/challenges" });
	},
});
