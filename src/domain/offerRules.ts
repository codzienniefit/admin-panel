import type { ApiIssue } from "@/data/api/errors";
import type { NewOffer, Offer } from "@/data/schemas/offer";

// What makes a special offer acceptable. One set of rules, used by the form
// and by the mock server; the backend holds the same ones
// (src/modules/services/helpers/offerPanelRules.ts), with the same paths and
// codes.
//
// An inactive offer is a draft: it may lack its copy and its store ids, but
// what it holds has to be right, because it is switched on as it is stored.
// A live offer is in the app the moment it is saved, so it is held to
// everything. Nothing is corrected on the way: the form puts the code in
// capitals and trims what it sends; the backend refuses anything else.

export const OFFER_CODE = /^[A-Z0-9_-]{3,32}$/;
/** Google Play base plan and offer ids. */
export const PLAY_PLAN_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Google Play product id. */
export const PLAY_PRODUCT_ID = /^[a-z0-9][a-z0-9_.]*$/;
/** App Store product id. */
export const APP_STORE_PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_.]*$/;

export const OFFER_TITLE_MAX = 120;
export const OFFER_SUBTITLE_MAX = 200;
export const OFFER_ID_MAX = 128;

/** A character a heading cannot hold: a line break, a tab, a control character. */
const notForATitle = (code: number): boolean =>
	code <= 0x1f ||
	(code >= 0x7f && code <= 0x9f) ||
	code === 0x2028 ||
	code === 0x2029;

/** A code the way it is stored: no space around it, in capitals. */
export const normalizeOfferCode = (code: string): string =>
	code.trim().toUpperCase();

export interface OfferContext {
	/** Every other offer: a code, or a live offering, may be used once. */
	others: readonly Pick<Offer, "id" | "code" | "offeringId" | "active">[];
	/** The offer as stored, for a change to an existing one. */
	stored?: Offer | null;
	/** An ISO instant. */
	now: string;
}

type Candidate = NewOffer & { id?: string };

/** A problem with its code, the same the backend gives for that field. */
export interface OfferIssue extends ApiIssue {
	code: string;
}

/** Every problem with an offer as it would be saved. Empty: it can be saved. */
export function offerIssues(
	offer: Candidate,
	context: OfferContext,
): OfferIssue[] {
	const { others, stored = null } = context;
	const issues: OfferIssue[] = [];
	const add = (path: string, code: string, message: string) =>
		issues.push({ path, code, message });
	const live = offer.active;

	if (offer.code === "") {
		add("code", "REQUIRED", "Kod oferty jest wymagany");
	} else if (!OFFER_CODE.test(offer.code)) {
		if (OFFER_CODE.test(normalizeOfferCode(offer.code))) {
			add(
				"code",
				"NOT_NORMALIZED",
				`Kod oferty wpisz wielkimi literami i bez spacji: ${normalizeOfferCode(offer.code)}`,
			);
		} else {
			add(
				"code",
				"INVALID_FORMAT",
				"Kod może mieć od 3 do 32 znaków: wielkie litery bez polskich znaków, cyfry, „-” i „_”",
			);
		}
	} else {
		const clash = others.find((other) => other.code === offer.code);
		if (clash) {
			add("code", "DUPLICATE", `Tego kodu używa już oferta ${clash.id}`);
		}
	}

	if (offer.offeringId === "") {
		add("offeringId", "REQUIRED", "Wybierz offering z RevenueCat");
	} else {
		issues.push(...idIssues("offeringId", offer.offeringId, "Offering"));
		if (live) {
			const clash = others.find(
				(other) => other.active && other.offeringId === offer.offeringId,
			);
			if (clash) {
				add(
					"offeringId",
					"DUPLICATE",
					`Tego offeringu używa już aktywna oferta ${clash.code}. Zakupy liczyłyby się dwa razy`,
				);
			}
		}
	}
	if (offer.entitlementId != null) {
		issues.push(
			...idIssues("entitlementId", offer.entitlementId, "Entitlement"),
		);
	}

	issues.push(
		...copyIssues(
			"title",
			offer.title,
			OFFER_TITLE_MAX,
			stored?.title ?? null,
			live,
			"Tytuł",
		),
		...copyIssues(
			"subtitle",
			offer.subtitle,
			OFFER_SUBTITLE_MAX,
			stored?.subtitle ?? null,
			live,
			"Podtytuł",
		),
	);

	const from = instant(offer.validFromUtc);
	const until = instant(offer.expiresAtUtc);
	if (offer.validFromUtc != null && from == null) {
		add("validFromUtc", "INVALID_DATE", "Podaj pełną datę i godzinę");
	}
	if (offer.expiresAtUtc != null && until == null) {
		add("expiresAtUtc", "INVALID_DATE", "Podaj pełną datę i godzinę");
	}
	if (from != null && until != null && until <= from) {
		add("expiresAtUtc", "BEFORE_START", "Koniec musi być później niż początek");
	}
	if (live && until != null && until <= Date.parse(context.now)) {
		// A live offer past its end tells the app the campaign has ended; it
		// may keep the end it has. Going live with an end that has passed, or
		// moving a live end into the past, is a campaign nobody can use.
		const keepsStoredEnd =
			stored?.active === true && instant(stored.expiresAtUtc) === until;
		if (!keepsStoredEnd) {
			add(
				"expiresAtUtc",
				"IN_THE_PAST",
				"Koniec aktywnej oferty nie może być w przeszłości",
			);
		}
	}

	if (offer.storeAndroid == null) {
		if (live) {
			add(
				"storeAndroid",
				"REQUIRED",
				"Aktywna oferta potrzebuje produktu z Google Play",
			);
		}
	} else {
		const android = offer.storeAndroid;
		const kept = stored?.storeAndroid ?? null;
		issues.push(
			...storeIdIssues(
				"storeAndroid.productId",
				android.productId,
				kept?.productId,
				PLAY_PRODUCT_ID,
				"małe litery, cyfry, „_” i „.”",
			),
			...storeIdIssues(
				"storeAndroid.basePlanId",
				android.basePlanId,
				kept?.basePlanId,
				PLAY_PLAN_ID,
				"małe litery, cyfry i „-”",
			),
			...storeIdIssues(
				"storeAndroid.offerId",
				android.offerId,
				kept?.offerId,
				PLAY_PLAN_ID,
				"małe litery, cyfry i „-”",
			),
		);
	}
	if (offer.storeIos == null) {
		if (live) {
			add(
				"storeIos",
				"REQUIRED",
				"Aktywna oferta potrzebuje produktu z App Store",
			);
		}
	} else {
		issues.push(
			...storeIdIssues(
				"storeIos.productId",
				offer.storeIos.productId,
				stored?.storeIos?.productId,
				APP_STORE_PRODUCT_ID,
				"litery, cyfry, „_” i „.”",
			),
		);
	}
	return issues;
}

/** What switching a stored offer on would be refused for. */
export function offerActivationIssues(
	offer: Offer,
	context: Omit<OfferContext, "stored">,
): OfferIssue[] {
	// Checked as the stored offer saved again with the switch on: its texts
	// count as unchanged, so one older than a rule does not stop it.
	return offerIssues(
		{ ...offer, active: true },
		{ ...context, stored: { ...offer, active: false } },
	);
}

export type OfferState = "draft" | "scheduled" | "live" | "ended";

/** What the app does with the offer's code at `now`. */
export function offerState(
	offer: Pick<Offer, "active" | "validFromUtc" | "expiresAtUtc">,
	now: string,
): OfferState {
	if (!offer.active) return "draft";
	const at = Date.parse(now);
	const from = instant(offer.validFromUtc);
	const until = instant(offer.expiresAtUtc);
	if (until != null && until <= at) return "ended";
	if (from != null && from > at) return "scheduled";
	return "live";
}

/** What the app answers for each state, for the list and the editor. */
export const OFFER_STATE_TEXT: Record<OfferState, string> = {
	draft: "Wyłączona: aplikacja odpowiada „nieznany kod”",
	scheduled: "Zaplanowana: do startu aplikacja odpowiada „nieznany kod”",
	live: "Aktywna: kod działa w aplikacji",
	ended: "Zakończona: aplikacja odpowiada „oferta wygasła”",
};

// ─── Pieces ─────────────────────────────────────────────────────────────────

function instant(value: string | null | undefined): number | null {
	if (value == null) return null;
	const at = Date.parse(value);
	return Number.isNaN(at) ? null : at;
}

function idIssues(path: string, value: string, label: string): OfferIssue[] {
	if (value.trim() === "" || value !== value.trim()) {
		return [
			{
				path,
				code: "PADDED",
				message: `${label} nie może być pusty ani zaczynać się lub kończyć spacją`,
			},
		];
	}
	if (value.length > OFFER_ID_MAX) {
		return [
			{
				path,
				code: "TOO_LONG",
				message: `${label} może mieć najwyżej ${OFFER_ID_MAX} znaków`,
			},
		];
	}
	return [];
}

function copyIssues(
	path: string,
	value: string | null,
	max: number,
	stored: string | null,
	live: boolean,
	label: string,
): OfferIssue[] {
	const required: OfferIssue = {
		path,
		code: "REQUIRED",
		message: `${label} jest wymagany w aktywnej ofercie`,
	};
	if (value == null) return live ? [required] : [];
	if (value.trim() === "") {
		return [
			live
				? required
				: { path, code: "EMPTY", message: `${label}: zostaw puste pole` },
		];
	}
	if (value !== value.trim()) {
		return [
			{
				path,
				code: "PADDED",
				message: `${label} nie może zaczynać się ani kończyć spacją`,
			},
		];
	}
	// A text saved before a rule existed is kept as it is.
	if (value === stored) return [];
	if (value.length > max) {
		return [
			{
				path,
				code: "TOO_LONG",
				message: `${label} może mieć najwyżej ${max} znaków (ma ${value.length})`,
			},
		];
	}
	if (
		[...value].some((character) => notForATitle(character.codePointAt(0) ?? 0))
	) {
		return [
			{
				path,
				code: "INVALID_CHARACTERS",
				message: `${label} musi być jedną linią tekstu`,
			},
		];
	}
	return [];
}

function storeIdIssues(
	path: string,
	value: string,
	stored: string | undefined,
	pattern: RegExp,
	rule: string,
): OfferIssue[] {
	if (value === "") {
		return [{ path, code: "REQUIRED", message: "To pole jest wymagane" }];
	}
	const problems = idIssues(path, value, "Identyfikator");
	if (problems.length > 0) return problems;
	if (value !== stored && !pattern.test(value)) {
		return [
			{ path, code: "INVALID_FORMAT", message: `Dozwolone są tylko ${rule}` },
		];
	}
	return [];
}
