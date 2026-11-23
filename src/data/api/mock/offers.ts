import { ApiError, type ApiIssue } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import { newOfferSchema, type Offer, offerSchema } from "@/data/schemas/offer";
import { offerActivationIssues, offerIssues } from "@/domain/offerRules";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, disagree, type MockKernel } from "./kernel";

// Special offers. The app's side (verifying a code, attributing purchases)
// does not exist here; the rules for saving and switching do, the same as
// the backend's, and so does a stand-in for RevenueCat that knows a few
// offerings.

export const MOCK_OFFERINGS = [
	"pro_promo_1month_free",
	"pro_promo_3months_half",
	"pro_promo_black_friday",
];
export const MOCK_ENTITLEMENTS = ["Pro", "Premium"];

const days = (from: number) =>
	new Date(Date.now() + from * 24 * 60 * 60 * 1000).toISOString();

export function buildOfferFixtures(): Offer[] {
	const base = {
		entitlementId: null,
		validFromUtc: null,
		storeAndroid: {
			productId: "cf_pro",
			basePlanId: "monthly",
			offerId: "free-month",
		},
		storeIos: { productId: "cf.pro.monthly.free" },
	};
	return [
		{
			...base,
			id: "o_1",
			etag: "1",
			code: "LATO2026",
			offeringId: "pro_promo_1month_free",
			title: "Miesiąc Pro za darmo",
			subtitle: "Oferta dla uczestników letniego wyzwania",
			expiresAtUtc: days(30),
			active: true,
			purchases: 42,
			createdAtUtc: days(-60),
			updatedAtUtc: days(-10),
		},
		{
			...base,
			id: "o_2",
			etag: "1",
			code: "BLACKFRIDAY",
			offeringId: "pro_promo_black_friday",
			title: "Pro za pół ceny",
			subtitle: null,
			validFromUtc: days(9),
			expiresAtUtc: days(13),
			active: false,
			storeIos: null,
			purchases: 0,
			createdAtUtc: days(-2),
			updatedAtUtc: days(-1),
		},
		{
			...base,
			id: "o_3",
			etag: "1",
			code: "WIOSNA2026",
			offeringId: "pro_promo_3months_half",
			title: "Trzy miesiące za pół ceny",
			subtitle: "Dla nowych osób",
			expiresAtUtc: days(-120),
			active: true,
			purchases: 128,
			createdAtUtc: days(-240),
			updatedAtUtc: days(-121),
		},
	];
}

export function offersApi(kernel: MockKernel): ApiClient["offers"] {
	const table = kernel.table<Offer>(
		"offers",
		buildOfferFixtures,
		(offer) => offer.id,
	);

	const find = (offerId: string): Offer => {
		const stored = table.get(offerId);
		if (!stored) throw new ApiError("notFound", "Nie ma takiej oferty");
		return stored;
	};

	const others = (id: string | undefined) =>
		[...table.values()].filter((offer) => offer.id !== id);

	/** What RevenueCat would say about a live offer's ids that are new to it. */
	function revenueCatIssues(offer: Offer, stored: Offer | null): ApiIssue[] {
		if (!offer.active) return [];
		const switchedOn = stored == null || !stored.active;
		const issues: ApiIssue[] = [];
		if (
			(switchedOn || offer.offeringId !== stored?.offeringId) &&
			!MOCK_OFFERINGS.includes(offer.offeringId)
		) {
			issues.push({
				path: "offeringId",
				message: `Offering „${offer.offeringId}” nie istnieje w RevenueCat`,
			});
		}
		if (
			offer.entitlementId != null &&
			(switchedOn || offer.entitlementId !== stored?.entitlementId) &&
			!MOCK_ENTITLEMENTS.includes(offer.entitlementId)
		) {
			issues.push({
				path: "entitlementId",
				message: `Entitlement „${offer.entitlementId}” nie istnieje w RevenueCat`,
			});
		}
		return issues;
	}

	const strip = (issues: readonly ApiIssue[]): ApiIssue[] =>
		issues.map(({ path, message }) => ({ path, message }));

	return {
		async list() {
			await kernel.latency();
			return offerSchema.array().parse(copy([...table.values()]));
		},
		async create(offer) {
			await kernel.latency();
			kernel.takeFailure();
			const fields = newOfferSchema.parse(copy(offer));
			const incoming: Offer = {
				...fields,
				id: kernel.freeId("o_", table),
				etag: "",
				purchases: 0,
				createdAtUtc: kernel.now(),
				updatedAtUtc: kernel.now(),
				[UNKNOWN_FIELD]: "offer:new",
			};
			const issues = offerIssues(incoming, {
				others: others(undefined),
				now: kernel.now(),
			});
			kernel.reject(strip(issues));
			kernel.reject(revenueCatIssues(incoming, null));
			return kernel.store(table, incoming);
		},
		async save(offer, options) {
			await kernel.latency();
			kernel.takeFailure();
			const incoming = offerSchema.parse(copy(offer));
			const stored = find(incoming.id);
			kernel.takeConcurrentChange<Offer>(stored, incoming, {
				otherField: (row) => {
					row.subtitle = "zmienione przez innego admina";
				},
				sameFields: disagree,
			});
			kernel.checkEtag(stored, options.etag);
			kernel.reject(
				strip(
					offerIssues(incoming, {
						others: others(incoming.id),
						stored,
						now: kernel.now(),
					}),
				),
			);
			kernel.reject(revenueCatIssues(incoming, stored));
			return kernel.store(table, {
				...incoming,
				// The server's own.
				purchases: stored.purchases,
				createdAtUtc: stored.createdAtUtc,
			});
		},
		async setActive(offerId, active, options) {
			await kernel.latency();
			kernel.takeFailure();
			const stored = find(offerId);
			kernel.takeConcurrentChange<Offer>(stored, stored, {
				otherField: (row) => {
					row.subtitle = "zmienione przez innego admina";
				},
				sameFields: (row) => {
					row.subtitle = "zmienione przez innego admina";
				},
			});
			kernel.checkEtag(stored, options.etag);
			if (stored.active === active) return copy(stored);
			if (active) {
				kernel.reject(
					strip(
						offerActivationIssues(stored, {
							others: others(offerId),
							now: kernel.now(),
						}),
					),
				);
				kernel.reject(
					revenueCatIssues(
						{ ...stored, active: true },
						{
							...stored,
							active: false,
						},
					),
				);
			}
			return kernel.store(table, { ...stored, active });
		},
		async choices() {
			await kernel.latency();
			return {
				offeringIds: [...MOCK_OFFERINGS],
				entitlementIds: [...MOCK_ENTITLEMENTS],
			};
		},
	};
}
