import { createFileRoute } from "@tanstack/react-router";
import { MessageEditor } from "@/features/messages/MessageEditor";

export const Route = createFileRoute("/_app/messages/$messageId")({
	component: MessageRoute,
});

function MessageRoute() {
	const { messageId } = Route.useParams();
	const navigate = Route.useNavigate();
	return (
		<MessageEditor
			messageId={messageId}
			onClose={() => navigate({ to: "/messages", search: (prev) => prev })}
			onOpen={(id) =>
				navigate({
					to: "/messages/$messageId",
					params: { messageId: id },
					search: (prev) => prev,
				})
			}
		/>
	);
}
