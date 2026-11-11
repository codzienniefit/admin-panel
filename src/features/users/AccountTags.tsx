import type { ReactNode } from "react";
import type { UserSummary } from "@/data/schemas/user";
import { Tag } from "@/ui/Tag";
import { ACCOUNT_FLAG_META as FLAGS } from "./userMeta";

interface AccountTagsProps {
	user: Pick<UserSummary, "disabled" | "emailVerified"> & {
		/** Known only once the account itself has been opened. */
		hasProSubscription?: boolean;
	};
	/** Shown when there is nothing to flag. */
	fallback?: ReactNode;
}

/** What stands out about an account: blocked, unconfirmed address, Pro. */
export function AccountTags({ user, fallback = null }: AccountTagsProps) {
	const nothing =
		!user.disabled && user.emailVerified && !user.hasProSubscription;
	if (nothing) return <>{fallback}</>;
	return (
		<span className="flex flex-wrap gap-1">
			{user.hasProSubscription && (
				<Tag tone={FLAGS.pro.tone}>{FLAGS.pro.label}</Tag>
			)}
			{user.disabled && (
				<Tag tone={FLAGS.disabled.tone}>{FLAGS.disabled.label}</Tag>
			)}
			{!user.emailVerified && (
				<Tag tone={FLAGS.unverified.tone}>{FLAGS.unverified.label}</Tag>
			)}
		</span>
	);
}
