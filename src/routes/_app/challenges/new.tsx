import { createFileRoute } from "@tanstack/react-router";
import { NewChallengePage } from "@/features/challenges/NewChallengePage";

export const Route = createFileRoute("/_app/challenges/new")({
	component: NewChallengeRoute,
});

function NewChallengeRoute() {
	const navigate = Route.useNavigate();
	return (
		<NewChallengePage
			onCreated={(challengeId) =>
				navigate({
					to: "/challenges/$challengeId/content",
					params: { challengeId },
				})
			}
		/>
	);
}
