import { createFileRoute } from "@tanstack/react-router";
import { BadgeEditor } from "@/features/badges/BadgeEditor";

export const Route = createFileRoute("/_app/badges/new")({
	component: NewBadgeRoute,
});

function NewBadgeRoute() {
	const navigate = Route.useNavigate();
	return (
		<BadgeEditor
			badgeId={null}
			onClose={() => navigate({ to: "/badges", search: (prev) => prev })}
			onOpen={(badgeId) =>
				navigate({
					to: "/badges/$badgeId",
					params: { badgeId },
					search: (prev) => prev,
					replace: true,
				})
			}
		/>
	);
}
