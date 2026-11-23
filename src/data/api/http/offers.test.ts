import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { blankOffer } from "@/data/schemas/offer";
import { fromOffer, offersArea, toOffer } from "./offers";
import {
	conflictReply,
	type FakeBackend,
	fakeBackend,
	json,
	production,
	validationReply,
} from "./testSupport";

// `panel/manageOffers` as the backend answers it
// (src/handlers/admin/adminOffersHandler.ts, SpecialOfferAdminDto).

const ETAG = `W/"datetime'2026-11-16T10%3A00%3A00.0000001Z'"`;

const wireOffer = (change: Record<string, unknown> = {}) => ({
	id: "o_1",
	etag: ETAG,
	code: "LATO2026",
	offeringId: "promo_free_month",
	entitlementId: null,
	title: "Miesiąc Pro za darmo",
	subtitle: "Dla nowych osób",
	validFromUtc: null,
	expiresAtUtc: "2099-01-01T00:00:00.000Z",
	active: true,
	storeAndroid: {
		productId: "cf_pro",
		basePlanId: "monthly",
		offerId: "free-month",
	},
	storeIos: { productId: "cf.pro.monthly" },
	purchases: 3,
	createdAtUtc: "2026-01-01T00:00:00.000Z",
	updatedAtUtc: "2026-01-02T00:00:00.000Z",
	...change,
});

const area = (backend: FakeBackend, caps = ALL_CAPABILITIES) =>
	offersArea(backend.transport, caps);

describe("offers: reading", () => {
	it("lists offers with the backend's own version", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageOffers",
			json([wireOffer()]),
		);

		const [offer] = await area(backend).list();

		expect(offer).toMatchObject({
			id: "o_1",
			etag: ETAG,
			purchases: 3,
			active: true,
		});
	});

	it("reads RevenueCat's ids for the selects", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageOfferChoices",
			json({ offeringIds: ["a", "b"], entitlementIds: null }),
		);

		expect(await area(backend).choices()).toEqual({
			offeringIds: ["a", "b"],
			entitlementIds: null,
		});
	});
});

describe("offers: writing", () => {
	it("creates without a version, sending only what the backend takes, in its one form", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers",
			json(wireOffer({ active: false })),
		);

		await area(backend).create({
			...blankOffer(),
			code: " lato2026 ",
			offeringId: " promo_free_month ",
			title: "  ",
			entitlementId: "",
			storeIos: { productId: " cf.pro " },
		});

		const request = backend.only("POST", "manageOffers");
		expect(request.headers["if-match"]).toBeUndefined();
		expect(request.body).toEqual({
			id: null,
			code: "LATO2026",
			offeringId: "promo_free_month",
			entitlementId: null,
			title: null,
			subtitle: null,
			validFromUtc: null,
			expiresAtUtc: null,
			active: false,
			storeAndroid: null,
			storeIos: { productId: "cf.pro" },
		});
	});

	it("saves with the version it is based on, and never sends what the server sets", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers",
			json(wireOffer({ title: "Nowy", etag: 'W/"2"' })),
		);
		const offer = toOffer(wireOffer());

		const saved = await area(backend).save(
			{ ...offer, title: "Nowy" },
			{ etag: offer.etag },
		);

		const request = backend.only("POST", "manageOffers");
		expect(request.headers["if-match"]).toBe(ETAG);
		expect(Object.keys(request.body as object)).not.toEqual(
			expect.arrayContaining(["etag"]),
		);
		for (const key of ["etag", "purchases", "createdAtUtc", "updatedAtUtc"]) {
			expect(request.body).not.toHaveProperty(key);
		}
		expect(saved).toMatchObject({ title: "Nowy", etag: 'W/"2"' });
	});

	it("puts the backend's problems on their fields", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers",
			validationReply([
				{
					path: "title",
					code: "REQUIRED",
					message: "Tytuł jest wymagany dla aktywnej oferty",
				},
				{ path: "offeringId", code: "CHECK_UNAVAILABLE", message: "x" },
			]),
		);
		const offer = toOffer(wireOffer());

		await expect(
			area(backend).save(offer, { etag: offer.etag }),
		).rejects.toMatchObject({
			kind: "validation",
			issues: [
				{ path: "title", message: "Tytuł jest wymagany dla aktywnej oferty" },
				{ path: "offeringId", message: "x" },
			],
		});
	});

	it("hands a conflict on with the offer as stored now", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers",
			conflictReply(
				"Offer o_1 was changed since it was loaded",
				wireOffer({ title: "Cudza zmiana", etag: 'W/"3"' }),
			),
		);
		const offer = toOffer(wireOffer());

		await expect(
			area(backend).save(offer, { etag: offer.etag }),
		).rejects.toMatchObject({
			kind: "conflict",
			current: { title: "Cudza zmiana", etag: 'W/"3"' },
		});
	});

	it("switches an offer with nothing but the switch and the version", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers/o_1/status",
			json(wireOffer({ active: false, etag: 'W/"4"' })),
		);

		const switched = await area(backend).setActive("o_1", false, {
			etag: ETAG,
		});

		const request = backend.only("POST", "manageOffers/o_1/status");
		expect(request.body).toEqual({ active: false });
		expect(request.headers["if-match"]).toBe(ETAG);
		expect(switched).toMatchObject({ active: false, etag: 'W/"4"' });
	});

	it("costs no request while the section is closed in Produkcja", async () => {
		const backend = fakeBackend();
		const closed = area(backend, production());
		const offer = toOffer(wireOffer());

		await expect(closed.create(blankOffer())).rejects.toMatchObject({
			kind: "validation",
		});
		await expect(
			closed.save(offer, { etag: offer.etag }),
		).rejects.toMatchObject({ kind: "validation" });
		await expect(
			closed.setActive("o_1", false, { etag: ETAG }),
		).rejects.toMatchObject({ kind: "validation" });
		expect(backend.requests).toEqual([]);
	});

	it("opens when the section is on", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageOffers/o_1/status",
			json(wireOffer()),
		);

		await area(backend, production({ writes: { offers: "on" } })).setActive(
			"o_1",
			true,
			{ etag: ETAG },
		);

		expect(backend.calls()).toEqual(["POST manageOffers/o_1/status"]);
	});
});

describe("fromOffer", () => {
	it("keeps a store with an empty field, for the backend to name it", () => {
		const body = fromOffer({
			...blankOffer(),
			storeAndroid: { productId: "cf_pro", basePlanId: "", offerId: "x" },
		});
		expect(body.storeAndroid).toEqual({
			productId: "cf_pro",
			basePlanId: "",
			offerId: "x",
		});
	});
});
