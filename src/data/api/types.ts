import type { Badge, NewBadge } from "@/data/schemas/badge";
import type { Challenge, NewChallenge } from "@/data/schemas/challenge";
import type { InternalConfig, WorkoutConfig } from "@/data/schemas/config";
import type { MediaFile, MediaUploadResult } from "@/data/schemas/media";
import type { Message, NewMessage } from "@/data/schemas/message";
import type { NewOffer, Offer, OfferChoices } from "@/data/schemas/offer";
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
		/**
		 * The file's public address, which works anywhere, signed in or not:
		 * to paste into a message, a document or a chat.
		 */
		publicUrlFor(path: string): string;
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
		 * The account with this whole e-mail address or this id. Nothing for
		 * any other query, names included (domain/userRules, parseUserQuery),
		 * and never more than USER_SEARCH_LIMIT rows.
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
	offers: {
		/** Every special offer, live and switched off. */
		list(): Promise<Offer[]>;
		/** The server assigns the id. */
		create(offer: NewOffer): Promise<Offer>;
		/** Saves the whole offer and returns it as stored, with a new etag. */
		save(offer: Offer, options: SaveOptions): Promise<Offer>;
		/**
		 * Switches an offer on (checked as a save would be) or off (never
		 * held up), without sending the rest of it.
		 */
		setActive(
			offerId: string,
			active: boolean,
			options: SaveOptions,
		): Promise<Offer>;
		/** The offering and entitlement ids RevenueCat knows. */
		choices(): Promise<OfferChoices>;
	};
	cache: {
		/**
		 * Asks the CDN in front of the app's catalogue to drop its copy, so the
		 * app shows the newest content at once. Changes no data; the backend
		 * also does it after every admin save. Refused within 30 seconds of the
		 * last one.
		 */
		purge(): Promise<CachePurgeResult>;
	};
}

export interface CachePurgeResult {
	/** When the CDN accepted the purge, as an ISO instant. */
	purgedAtUtc: string;
	/** True when nothing was really purged: the Test environment has no CDN. */
	simulated?: boolean;
}
