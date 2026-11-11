import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/features/users/UsersPage";

export const Route = createFileRoute("/_app/users/")({
	component: UsersRoute,
});

function UsersRoute() {
	const { q } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<UsersPage
			query={q ?? ""}
			onSearch={(query) => navigate({ search: { q: query || undefined } })}
			onOpen={(uid) =>
				navigate({
					to: "/users/$uid",
					params: { uid },
					search: (prev) => ({ q: prev.q }),
				})
			}
		/>
	);
}
