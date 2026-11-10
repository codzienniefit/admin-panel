import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MEDIA_FOLDERS } from "@/domain/mediaRules";
import { MediaPage } from "@/features/media/MediaPage";

const folderIds = MEDIA_FOLDERS.map((folder) => folder.id);

const searchSchema = z.object({
	folder: z
		.string()
		.refine((id) => folderIds.includes(id))
		.optional()
		.catch(undefined),
	q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/media")({
	validateSearch: (search) => searchSchema.parse(search),
	component: MediaRoute,
});

function MediaRoute() {
	const { folder, q } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<MediaPage
			folderId={folder ?? "workouts"}
			query={q ?? ""}
			onChange={(patch) =>
				navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
			}
		/>
	);
}
