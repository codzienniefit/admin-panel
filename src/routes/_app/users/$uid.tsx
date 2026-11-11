import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { UserPage } from "@/features/users/UserPage";

// The open tab is part of the address; an unknown one falls back to badges.
const searchSchema = z.object({
	tab: z.enum(["badges", "progress", "account"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/users/$uid")({
	validateSearch: (search) => searchSchema.parse(search),
	component: UserRoute,
});

function UserRoute() {
	const { uid } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<UserPage
			// A different person starts from clean forms.
			key={uid}
			uid={uid}
			tab={tab ?? "badges"}
			onTabChange={(next) =>
				navigate({
					search: (prev) => ({
						...prev,
						tab: next === "badges" ? undefined : next,
					}),
					replace: true,
				})
			}
			onBack={() =>
				navigate({ to: "/users", search: (prev) => ({ q: prev.q }) })
			}
		/>
	);
}
