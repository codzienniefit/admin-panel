import {
	type Capabilities,
	PRODUCTION_CAPABILITIES,
	type WriteArea,
	type WriteMode,
} from "@/data/api/capabilities";
import { ApiError, isApiError } from "@/data/api/errors";
import {
	createTransport,
	type Method,
	type Transport,
	type WireAnswer,
	type WireRequest,
} from "./transport";

// What the tests of the HTTP client share: a backend that exists only in
// memory and remembers every request, and rows shaped the way the real
// backend sends them (docs/research/backend-audit.md §4a). Nothing here
// touches the network.

// ─── A backend that only remembers ──────────────────────────────────────────

export interface Recorded {
	method: Method;
	/** The path after the base address, still encoded: "manageChallenges/C1". */
	path: string;
	query: Record<string, string>;
	headers: Record<string, string>;
	/** A JSON body parsed; a file as it was sent; undefined when there was none. */
	body: unknown;
	timeoutMs: number;
	/** Which of the transport's two senders carried the request. */
	sender: "send" | "upload";
	onProgress: ((fraction: number) => void) | undefined;
}

export interface Reply {
	/** 200 when left out. */
	status?: number;
	/** Sent as JSON. */
	body?: unknown;
	/** Sent as it is, instead of `body`. */
	text?: string;
	/** The `ETag` header. */
	etag?: string | null;
}

export type Responder = Reply | ((request: Recorded) => Reply | Promise<Reply>);

export interface FakeBackend {
	transport: Transport;
	/** Every request that reached the wire, in order. */
	requests: Recorded[];
	/** The same, as "METHOD path" lines. */
	calls(): string[];
	/**
	 * What to answer. Several answers are given one after another, and the
	 * last one stays.
	 */
	on(method: Method, path: string, ...answers: Responder[]): FakeBackend;
	/** The only request with this method and path; fails when there is not exactly one. */
	only(method: Method, path: string): Recorded;
	/** All requests with this method and path. */
	all(method: Method, path: string): Recorded[];
}

const BASE = "/api";

function record(wire: WireRequest, sender: Recorded["sender"]): Recorded {
	const [address = "", search = ""] = wire.url.split("?");
	return {
		method: wire.method,
		path: address.startsWith(`${BASE}/`)
			? address.slice(BASE.length + 1)
			: address,
		query: Object.fromEntries(new URLSearchParams(search)),
		headers: wire.headers,
		body: typeof wire.body === "string" ? JSON.parse(wire.body) : wire.body,
		timeoutMs: wire.timeoutMs,
		sender,
		onProgress: wire.onProgress,
	};
}

/**
 * A transport wired to answers prepared in the test. A request nobody
 * prepared an answer for fails the call loudly, and is still recorded, so
 * "made no request" can be checked on `requests`.
 */
export function fakeBackend(): FakeBackend {
	const requests: Recorded[] = [];
	const routes = new Map<string, Responder[]>();
	const key = (method: string, path: string) => `${method} ${path}`;

	async function answer(
		wire: WireRequest,
		sender: Recorded["sender"],
	): Promise<WireAnswer> {
		const request = record(wire, sender);
		requests.push(request);
		const prepared = routes.get(key(request.method, request.path));
		const next =
			prepared && prepared.length > 1 ? prepared.shift() : prepared?.[0];
		if (next === undefined) {
			throw new ApiError(
				"server",
				`test: no answer prepared for ${key(request.method, request.path)}`,
			);
		}
		const reply = typeof next === "function" ? await next(request) : next;
		return {
			status: reply.status ?? 200,
			text:
				reply.text ??
				(reply.body === undefined ? "" : JSON.stringify(reply.body)),
			etag: reply.etag ?? null,
		};
	}

	const backend: FakeBackend = {
		requests,
		transport: createTransport({
			baseUrl: BASE,
			getToken: async () => null,
			send: (wire) => answer(wire, "send"),
			upload: (wire) => answer(wire, "upload"),
		}),
		calls: () => requests.map((request) => key(request.method, request.path)),
		on(method, path, ...answers) {
			routes.set(key(method, path), [...answers]);
			return backend;
		},
		all: (method, path) =>
			requests.filter(
				(request) => request.method === method && request.path === path,
			),
		only(method, path) {
			const found = backend.all(method, path);
			const [first] = found;
			if (found.length !== 1 || !first) {
				throw new Error(
					`test: expected one ${key(method, path)}, saw ${found.length} among: ${backend.calls().join(", ") || "no requests"}`,
				);
			}
			return first;
		},
	};
	return backend;
}

/** A success with this JSON body. */
export const json = (body: unknown, more: Omit<Reply, "body"> = {}): Reply => ({
	...more,
	body,
});

/** The backend's error envelope (audit §7a). */
export const errorReply = (
	status: number,
	error: string,
	more: Record<string, unknown> = {},
): Reply => ({ status, body: { error, ...more } });

// ─── Capabilities ───────────────────────────────────────────────────────────

export interface CapabilityChange
	extends Partial<Omit<Capabilities, "writes">> {
	writes?: Partial<Record<WriteArea, WriteMode>>;
}

/**
 * The backend as it was until 2026-11-13: no versions, no statuses, no
 * planning store, nothing written. Every feature switch can go back to this,
 * so the tests of how the client then behaves are kept, built on this.
 */
export const SWITCHED_OFF: Capabilities = {
	writes: { ...PRODUCTION_CAPABILITIES.writes },
	etag: false,
	status: false,
	planning: false,
	badgeDelete: false,
	messageUnarchive: false,
};

/** The backend as it was (see SWITCHED_OFF), with a few lines changed. */
export function capabilities(change: CapabilityChange = {}): Capabilities {
	const { writes, ...rest } = change;
	return {
		...SWITCHED_OFF,
		...rest,
		writes: { ...SWITCHED_OFF.writes, ...writes },
	};
}

/** Produkcja as it is configured today (every feature, no write), with a few lines changed. */
export function production(change: CapabilityChange = {}): Capabilities {
	const { writes, ...rest } = change;
	return {
		...PRODUCTION_CAPABILITIES,
		...rest,
		writes: { ...PRODUCTION_CAPABILITIES.writes, ...writes },
	};
}

// ─── Failures ───────────────────────────────────────────────────────────────

/** The ApiError a call ends with; anything else fails the test. */
export async function failure(call: Promise<unknown>): Promise<ApiError> {
	let result: unknown;
	try {
		result = await call;
	} catch (error) {
		if (isApiError(error)) return error;
		throw error;
	}
	throw new Error(
		`test: expected the call to fail, it returned ${JSON.stringify(result)}`,
	);
}

// ─── Rows as the backend sends them today ───────────────────────────────────

type Row = Record<string, unknown>;

/**
 * The row as it would arrive: through JSON, so a field set to `undefined`
 * in a test is a field the backend left out.
 */
const sent = (row: Row): Row => JSON.parse(JSON.stringify(row)) as Row;

/** One variant as `GET manageChallenges` lists it: no id of its own. */
export function wirePath(overrides: Row = {}): Row {
	return sent({
		levelId: "beginner",
		equipmentIds: ["mat"],
		difficultyLevelsIds: ["easy"],
		frequency: "3",
		minimumDaysToComplete: 1,
		description: "Dla początkujących",
		pro: false,
		days: [
			{ dayIndex: 1, workoutIds: ["W1", "W2"], type: "workout" },
			{ dayIndex: 2, workoutIds: [], type: "restday" },
		],
		...overrides,
	});
}

/**
 * ChallengeUpsertAdminDto as `mapToAdminChallenge` builds it: the three
 * dates are left out when unset, everything else unset is null.
 */
export function wireChallenge(overrides: Row = {}): Row {
	return sent({
		id: "C12",
		title: "Wiosenne wyzwanie",
		subtitle: "28 dni ruchu",
		internalTitle: "[TEST] wiosna 2026",
		addedAtUtc: "2026-03-01T08:00:00.000Z",
		updatedAtUtc: "2026-11-03T12:00:00.000Z",
		descriptionFancyContent: [
			{ type: "Title", content: "Zaczynamy" },
			{
				type: "Image",
				content: "",
				metadata: {
					imageRelativePath: "challenges/c12-opis.webp",
					heightToWidthRatio: 0.56,
				},
			},
		],
		hidden: false,
		pro: true,
		imageRelativePath: "challenges/c12.webp",
		lengthDays: 2,
		categoryId: "main",
		goalsIds: ["strength"],
		difficultyLevelsIds: ["easy"],
		visibleDaysUpFront: 7,
		offeringId: null,
		offeringDiscountedId: null,
		unlockedByEntitlementIds: ["pro"],
		discountedForEntitlementIds: [],
		paths: [wirePath()],
		badgeId: null,
		perfectCompletionBadgeId: null,
		recommendedNext: [{ id: "C3" }],
		...overrides,
	});
}

/** WorkoutResultAdminDto as `mapToAdminWorkout` builds it. */
export function wireWorkout(overrides: Row = {}): Row {
	return sent({
		id: "W12",
		title: "Mobilność bioder",
		internalTitle: "[TEST] mobilność",
		addedAtUtc: "2026-02-10T09:00:00.000Z",
		updatedAtUtc: "2026-11-02T10:30:00.000Z",
		levelId: "beginner",
		equipmentIds: ["mat"],
		trainingTypeIds: ["mobility"],
		descriptionFancyContent: [{ type: "Text", content: "Spokojnie." }],
		hidden: false,
		pro: false,
		durationMinutes: 25,
		imageRelativePath: "workouts/mobilnosc.webp",
		audioRelativePath: null,
		videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		badgeId: null,
		...overrides,
	});
}

/** BadgeResultAdminDto as `GET manageBadges` lists it. */
export function wireBadge(overrides: Row = {}): Row {
	return sent({
		id: "n_7",
		name: "Pierwszy trening",
		imageRelativePath: "badges/pierwszy.webp",
		comment: "[TEST] za pierwszy trening",
		type: "normal",
		repeatCategory: null,
		milestoneCount: null,
		specialCategory: null,
		sectionId: "workouts",
		subsectionId: "first",
		activeFromUtc: null,
		activeTillUtc: null,
		isHidden: null,
		claimToken: null,
		isClaimLinkActive: null,
		createdAtUtc: "2026-01-05T10:00:00.000Z",
		updatedAtUtc: "2026-10-20T08:15:00.000Z",
		assignedToWorkouts: [{ id: "W12", name: "Mobilność bioder" }],
		assignedToChallenges: [],
		...overrides,
	});
}

/** DraftMessageListAdminResponseDto: one row of `manageMessageDrafts/list`. */
export function wireMessage(overrides: Row = {}): Row {
	return sent({
		id: "2516735103999999999",
		title: "[TEST] nowy plan",
		from: "Codziennie Fit",
		status: "draft",
		createdAtUtc: "2026-11-01T09:00:00.000Z",
		targetGroup: "all",
		sentAtUtc: null,
		archivedAtUtc: null,
		fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
		...overrides,
	});
}

/**
 * The Firebase `UserRecord` that `GET accounts/{uid}` passes on whole,
 * secrets included.
 */
export function firebaseRecord(overrides: Row = {}): Row {
	return sent({
		uid: "Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1",
		email: "anna@example.com",
		emailVerified: true,
		displayName: "Anna Nowak",
		photoURL: "https://example.com/anna.jpg",
		phoneNumber: "+48500100200",
		disabled: false,
		metadata: {
			lastSignInTime: "Tue, 03 Nov 2026 12:00:00 GMT",
			creationTime: "Mon, 05 Jan 2026 08:30:00 GMT",
			lastRefreshTime: "Tue, 03 Nov 2026 12:05:00 GMT",
		},
		passwordHash: "c2VjcmV0LWhhc2g=",
		passwordSalt: "c2VjcmV0LXNhbHQ=",
		customClaims: { acceptedTermsAndPrivacyVersion: 3 },
		tokensValidAfterTime: "Mon, 05 Jan 2026 08:30:00 GMT",
		providerData: [
			{
				uid: "anna@example.com",
				displayName: "Anna Nowak",
				email: "anna@example.com",
				providerId: "password",
			},
			{
				uid: "1234567890",
				email: "anna@example.com",
				providerId: "google.com",
			},
		],
		...overrides,
	});
}

/** AdminUserSummaryDto: one row of `manageUsers`. */
export function wireUserSummary(overrides: Row = {}): Row {
	return sent({
		uid: "Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1",
		email: "anna@example.com",
		displayName: "Anna Nowak",
		emailVerified: true,
		disabled: false,
		providers: ["password", "google.com"],
		createdAtUtc: "2026-01-05T08:30:00.000Z",
		lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
		...overrides,
	});
}

// ─── The panel's routes, as built on 2026-11-13 ─────────────────────────────
//
// Copied from what the backend's own tests show it answers
// (tests/handlers/manageChallengesEditing.test.ts, manageWorkoutsEditing,
// messagesPanelContract, manageBadgesPanelContract, accountsPanelContract,
// mediaPanelContract, panelDocsHandler). The texts are the backend's.

/** A version as Table Storage states it; `n` tells two of them apart. */
export const tableEtag = (n: number): string =>
	`W/"datetime'2026-11-13T10%3A${String(n).padStart(2, "0")}%3A00.0000000Z'"`;

/** A version of a planning document: a quoted entity tag of 32 hex digits. */
export const docEtag = (n: number): string =>
	`"${n.toString(16).padStart(32, "0")}"`;

/** 422: `validationFailed` of the backend's panelContract.ts. */
export const validationReply = (
	issues: { path: string; code: string; message: string }[],
	error: string = issues.map((issue) => issue.message).join("; "),
	more: Record<string, unknown> = {},
): Reply => ({
	status: 422,
	body: { error, errorCode: "VALIDATION", issues, ...more },
});

/** 409: `conflict` of the backend's panelContract.ts. */
export const conflictReply = (
	error: string,
	current: unknown,
	errorCode = "CONFLICT",
	more: Record<string, unknown> = {},
): Reply => ({
	status: 409,
	body: { error, errorCode, current: current ?? null, ...more },
});

/** 404: `panelNotFound` of the backend's panelContract.ts. */
export const notFoundReply = (error: string): Reply => ({
	status: 404,
	body: { error, errorCode: "NOT_FOUND" },
});

/** One variant as the panel's route sends it: with its id and what the backend works out. */
export function panelPath(overrides: Row = {}): Row {
	return sent({
		pathId: "p_0a1b2c3d4e5f",
		levelId: "beginner",
		equipmentIds: ["mat"],
		difficultyLevelsIds: ["easy"],
		difficultyLevelsLabels: ["Łatwy"],
		pro: false,
		frequency: "3",
		workoutsCount: 2,
		description: "Dla początkujących",
		workoutsLength: { fromMinutes: 20, toMinutes: 30 },
		minimumDaysToComplete: 1,
		days: [
			{ dayIndex: 1, workoutIds: ["W1", "W2"], type: "workout" },
			{ dayIndex: 2, workoutIds: [], type: "restday" },
		],
		...overrides,
	});
}

/**
 * A challenge as `GET panel/manageChallenges` lists it
 * (`mapToAdminChallenge`): with its version, its status and the bin's two
 * fields. The answer to a save is the same with `warnings`.
 */
export function panelChallenge(overrides: Row = {}): Row {
	return wireChallenge({
		etag: tableEtag(0),
		status: "published",
		hidden: false,
		deletedAtUtc: null,
		deletedBy: null,
		paths: [panelPath()],
		...overrides,
	});
}

/** A workout as `GET panel/manageWorkouts` lists it (`mapToAdminWorkout`). */
export function panelWorkout(overrides: Row = {}): Row {
	return wireWorkout({
		etag: tableEtag(0),
		status: "published",
		hidden: false,
		deletedAtUtc: null,
		deletedBy: null,
		recordingStatus: null,
		format: null,
		...overrides,
	});
}

/** BadgeAdminDto: a badge as the panel's route lists it and answers a save with. */
export function panelBadge(overrides: Row = {}): Row {
	return wireBadge({ etag: tableEtag(0), ...overrides });
}

/** DraftMessageAdminDto: exactly these fields, a group that is not set as null. */
export function panelMessage(overrides: Row = {}): Row {
	return sent({
		id: "2516735103999999999",
		etag: tableEtag(0),
		title: "[TEST] nowy plan",
		from: "Codziennie Fit",
		status: "draft",
		createdAtUtc: "2026-11-01T09:00:00.000Z",
		targetGroup: "all",
		targetGroupValue: null,
		fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
		sentAtUtc: null,
		archivedAtUtc: null,
		sendingStartedAtUtc: null,
		...overrides,
	});
}

/** A planning document or the settings, as the store states one (PanelDocDto). */
export function panelDoc(id: string, body: Row, overrides: Row = {}): Row {
	return sent({
		id,
		etag: docEtag(1),
		updatedAtUtc: "2026-11-13T10:00:00.000Z",
		updatedBy: "uid-ada",
		body,
		...overrides,
	});
}
