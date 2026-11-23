import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { ApiError, isConflict } from "@/data/api/errors";
import type { NewOffer, Offer } from "@/data/schemas/offer";
import { createVersionedCollection } from "./versioned";

// The single copy of every special offer, live and switched off.
const offers = createVersionedCollection<Offer>({
	name: "offers",
	list: () => api.offers.list(),
	save: (offer, options) => api.offers.save(offer, options),
});

export const offersCollection = offers.collection;
export const offerSaver = offers.saver;
export const offerTarget = offers.target;

export async function createOffer(input: NewOffer): Promise<Offer> {
	return offers.addCreated(await api.offers.create(input));
}

/**
 * Switches an offer on or off, based on the version on screen. Not a field
 * edit: it does not go through the saver, and a refusal or a conflict comes
 * back to the caller with the offer as it is now already on screen.
 */
export async function setOfferActive(
	offerId: string,
	active: boolean,
): Promise<Offer> {
	const current = offersCollection.get(offerId);
	if (!current) throw new ApiError("notFound", "Nie ma takiej oferty");
	try {
		const saved = await api.offers.setActive(offerId, active, {
			etag: current.etag,
		});
		offers.saver.remember([saved]);
		offersCollection.utils.writeUpsert(saved);
		return saved;
	} catch (error) {
		if (isConflict<Offer>(error) && error.current) {
			offers.saver.remember([error.current]);
			offersCollection.utils.writeUpsert(error.current);
		}
		throw error;
	}
}

/**
 * The offering and entitlement ids RevenueCat knows, for the form's selects.
 * Read when a form opens; a save checks the ids itself whatever this said.
 */
export const offerChoicesQuery = () =>
	queryOptions({
		queryKey: ["offers", "choices"] as const,
		queryFn: () => api.offers.choices(),
		staleTime: 5 * 60_000,
		retry: false,
	});

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
