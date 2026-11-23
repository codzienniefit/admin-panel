import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { OffersPage } from "@/features/offers/OffersPage";

// Filters live in the address, so a filtered list can be bookmarked or sent
// to someone. Anything unrecognised is dropped, not an error.
const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
	state: z
		.enum(["live", "scheduled", "draft", "ended"])
		.optional()
		.catch(undefined),
});

export const Route = createFileRoute("/_app/offers")({
	validateSearch: (search) => searchSchema.parse(search),
	component: OffersRoute,
});

function OffersRoute() {
	const filters = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<>
			<OffersPage
				filters={filters}
				onFiltersChange={(patch) =>
					navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
				}
				onOpen={(offerId) =>
					navigate({
						to: "/offers/$offerId",
						params: { offerId },
						search: (prev) => prev,
					})
				}
				onCreate={() => navigate({ to: "/offers/new", search: (prev) => prev })}
			/>
			{/* The editor opens over the list, which stays mounted and scrolled. */}
			<Outlet />
		</>
	);
}
