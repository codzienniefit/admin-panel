import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable } from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import {
	type NewOffer,
	type Offer,
	offerChoicesSchema,
	offerSchema,
} from "@/data/schemas/offer";
import { conform, isBackendEtag, versionOf, withCurrent } from "./shared";
import type { Transport } from "./transport";

// Special offers: `panel/manageOffers` of the backend
// (src/handlers/admin/adminOffersHandler.ts; SpecialOfferAdminDto in and out,
// rules in src/modules/services/helpers/offerPanelRules.ts). Panel only
// besides the list: one offer, the on/off switch and RevenueCat's ids.
//
// The backend speaks the editing contract on these routes from the start
// (versions, 422 with every problem, 409 with the offer as stored), so there
// is no older way to talk to it here.

export const wireOfferSchema = z.looseObject({
	id: z.string(),
	etag: z.string().nullish(),
	updatedAtUtc: z.string().nullish(),
});

export function toOffer(raw: unknown): Offer {
	const wire = conform(wireOfferSchema, raw, "Oferta");
	return conform(
		offerSchema,
		{ ...wire, etag: versionOf(wire) },
		`Oferta ${wire.id}`,
	);
}

/** What only the server sets: never sent. */
const NEVER_SENT = ["etag", "purchases", "createdAtUtc", "updatedAtUtc"];

/**
 * The request body for a save: SpecialOfferUpsertAdminDto. The backend
 * corrects nothing, so what the form typed is put in the one form it takes
 * first: the code in capitals, ids without the space around them, an empty
 * text as null. Anything else wrong is left for it to refuse at its field.
 */
export function fromOffer(offer: Offer | NewOffer): Record<string, unknown> {
	const body: Record<string, unknown> = { ...offer };
	for (const key of NEVER_SENT) delete body[key];
	body.id = typeof offer.id === "string" ? offer.id : null;
	body.code = offer.code.trim().toUpperCase();
	body.offeringId = offer.offeringId.trim();
	body.entitlementId = textOrNull(offer.entitlementId);
	body.title = textOrNull(offer.title);
	body.subtitle = textOrNull(offer.subtitle);
	body.validFromUtc = textOrNull(offer.validFromUtc);
	body.expiresAtUtc = textOrNull(offer.expiresAtUtc);
	body.storeAndroid = offer.storeAndroid
		? {
				productId: offer.storeAndroid.productId.trim(),
				basePlanId: offer.storeAndroid.basePlanId.trim(),
				offerId: offer.storeAndroid.offerId.trim(),
			}
		: null;
	body.storeIos = offer.storeIos
		? { productId: offer.storeIos.productId.trim() }
		: null;
	return body;
}

const textOrNull = (value: string | null | undefined): string | null => {
	const text = value?.trim() ?? "";
	return text === "" ? null : text;
};

export function offersArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["offers"] {
	async function read(id: string): Promise<Offer> {
		return toOffer(
			await transport.request({
				path: ["manageOffers", id],
				what: "Oferta",
			}),
		);
	}

	const versionHeaders = (etag: string): Record<string, string> =>
		isBackendEtag(etag) ? { "if-match": etag } : {};

	async function write(
		body: Record<string, unknown>,
		headers: Record<string, string>,
	): Promise<Offer> {
		return toOffer(
			await transport.request({
				method: "POST",
				path: ["manageOffers"],
				body,
				headers,
				what: "Zapis oferty",
			}),
		);
	}

	return {
		async list() {
			const rows = await transport.request({
				path: ["manageOffers"],
				schema: z.array(z.unknown()),
				what: "Lista ofert",
			});
			return rows.map(toOffer);
		},
		async create(offer) {
			// Nothing to mark as a test item: on, or not at all.
			assertWritable(capabilities, "offers", null);
			return write(fromOffer(offer), {});
		},
		async save(offer, options) {
			assertWritable(capabilities, "offers", null);
			return withCurrent(
				() => write(fromOffer(offer), versionHeaders(options.etag)),
				toOffer,
				() => read(offer.id),
			);
		},
		async setActive(offerId, active, options) {
			assertWritable(capabilities, "offers", null);
			return withCurrent(
				async () =>
					toOffer(
						await transport.request({
							method: "POST",
							path: ["manageOffers", offerId, "status"],
							body: { active },
							headers: versionHeaders(options.etag),
							what: active ? "Włączenie oferty" : "Wyłączenie oferty",
						}),
					),
				toOffer,
				() => read(offerId),
			);
		},
		async choices() {
			return transport.request({
				path: ["manageOfferChoices"],
				schema: offerChoicesSchema,
				what: "Offeringi z RevenueCat",
			});
		},
	};
}
