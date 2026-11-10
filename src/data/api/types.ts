import type { Badge } from "@/data/schemas/badge";
import type { Challenge, NewChallenge } from "@/data/schemas/challenge";
import type { InternalConfig, WorkoutConfig } from "@/data/schemas/config";
import type { MediaFile, MediaUploadResult } from "@/data/schemas/media";
import type { NewWorkout, Workout } from "@/data/schemas/workout";

export interface SaveOptions {
	/**
	 * The etag of the version the change is based on. When it no longer
	 * matches the stored one the save fails with ApiError kind "conflict".
	 */
	etag: string;
}

export interface UploadOptions {
	/** Folder and file name, e.g. "workouts/mobilnosc.webp". */
	relativePath: string;
	/** Called with a fraction from 0 to 1 while the file is being sent. */
	onProgress?: (fraction: number) => void;
}

/**
 * Everything the panel asks of a backend. Two implementations: the in-process
 * mock (src/data/api/mock) and, from the live slices on, HTTP. Screens never
 * see which one is active; they only use collections.
 *
 * Each phase adds its section here first.
 */
export interface ApiClient {
	config: {
		/** Options for every select: levels, equipment, training types, goals. */
		workouts(): Promise<WorkoutConfig>;
		/** Panel-only labels, and the promoted challenge. */
		internal(): Promise<InternalConfig>;
		/** Chooses the challenge shown first in the app; null clears it. */
		setPromotedChallenge(challengeId: string | null): Promise<InternalConfig>;
	};
	challenges: {
		/** Every challenge and plan, deleted ones included; screens filter. */
		list(): Promise<Challenge[]>;
		/** The server assigns the id. */
		create(challenge: NewChallenge): Promise<Challenge>;
		/** Saves the whole entity and returns it as stored, with a new etag. */
		save(challenge: Challenge, options: SaveOptions): Promise<Challenge>;
	};
	workouts: {
		/** Every workout, deleted ones included; screens filter. */
		list(): Promise<Workout[]>;
		/** The server assigns the id. */
		create(workout: NewWorkout): Promise<Workout>;
		save(workout: Workout, options: SaveOptions): Promise<Workout>;
	};
	media: {
		list(): Promise<MediaFile[]>;
		/** Never overwrites: a taken name gets a numeric suffix. */
		upload(file: Blob, options: UploadOptions): Promise<MediaUploadResult>;
		/** The address a browser can load the file from. */
		urlFor(path: string): string;
	};
	badges: {
		list(): Promise<Badge[]>;
	};
}
