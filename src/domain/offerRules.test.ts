import { describe, expect, it } from "vitest";
import { blankOffer, type NewOffer, type Offer } from "@/data/schemas/offer";
import {
	normalizeOfferCode,
	OFFER_TITLE_MAX,
	offerActivationIssues,
	offerIssues,
	offerState,
} from "./offerRules";

// The same rules as the backend's offerPanelRules.ts: these cases mirror
// tests/handlers/adminOffersPanelContract.test.ts there, path and code.

const NOW = "2026-11-16T10:00:00.000Z";

const live = (change: Partial<NewOffer> = {}): NewOffer => ({
	...blankOffer(),
	code: "LATO2026",
	offeringId: "promo_free_month",
	title: "Miesiąc Pro za darmo",
	subtitle: "Oferta ważna do końca września",
	expiresAtUtc: "2099-01-01T00:00:00.000Z",
	active: true,
	storeAndroid: {
		productId: "cf_pro",
		basePlanId: "monthly",
		offerId: "free-month",
	},
	storeIos: { productId: "cf.pro.monthly" },
	...change,
});

const stored = (change: Partial<Offer> = {}): Offer => ({
	...live(),
	id: "o_1",
	etag: "1",
	purchases: 0,
	createdAtUtc: "2026-01-01T00:00:00.000Z",
	updatedAtUtc: "2026-01-02T00:00:00.000Z",
	...change,
});

const codes = (issues: { path: string; code: string }[]) =>
	issues.map((issue) => `${issue.path}:${issue.code}`);

const check = (
	offer: NewOffer,
	others: Offer[] = [],
	before: Offer | null = null,
) => codes(offerIssues(offer, { others, stored: before, now: NOW }));

describe("offerIssues", () => {
	it("accepts a complete live offer and the smallest draft", () => {
		expect(check(live())).toEqual([]);
		expect(
			check({ ...blankOffer(), code: "JESIEN", offeringId: "promo" }),
		).toEqual([]);
	});

	it("asks a live offer for its copy and both stores", () => {
		expect(
			check(
				live({
					title: null,
					subtitle: null,
					storeAndroid: null,
					storeIos: null,
				}),
			),
		).toEqual([
			"title:REQUIRED",
			"subtitle:REQUIRED",
			"storeAndroid:REQUIRED",
			"storeIos:REQUIRED",
		]);
	});

	it("refuses what it would have to correct, even on a draft", () => {
		expect(
			check({
				...blankOffer(),
				code: "jesien",
				offeringId: " promo",
				entitlementId: "",
				title: " Jesień ",
				subtitle: "",
			}),
		).toEqual([
			"code:NOT_NORMALIZED",
			"offeringId:PADDED",
			"entitlementId:PADDED",
			"title:PADDED",
			"subtitle:EMPTY",
		]);
	});

	it("refuses a code in a shape the app cannot match", () => {
		expect(check(live({ code: "ŻUBR" }))).toEqual(["code:INVALID_FORMAT"]);
		expect(check(live({ code: "AB" }))).toEqual(["code:INVALID_FORMAT"]);
		expect(check(live({ code: "" }))).toEqual(["code:REQUIRED"]);
	});

	it("refuses a code another offer has, and a second live offer on one offering", () => {
		const other = stored({ id: "o_9", code: "LATO2026" });
		expect(check(live(), [other])).toEqual([
			"code:DUPLICATE",
			"offeringId:DUPLICATE",
		]);
		// a draft may share an offering with a live offer
		expect(check(live({ code: "INNY", active: false }), [other])).toEqual([]);
	});

	it("refuses long copy and copy on more than one line", () => {
		expect(
			check(
				live({
					title: "x".repeat(OFFER_TITLE_MAX + 1),
					subtitle: "Linia\ndruga",
				}),
			),
		).toEqual(["title:TOO_LONG", "subtitle:INVALID_CHARACTERS"]);
	});

	it("keeps a stored text older than a rule, and holds a changed one to it", () => {
		const old = stored({ title: "x".repeat(150), active: false });
		expect(check({ ...old, subtitle: "Nowy" }, [], old)).toEqual([]);
		expect(check({ ...old, title: "y".repeat(150) }, [], old)).toEqual([
			"title:TOO_LONG",
		]);
	});

	it("refuses dates that end before they start, and a live offer already over", () => {
		expect(
			check(
				live({
					validFromUtc: "2030-02-01T00:00:00.000Z",
					expiresAtUtc: "2030-01-01T00:00:00.000Z",
				}),
			),
		).toEqual(["expiresAtUtc:BEFORE_START"]);
		expect(check(live({ expiresAtUtc: "2020-01-01T00:00:00.000Z" }))).toEqual([
			"expiresAtUtc:IN_THE_PAST",
		]);
		expect(
			check(live({ expiresAtUtc: "2020-01-01T00:00:00.000Z", active: false })),
		).toEqual([]);
	});

	it("lets a live offer past its end keep that end", () => {
		const ended = stored({ expiresAtUtc: "2026-01-31T00:00:00.000Z" });
		expect(check({ ...ended, subtitle: "Poprawka" }, [], ended)).toEqual([]);
	});

	it("checks store ids against what each store takes, and names a missing one", () => {
		expect(
			check(
				live({
					storeAndroid: {
						productId: "CF Pro",
						basePlanId: "",
						offerId: "free_month",
					},
					storeIos: { productId: "cf pro" },
				}),
			),
		).toEqual([
			"storeAndroid.productId:INVALID_FORMAT",
			"storeAndroid.basePlanId:REQUIRED",
			"storeAndroid.offerId:INVALID_FORMAT",
			"storeIos.productId:INVALID_FORMAT",
		]);
	});
});

describe("offerActivationIssues", () => {
	it("is what a save with the switch on would say about the stored offer", () => {
		const draft = stored({ active: false, subtitle: null, storeAndroid: null });
		expect(
			codes(offerActivationIssues(draft, { others: [], now: NOW })),
		).toEqual(["subtitle:REQUIRED", "storeAndroid:REQUIRED"]);
	});

	it("refuses to switch on a draft whose end has passed", () => {
		const draft = stored({
			active: false,
			expiresAtUtc: "2020-01-01T00:00:00.000Z",
		});
		expect(
			codes(offerActivationIssues(draft, { others: [], now: NOW })),
		).toEqual(["expiresAtUtc:IN_THE_PAST"]);
	});
});

describe("offerState", () => {
	it("says what the app does with the code now", () => {
		expect(offerState(stored({ active: false }), NOW)).toBe("draft");
		expect(offerState(stored(), NOW)).toBe("live");
		expect(
			offerState(stored({ validFromUtc: "2027-01-01T00:00:00.000Z" }), NOW),
		).toBe("scheduled");
		expect(offerState(stored({ expiresAtUtc: NOW }), NOW)).toBe("ended");
	});
});

describe("normalizeOfferCode", () => {
	it("trims and puts in capitals", () => {
		expect(normalizeOfferCode(" lato2026 ")).toBe("LATO2026");
	});
});
