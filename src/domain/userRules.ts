import type { ApiIssue } from "@/data/api/errors";
import type { Badge } from "@/data/schemas/badge";
import type { InternalConfig } from "@/data/schemas/config";
import type { UserBadge, UserSummary } from "@/data/schemas/user";

// Rules for looking people up and for the few things the panel may change
// about them. One set, used by the screens and by the mock server.

/**
 * A search never returns more than this; the rest needs a narrower query.
 * It is also the most the backend lets the panel ask for.
 */
export const USER_SEARCH_LIMIT = 20;

/**
 * A whole address, as the backend recognises one (its FULL_EMAIL_PATTERN):
 * then it asks Firebase for that one account instead of searching.
 */
const FULL_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
/**
 * Firebase makes ids of 28 letters and digits. Twenty or more such
 * characters with no space or dot in them is no name or address.
 */
const UID = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * What a search is for: one person, by their whole e-mail address or their
 * id. Both are one direct look-up. Names are never searched: on the backend
 * that means listing every account first, which takes up to a minute and
 * finds names poorly (people write theirs in many ways, or not at all).
 */
export type UserQuery =
	| { kind: "email"; email: string }
	| { kind: "uid"; uid: string };

export function parseUserQuery(query: string): UserQuery | null {
	const text = query.trim();
	if (FULL_EMAIL.test(text)) return { kind: "email", email: text };
	if (UID.test(text)) return { kind: "uid", uid: text };
	return null;
}

/** What to tell someone whose query cannot be searched; null when it can. */
export function searchQueryProblem(query: string): string | null {
	const text = query.trim();
	if (!text) return "Wpisz adres e-mail albo identyfikator użytkownika";
	if (parseUserQuery(text)) return null;
	if (text.includes("@")) {
		return "Wpisz cały adres e-mail, np. jan.kowalski@example.com";
	}
	return "Szukamy tylko po całym adresie e-mail albo identyfikatorze użytkownika, nie po imieniu ani nazwisku";
}

export const isSearchable = (query: string): boolean =>
	parseUserQuery(query) !== null;

/** The one account a query is for: the same address, or the same id. */
export function userMatches(
	user: Pick<UserSummary, "uid" | "email">,
	query: UserQuery,
): boolean {
	return query.kind === "uid"
		? user.uid === query.uid
		: user.email !== null &&
				normalizeEmail(user.email) === normalizeEmail(query.email);
}

/** The form an address is stored and compared in. */
export const normalizeEmail = (email: string): string =>
	email.trim().toLowerCase();

// One "@", something on both sides, a dot in the domain, no spaces. The mail
// server is the real judge; this only catches slips of the hand.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL_MAX = 254;

/** Problems with a new e-mail address for an account. */
export function emailIssues(next: string, current: string | null): ApiIssue[] {
	const email = normalizeEmail(next);
	const refuse = (message: string): ApiIssue[] => [{ path: "email", message }];
	if (!email) return refuse("Podaj nowy adres e-mail");
	if (email.length > EMAIL_MAX) return refuse("Ten adres jest za długi");
	if (!EMAIL.test(email)) {
		return refuse("To nie wygląda na poprawny adres e-mail");
	}
	if (current && email === normalizeEmail(current)) {
		return refuse("To jest obecny adres tej osoby");
	}
	return [];
}

/** Why a badge cannot be given to a person by hand; empty when it can. */
export function grantIssues(
	badge: Pick<Badge, "type"> | undefined,
	alreadyHeld: boolean,
): ApiIssue[] {
	const refuse = (message: string): ApiIssue[] => [
		{ path: "badgeId", message },
	];
	if (!badge) return refuse("Takiej odznaki już nie ma");
	if (badge.type !== "manual") {
		return refuse(
			"Ręcznie można przyznać tylko odznakę ręczną. Pozostałe zdobywa się w aplikacji",
		);
	}
	if (alreadyHeld) return refuse("Ta osoba ma już tę odznakę");
	return [];
}

/** Only a badge that was handed out can be taken back. */
export const isRevocable = (held: Pick<UserBadge, "grantId">): boolean =>
	Boolean(held.grantId);

export function revokeIssues(held: Pick<UserBadge, "grantId">): ApiIssue[] {
	if (isRevocable(held)) return [];
	return [
		{
			path: "badgeId",
			message:
				"Tę odznakę osoba zdobyła sama w aplikacji. Odebrać można tylko odznakę przyznaną ręcznie albo zdobytą kodem",
		},
	];
}

/** Manual badges the person does not hold yet. */
export function grantableBadges(
	badges: readonly Badge[],
	held: readonly UserBadge[],
): Badge[] {
	const heldIds = new Set(held.map((item) => item.badgeId));
	return badges.filter(
		(badge) => grantIssues(badge, heldIds.has(badge.id)).length === 0,
	);
}

export interface HeldBadge {
	held: UserBadge;
	/** Missing when the definition has been deleted since. */
	badge: Badge | null;
}

export interface UserBadgeSection {
	id: string;
	label: string;
	subsections: Array<{ id: string; label: string; badges: HeldBadge[] }>;
}

const OTHER = "other";

/**
 * A person's badges the way the app lists them: by section and subsection,
 * in the configured order, newest first inside each. Badges with no section
 * (or one the configuration does not know) end up in "Pozostałe".
 */
export function groupUserBadges(
	held: readonly UserBadge[],
	badges: readonly Badge[],
	sections: InternalConfig["badgeSections"],
): UserBadgeSection[] {
	const definitions = new Map(badges.map((badge) => [badge.id, badge]));
	const groups: UserBadgeSection[] = sections.map((section) => ({
		id: section.id,
		label: section.label,
		subsections: section.subsections.map((subsection) => ({
			id: subsection.id,
			label: subsection.label,
			badges: [],
		})),
	}));
	const other: UserBadgeSection = {
		id: OTHER,
		label: "Pozostałe",
		subsections: [{ id: OTHER, label: "", badges: [] }],
	};

	const newestFirst = [...held].sort((a, b) =>
		b.earnedAtUtc.localeCompare(a.earnedAtUtc),
	);
	for (const item of newestFirst) {
		const badge = definitions.get(item.badgeId) ?? null;
		const section = groups.find((group) => group.id === badge?.sectionId);
		// A known section with an unknown subsection still shows under it.
		let target = section?.subsections.find(
			(subsection) => subsection.id === badge?.subsectionId,
		);
		if (section && !target) {
			target = section.subsections.find((s) => s.id === OTHER);
			if (!target) {
				target = { id: OTHER, label: "", badges: [] };
				section.subsections.push(target);
			}
		}
		(target ?? other.subsections[0])?.badges.push({ held: item, badge });
	}

	return [...groups, other]
		.map((group) => ({
			...group,
			subsections: group.subsections.filter((s) => s.badges.length > 0),
		}))
		.filter((group) => group.subsections.length > 0);
}
