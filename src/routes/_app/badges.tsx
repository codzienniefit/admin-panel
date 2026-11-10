import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";

export const Route = createFileRoute("/_app/badges")({
	component: BadgesPage,
});

function BadgesPage() {
	return (
		<SectionPlaceholder title="Odznaki" phase="fazie 7">
			Definicje odznak, ich grafiki i kody do zdobywania.
		</SectionPlaceholder>
	);
}
