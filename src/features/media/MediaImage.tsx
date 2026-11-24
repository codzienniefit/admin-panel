import { useEffect, useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import { Spinner } from "@/ui/Loading";

// The one place a picture from the media library is drawn. Every thumbnail
// in the panel goes through here, so it behaves the same everywhere:
//
// - no picture chosen: an empty box with its text ("brak grafiki");
// - loading: a spinner in the box, never the "no picture" text;
// - a load that fails is tried again a little later (a long list asks for
//   many files at once, and one refused in a busy moment would otherwise stay
//   empty while the same picture loads fine in the editor), with the spinner
//   still showing;
// - when the tries run out: a "refresh" button that starts again.
//
// A failed answer is never kept by the browser, so a new try really asks
// again. A picture that did load is kept by the browser (the Worker allows
// it for a day), so it shows at once the next time.

/** The empty box, unless a screen asks for another look. */
const DASHED = "border border-line-input border-dashed text-xs text-muted";

/** Waits before each new try; when they run out the refresh button shows. */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

interface MediaImageProps {
	/** Path in the media library; null or empty shows the placeholder. */
	path: string | null;
	/** Size and shape. Goes on the box, loaded or not. */
	className?: string;
	/** Text inside the placeholder, e.g. "brak grafiki". */
	placeholder?: string;
	/** How the picture fills its box and what is around it. */
	imageClassName?: string;
	/** The placeholder's look, where a dashed outline does not fit. */
	placeholderClassName?: string;
}

/** What happened so far, for one path: another path starts from nothing. */
interface Attempt {
	path: string | null;
	/** Loads that failed since the last fresh start. */
	failures: number;
	/** Waiting before the next try. */
	waiting: boolean;
	loaded: boolean;
	/** Counts fresh starts, so a refresh gets a new element. */
	round: number;
}

const fresh = (path: string | null, round = 0): Attempt => ({
	path,
	failures: 0,
	waiting: false,
	loaded: false,
	round,
});

export function MediaImage({
	path,
	className = "",
	placeholder,
	imageClassName = "object-cover",
	placeholderClassName = DASHED,
}: MediaImageProps) {
	const [attempt, setAttempt] = useState<Attempt>(() => fresh(path));
	const current = attempt.path === path ? attempt : fresh(path);

	const delay = current.waiting
		? MEDIA_RETRY_DELAYS_MS[current.failures - 1]
		: undefined;
	useEffect(() => {
		if (delay === undefined) return;
		const timer = setTimeout(
			() =>
				setAttempt((now) =>
					now.path === path ? { ...now, waiting: false } : now,
				),
			delay,
		);
		return () => clearTimeout(timer);
	}, [delay, path]);

	if (!path) {
		return (
			<span
				className={`flex items-center justify-center ${className} ${placeholderClassName}`}
			>
				{placeholder}
			</span>
		);
	}

	const givenUp = current.failures > MEDIA_RETRY_DELAYS_MS.length;
	const busy = !current.loaded && !givenUp;

	return (
		<span
			className={`relative flex items-center justify-center overflow-hidden ${className} ${current.loaded ? "" : "bg-hover"}`}
			aria-busy={busy || undefined}
		>
			{!current.waiting && !givenUp && (
				<img
					// a new element for each try, so the browser asks again
					key={`${current.round}-${current.failures}`}
					src={mediaUrl(path)}
					alt=""
					loading="lazy"
					onLoad={() =>
						setAttempt((now) => ({
							...(now.path === path ? now : fresh(path)),
							loaded: true,
						}))
					}
					onError={() =>
						setAttempt((now) => {
							const before = now.path === path ? now : fresh(path);
							const failures = before.failures + 1;
							return {
								...before,
								failures,
								loaded: false,
								waiting: failures <= MEDIA_RETRY_DELAYS_MS.length,
							};
						})
					}
					className={`absolute inset-0 size-full transition-opacity ${current.loaded ? "opacity-100" : "opacity-0"} ${imageClassName}`}
				/>
			)}
			{busy && <Spinner className="size-5 max-h-[60%] max-w-[60%]" />}
			{givenUp && (
				// A span, not a button: the picture often sits inside a clickable
				// row or tile, and a button inside a button is not allowed.
				// biome-ignore lint/a11y/useSemanticElements: see above
				<span
					role="button"
					tabIndex={0}
					title="Nie udało się wczytać obrazu. Kliknij, żeby spróbować ponownie."
					aria-label="Wczytaj obraz ponownie"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setAttempt((now) => fresh(path, now.round + 1));
					}}
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
						setAttempt((now) => fresh(path, now.round + 1));
					}}
					className="flex size-full cursor-pointer items-center justify-center text-lg text-muted outline-none hover:text-ink focus-visible:shadow-focus"
				>
					↻
				</span>
			)}
		</span>
	);
}
