import { createFileRoute } from "@tanstack/react-router";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";

export const Route = createFileRoute("/_app/users")({
	component: UsersPage,
});

function UsersPage() {
	return (
		<SectionPlaceholder title="Użytkownicy" phase="fazie 7">
			Wyszukiwanie użytkowników, ich odznaki, postępy i adres e-mail.
		</SectionPlaceholder>
	);
}
