import { createFileRoute } from "@tanstack/react-router";
import { SpikePage } from "@/features/spike/SpikePage";

export const Route = createFileRoute("/_app/spike")({
	component: () => <SpikePage challengeId="C1" />,
});
