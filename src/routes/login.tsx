import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { sanitizeRedirect } from "@/auth/redirect";
import { LoginPage } from "@/features/auth/LoginPage";

export const Route = createFileRoute("/login")({
	validateSearch: (
		search: Record<string, unknown>,
	): { redirect: string; error?: string } => ({
		redirect: sanitizeRedirect(search.redirect),
		// A short code the Worker sends back with; never shown as it is.
		...(typeof search.error === "string" &&
		/^[A-Za-z]{1,32}$/.test(search.error)
			? { error: search.error }
			: {}),
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
	const { redirect: target, error } = Route.useSearch();
	return <LoginPage redirect={target} problem={error} />;
}
