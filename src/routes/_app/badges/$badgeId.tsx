import { createFileRoute } from "@tanstack/react-router";
import { BadgeEditor } from "@/features/badges/BadgeEditor";

export const Route = createFileRoute("/_app/badges/$badgeId")({
	component: BadgeRoute,
});

function BadgeRoute() {
	const { badgeId } = Route.useParams();
	const navigate = Route.useNavigate();
	return (
		<BadgeEditor
			badgeId={badgeId}
			onClose={() => navigate({ to: "/badges", search: (prev) => prev })}
			onOpen={(id) =>
				navigate({
					to: "/badges/$badgeId",
					params: { badgeId: id },
					search: (prev) => prev,
				})
			}
		/>
	);
}
