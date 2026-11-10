import { createFileRoute } from "@tanstack/react-router";
import { ChallengeContentForm } from "@/features/challenges/ChallengeContentForm";
import { useChallenge } from "@/features/challenges/useChallenge";

export const Route = createFileRoute("/_app/challenges/$challengeId/content")({
	component: ContentRoute,
});

function ContentRoute() {
	const challenge = useChallenge(Route.useParams().challengeId);
	// A different challenge is a different form.
	return challenge ? (
		<ChallengeContentForm key={challenge.id} challenge={challenge} />
	) : null;
}
