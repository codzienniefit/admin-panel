import { useEffect, useState } from "react";
import { mediaUrl } from "@/data/collections/media";

// The one place a picture from the media library is drawn. Every thumbnail
// in the panel goes through here, so a missing file and a file that will not
// load look the same everywhere: an empty box, never a broken-image icon.
//
// A picture that fails is tried again a little later: a long list asks for
// many files at once, and one refused in a busy moment (too many requests,
// a slow backend) would otherwise stay an empty box for as long as the list
// is open, while the same picture opened in the editor loads fine. A failed
// answer is never kept by the browser, so a new try really asks again.

/** The empty box, unless a screen asks for another look. */
const DASHED = "border border-line-input border-dashed text-xs text-muted";

/** Waits before each new try; when they run out the box stays empty. */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

interface MediaImageProps {
	/** Path in the media library; null or empty shows the placeholder. */
	path: string | null;
	/** Size and shape. Goes on the picture and on the placeholder alike. */
	className?: string;
	/** Text inside the placeholder, e.g. "brak grafiki". */
	placeholder?: string;
	/** How the picture fills its box and what is around it. */
	imageClassName?: string;
	/** The placeholder's look, where a dashed outline does not fit. */
	placeholderClassName?: string;
}

/** Tries so far, for one path: another path starts from nothing. */
interface Attempt {
	path: string | null;
	/** How many loads have failed. */
	failures: number;
	/** Waiting before the next try. */
	waiting: boolean;
}

export function MediaImage({
	path,
	className = "",
	placeholder,
	imageClassName = "object-cover",
	placeholderClassName = DASHED,
}: MediaImageProps) {
	const [attempt, setAttempt] = useState<Attempt>({
		path,
		failures: 0,
		waiting: false,
	});
	const current: Attempt =
		attempt.path === path ? attempt : { path, failures: 0, waiting: false };

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

	const givenUp = current.failures > MEDIA_RETRY_DELAYS_MS.length;
	if (!path || current.waiting || givenUp) {
		return (
			<span
				className={`flex items-center justify-center ${className} ${placeholderClassName}`}
			>
				{placeholder}
			</span>
		);
	}
	return (
		<img
			// a new element for each try, so the browser asks again
			key={current.failures}
			src={mediaUrl(path)}
			alt=""
			loading="lazy"
			onError={() =>
				setAttempt((now) => {
					const failures = (now.path === path ? now.failures : 0) + 1;
					return {
						path,
						failures,
						waiting: failures <= MEDIA_RETRY_DELAYS_MS.length,
					};
				})
			}
			className={`${className} ${imageClassName}`}
		/>
	);
}
