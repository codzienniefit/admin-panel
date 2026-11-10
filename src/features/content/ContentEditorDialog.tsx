import { useState } from "react";
import type { ContentBlock } from "@/data/schemas/workout";
import { deepEqual } from "@/domain/rebase";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { Dialog } from "@/ui/Dialog";
import { ContentEditor } from "./ContentEditor";

interface ContentEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** What the dialog is editing, e.g. "Opis treningu". */
	title: string;
	value: readonly ContentBlock[];
	/** Called with the edited blocks when the user accepts them. */
	onApply: (blocks: ContentBlock[]) => void;
	imageFolderId: string;
}

/** The content editor in a window-sized dialog, working on a copy. */
export function ContentEditorDialog(props: ContentEditorDialogProps) {
	// Mounted only while open, so every opening starts from the current value.
	if (!props.open) return null;
	return <OpenEditor {...props} />;
}

function OpenEditor({
	onOpenChange,
	title,
	value,
	onApply,
	imageFolderId,
}: ContentEditorDialogProps) {
	const [draft, setDraft] = useState<ContentBlock[]>(() =>
		structuredClone([...value]),
	);
	const changed = !deepEqual(draft, value);

	const close = async () => {
		if (changed) {
			const sure = await confirm({
				title: "Zamknąć bez zatwierdzania?",
				description: "Zmiany w treści nie zostaną zachowane.",
				confirmLabel: "Zamknij",
				destructive: true,
			});
			if (!sure) return;
		}
		onOpenChange(false);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) void close();
			}}
			title={title}
			description="Treść zapisze się razem z całym formularzem."
			size="full"
			footer={
				<>
					<Button size="md" onClick={() => void close()}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						onClick={() => {
							onApply(draft);
							onOpenChange(false);
						}}
					>
						Gotowe
					</Button>
				</>
			}
		>
			<ContentEditor
				value={draft}
				onChange={setDraft}
				imageFolderId={imageFolderId}
			/>
		</Dialog>
	);
}
