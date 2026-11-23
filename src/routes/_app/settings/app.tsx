import { createFileRoute } from "@tanstack/react-router";
import { AppCacheSettings } from "@/features/settings/AppCacheSettings";

export const Route = createFileRoute("/_app/settings/app")({
	component: AppCacheSettings,
});
