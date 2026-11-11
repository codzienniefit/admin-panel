import { confirm } from "./confirm";
import { Dialog } from "./Dialog";
import { Loading } from "./Loading";
import { Menu, type MenuAction } from "./Menu";

// Pieces every editor that opens over a list needs: what to show while its
// record loads or when the address names one that does not exist, the
// question asked before unsaved input is thrown away, and the "more actions"
// menu of its footer.

interface EditorPlaceholderProps {
	/** Still loading. Otherwise the record does not exist. */
	loading: boolean;
	/** "Nie ma takiej wiadomości". */
	missingTitle: string;
	/** What may have happened, in a sentence. */
	missingText: string;
	onClose: () => void;
	size?: "sm" | "md" | "lg" | "full";
}

/** Stands in for an editor whose record is loading or does not exist. */
export function EditorPlaceholder({
	loading,
	missingTitle,
	missingText,
	onClose,
	size = "lg",
}: EditorPlaceholderProps) {
	return (
		<Dialog
			open
			onClose={onClose}
			title={loading ? "Wczytywanie…" : missingTitle}
			description={loading ? undefined : missingText}
			size={size}
		>
			{loading && (
				<div className="flex flex-col gap-3">
					<Loading />
					<Loading />
					<Loading />
				</div>
			)}
		</Dialog>
	);
}

/**
 * Asks before input that was not saved is thrown away. Resolves to true when
 * there is nothing to lose or the person chose to lose it.
 */
export async function confirmDiscard(
	unsaved: boolean,
	/** "Zmiany w tej wiadomości nie zostały zapisane." */
	text: string,
): Promise<boolean> {
	if (!unsaved) return true;
	return confirm({
		title: "Zamknąć bez zapisywania?",
		description: text,
		confirmLabel: "Zamknij bez zapisu",
		destructive: true,
	});
}

/** The "Więcej" menu at the start of an editor's footer. */
export function MoreActions({ actions }: { actions: readonly MenuAction[] }) {
	if (actions.length === 0) return null;
	return (
		<div className="md:mr-auto">
			<Menu
				label="Więcej akcji"
				trigger="Więcej ▾"
				triggerClassName="h-9 w-full rounded-control border border-line-input px-4 text-sm hover:border-primary md:w-auto"
				align="start"
				actions={actions}
			/>
		</div>
	);
}
