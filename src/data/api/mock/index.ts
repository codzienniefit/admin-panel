import { ApiError, type ApiIssue } from "@/data/api/errors";
import type { ApiClient, SaveOptions } from "@/data/api/types";
import { badgeSchema } from "@/data/schemas/badge";
import {
	type Challenge,
	challengeSchema,
	newChallengeSchema,
} from "@/data/schemas/challenge";
import {
	internalConfigSchema,
	workoutConfigSchema,
} from "@/data/schemas/config";
import {
	type MediaFile,
	mediaFileSchema,
	mediaUploadResultSchema,
} from "@/data/schemas/media";
import {
	newWorkoutSchema,
	type Workout,
	workoutSchema,
} from "@/data/schemas/workout";
import { challengeIssues } from "@/domain/challengeRules";
import { extensionOf } from "@/domain/mediaRules";
import { slugify } from "@/domain/text";
import { workoutIssues } from "@/domain/workoutRules";
import type { Store } from "@/lib/store";
import { internalConfigFixture, workoutConfigFixture } from "./configFixtures";
import { type MockControls, mockControls } from "./controls";
import { buildFixtures, type Fixtures, UNKNOWN_FIELD } from "./fixtures";
import { placeholderAudio, placeholderImage, toDataUrl } from "./mediaUrls";
import { browserStorage, SNAPSHOT_KEY, type StorageLike } from "./persistence";

// An in-process ApiClient: no network, no service worker. It implements the
// TARGET contract (statuses, etags and 409s, validation with field paths),
// which makes it the executable specification for docs/BACKEND-SCOPE.md.

interface Versioned {
	id: string;
	etag: string;
	updatedAtUtc: string;
}

export interface MockApiOptions {
	fixtures?: Fixtures;
	controls?: Store<MockControls>;
	/** Where edits are kept across reloads; null keeps them in memory only. */
	storage?: StorageLike | null;
	/** Injected in tests so they do not wait on real timers. */
	sleep?: (ms: number) => Promise<void>;
	now?: () => string;
}

interface Snapshot {
	dataset: string;
	version: number;
	challenges: Challenge[];
	workouts: Workout[];
	media: MediaFile[];
	promotedChallengeId?: string | null;
	/** Uploaded files small enough to keep, as data: addresses. */
	uploads: Record<string, string>;
}

/** Everything crossing the boundary is copied, as JSON over HTTP would be. */
const copy = <T>(value: T): T => structuredClone(value);

const realSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const AUDIO = new Set(["m4a", "m4v", "mp3", "wav"]);
const IMAGE = new Set(["webp", "png", "jpg", "jpeg", "gif", "svg"]);
const MIME: Record<string, string> = {
	webp: "image/webp",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
};
/** Larger uploads are listed but not kept across a reload. */
const KEEP_UPLOAD_BYTES = 400 * 1024;

export function createMockApi(options: MockApiOptions = {}): ApiClient {
	const controls = options.controls ?? mockControls;
	const sleep = options.sleep ?? realSleep;
	const now = options.now ?? (() => new Date().toISOString());
	const storage =
		options.storage === undefined ? browserStorage() : options.storage;
	const dataset = controls.get().dataset;

	const restored = options.fixtures ? null : readSnapshot(storage, dataset);
	const seed = options.fixtures ?? (restored ? null : buildFixtures(dataset));

	const challenges = new Map(
		(restored?.challenges ?? seed?.challenges ?? []).map((c) => [
			c.id,
			copy(c),
		]),
	);
	const workouts = new Map(
		(restored?.workouts ?? seed?.workouts ?? []).map((w) => [w.id, copy(w)]),
	);
	const media = new Map(
		(restored?.media ?? seed?.media ?? []).map((m) => [m.path, copy(m)]),
	);
	const badges = (options.fixtures ?? buildFixtures("normal")).badges;
	const uploads = new Map(Object.entries(restored?.uploads ?? {}));
	let promotedChallengeId =
		restored?.promotedChallengeId === undefined
			? internalConfigFixture.promotedChallengeId
			: restored.promotedChallengeId;
	let version = restored?.version ?? 1;
	const nextEtag = () => String(++version);

	function persist() {
		if (!storage) return;
		const snapshot = (withUploads: boolean): Snapshot => ({
			dataset,
			version,
			challenges: [...challenges.values()],
			workouts: [...workouts.values()],
			media: [...media.values()],
			promotedChallengeId,
			uploads: withUploads ? Object.fromEntries(uploads) : {},
		});
		try {
			storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot(true)));
		} catch {
			// Most likely the storage quota. The records matter more than the
			// uploaded pictures, so try again without them.
			try {
				storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot(false)));
			} catch {
				// Keep working in memory.
			}
		}
	}

	async function latency() {
		const { minLatencyMs, maxLatencyMs } = controls.get();
		const span = Math.max(0, maxLatencyMs - minLatencyMs);
		await sleep(minLatencyMs + Math.random() * span);
	}

	function takeFailure() {
		if (!controls.get().failNextSave) return;
		controls.set((c) => ({ ...c, failNextSave: false }));
		throw new ApiError("server", "Symulowany błąd serwera");
	}

	/** Plays the part of another admin saving just before this request. */
	function takeConcurrentChange<T extends Versioned>(
		stored: T,
		incoming: T,
		change: {
			otherField: (stored: T) => void;
			sameFields: (stored: T, incoming: T) => void;
		},
	) {
		const mode = controls.get().conflictNextSave;
		if (!mode) return;
		controls.set((c) => ({ ...c, conflictNextSave: null }));
		change[mode](stored, incoming);
		stored.etag = nextEtag();
		stored.updatedAtUtc = now();
	}

	const challengeChange = {
		otherField: (stored: Challenge) => {
			stored.title = `${stored.title} (zmienione przez innego admina)`;
		},
		sameFields: (stored: Challenge, incoming: Challenge) => {
			const spare = [...workouts.keys()];
			for (const path of stored.paths) {
				const incomingPath = incoming.paths.find(
					(p) => p.pathId === path.pathId,
				);
				for (const day of path.days) {
					const theirs = incomingPath?.days.find(
						(d) => d.dayIndex === day.dayIndex,
					);
					if (!theirs || sameList(theirs.workoutIds, day.workoutIds)) continue;
					const extra = spare.find(
						(id) =>
							!day.workoutIds.includes(id) && !theirs.workoutIds.includes(id),
					);
					if (extra) day.workoutIds.push(extra);
				}
			}
		},
	};

	const workoutChange = {
		otherField: (stored: Workout) => {
			stored.internalTitle = "zmienione przez innego admina";
		},
		sameFields: (stored: Workout, incoming: Workout) => {
			const target = stored as Record<string, unknown>;
			const theirs = incoming as Record<string, unknown>;
			for (const key of Object.keys(theirs)) {
				if (key === "etag" || key === "updatedAtUtc") continue;
				if (JSON.stringify(theirs[key]) === JSON.stringify(target[key]))
					continue;
				const value = target[key];
				if (typeof value === "string") target[key] = `${value} (inny admin)`;
				else if (typeof value === "number") target[key] = value + 5;
				else if (typeof value === "boolean") target[key] = !theirs[key];
			}
		},
	};

	function checkEtag<T extends Versioned>(stored: T | undefined, etag: string) {
		if (stored && stored.etag !== etag) {
			throw new ApiError<T>(
				"conflict",
				"Ktoś inny zapisał ten element w międzyczasie",
				{ current: copy(stored) },
			);
		}
	}

	function reject(issues: ApiIssue[]) {
		if (issues.length === 0) return;
		throw new ApiError("validation", issues.map((i) => i.message).join("\n"), {
			issues,
		});
	}

	function store<T extends Versioned>(table: Map<string, T>, incoming: T): T {
		const saved = { ...copy(incoming), etag: nextEtag(), updatedAtUtc: now() };
		table.set(saved.id, saved);
		persist();
		return copy(saved);
	}

	const badgeIds = new Set(
		badges.filter((b) => b.type === "normal").map((b) => b.id),
	);

	function workoutProblems(
		incoming: Workout,
		stored: Workout | undefined,
	): ApiIssue[] {
		const issues = workoutIssues(incoming, workoutConfigFixture, { badgeIds });

		if (incoming.videoUrl) {
			const twin = [...workouts.values()].find(
				(w) => w.id !== incoming.id && w.videoUrl === incoming.videoUrl,
			);
			if (twin) {
				issues.push({
					path: "videoUrl",
					message: `Ten film jest już w katalogu jako „${twin.title}” (${twin.id})`,
				});
			}
		}
		if (stored?.status === "deleted" && incoming.status === "deleted") {
			issues.push({
				path: "status",
				message: "Usunięty trening można tylko przywrócić",
			});
		}
		const usedBy = (statuses: readonly string[]) =>
			[...challenges.values()].filter(
				(c) =>
					statuses.includes(c.status) &&
					c.paths.some((p) =>
						p.days.some((d) => d.workoutIds.includes(incoming.id)),
					),
			);
		const names = (list: Challenge[]) =>
			list.map((c) => `${c.title} (${c.id})`).join(", ");
		if (incoming.status === "deleted" && stored?.status !== "deleted") {
			const users = usedBy(["draft", "hidden", "published"]);
			if (users.length) {
				issues.push({
					path: "status",
					message: `Trening jest używany w wyzwaniach: ${names(users)}`,
				});
			}
		}
		if (incoming.status === "draft" && stored && stored.status !== "draft") {
			// A challenge that users can see must not point at an unfinished workout.
			const users = usedBy(["hidden", "published"]);
			if (users.length) {
				issues.push({
					path: "status",
					message: `Trening jest w opublikowanych wyzwaniach, więc nie może wrócić do szkicu: ${names(users)}`,
				});
			}
		}
		return issues;
	}

	function freeId(prefix: string, table: ReadonlyMap<string, unknown>) {
		for (let n = 1; ; n++) {
			if (!table.has(`${prefix}${n}`)) return `${prefix}${n}`;
		}
	}

	function challengeProblems(
		incoming: Challenge,
		stored: Challenge | undefined,
	): ApiIssue[] {
		const issues = challengeIssues(incoming, workoutConfigFixture, {
			workoutStatus: new Map(
				[...workouts.values()].map((w) => [w.id, w.status]),
			),
			badgeIds,
			challengeIds: new Set(challenges.keys()),
			ownId: incoming.id,
			promotedChallengeId,
		});
		if (stored?.status === "deleted" && incoming.status === "deleted") {
			issues.push({
				path: "status",
				message: "Usunięte wyzwanie można tylko przywrócić",
			});
		}
		return issues;
	}

	const internalConfig = () =>
		internalConfigSchema.parse({
			...copy(internalConfigFixture),
			promotedChallengeId,
		});

	return {
		config: {
			async workouts() {
				await latency();
				return workoutConfigSchema.parse(copy(workoutConfigFixture));
			},
			async internal() {
				await latency();
				return internalConfig();
			},
			async setPromotedChallenge(challengeId) {
				await latency();
				takeFailure();
				if (challengeId !== null) {
					const target = challenges.get(challengeId);
					const problem = !target
						? `Wyzwanie ${challengeId} nie istnieje`
						: target.status !== "published"
							? "Promować można tylko opublikowane wyzwanie"
							: !target.liveAtUtc
								? "Promować można tylko wyzwanie z datą premiery, nie plan"
								: null;
					if (problem) {
						reject([{ path: "promotedChallengeId", message: problem }]);
					}
				}
				promotedChallengeId = challengeId;
				persist();
				return internalConfig();
			},
		},
		challenges: {
			async list() {
				await latency();
				return challengeSchema.array().parse(copy([...challenges.values()]));
			},
			async save(challenge, options) {
				await latency();
				takeFailure();
				const incoming = challengeSchema.parse(copy(challenge));
				const stored = challenges.get(incoming.id);
				if (stored) takeConcurrentChange(stored, incoming, challengeChange);
				checkEtag(stored, options.etag);
				reject(challengeProblems(incoming, stored));
				return store(challenges, incoming);
			},
			async create(challenge) {
				await latency();
				takeFailure();
				const fields = newChallengeSchema.parse(copy(challenge));
				const incoming: Challenge = {
					...fields,
					id: freeId("C", challenges),
					etag: "",
					updatedAtUtc: now(),
					[UNKNOWN_FIELD]: "challenge:new",
				};
				reject(challengeProblems(incoming, undefined));
				return store(challenges, incoming);
			},
		},
		workouts: {
			async list() {
				await latency();
				return workoutSchema.array().parse(copy([...workouts.values()]));
			},
			async create(workout) {
				await latency();
				takeFailure();
				const fields = newWorkoutSchema.parse(copy(workout));
				const incoming: Workout = {
					...fields,
					id: freeId("W", workouts),
					etag: "",
					updatedAtUtc: now(),
					// A real backend would add its own fields to a new row too.
					[UNKNOWN_FIELD]: "workout:new",
				};
				reject(workoutProblems(incoming, undefined));
				return store(workouts, incoming);
			},
			async save(workout, options: SaveOptions) {
				await latency();
				takeFailure();
				const incoming = workoutSchema.parse(copy(workout));
				const stored = workouts.get(incoming.id);
				if (!stored) throw new ApiError("notFound", "Nie ma takiego treningu");
				takeConcurrentChange(stored, incoming, workoutChange);
				checkEtag(stored, options.etag);
				reject(workoutProblems(incoming, stored));
				return store(workouts, incoming);
			},
		},
		media: {
			async list() {
				await latency();
				return mediaFileSchema.array().parse(copy([...media.values()]));
			},
			async upload(file, { relativePath, onProgress }) {
				const extension = extensionOf(relativePath);
				const type = AUDIO.has(extension)
					? "audio"
					: IMAGE.has(extension)
						? "image"
						: null;
				if (!type) {
					throw new ApiError(
						"validation",
						"Ten rodzaj pliku nie jest obsługiwany",
						{
							issues: [
								{
									path: "file",
									message: "Ten rodzaj pliku nie jest obsługiwany",
								},
							],
						},
					);
				}
				for (const fraction of [0.15, 0.4, 0.7, 0.9]) {
					await latency();
					onProgress?.(fraction);
				}
				takeFailure();

				const segments = relativePath.split("/").filter(Boolean);
				const name = segments.pop() ?? "plik";
				const stem = slugify(name.slice(0, -extension.length - 1)) || "plik";
				const folder =
					segments.map(slugify).filter(Boolean).join("/") || "other";
				const clean = `${folder}/${stem}.${extension}`;
				let path = clean;
				for (let n = 1; media.has(path); n++) {
					path = `${folder}/${stem}-${n}.${extension}`;
				}

				if (type === "image" && file.size <= KEEP_UPLOAD_BYTES) {
					const bytes = new Uint8Array(await file.arrayBuffer());
					uploads.set(path, toDataUrl(bytes, MIME[extension] ?? file.type));
				}
				media.set(path, {
					path,
					type,
					createdAtUtc: now(),
					sizeBytes: file.size,
					[UNKNOWN_FIELD]: "media",
				});
				persist();
				onProgress?.(1);
				return mediaUploadResultSchema.parse({
					requestedRelativePath: relativePath,
					relativePath: path,
					type,
					pathSanitized: clean !== relativePath,
					renamedToAvoidOverwrite: path !== clean,
				});
			},
			urlFor(path) {
				const uploaded = uploads.get(path);
				if (uploaded) return uploaded;
				return AUDIO.has(extensionOf(path))
					? placeholderAudio()
					: placeholderImage(path);
			},
		},
		badges: {
			async list() {
				await latency();
				return badgeSchema.array().parse(copy(badges));
			},
		},
	};
}

function readSnapshot(
	storage: StorageLike | null,
	dataset: string,
): Snapshot | null {
	try {
		const raw = storage?.getItem(SNAPSHOT_KEY);
		if (!raw) return null;
		const snapshot = JSON.parse(raw) as Snapshot;
		if (snapshot.dataset !== dataset) return null;
		if (
			!Array.isArray(snapshot.workouts) ||
			!Array.isArray(snapshot.challenges)
		) {
			return null;
		}
		return snapshot;
	} catch {
		return null;
	}
}

function sameList(a: readonly string[], b: readonly string[]) {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
