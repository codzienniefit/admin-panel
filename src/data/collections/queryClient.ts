import { QueryClient } from "@tanstack/react-query";

// Lists are loaded once and kept; saves write their confirmed result straight
// into the collection, so nothing needs refetching on focus.
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
