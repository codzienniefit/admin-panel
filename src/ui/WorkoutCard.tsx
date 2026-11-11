import type { ReactNode } from "react";
import type { ContentStatus } from "@/data/schemas/challenge";
import { isHexColor, readableTextOn } from "@/domain/palette";
import { STATUS_META, trainingTypeMeta } from "./enums";

/** The fields of a workout a card shows. */
export interface WorkoutCardData {
	title: string;
	durationMinutes: number;
	trainingTypeIds: readonly string[];
	status: ContentStatus;
	videoUrl?: string | null;
	audioRelativePath?: string | null;
}

interface WorkoutCardProps {
	/** Undefined when the plan points at a workout that no longer exists. */
	workout: WorkoutCardData | undefined;
	/** Shown instead of the title when the workout is missing. */
	fallbackTitle: string;
	/** `#rrggbb` background chosen in the planner. */
	color?: string;
	note?: string;
	/** A menu button or other control at the top right. */
	action?: ReactNode;
	className?: string;
}

/** How the app will play it, derived from what the workout has. */
export function workoutFormat(workout: {
	videoUrl?: string | null;
	audioRelativePath?: string | null;
}): string {
	if (workout.videoUrl) return "Wideo";
	if (workout.audioRelativePath) return "Audio";
	return "Rozpiska";
}

/**
 * A workout as it appears in a plan: title, types, duration, format. The
 * stripe on the left takes the colour of the first training type. A workout
 * that is not published shows its status, because it blocks publishing.
 */
export function WorkoutCard({
	workout,
	fallbackTitle,
	color: chosenColor,
	note,
	action,
	className = "",
}: WorkoutCardProps) {
	// Only a real colour reaches the style attribute, whatever the data says.
	const color = isHexColor(chosenColor) ? chosenColor : undefined;
	const types = (workout?.trainingTypeIds ?? []).map((id) => ({
		id,
		...trainingTypeMeta(id),
	}));
	const tone = types[0]?.tone ?? "grey";
	const ink = color ? readableTextOn(color) : undefined;
	const status = workout?.status;

	return (
		<div
			data-tone={tone}
			style={color ? { backgroundColor: color, color: ink } : undefined}
			className={`flex items-stretch overflow-hidden rounded-chip border text-left text-xs ${
				color ? "border-transparent" : "border-line bg-surface-alt"
			} ${className}`}
		>
			<span className="w-1 shrink-0 bg-(--tone)" aria-hidden="true" />
			<div className="min-w-0 flex-1 px-2 py-1.5">
				<p className="line-clamp-2 font-medium leading-snug">
					{workout ? workout.title || "Bez nazwy" : fallbackTitle}
				</p>
				{types.length > 0 && (
					<p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] opacity-80">
						{types.map((type) => (
							<span key={type.id} className="inline-flex items-center gap-1">
								{type.emoji ? (
									<span aria-hidden="true">{type.emoji}</span>
								) : (
									<span
										data-tone={type.tone}
										className="size-1.5 rounded-full bg-(--tone)"
									/>
								)}
								{type.label}
							</span>
						))}
					</p>
				)}
				<p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] opacity-70">
					{workout ? (
						<>
							<span>{workout.durationMinutes} min</span>
							<span aria-hidden="true">·</span>
							<span>{workoutFormat(workout)}</span>
						</>
					) : (
						<span>Nie ma takiego treningu</span>
					)}
					{status && status !== "published" && (
						<span
							data-tone={STATUS_META[status].tone}
							className="rounded-full bg-(--tone-soft) px-1.5 font-semibold text-(--tone-ink) opacity-100"
						>
							{STATUS_META[status].label}
						</span>
					)}
				</p>
				{note && (
					<p className="mt-1 line-clamp-2 border-current/20 border-t pt-1 text-[11px] italic opacity-80">
						{note}
					</p>
				)}
			</div>
			{action}
		</div>
	);
}
