import type { Saver, Versioned } from "@/data/collections/saver";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { Notice } from "@/ui/Notice";

interface HeldEditsNoticeProps<T extends Versioned> {
	saver: Saver<T>;
	id: string;
	/** Turns a location such as "title" or "paths[p].days[4]" into words. */
	describe?: (location: string) => string;
	/** Called after the user settled it; "theirs" means their edits are gone. */
	onResolved?: (kept: "mine" | "theirs") => void;
}

/**
 * Shown when a save stopped and the user's edits are being held: either
 * someone else changed the same thing, or the save kept failing. Nothing is
 * lost until the user chooses.
 */
export function HeldEditsNotice<T extends Versioned>({
	saver,
	id,
	describe = (location) => location,
	onResolved,
}: HeldEditsNoticeProps<T>) {
	const held = useStore(saver.held);
	if (!held || held.id !== id) return null;

	const isConflict = held.reason === "conflict";

	const keepMine = async () => {
		try {
			await saver.reapplyHeld("mine");
			onResolved?.("mine");
		} catch {
			// The save stopped again; the notice stays with the new reason.
		}
	};

	const discard = async () => {
		const sure = await confirm({
			title: isConflict ? "Zostawić wersję z serwera?" : "Odrzucić zmiany?",
			description: "Twoje niezapisane zmiany przepadną.",
			confirmLabel: isConflict ? "Zostaw wersję z serwera" : "Odrzuć",
			destructive: true,
		});
		if (!sure) return;
		saver.dismissHeld();
		onResolved?.("theirs");
	};

	return (
		<Notice
			tone={isConflict ? "amber" : "red"}
			role="alert"
			title={
				isConflict
					? "Ktoś inny zmienił to samo w międzyczasie"
					: "Nie udało się zapisać zmian"
			}
			actions={
				<>
					<Button variant="primary" size="md" onClick={() => void keepMine()}>
						{isConflict ? "Nadpisz moimi zmianami" : "Spróbuj ponownie"}
					</Button>
					<Button size="md" onClick={() => void discard()}>
						{isConflict ? "Zostaw wersję z serwera" : "Odrzuć moje zmiany"}
					</Button>
				</>
			}
		>
			{isConflict
				? `Twoje zmiany nie przepadły. Różnice: ${held.conflicts.map(describe).join(", ")}.`
				: `${held.message}. Twoje zmiany nie przepadły.`}
		</Notice>
	);
}
