import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { loadConfig } from "@/data/config";
import { Shell, ShellSkeleton } from "@/features/shell/Shell";
import { applyConfigLabels } from "@/ui/enums";

// Everything under src/routes/_app/ is behind sign-in. The guard runs before
// any of those routes loads data or renders.
//
// This only decides what the panel shows. The backend checks the admin claim
// on every request by itself.
export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ location }) => {
		await auth.ready();
		const { status } = auth.session.get();
		if (status === "signedOut") {
			// Remember where the person was heading, to return there after login.
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		if (status !== "admin") throw redirect({ to: "/forbidden" });
	},
	loader: async () => {
		const config = await loadConfig();
		applyConfigLabels(config.workouts);
		return config;
	},
	pendingComponent: ShellSkeleton,
	pendingMs: 150,
	pendingMinMs: 300,
	component: Shell,
});
