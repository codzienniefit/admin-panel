import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/data/collections/queryClient";
import {
	userAccountQuery,
	userBadgesQuery,
	userProgressQuery,
	userSearchQuery,
} from "@/data/collections/users";

// People are read on demand and kept only in memory (see
// data/collections/users.ts), so these are queries, not live collections.

export const useUserSearch = (query: string) =>
	useQuery(userSearchQuery(query), queryClient);

export const useUserAccount = (uid: string) =>
	useQuery(userAccountQuery(uid), queryClient);

export const useUserBadges = (uid: string) =>
	useQuery(userBadgesQuery(uid), queryClient);

export const useUserProgress = (uid: string) =>
	useQuery(userProgressQuery(uid), queryClient);
