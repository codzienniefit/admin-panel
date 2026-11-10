import { currentEnvironment } from "@/data/environment";
import { createMockAuth } from "./mock";
import type { AuthProvider } from "./types";

// One sign-in system per environment, like the ApiClient.
function createAuth(): AuthProvider {
	const environment = currentEnvironment();
	if (environment === "test") return createMockAuth();
	throw new Error(`Środowisko "${environment}" nie jest jeszcze dostępne.`);
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
