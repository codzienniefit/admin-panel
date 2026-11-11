import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/data/api/errors";
import { uploadMedia } from "@/data/collections/media";
import {
	dropProblem,
	type MediaFolder,
	uploadProblem,
} from "@/domain/mediaRules";
import { attempt } from "@/ui/tasks";
import { toast } from "@/ui/toast";

// The one way a file gets from this device into the media library: checked
// against the folder's rules, sent with progress, and reported. The library's
// "Dodaj plik" and a form field's "Wybierz z komputera" are two faces of this hook;
// the markup they share is in MediaUploadParts.tsx.

/**
 * Uploading one file at a time into a folder. `onUploaded` gets the path the
 * file was actually stored under, which can differ from its name.
 * Without a folder (an id the panel does not know) nothing can be sent.
 */
export function useMediaUpload(
	folder: MediaFolder | undefined,
	onUploaded?: (path: string) => void,
) {
	const input = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	// An upload can outlast many renders. The handler that started it would
	// report to the screen as it was then, and a screen that rebuilds its data
	// from what it saw (the content editor does) would undo what was typed in
	// the meantime. So the result goes to the handler of the latest render.
	const latest = useRef(onUploaded);
	useEffect(() => {
		latest.current = onUploaded;
	});

	const busy = progress !== null;

	const send = async (file: File) => {
		if (!folder || busy) return;
		const refused = uploadProblem(folder, file);
		setProblem(refused);
		if (refused) return;

		setProgress(0);
		const sent = await attempt(() => uploadMedia(file, folder.id, setProgress));
		setProgress(null);
		if (!sent.ok) {
			setProblem(errorMessage(sent.error, "Nie udało się wysłać pliku"));
			return;
		}
		const result = sent.value;
		toast({
			title: "Plik dodany",
			description: result.renamedToAvoidOverwrite
				? `Taka nazwa już istniała, zapisano jako ${result.relativePath}`
				: result.relativePath,
			tone: "green",
		});
		latest.current?.(result.relativePath);
	};

	/** What was dropped onto a field: one acceptable file, or a problem. */
	const drop = (files: readonly File[]) => {
		if (!folder || busy) return;
		const refused = dropProblem(folder, files);
		const [file] = files;
		if (refused || !file) {
			setProblem(refused);
			return;
		}
		void send(file);
	};

	return {
		folder,
		busy,
		/** 0 to 1 while a file is being sent, otherwise null. */
		progress,
		/** Why the last file was not taken, in words for the screen. */
		problem,
		send,
		drop,
		/** Opens the device's file chooser (needs MediaUploadButton on screen). */
		choose: () => input.current?.click(),
		/** Forgets the last problem, once the field got its file another way. */
		dismiss: () => setProblem(null),
		input,
	};
}

export type MediaUploadState = ReturnType<typeof useMediaUpload>;
