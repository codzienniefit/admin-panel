import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { contentStatusSchema } from "@/data/schemas/challenge";
import { WorkoutsPage } from "@/features/workouts/WorkoutsPage";

// Filters live in the address, so a filtered list can be bookmarked or sent
// to someone. Anything unrecognised is dropped, not an error.
const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
	status: contentStatusSchema.optional().catch(undefined),
	type: z.string().optional().catch(undefined),
	level: z.string().optional().catch(undefined),
	sort: z.enum(["added", "updated", "title"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/workouts")({
	validateSearch: (search) => searchSchema.parse(search),
	component: WorkoutsRoute,
});

function WorkoutsRoute() {
	const filters = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<>
			<WorkoutsPage
				filters={filters}
				onFiltersChange={(patch) =>
					navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
				}
				onOpen={(workoutId) =>
					navigate({
						to: "/workouts/$workoutId",
						params: { workoutId },
						search: (prev) => prev,
					})
				}
				onCreate={() =>
					navigate({ to: "/workouts/new", search: (prev) => prev })
				}
			/>
			{/* The editor opens over the list, which stays mounted and scrolled. */}
			<Outlet />
		</>
	);
}
