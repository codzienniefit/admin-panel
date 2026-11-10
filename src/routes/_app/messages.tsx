import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";

export const Route = createFileRoute("/_app/messages")({
	component: MessagesPage,
});

function MessagesPage() {
	return (
		<SectionPlaceholder title="Wiadomości" phase="fazie 7">
			Wiadomości do użytkowników: wersje robocze, podgląd, wysyłka i archiwum.
		</SectionPlaceholder>
	);
}
