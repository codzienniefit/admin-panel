import { z } from "zod";
import { optionalText } from "./common";

// A special offer: a campaign code a person arrives with from a deep link.
// The app verifies it with the backend and presents a RevenueCat offering
// under the offer's own headline. The backend's `manageOffers`
// (SpecialOfferAdminDto; backend docs/special-offers.md).
//
// An inactive offer is the panel's draft: the app answers "unknown code" for
// it, so it may be incomplete. Switching it on checks everything.

export const offerAndroidSchema = z.looseObject({
	productId: z.string(),
	basePlanId: z.string(),
	offerId: z.string(),
});
export type OfferAndroid = z.infer<typeof offerAndroidSchema>;

export const offerIosSchema = z.looseObject({
	productId: z.string(),
});
export type OfferIos = z.infer<typeof offerIosSchema>;

export const offerSchema = z.looseObject({
	/** `o_1`, `o_2`, …; never changes. Older offers may have their first code as id. */
	id: z.string(),
	etag: z.string(),
	/** In capitals; unique; may change at any time, even on a live offer. */
	code: z.string(),
	/** The RevenueCat offering the app presents. */
	offeringId: z.string(),
	/** null: the app assumes "Pro". */
	entitlementId: optionalText,
	/** The sheet the app shows. Required on a live offer. */
	title: optionalText,
	subtitle: optionalText,
	/** Before this the code answers "unknown" in the app. */
	validFromUtc: optionalText,
	/** From this on the code answers "expired". */
	expiresAtUtc: optionalText,
	active: z.boolean(),
	/** What the app checks eligibility against before it opens the paywall. */
	storeAndroid: offerAndroidSchema.nullish().default(null),
	storeIos: offerIosSchema.nullish().default(null),
	/** Production purchases attributed to the offer. Counted by the server. */
	purchases: z.number().default(0),
	createdAtUtc: z.string().default(""),
	updatedAtUtc: z.string().default(""),
});
export type Offer = z.infer<typeof offerSchema>;

/** What a create carries: everything the server does not assign or count. */
export const newOfferSchema = offerSchema.omit({
	id: true,
	etag: true,
	purchases: true,
	createdAtUtc: true,
	updatedAtUtc: true,
});
export type NewOffer = z.infer<typeof newOfferSchema>;

export function blankOffer(): NewOffer {
	return {
		code: "",
		offeringId: "",
		entitlementId: null,
		title: null,
		subtitle: null,
		validFromUtc: null,
		expiresAtUtc: null,
		active: false,
		storeAndroid: null,
		storeIos: null,
	};
}

/** What RevenueCat knows, for the form's selects. null: it could not be asked. */
export const offerChoicesSchema = z.looseObject({
	offeringIds: z.array(z.string()).nullable(),
	entitlementIds: z.array(z.string()).nullable(),
});
export type OfferChoices = z.infer<typeof offerChoicesSchema>;
