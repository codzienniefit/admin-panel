import { createFileRoute } from "@tanstack/react-router";
import { ChallengeLayout } from "@/features/challenges/ChallengeLayout";

export const Route = createFileRoute("/_app/challenges/$challengeId")({
	component: ChallengeRoute,
});

function ChallengeRoute() {
	const { challengeId } = Route.useParams();
	return <ChallengeLayout challengeId={challengeId} />;
}
