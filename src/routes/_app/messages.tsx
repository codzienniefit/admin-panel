import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { messageStatusSchema } from "@/data/schemas/message";
import { MessagesPage } from "@/features/messages/MessagesPage";

// Filters live in the address, so a filtered list can be bookmarked or sent
// to someone. Anything unrecognised is dropped, not an error.
const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
	status: messageStatusSchema.optional().catch(undefined),
	group: z.string().optional().catch(undefined),
	sort: z.enum(["created", "sent", "title"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/messages")({
	validateSearch: (search) => searchSchema.parse(search),
	component: MessagesRoute,
});

function MessagesRoute() {
	const filters = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<>
			<MessagesPage
				filters={filters}
				onFiltersChange={(patch) =>
					navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
				}
				onOpen={(messageId) =>
					navigate({
						to: "/messages/$messageId",
						params: { messageId },
						search: (prev) => prev,
					})
				}
				onCreate={() =>
					navigate({ to: "/messages/new", search: (prev) => prev })
				}
			/>
			{/* The editor opens over the list, which stays mounted and scrolled. */}
			<Outlet />
		</>
	);
}
