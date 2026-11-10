import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { sanitizeRedirect } from "@/auth/redirect";
import { LoginPage } from "@/features/auth/LoginPage";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: sanitizeRedirect(search.redirect),
	}),
	beforeLoad: async () => {
		await auth.ready();
		const { status } = auth.session.get();
		if (status === "admin") throw redirect({ to: "/challenges" });
		if (status === "forbidden") throw redirect({ to: "/forbidden" });
	},
	component: LoginRoute,
});

function LoginRoute() {
	const { redirect: target } = Route.useSearch();
	return <LoginPage redirect={target} />;
}
