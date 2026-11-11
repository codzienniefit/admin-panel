import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { plannerSettingsCollection } from "@/data/collections/settings";
import { loadConfig } from "@/data/config";
import { PLANNER_SETTINGS_ID } from "@/data/schemas/settings";
import { Shell } from "@/features/shell/Shell";
import { applyConfigLabels, applyTypeStyles } from "@/ui/enums";
import { Loading } from "@/ui/Loading";

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
		const [config] = await Promise.all([
			loadConfig(),
			plannerSettingsCollection.preload(),
		]);
		applyConfigLabels(config.workouts);
		applyTypeStyles(
			plannerSettingsCollection.get(PLANNER_SETTINGS_ID)?.trainingTypeStyles ??
				{},
		);
		return config;
	},
	pendingComponent: Loading,
	pendingMs: 150,
	pendingMinMs: 300,
	component: Shell,
});
