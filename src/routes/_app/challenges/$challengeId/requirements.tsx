import { createFileRoute } from "@tanstack/react-router";
import { ChallengeRequirements } from "@/features/challenges/ChallengeRequirements";
import { useChallenge } from "@/features/challenges/useChallenge";

export const Route = createFileRoute(
	"/_app/challenges/$challengeId/requirements",
)({
	component: RequirementsRoute,
});

function RequirementsRoute() {
	const challenge = useChallenge(Route.useParams().challengeId);
	return challenge ? <ChallengeRequirements challenge={challenge} /> : null;
}
