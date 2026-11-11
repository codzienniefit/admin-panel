import { ApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import type { Badge } from "@/data/schemas/badge";
import type { Challenge } from "@/data/schemas/challenge";
import {
	type UserAccount,
	type UserBadge,
	userAccountSchema,
	userBadgeSchema,
	userProgressSchema,
	userSearchResultSchema,
} from "@/data/schemas/user";
import type { Workout } from "@/data/schemas/workout";
import {
	emailIssues,
	grantIssues,
	isSearchable,
	normalizeEmail,
	revokeIssues,
	USER_SEARCH_LIMIT,
	userMatches,
} from "@/domain/userRules";
import { UNKNOWN_FIELD } from "./fixtures";
import { copy, type MockKernel } from "./kernel";
import { buildUserFixtures, buildUserHistory } from "./userFixtures";

// People who use the app, as the panel may see them: found by searching,
// never listed. Their history is made up from the sample catalogue.

interface UserDeps {
	badges(): Badge[];
	workouts(): Workout[];
	challenges(): Challenge[];
}

/** A badge handed to a person, or claimed by them with a code. */
interface Grant {
	grantId: string;
	uid: string;
	badgeId: string;
	grantedAtUtc: string;
}

const byName = new Intl.Collator("pl", { sensitivity: "base" });

export function usersApi(
	kernel: MockKernel,
	deps: UserDeps,
): ApiClient["users"] {
	// Accounts hold e-mail addresses, so they stay in memory: nothing about a
	// person is written to the browser's storage. A changed address therefore
	// lasts until the page is reloaded.
	const accounts = new Map<string, UserAccount>(
		buildUserFixtures().map((account) => [account.uid, account]),
	);
	const position = new Map([...accounts.keys()].map((uid, i) => [uid, i]));

	// Grants name a person only by id, so they can be kept across reloads.
	const grants = kernel.table<Grant>(
		"userBadgeGrants",
		() => {
			const uids = [...accounts.keys()];
			const sample: Array<[index: number, badgeId: string, daysAgo: number]> = [
				[0, "s_1", 40],
				[0, "s_3", 12],
				[3, "s_1", 40],
				[7, "s_3", 90],
			];
			return sample.flatMap(([index, badgeId, daysAgo], n) => {
				const uid = uids[index];
				if (!uid) return [];
				return [
					{
						grantId: `g${n + 1}`,
						uid,
						badgeId,
						grantedAtUtc: new Date(
							Date.UTC(2026, 10, 10) - daysAgo * 86_400_000,
						).toISOString(),
					},
				];
			});
		},
		(grant) => grant.grantId,
	);

	const find = (uid: string): UserAccount => {
		const account = accounts.get(uid);
		if (!account) throw new ApiError("notFound", "Nie ma takiego użytkownika");
		return account;
	};

	function history(uid: string) {
		const definitions = new Map(deps.badges().map((b) => [b.id, b]));
		return buildUserHistory(position.get(uid) ?? 0, {
			workoutIds: deps
				.workouts()
				.filter((workout) => workout.status === "published")
				.map((workout) => workout.id),
			challenges: deps
				.challenges()
				.filter((c) => c.status === "published" || c.status === "hidden")
				.map((challenge) => ({
					id: challenge.id,
					lengthDays: challenge.lengthDays,
					levelIds: challenge.paths.map((path) => path.levelId),
					badgeId:
						challenge.badgeId && definitions.has(challenge.badgeId)
							? challenge.badgeId
							: null,
				})),
			milestones: [...definitions.values()]
				.filter(
					(b) => b.type === "milestone" && b.repeatCategory === "workouts",
				)
				.map((badge) => ({ id: badge.id, count: badge.milestoneCount ?? 0 }))
				.filter((milestone) => milestone.count > 0),
		});
	}

	/** Earned in the app plus handed out, newest first. */
	function badgesOf(uid: string): UserBadge[] {
		const exists = new Set(deps.badges().map((badge) => badge.id));
		const granted: UserBadge[] = [...grants.values()]
			.filter((grant) => grant.uid === uid)
			.map((grant) => ({
				badgeId: grant.badgeId,
				earnedAtUtc: grant.grantedAtUtc,
				grantId: grant.grantId,
				[UNKNOWN_FIELD]: "userBadge",
			}));
		return [...history(uid).earned, ...granted]
			.filter((held) => exists.has(held.badgeId))
			.sort((a, b) => b.earnedAtUtc.localeCompare(a.earnedAtUtc));
	}

	const badgeList = (uid: string) =>
		userBadgeSchema.array().parse(copy(badgesOf(uid)));

	return {
		async search(query) {
			await kernel.latency();
			// Too short to mean anyone in particular: nobody is returned.
			const matches = isSearchable(query)
				? [...accounts.values()]
						.filter((account) => userMatches(account, query))
						.sort((a, b) =>
							byName.compare(
								a.displayName ?? a.email ?? "",
								b.displayName ?? b.email ?? "",
							),
						)
				: [];
			return userSearchResultSchema.parse(
				copy({
					users: matches.slice(0, USER_SEARCH_LIMIT),
					totalMatches: matches.length,
					truncated: matches.length > USER_SEARCH_LIMIT,
				}),
			);
		},
		async get(uid) {
			await kernel.latency();
			return userAccountSchema.parse(copy(find(uid)));
		},
		async badges(uid) {
			await kernel.latency();
			find(uid);
			return badgeList(uid);
		},
		async progress(uid) {
			await kernel.latency();
			find(uid);
			return userProgressSchema.parse(copy(history(uid).progress));
		},
		async changeEmail(uid, email) {
			await kernel.latency();
			kernel.takeFailure();
			const account = find(uid);
			const next = normalizeEmail(email);
			const issues = emailIssues(next, account.email);
			const taken = [...accounts.values()].some(
				(other) =>
					other.uid !== uid && normalizeEmail(other.email ?? "") === next,
			);
			if (issues.length === 0 && taken) {
				issues.push({
					path: "email",
					message: "Ten adres ma już inne konto",
				});
			}
			kernel.reject(issues);
			// A new address has not been confirmed by its owner yet.
			const changed = { ...account, email: next, emailVerified: false };
			accounts.set(uid, changed);
			return userAccountSchema.parse(copy(changed));
		},
		async grantBadge(uid, badgeId) {
			await kernel.latency();
			kernel.takeFailure();
			find(uid);
			const badge = deps.badges().find((item) => item.id === badgeId);
			const held = badgesOf(uid).some((item) => item.badgeId === badgeId);
			kernel.reject(grantIssues(badge, held));
			const grantId = kernel.freeId("g", grants);
			grants.set(grantId, {
				grantId,
				uid,
				badgeId,
				grantedAtUtc: kernel.now(),
			});
			kernel.persist();
			return badgeList(uid);
		},
		async revokeBadge(uid, badge) {
			await kernel.latency();
			kernel.takeFailure();
			find(uid);
			kernel.reject(revokeIssues(badge));
			const grant = badge.grantId ? grants.get(badge.grantId) : undefined;
			if (!grant || grant.uid !== uid) {
				throw new ApiError("notFound", "Ta osoba nie ma już tej odznaki");
			}
			grants.delete(grant.grantId);
			kernel.persist();
			return badgeList(uid);
		},
	};
}
