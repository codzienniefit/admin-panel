import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { contentStatusSchema } from "@/data/schemas/challenge";
import { ChallengesPage } from "@/features/challenges/ChallengesPage";

const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
	status: contentStatusSchema.optional().catch(undefined),
	kind: z
		.enum(["challenge", "main", "supplementary", "archived", "plan"])
		.optional()
		.catch(undefined),
	sort: z
		.enum(["updated", "added", "title", "premiere"])
		.optional()
		.catch(undefined),
	folder: z.string().optional().catch(undefined),
	view: z.enum(["cards", "table"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/challenges/")({
	validateSearch: (search) => searchSchema.parse(search),
	component: ChallengesRoute,
});

function ChallengesRoute() {
	const { view, ...filters } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<ChallengesPage
			filters={filters}
			view={view ?? "cards"}
			onChange={(patch) =>
				navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
			}
			onOpen={(challengeId) =>
				navigate({ to: "/challenges/$challengeId", params: { challengeId } })
			}
			onCreate={() => navigate({ to: "/challenges/new" })}
		/>
	);
}
