import { createFileRoute } from "@tanstack/react-router";
import { MessageEditor } from "@/features/messages/MessageEditor";

export const Route = createFileRoute("/_app/messages/new")({
	component: NewMessageRoute,
});

function NewMessageRoute() {
	const navigate = Route.useNavigate();
	return (
		<MessageEditor
			messageId={null}
			onClose={() => navigate({ to: "/messages", search: (prev) => prev })}
			// A saved draft stays open: reading it once more is the step before
			// sending.
			onOpen={(messageId) =>
				navigate({
					to: "/messages/$messageId",
					params: { messageId },
					search: (prev) => prev,
					replace: true,
				})
			}
		/>
	);
}
