import { createFileRoute } from "@tanstack/react-router";
import { TrainingTypesSettings } from "@/features/settings/TrainingTypesSettings";

export const Route = createFileRoute("/_app/settings/training-types")({
	component: TrainingTypesSettings,
});
