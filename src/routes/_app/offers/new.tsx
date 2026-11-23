import { createFileRoute } from "@tanstack/react-router";
import { OfferEditor } from "@/features/offers/OfferEditor";

export const Route = createFileRoute("/_app/offers/new")({
	component: NewOfferRoute,
});

function NewOfferRoute() {
	const navigate = Route.useNavigate();
	return (
		<OfferEditor
			offerId={null}
			onClose={() => navigate({ to: "/offers", search: (prev) => prev })}
			onOpen={(offerId) =>
				navigate({
					to: "/offers/$offerId",
					params: { offerId },
					search: (prev) => prev,
					replace: true,
				})
			}
		/>
	);
}
