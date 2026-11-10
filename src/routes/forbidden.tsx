import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { ForbiddenPage } from "@/features/auth/ForbiddenPage";

export const Route = createFileRoute("/forbidden")({
	beforeLoad: async () => {
		await auth.ready();
		const { status } = auth.session.get();
		if (status === "admin") throw redirect({ to: "/challenges" });
		if (status === "signedOut") {
			throw redirect({ to: "/login", search: { redirect: "/" } });
		}
	},
	component: ForbiddenPage,
});
