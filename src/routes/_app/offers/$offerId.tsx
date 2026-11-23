import { createFileRoute } from "@tanstack/react-router";
import { OfferEditor } from "@/features/offers/OfferEditor";

export const Route = createFileRoute("/_app/offers/$offerId")({
	component: OfferRoute,
});

function OfferRoute() {
	const { offerId } = Route.useParams();
	const navigate = Route.useNavigate();
	return (
		<OfferEditor
			offerId={offerId}
			onClose={() => navigate({ to: "/offers", search: (prev) => prev })}
			onOpen={(id) =>
				navigate({
					to: "/offers/$offerId",
					params: { offerId: id },
					search: (prev) => prev,
				})
			}
		/>
	);
}
