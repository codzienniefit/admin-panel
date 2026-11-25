import type { Workout } from "@/data/schemas/workout";
import { MediaImage } from "@/features/media/MediaImage";

/**
 * A workout's picture on its card in the planner: small, so a day with four
 * workouts still fits. Nothing at all for a workout without a picture, so
 * cards without one do not grow an empty box.
 */
export function plannerThumbnail(workout: Workout | undefined) {
	if (!workout?.imageRelativePath) return undefined;
	return (
		<MediaImage
			path={workout.imageRelativePath}
			className="h-8 w-12 rounded-sm"
			zoomOnHover
			imageClassName="object-cover"
		/>
	);
}
