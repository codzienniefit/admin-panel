import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { confirmDiscard } from "@/ui/EditorParts";

/**
 * Asks before unsaved input is lost by leaving: the browser's Back button, a
 * link in the top bar, closing the tab. Buttons that already asked, or that
 * leave because the input was just saved, call the returned function first so
 * the person is not asked twice.
 */
export function useUnsavedGuard(unsaved: boolean, text: string): () => void {
	const released = useRef(false);

	useBlocker({
		disabled: !unsaved,
		enableBeforeUnload: unsaved,
		shouldBlockFn: async () =>
			released.current ? false : !(await confirmDiscard(true, text)),
	});

	// A new round of editing is guarded again.
	useEffect(() => {
		if (!unsaved) released.current = false;
	}, [unsaved]);

	return () => {
		released.current = true;
	};
}
