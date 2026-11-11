import { createFileRoute } from "@tanstack/react-router";
import { PlanTypesSettings } from "@/features/settings/PlanTypesSettings";

export const Route = createFileRoute("/_app/settings/plan-types")({
	component: PlanTypesSettings,
});
