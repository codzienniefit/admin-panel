import { currentEnvironment } from "@/data/environment";
import { createMockAuth } from "./mock";
import { createServerAuth } from "./server";
import type { AuthProvider } from "./types";

// One sign-in system per environment, like the ApiClient.
function createAuth(): AuthProvider {
	return currentEnvironment() === "test"
		? createMockAuth()
		: createServerAuth();
}

export const auth: AuthProvider = createAuth();

/**
 * Signs out and loads the login page from scratch, so nothing loaded for one
 * person stays in memory for the next.
 */
export async function signOutAndLeave(): Promise<void> {
	await auth.signOut();
	window.location.assign("/login");
}
