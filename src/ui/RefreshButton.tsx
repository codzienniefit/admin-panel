import { useState } from "react";
import { Button } from "./Button";
import { attempt, whileBusy } from "./tasks";
import { toast } from "./toast";

// Fetches a list again from the backend. Lists load once and stay as they
// are (nothing refetches on its own), so a change made elsewhere (by someone
// else, in Retool, on another tab) shows only after this, or a page reload.

/** What a list page needs to refetch everything it shows. */
export type Refresh = () => Promise<unknown>;

/** Refetches each of these collections, all at once. */
export const refreshing =
	(
		...collections: ReadonlyArray<{
			utils: { refetch: () => Promise<unknown> };
		}>
	): Refresh =>
	() =>
		Promise.all(collections.map((collection) => collection.utils.refetch()));

export function RefreshButton({ onRefresh }: { onRefresh: Refresh }) {
	const [busy, setBusy] = useState(false);
	return (
		<Button
			size="md"
			disabled={busy}
			title="Pobiera listę od nowa z serwera. Zmiany sprzed chwili mogą dotrzeć do kilku minut później: backend trzyma część odpowiedzi w pamięci."
			onClick={async () => {
				const done = await whileBusy(setBusy, () => attempt(onRefresh));
				if (!done.ok) {
					toast({ title: "Nie udało się odświeżyć listy", tone: "red" });
				}
			}}
		>
			<span
				aria-hidden="true"
				className={busy ? "inline-block animate-spin" : ""}
			>
				↻
			</span>
			{busy ? "Odświeżanie…" : "Odśwież"}
		</Button>
	);
}
