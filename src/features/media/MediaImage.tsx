import { useState } from "react";
import { mediaUrl } from "@/data/collections/media";

// The one place a picture from the media library is drawn. Every thumbnail
// in the panel goes through here, so a missing file and a file that will not
// load look the same everywhere: an empty box, never a broken-image icon.

/** The empty box, unless a screen asks for another look. */
const DASHED = "border border-line-input border-dashed text-xs text-muted";

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

export function MediaImage({
	path,
	className = "",
	placeholder,
	imageClassName = "object-cover",
	placeholderClassName = DASHED,
}: MediaImageProps) {
	// The path that failed, not a flag: another path gets its own chance.
	const [failed, setFailed] = useState<string | null>(null);

	if (!path || failed === path) {
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
			src={mediaUrl(path)}
			alt=""
			loading="lazy"
			onError={() => setFailed(path)}
			className={`${className} ${imageClassName}`}
		/>
	);
}
