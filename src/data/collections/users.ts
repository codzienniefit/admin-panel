import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { isApiError } from "@/data/api/errors";
import type { UserAccount, UserBadge } from "@/data/schemas/user";
import { isSearchable } from "@/domain/userRules";
import { queryClient } from "./queryClient";

// People are personal data, so there is deliberately no collection holding
// "all users". The panel only ever has what one search returned and the
// accounts that were opened, in the query cache: in memory, never in
// localStorage, and dropped a few minutes after the screen is left.
//
// Screens read with useQuery(…, queryClient) and change things only through
// the functions below, which put the server's answer back in the cache.

const KEEP_MS = 5 * 60_000;

/** A missing person stays missing; anything else is worth one more try. */
const retry = (failures: number, error: unknown) =>
	failures < 1 && !(isApiError(error) && error.kind === "notFound");

const shared = { staleTime: 60_000, gcTime: KEEP_MS, retry };

export const userSearchQuery = (query: string) =>
	queryOptions({
		queryKey: ["users", "search", query.trim()] as const,
		queryFn: () => api.users.search(query.trim()),
		// Too short a query is not sent at all.
		enabled: isSearchable(query),
		...shared,
	});

export const userAccountQuery = (uid: string) =>
	queryOptions({
		queryKey: ["users", "account", uid] as const,
		queryFn: () => api.users.get(uid),
		...shared,
	});

export const userBadgesQuery = (uid: string) =>
	queryOptions({
		queryKey: ["users", "badges", uid] as const,
		queryFn: () => api.users.badges(uid),
		...shared,
	});

export const userProgressQuery = (uid: string) =>
	queryOptions({
		queryKey: ["users", "progress", uid] as const,
		queryFn: () => api.users.progress(uid),
		...shared,
	});

export async function changeUserEmail(
	uid: string,
	email: string,
): Promise<UserAccount> {
	const account = await api.users.changeEmail(uid, email);
	queryClient.setQueryData(userAccountQuery(uid).queryKey, account);
	// Search results may still show the old address.
	queryClient.removeQueries({ queryKey: ["users", "search"] });
	return account;
}

export async function grantUserBadge(
	uid: string,
	badgeId: string,
): Promise<UserBadge[]> {
	const held = await api.users.grantBadge(uid, badgeId);
	queryClient.setQueryData(userBadgesQuery(uid).queryKey, held);
	return held;
}

export async function revokeUserBadge(
	uid: string,
	badge: UserBadge,
): Promise<UserBadge[]> {
	const held = await api.users.revokeBadge(uid, badge);
	queryClient.setQueryData(userBadgesQuery(uid).queryKey, held);
	return held;
}
