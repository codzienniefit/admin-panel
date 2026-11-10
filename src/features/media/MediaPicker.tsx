import { useState } from "react";
import { Dialog } from "@/ui/Dialog";
import { MediaBrowser } from "./MediaBrowser";

interface MediaPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	kind: "image" | "audio";
	/** The folder the picker opens in. */
	folderId: string;
	value: string | null;
	onPick: (path: string) => void;
}

/** The media library in a dialog, for choosing one file from a form. */
export function MediaPicker({
	open,
	onOpenChange,
	kind,
	folderId,
	value,
	onPick,
}: MediaPickerProps) {
	const [folder, setFolder] = useState(folderId);
	const [query, setQuery] = useState("");

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={kind === "audio" ? "Wybierz plik audio" : "Wybierz grafikę"}
			description="Kliknij plik, żeby go wybrać, albo dodaj nowy."
			size="lg"
		>
			<MediaBrowser
				kind={kind}
				folderId={folder}
				onFolderChange={setFolder}
				query={query}
				onQueryChange={setQuery}
				selectedPath={value}
				onPick={(path) => {
					onPick(path);
					onOpenChange(false);
				}}
			/>
		</Dialog>
	);
}
