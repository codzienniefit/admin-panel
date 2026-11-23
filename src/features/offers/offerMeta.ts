import type { Offer } from "@/data/schemas/offer";
import { type OfferState, offerState } from "@/domain/offerRules";
import { matchesQuery } from "@/domain/text";
import type { EnumMeta } from "@/ui/enums";

// How an offer's state is shown: what the app does with its code now.

export const OFFER_STATE_META: Record<OfferState, EnumMeta> = {
	live: { label: "Aktywna", tone: "green" },
	scheduled: { label: "Zaplanowana", tone: "blue" },
	ended: { label: "Zakończona", tone: "amber" },
	draft: { label: "Wyłączona", tone: "grey" },
};

export const OFFER_STATES = Object.keys(OFFER_STATE_META) as OfferState[];

export interface OfferFilters {
	q?: string;
	state?: OfferState;
}

/** Live first, then planned, switched off, ended; newest change first within each. */
const ORDER: Record<OfferState, number> = {
	live: 0,
	scheduled: 1,
	draft: 2,
	ended: 3,
};

export function filterOffers(
	offers: readonly Offer[],
	filters: OfferFilters,
	now: string,
): Offer[] {
	return offers
		.filter(
			(offer) => !filters.state || offerState(offer, now) === filters.state,
		)
		.filter(
			(offer) =>
				!filters.q ||
				matchesQuery(
					[
						offer.code,
						offer.title ?? "",
						offer.subtitle ?? "",
						offer.offeringId,
					].join(" "),
					filters.q,
				),
		)
		.sort(
			(a, b) =>
				ORDER[offerState(a, now)] - ORDER[offerState(b, now)] ||
				b.updatedAtUtc.localeCompare(a.updatedAtUtc),
		);
}
