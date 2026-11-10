import { createFileRoute } from "@tanstack/react-router";
import { SpikePage } from "@/features/spike/SpikePage";

// The plan of one variant. Until the planner of Phase 5 replaces it, this is
// the Phase 0 test editor: enough to put workouts into days.
export const Route = createFileRoute(
	"/_app/challenges/$challengeId/plan/$pathId",
)({
	component: PlanRoute,
});

function PlanRoute() {
	const { challengeId, pathId } = Route.useParams();
	return (
		<SpikePage
			key={`${challengeId}:${pathId}`}
			challengeId={challengeId}
			initialPathId={pathId}
			embedded
		/>
	);
}
