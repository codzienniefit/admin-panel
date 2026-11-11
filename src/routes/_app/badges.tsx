import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { BadgesPage } from "@/features/badges/BadgesPage";

// Filters live in the address, so a filtered list can be bookmarked or sent
// to someone. Anything unrecognised is dropped, not an error.
const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
	type: z.string().optional().catch(undefined),
	section: z.string().optional().catch(undefined),
	visibility: z.enum(["visible", "hidden"]).optional().catch(undefined),
	sort: z.enum(["name", "updated"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/badges")({
	validateSearch: (search) => searchSchema.parse(search),
	component: BadgesRoute,
});

function BadgesRoute() {
	const filters = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<>
			<BadgesPage
				filters={filters}
				onFiltersChange={(patch) =>
					navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
				}
				onOpen={(badgeId) =>
					navigate({
						to: "/badges/$badgeId",
						params: { badgeId },
						search: (prev) => prev,
					})
				}
				onCreate={() => navigate({ to: "/badges/new", search: (prev) => prev })}
			/>
			{/* The editor opens over the list, which stays mounted and scrolled. */}
			<Outlet />
		</>
	);
}
