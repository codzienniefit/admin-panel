import type { Badge, NewBadge } from "@/data/schemas/badge";
import type { Challenge, NewChallenge } from "@/data/schemas/challenge";
import type { InternalConfig, WorkoutConfig } from "@/data/schemas/config";
import type { MediaFile, MediaUploadResult } from "@/data/schemas/media";
import type { Message, NewMessage } from "@/data/schemas/message";
import type { Planning } from "@/data/schemas/planning";
import type { PlannerSettings } from "@/data/schemas/settings";
import type {
	UserAccount,
	UserBadge,
	UserProgress,
	UserSearchResult,
} from "@/data/schemas/user";
import type { NewWorkout, Workout } from "@/data/schemas/workout";

/** An entity saved with a version: every save names the etag it is based on. */
export interface Versioned {
	id: string;
	etag: string;
}

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
		/** The server assigns the id and, for an event badge, the claim code. */
		create(badge: NewBadge): Promise<Badge>;
		/** Where the app lists the badge (section) is worked out by the server. */
		save(badge: Badge, options: SaveOptions): Promise<Badge>;
		/** Refused while a workout or a challenge still awards the badge. */
		remove(badgeId: string, options: SaveOptions): Promise<void>;
	};
	messages: {
		/** Every message, archived ones included; screens filter. */
		list(): Promise<Message[]>;
		/** Always a draft. The server assigns the id. */
		create(message: NewMessage): Promise<Message>;
		/**
		 * Changes a draft. Status and its dates are the server's: they change
		 * only through the actions below.
		 */
		save(message: Message, options: SaveOptions): Promise<Message>;
		/**
		 * Delivers a draft to its target group. Happens once: a sent message
		 * cannot be sent again, changed or taken back.
		 */
		send(messageId: string, options: SaveOptions): Promise<Message>;
		archive(messageId: string, options: SaveOptions): Promise<Message>;
		/** Back to what it was before: sent, or a draft. */
		unarchive(messageId: string, options: SaveOptions): Promise<Message>;
	};
	users: {
		/**
		 * Accounts whose e-mail, name or id contains the query. Never the whole
		 * user base: nothing for a query shorter than USER_QUERY_MIN characters,
		 * and at most USER_SEARCH_LIMIT rows (domain/userRules).
		 */
		search(query: string): Promise<UserSearchResult>;
		get(uid: string): Promise<UserAccount>;
		/** The badges a person holds; definitions come from `badges.list`. */
		badges(uid: string): Promise<UserBadge[]>;
		progress(uid: string): Promise<UserProgress>;
		changeEmail(uid: string, email: string): Promise<UserAccount>;
		/** Gives a manual badge by hand; returns the person's badges. */
		grantBadge(uid: string, badgeId: string): Promise<UserBadge[]>;
		/** Takes back a badge that was given by hand or claimed with a code. */
		revokeBadge(uid: string, badge: UserBadge): Promise<UserBadge[]>;
	};
	planning: {
		/**
		 * One planning document per challenge. A challenge nobody has planned
		 * yet gets a blank one with the etag UNSAVED_ETAG.
		 */
		list(): Promise<Planning[]>;
		/** Creates the document on its first save. */
		save(planning: Planning, options: SaveOptions): Promise<Planning>;
	};
	settings: {
		/** Plan types, training-type styles and folders. */
		planner(): Promise<PlannerSettings>;
		savePlanner(
			settings: PlannerSettings,
			options: SaveOptions,
		): Promise<PlannerSettings>;
	};
}
