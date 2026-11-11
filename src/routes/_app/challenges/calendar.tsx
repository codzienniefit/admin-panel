import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CalendarPage } from "@/features/calendar/CalendarPage";

const searchSchema = z.object({
	view: z.enum(["month", "year"]).optional().catch(undefined),
	y: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
	/** 1 for January, as people write it. */
	m: z.coerce.number().int().min(1).max(12).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/challenges/calendar")({
	validateSearch: (search) => searchSchema.parse(search),
	component: CalendarRoute,
});

function CalendarRoute() {
	const { view, y, m } = Route.useSearch();
	const navigate = Route.useNavigate();
	const now = new Date();
	return (
		<CalendarPage
			view={view ?? "month"}
			year={y ?? now.getFullYear()}
			month0={(m ?? now.getMonth() + 1) - 1}
			onChange={(patch) =>
				navigate({
					search: (prev) => ({
						...prev,
						...(patch.view ? { view: patch.view } : {}),
						...(patch.year !== undefined ? { y: patch.year } : {}),
						...(patch.month0 !== undefined ? { m: patch.month0 + 1 } : {}),
					}),
					replace: true,
				})
			}
			onOpen={(challengeId) =>
				navigate({ to: "/challenges/$challengeId", params: { challengeId } })
			}
		/>
	);
}
