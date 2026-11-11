import { createFileRoute } from "@tanstack/react-router";
import { FoldersSettings } from "@/features/settings/FoldersSettings";

export const Route = createFileRoute("/_app/settings/folders")({
	component: FoldersSettings,
});
