import { isApiError } from "@/data/api/errors";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { type TabItem, Tabs } from "@/ui/Tabs";
import { AccountTags } from "./AccountTags";
import { UserAccountTab } from "./UserAccountTab";
import { UserBadgesTab } from "./UserBadgesTab";
import { UserProgressTab } from "./UserProgressTab";
import { personName } from "./userMeta";
import { useUserAccount } from "./useUsers";

export type UserTab = "badges" | "progress" | "account";

const TABS: readonly TabItem<UserTab>[] = [
	{ id: "badges", label: "Odznaki" },
	{ id: "progress", label: "Wykonania" },
	{ id: "account", label: "Dane ogólne" },
];

interface UserPageProps {
	uid: string;
	tab: UserTab;
	onTabChange: (tab: UserTab) => void;
	/** Back to the search, with its query as it was. */
	onBack: () => void;
}

/** One person: their badges, what they have done, and their account. */
export function UserPage({ uid, tab, onTabChange, onBack }: UserPageProps) {
	const account = useUserAccount(uid);
	const showLoading = useDelayedLoading(account.isLoading);

	const back = (
		<button
			type="button"
			onClick={onBack}
			className="self-start text-sm text-muted hover:text-primary"
		>
			← Wyszukiwanie
		</button>
	);

	if (account.isLoading) {
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-4">
				{back}
				{showLoading && (
					<>
						<Loading />
						<Loading />
						<Loading />
					</>
				)}
			</div>
		);
	}

	if (!account.data) {
		const missing =
			isApiError(account.error) && account.error.kind === "notFound";
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-4">
				{back}
				{missing ? (
					<EmptyState
						title="Nie ma takiego użytkownika"
						action={<Button onClick={onBack}>Wróć do wyszukiwania</Button>}
					>
						Konto o tym identyfikatorze nie istnieje albo zostało usunięte.
						Sprawdź adres albo wyszukaj osobę jeszcze raz.
					</EmptyState>
				) : (
					<Notice
						tone="red"
						role="alert"
						title="Nie udało się wczytać konta"
						actions={
							<Button onClick={() => void account.refetch()}>
								Spróbuj ponownie
							</Button>
						}
					>
						Sprawdź połączenie i spróbuj jeszcze raz.
					</Notice>
				)}
			</div>
		);
	}

	const user = account.data;

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<header className="flex flex-col gap-3">
				{back}
				<div>
					<h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
						{personName(user)}
					</h1>
					<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
						{user.displayName && user.email && (
							<span className="text-sm text-subtle [overflow-wrap:anywhere]">
								{user.email}
							</span>
						)}
						<AccountTags user={user} />
					</div>
				</div>
				<Tabs
					label="Części profilu"
					tabs={TABS}
					value={tab}
					onChange={onTabChange}
				/>
			</header>

			{tab === "badges" && (
				<UserBadgesTab uid={user.uid} person={personName(user)} />
			)}
			{tab === "progress" && <UserProgressTab uid={user.uid} />}
			{tab === "account" && <UserAccountTab account={user} />}
		</div>
	);
}
