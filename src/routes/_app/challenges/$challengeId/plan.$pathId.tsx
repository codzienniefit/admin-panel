import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useChallenge } from "@/features/challenges/useChallenge";
import { PlannerPage } from "@/features/planner/PlannerPage";

const searchSchema = z.object({
	/** The week shown on a phone. */
	week: z.coerce.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute(
	"/_app/challenges/$challengeId/plan/$pathId",
)({
	validateSearch: (search) => searchSchema.parse(search),
	component: PlanRoute,
});

function PlanRoute() {
	const { challengeId, pathId } = Route.useParams();
	const { week } = Route.useSearch();
	const navigate = Route.useNavigate();
	const challenge = useChallenge(challengeId);
	if (!challenge) return null;
	return (
		<PlannerPage
			challenge={challenge}
			pathId={pathId}
			week={week ?? 1}
			onWeekChange={(next) =>
				navigate({ search: { week: next }, replace: true })
			}
			onOpenWorkout={(workoutId) =>
				navigate({ to: "/workouts/$workoutId", params: { workoutId } })
			}
			onOpenPlan={(nextChallengeId, nextPathId) =>
				navigate({
					to: "/challenges/$challengeId/plan/$pathId",
					params: { challengeId: nextChallengeId, pathId: nextPathId },
				})
			}
		/>
	);
}
