import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable, refuse } from "@/data/api/capabilities";
import { ApiError, isApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import {
	type UserAccount,
	type UserBadge,
	type UserProgress,
	type UserSearchResult,
	userAccountSchema,
	userBadgeSchema,
	userProgressSchema,
	userSearchResultSchema,
} from "@/data/schemas/user";
import { isSearchable, USER_SEARCH_LIMIT } from "@/domain/userRules";
import { conform, isoInstantOrNull, isoOrNull } from "./shared";
import type { Transport } from "./transport";

// People who use the app: `manageUsers`, `accounts/{uid}`,
// `manageUserBadges/{uid}` and `manageUserProgress/{uid}` of the backend.
//
// This is personal data. Nothing here is passed through as it came: each
// function builds exactly the fields the panel shows and drops the rest.
// The panel's routes answer `accounts/{uid}` with a typed record of exactly
// those fields (AdminUserAccountResponseDto); Retool's route, and the backend
// before 2026-11-13, with the raw Firebase record, which could carry a
// password hash. Both are read the same way, field by field.

// ─── Accounts ───────────────────────────────────────────────────────────────

const firebaseRecordSchema = z.looseObject({
	uid: z.string(),
	email: z.string().nullish(),
	displayName: z.string().nullish(),
	emailVerified: z.boolean().nullish(),
	disabled: z.boolean().nullish(),
	metadata: z
		.looseObject({
			creationTime: z.string().nullish(),
			lastSignInTime: z.string().nullish(),
		})
		.nullish(),
	providerData: z
		.array(z.looseObject({ providerId: z.string().nullish() }))
		.nullish(),
	// The typed answer (AdminUserSummaryDto) names these directly.
	providers: z.array(z.string()).nullish(),
	createdAtUtc: z.string().nullish(),
	lastSignInAtUtc: z.string().nullish(),
});

const accountAnswerSchema = z.looseObject({
	hasProSubscription: z.boolean().nullish(),
	account: z.unknown().optional(),
	user: z.unknown().optional(),
});

/** One account, from either shape the backend uses for it. */
export function toAccount(
	raw: unknown,
	hasProSubscription: boolean,
): UserAccount {
	const record = conform(firebaseRecordSchema, raw, "Konto użytkownika");
	const providers =
		record.providers ??
		(record.providerData ?? [])
			.map((provider) => provider.providerId)
			.filter((id): id is string => typeof id === "string" && id !== "");
	// Built field by field: nothing else in the record reaches the panel.
	return conform(
		userAccountSchema,
		{
			uid: record.uid,
			email: record.email ?? null,
			displayName: record.displayName ?? null,
			emailVerified: record.emailVerified ?? false,
			disabled: record.disabled ?? false,
			providers,
			// Firebase writes these as "Tue, 03 Nov 2026 12:00:00 GMT".
			createdAtUtc:
				record.createdAtUtc ?? isoOrNull(record.metadata?.creationTime),
			lastSignInAtUtc:
				record.lastSignInAtUtc ?? isoOrNull(record.metadata?.lastSignInTime),
			hasProSubscription,
		},
		`Konto ${record.uid}`,
	);
}

const searchAnswerSchema = z.looseObject({
	users: z.array(z.unknown()).nullish(),
	totalMatches: z.number().nullish(),
	truncated: z.boolean().nullish(),
	indexedAtUtc: z.string().nullish(),
});

/** The rows of a search, each cut down to what the list shows. */
export function toSearchResult(raw: unknown): UserSearchResult {
	const wire = conform(searchAnswerSchema, raw, "Wyniki wyszukiwania");
	const users = (wire.users ?? []).map((row) => {
		const { hasProSubscription: _pro, ...summary } = toAccount(row, false);
		return summary;
	});
	return conform(
		userSearchResultSchema,
		{
			users,
			totalMatches: wire.totalMatches ?? users.length,
			truncated: wire.truncated ?? false,
			// When the list of accounts behind the answer was read (the backend
			// keeps it for up to half an hour; a full address is always looked
			// up live). Not personal data.
			...(wire.indexedAtUtc ? { indexedAtUtc: wire.indexedAtUtc } : {}),
		},
		"Wyniki wyszukiwania",
	);
}

// ─── Badges ─────────────────────────────────────────────────────────────────

const badgeSectionsSchema = z.looseObject({
	sections: z
		.array(
			z.looseObject({
				subsections: z
					.array(
						z.looseObject({
							badges: z
								.array(
									z.looseObject({
										id: z.string(),
										isActive: z.boolean().nullish(),
									}),
								)
								.nullish(),
						}),
					)
					.nullish(),
			}),
		)
		.nullish(),
});

const grantsSchema = z.array(
	z.looseObject({
		grantId: z.string(),
		badgeId: z.string(),
		grantedAtUtc: z.string(),
	}),
);

/**
 * The badges a person holds, newest first where a date is known.
 *
 * The backend describes them twice: every badge with whether it is earned
 * (no date), and every badge given by hand or claimed with a code (with its
 * date and the id needed to take it back). A badge of the second kind is
 * listed once per grant; any other earned badge once, with an empty date.
 */
export function toUserBadges(
	sectionsRaw: unknown,
	grantsRaw: unknown,
): UserBadge[] {
	const sections = conform(
		badgeSectionsSchema,
		sectionsRaw,
		"Odznaki użytkownika",
	);
	const grants = conform(grantsSchema, grantsRaw, "Nadane odznaki użytkownika");

	const granted: UserBadge[] = grants.map((grant) =>
		conform(
			userBadgeSchema,
			{
				badgeId: grant.badgeId,
				earnedAtUtc: grant.grantedAtUtc,
				grantId: grant.grantId,
			},
			"Nadana odznaka",
		),
	);
	const byGrant = new Set(granted.map((badge) => badge.badgeId));
	const earned: UserBadge[] = [];
	for (const section of sections.sections ?? []) {
		for (const subsection of section.subsections ?? []) {
			for (const badge of subsection.badges ?? []) {
				if (!badge.isActive || byGrant.has(badge.id)) continue;
				byGrant.add(badge.id);
				earned.push(
					conform(
						userBadgeSchema,
						{ badgeId: badge.id, earnedAtUtc: "", grantId: null },
						"Odznaka użytkownika",
					),
				);
			}
		}
	}
	granted.sort((a, b) => b.earnedAtUtc.localeCompare(a.earnedAtUtc));
	return [...granted, ...earned];
}

// ─── Progress ───────────────────────────────────────────────────────────────

const progressSchema = z.looseObject({
	workouts: z
		.array(
			z.looseObject({
				id: z.string(),
				completions: z
					.array(z.looseObject({ completedAtUtc: z.string().nullish() }))
					.nullish(),
			}),
		)
		.nullish(),
	challenges: z
		.array(
			z.looseObject({
				id: z.string(),
				attempts: z
					.array(
						z.looseObject({
							path: z.string().nullish(),
							startedAtUtc: z.string(),
							completedAtUtc: z.string().nullish(),
							abortedAtUtc: z.string().nullish(),
							dayCompletions: z.array(z.unknown()).nullish(),
						}),
					)
					.nullish(),
			}),
		)
		.nullish(),
});

/**
 * What a person did, as two flat lists, newest first. The backend groups
 * by workout and by challenge; the panel shows a history.
 */
export function toUserProgress(raw: unknown): UserProgress {
	const wire = conform(progressSchema, raw, "Postępy użytkownika");
	const workouts = (wire.workouts ?? []).flatMap((workout) =>
		(workout.completions ?? [])
			.filter((completion) => completion.completedAtUtc)
			.map((completion) => ({ ...completion, workoutId: workout.id })),
	);
	const challenges = (wire.challenges ?? []).flatMap((challenge) =>
		(challenge.attempts ?? []).map(({ path, dayCompletions, ...attempt }) => ({
			...attempt,
			challengeId: challenge.id,
			// An attempt names its variant by level.
			levelId: path ?? null,
			completedDays: dayCompletions?.length ?? 0,
		})),
	);
	const newest = (a: string, b: string) => b.localeCompare(a);
	workouts.sort((a, b) =>
		newest(a.completedAtUtc ?? "", b.completedAtUtc ?? ""),
	);
	challenges.sort((a, b) => newest(a.startedAtUtc, b.startedAtUtc));
	return conform(
		userProgressSchema,
		{ workouts, challenges },
		"Postępy użytkownika",
	);
}

// ─── The area ───────────────────────────────────────────────────────────────

const NO_ACCOUNT = "Nie ma takiego konta.";

const EMPTY_SEARCH: UserSearchResult = {
	users: [],
	totalMatches: 0,
	truncated: false,
};

/**
 * The first search on a fresh backend instance lists every account to build
 * its index (about a call per thousand accounts) and can take a minute; later
 * ones read the index. Below Cloudflare's 100 s limit for an answer.
 */
export const USER_SEARCH_TIMEOUT_MS = 90_000;

/** Firebase ids are 28 letters and digits; anything close is worth a direct look. */
const looksLikeUid = (query: string): boolean =>
	/^[A-Za-z0-9]{20,40}$/.test(query);

export function usersArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["users"] {
	const segment = (uid: string) => {
		const trimmed = uid.trim();
		if (trimmed === "") throw new ApiError("notFound", NO_ACCOUNT);
		return trimmed;
	};

	async function get(uid: string): Promise<UserAccount> {
		// The panel's route answers 404 for an id nobody has.
		const answer = await transport.request({
			path: ["accounts", segment(uid)],
			schema: accountAnswerSchema,
			what: "Konto użytkownika",
		});
		// Retool's route: a 200 with only a message.
		const record =
			answer.account ?? (typeof answer.uid === "string" ? answer : null);
		if (!record) throw new ApiError("notFound", NO_ACCOUNT);
		return toAccount(record, answer.hasProSubscription ?? false);
	}

	async function badges(uid: string): Promise<UserBadge[]> {
		const id = segment(uid);
		const [sections, grants] = await Promise.all([
			transport.request({ path: ["manageUserBadges", id] }),
			transport.request({ path: ["manageUserBadges", id, "grants"] }),
		]);
		return toUserBadges(sections, grants);
	}

	return {
		get,
		badges,
		async search(query) {
			const text = query.trim();
			// Too short as a whole or word by word (domain/userRules, the
			// backend's own rule): nothing is asked for, and the screen says why.
			if (!isSearchable(text)) return EMPTY_SEARCH;
			// The search looks at e-mail and name only, and on a fresh backend
			// instance it first lists every account. An id is one direct look-up,
			// so it goes first; only when no account has it is the text searched.
			if (looksLikeUid(text)) {
				try {
					const account = await get(text);
					const { hasProSubscription: _pro, ...summary } = account;
					return { users: [summary], totalMatches: 1, truncated: false };
				} catch (error) {
					if (!isApiError(error) || error.kind !== "notFound") throw error;
				}
			}
			return toSearchResult(
				await transport.request({
					path: ["manageUsers"],
					// The query and the limit, and nothing else: the backend
					// refuses a limit above this one and a `refresh` from the panel.
					query: { query: text, limit: USER_SEARCH_LIMIT },
					timeoutMs: USER_SEARCH_TIMEOUT_MS,
				}),
			);
		},
		async progress(uid) {
			return toUserProgress(
				await transport.request({ path: ["manageUserProgress", segment(uid)] }),
			);
		},
		async changeEmail(uid, email) {
			assertWritable(capabilities, "users", null);
			const answer = await transport.request({
				method: "PUT",
				path: ["accounts", segment(uid)],
				// The address and nothing else: the panel's route refuses any
				// other field.
				body: { email: email.trim() },
			});
			// The panel's route answers with the account as GET does. Retool's
			// names no subscription state, so there the account is read again.
			const changed = accountAnswerSchema.safeParse(answer);
			if (
				changed.success &&
				changed.data.account != null &&
				typeof changed.data.hasProSubscription === "boolean"
			) {
				return toAccount(changed.data.account, changed.data.hasProSubscription);
			}
			return get(uid);
		},
		async grantBadge(uid, badgeId) {
			assertWritable(capabilities, "userBadges", null);
			await transport.request({
				method: "POST",
				path: ["manageBadges", "grantManual"],
				// Both ids exactly as stored: with a space around them they are
				// refused, not looked up without it.
				body: { userId: segment(uid), badgeId: badgeId.trim() },
			});
			return badges(uid);
		},
		async revokeBadge(uid, badge) {
			assertWritable(capabilities, "userBadges", null);
			if (!badge.grantId) {
				refuse(
					"Tę odznakę użytkownik zdobył sam; odebrać można tylko nadaną ręcznie albo odebraną kodem.",
				);
			}
			await transport.request({
				method: "POST",
				path: ["manageBadges", "revokeManual"],
				// The backend finds the grant by its date: the full instant the
				// list of grants gave, never a date it would have to guess.
				body: {
					userId: segment(uid),
					badgeId: badge.badgeId.trim(),
					grantedAtUtc: isoInstantOrNull(badge.earnedAtUtc),
				},
			});
			return badges(uid);
		},
	};
}
