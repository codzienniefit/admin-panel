import type { UserSummary } from "@/data/schemas/user";
import type { AttemptState } from "@/domain/userRules";
import type { EnumMeta } from "@/ui/enums";

// How things about a person are worded and coloured, in the style of
// src/ui/enums.ts.

const PROVIDERS: Record<string, string> = {
	password: "E-mail i hasło",
	"google.com": "Google",
	"apple.com": "Apple",
	"facebook.com": "Facebook",
};

/** "google.com" → "Google". An unknown method shows as it came. */
export const providerLabel = (provider: string): string =>
	PROVIDERS[provider] ?? provider;

export const ATTEMPT_STATE_META: Record<AttemptState, EnumMeta> = {
	active: { label: "W trakcie", tone: "blue" },
	completed: { label: "Ukończone", tone: "green" },
	aborted: { label: "Przerwane", tone: "grey" },
};

/** What to call a person on screen when they gave no name. */
export const personName = (
	user: Pick<UserSummary, "displayName" | "email">,
): string => user.displayName || user.email || "Osoba bez nazwy";

/** What can be said about an account at a glance. */
export const ACCOUNT_FLAG_META = {
	disabled: { label: "Zablokowane", tone: "red" },
	unverified: { label: "E-mail niepotwierdzony", tone: "amber" },
	// The same colour "Pro" has on workouts and challenges.
	pro: { label: "Pro", tone: "indigo" },
} as const satisfies Record<string, EnumMeta>;
