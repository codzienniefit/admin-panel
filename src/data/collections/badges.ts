import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { api } from "@/data/api";
import type { Badge } from "@/data/schemas/badge";
import { queryClient } from "./queryClient";

/** Badge definitions. Read-only until the badges section (Phase 7). */
export const badgesCollection = createCollection(
	queryCollectionOptions<Badge>({
		id: "badges",
		queryKey: ["badges"],
		queryClient,
		queryFn: () => api.badges.list(),
		getKey: (badge) => badge.id,
	}),
);

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
