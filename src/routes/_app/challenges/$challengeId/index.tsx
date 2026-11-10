import { createFileRoute } from "@tanstack/react-router";
import { ChallengeOverview } from "@/features/challenges/ChallengeOverview";
import { useChallenge } from "@/features/challenges/useChallenge";

export const Route = createFileRoute("/_app/challenges/$challengeId/")({
	component: OverviewRoute,
});

function OverviewRoute() {
	const challenge = useChallenge(Route.useParams().challengeId);
	return challenge ? <ChallengeOverview challenge={challenge} /> : null;
}
