import { currentEnvironment, onThisComputer } from "@/data/environment";
import { createMockAuth } from "./mock";
import { createServerAuth } from "./server";
import { createGatedTestAuth } from "./testGate";
import type { AuthProvider } from "./types";

// One sign-in system per environment, like the ApiClient. On the deployed panel, Test opens only
// behind a real sign-in (testGate.ts); on this computer it is the demo sign-in alone.
function createAuth(): AuthProvider {
	if (currentEnvironment() === "production") return createServerAuth();
	return onThisComputer()
		? createMockAuth()
		: createGatedTestAuth(createMockAuth(), createServerAuth());
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
