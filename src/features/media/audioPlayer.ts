import { mediaUrl } from "@/data/collections/media";
import { createStore } from "@/lib/store";

// One audio element for the whole panel, so starting a file stops the
// previous one.

/** The path being played, or null. */
export const nowPlaying = createStore<string | null>(null);

let element: HTMLAudioElement | null = null;

export function togglePlayback(path: string): void {
	if (nowPlaying.get() === path) {
		element?.pause();
		nowPlaying.set(null);
		return;
	}
	element?.pause();
	element = new Audio(mediaUrl(path));
	element.addEventListener("ended", () => nowPlaying.set(null));
	element.addEventListener("error", () => nowPlaying.set(null));
	nowPlaying.set(path);
	void element.play().catch(() => nowPlaying.set(null));
}
