import { MediaImage } from "@/features/media/MediaImage";

const SIZES = {
	sm: "size-10",
	md: "size-16",
};

interface BadgeImageProps {
	/** Path in the media library; empty shows a dashed placeholder. */
	path: string | null;
	size?: keyof typeof SIZES;
	/** Greyed out, for a hidden badge. */
	dimmed?: boolean;
}

/** The picture of a badge, as a small round-cornered tile. */
export function BadgeImage({ path, size = "sm", dimmed }: BadgeImageProps) {
	return (
		<MediaImage
			path={path}
			className={`${SIZES[size]} shrink-0 rounded-chip`}
			imageClassName={`bg-hover object-contain ${dimmed ? "opacity-40 grayscale" : ""}`}
		/>
	);
}
