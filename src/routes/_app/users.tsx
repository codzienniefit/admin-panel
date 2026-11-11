import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";

// The search query lives in the address of the whole section, so that going
// into a person's page and back returns to the same results. It is the only
// place a query is kept: nothing about a search is stored in the browser.
const searchSchema = z.object({
	q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/users")({
	validateSearch: (search) => searchSchema.parse(search),
	component: Outlet,
});
