import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import type { UserBadge } from "@/data/schemas/user";
import {
	capabilities,
	errorReply,
	failure,
	fakeBackend,
	firebaseRecord,
	json,
	notFoundReply,
	production,
	type Recorded,
	SWITCHED_OFF,
	validationReply,
	wireUserSummary,
} from "./testSupport";
import {
	toAccount,
	toSearchResult,
	toUserBadges,
	toUserProgress,
	usersArea,
} from "./users";

// Rows and answers below follow `manageUsers`, `accounts/{uid}`,
// `manageUserBadges/{uid}` (+ `/grants`), `manageUserProgress/{uid}` and
// `manageBadges/{grantManual,revokeManual}` as they are today
// (docs/research/backend-audit.md §1a, §4a, §7a) and the typed answers
// planned in docs/BACKEND-SCOPE.md B2.8.

const UID = "Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1";

const bodyOf = (request: Recorded) => request.body as Record<string, unknown>;

function thrownBy(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		if (error instanceof ApiError) return error;
		throw error;
	}
	throw new Error("test: expected it to throw");
}

/** What must never leave this module, whatever the backend sent. */
const SECRETS = [
	"passwordHash",
	"passwordSalt",
	"c2VjcmV0LWhhc2g=",
	"c2VjcmV0LXNhbHQ=",
	"customClaims",
	"acceptedTermsAndPrivacyVersion",
	"tokensValidAfterTime",
	"phoneNumber",
	"+48500100200",
	"photoURL",
	"lastRefreshTime",
	"providerData",
	"metadata",
];

function expectNoSecrets(value: unknown) {
	const text = JSON.stringify(value);
	for (const secret of SECRETS) expect(text).not.toContain(secret);
}

// ─── Accounts ───────────────────────────────────────────────────────────────

describe("toAccount", () => {
	it("builds the account from Firebase's record", () => {
		expect(toAccount(firebaseRecord(), true)).toEqual({
			uid: UID,
			email: "anna@example.com",
			displayName: "Anna Nowak",
			emailVerified: true,
			disabled: false,
			providers: ["password", "google.com"],
			// "Mon, 05 Jan 2026 08:30:00 GMT" and "Tue, 03 Nov 2026 12:00:00 GMT".
			createdAtUtc: "2026-01-05T08:30:00.000Z",
			lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
			hasProSubscription: true,
		});
	});

	it("lets nothing else of the record through: no hash, salt, claims or phone", () => {
		const account = toAccount(firebaseRecord(), false);
		expectNoSecrets(account);
		expect(Object.keys(account).toSorted()).toEqual([
			"createdAtUtc",
			"disabled",
			"displayName",
			"email",
			"emailVerified",
			"hasProSubscription",
			"lastSignInAtUtc",
			"providers",
			"uid",
		]);
	});

	it("drops a field this build does not know, here on purpose", () => {
		// Everywhere else unknown fields are kept; an account is personal data.
		const account = toAccount(
			firebaseRecord({ multiFactor: { enrolledFactors: [{ phone: "x" }] } }),
			false,
		);
		expect(account).not.toHaveProperty("multiFactor");
	});

	it("takes the subscription state from the caller", () => {
		expect(toAccount(firebaseRecord(), true).hasProSubscription).toBe(true);
		expect(toAccount(firebaseRecord(), false).hasProSubscription).toBe(false);
	});

	it("reads an account that never signed in", () => {
		const account = toAccount(
			firebaseRecord({
				metadata: {
					creationTime: "Mon, 05 Jan 2026 08:30:00 GMT",
					lastSignInTime: null,
				},
			}),
			false,
		);
		expect(account.createdAtUtc).toBe("2026-01-05T08:30:00.000Z");
		expect(account.lastSignInAtUtc).toBeNull();
	});

	it("reads an account with hardly anything on it", () => {
		expect(toAccount({ uid: "anon1" }, false)).toEqual({
			uid: "anon1",
			email: null,
			displayName: null,
			emailVerified: false,
			disabled: false,
			providers: [],
			createdAtUtc: null,
			lastSignInAtUtc: null,
			hasProSubscription: false,
		});
	});

	it("reads nulls the same as missing fields", () => {
		expect(
			toAccount(
				{
					uid: "anon1",
					email: null,
					displayName: null,
					emailVerified: null,
					disabled: null,
					metadata: null,
					providerData: null,
				},
				false,
			),
		).toMatchObject({
			email: null,
			displayName: null,
			emailVerified: false,
			disabled: false,
			providers: [],
			createdAtUtc: null,
			lastSignInAtUtc: null,
		});
	});

	it("reads a date it cannot parse as unknown", () => {
		const account = toAccount(
			firebaseRecord({
				metadata: { creationTime: "kiedyś", lastSignInTime: "" },
			}),
			false,
		);
		expect(account.createdAtUtc).toBeNull();
		expect(account.lastSignInAtUtc).toBeNull();
	});

	it("skips a sign-in method without a name", () => {
		const account = toAccount(
			firebaseRecord({
				providerData: [
					{ providerId: "apple.com" },
					{ uid: "x" },
					{ providerId: null },
					{ providerId: "" },
				],
			}),
			false,
		);
		expect(account.providers).toEqual(["apple.com"]);
	});

	it("reads the planned typed answer, which names the fields directly", () => {
		expect(toAccount(wireUserSummary(), true)).toEqual({
			uid: UID,
			email: "anna@example.com",
			displayName: "Anna Nowak",
			emailVerified: true,
			disabled: false,
			providers: ["password", "google.com"],
			createdAtUtc: "2026-01-05T08:30:00.000Z",
			lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
			hasProSubscription: true,
		});
	});

	it("fails loudly for a record without an id", () => {
		const error = thrownBy(() => toAccount({ email: "a@example.com" }, false));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Konto użytkownika: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["uid"]);
	});
});

// ─── Badges ─────────────────────────────────────────────────────────────────

/** UserBadgeDto, as `manageUserBadges/{uid}` lists every badge. */
const userBadge = (id: string, isActive: boolean) => ({
	id,
	name: `Odznaka ${id}`,
	currentCount: isActive ? 1 : 0,
	targetCount: 1,
	isActive,
	imageRelativePath: `badges/${id}.webp`,
	imageFullPath: `https://cdn.example/public/badges/${id}.webp`,
});

/** UserBadgesResponseDto. */
const sectionsOf = (
	...subsections: ReturnType<typeof userBadge>[][]
): Record<string, unknown> => ({
	sections: [
		{
			id: "main",
			title: "Odznaki",
			shouldShowTitle: true,
			subsections: subsections.map((badges, index) => ({
				id: `sub${index}`,
				title: `Grupa ${index}`,
				badgeSize: "normal",
				badges,
			})),
		},
	],
});

/** UserManualBadgeGrantAdminDto. */
const grant = (
	grantId: string,
	badgeId: string,
	grantedAtUtc: string,
): Record<string, unknown> => ({
	grantId,
	badgeId,
	badgeName: `Odznaka ${badgeId}`,
	specialCategory: "event",
	grantedAtUtc,
});

describe("toUserBadges", () => {
	it("lists earned badges once, without a date, and skips the rest", () => {
		expect(
			toUserBadges(
				sectionsOf(
					[userBadge("n_1", true), userBadge("n_2", false)],
					[userBadge("m_running_10", true)],
				),
				[],
			),
		).toEqual([
			{ badgeId: "n_1", earnedAtUtc: "", grantId: null },
			{ badgeId: "m_running_10", earnedAtUtc: "", grantId: null },
		]);
	});

	it("lists a badge given by hand with its date and the id to take it back", () => {
		expect(
			toUserBadges(sectionsOf([userBadge("s_4", true)]), [
				grant("g-1", "s_4", "2026-10-01T10:00:00.000Z"),
			]),
		).toEqual([
			{
				badgeId: "s_4",
				earnedAtUtc: "2026-10-01T10:00:00.000Z",
				grantId: "g-1",
			},
		]);
	});

	it("puts granted badges first, newest first, then the earned ones", () => {
		const badges = toUserBadges(
			sectionsOf([
				userBadge("n_1", true),
				userBadge("s_4", true),
				userBadge("s_5", true),
			]),
			[
				grant("g-1", "s_4", "2026-09-01T10:00:00.000Z"),
				grant("g-2", "s_5", "2026-10-01T10:00:00.000Z"),
			],
		);
		expect(badges.map((badge) => badge.badgeId)).toEqual(["s_5", "s_4", "n_1"]);
	});

	it("lists a badge once per grant when it was given more than once", () => {
		const badges = toUserBadges(sectionsOf([userBadge("s_4", true)]), [
			grant("g-1", "s_4", "2026-09-01T10:00:00.000Z"),
			grant("g-2", "s_4", "2026-10-01T10:00:00.000Z"),
		]);
		expect(badges).toEqual([
			{
				badgeId: "s_4",
				earnedAtUtc: "2026-10-01T10:00:00.000Z",
				grantId: "g-2",
			},
			{
				badgeId: "s_4",
				earnedAtUtc: "2026-09-01T10:00:00.000Z",
				grantId: "g-1",
			},
		]);
	});

	it("lists an earned badge once even when two groups show it", () => {
		expect(
			toUserBadges(
				sectionsOf([userBadge("n_1", true)], [userBadge("n_1", true)]),
				[],
			),
		).toEqual([{ badgeId: "n_1", earnedAtUtc: "", grantId: null }]);
	});

	it("keeps a grant whose badge the sections do not show", () => {
		// For example a hidden badge.
		expect(
			toUserBadges(sectionsOf([]), [
				grant("g-1", "s_9", "2026-10-01T10:00:00.000Z"),
			]),
		).toEqual([
			{
				badgeId: "s_9",
				earnedAtUtc: "2026-10-01T10:00:00.000Z",
				grantId: "g-1",
			},
		]);
	});

	it("builds each row from three fields and nothing else", () => {
		const [badge] = toUserBadges(sectionsOf([userBadge("s_4", true)]), [
			grant("g-1", "s_4", "2026-10-01T10:00:00.000Z"),
		]);
		expect(Object.keys(badge ?? {}).toSorted()).toEqual([
			"badgeId",
			"earnedAtUtc",
			"grantId",
		]);
	});

	it("reads sections that are missing or empty as no earned badges", () => {
		for (const sections of [
			{},
			{ sections: null },
			{ sections: [] },
			{ sections: [{ id: "main" }] },
			{ sections: [{ id: "main", subsections: [{ id: "sub" }] }] },
			{
				sections: [{ id: "main", subsections: [{ id: "sub", badges: null }] }],
			},
		]) {
			expect(toUserBadges(sections, [])).toEqual([]);
		}
	});

	it("does not count a badge without the flag as earned", () => {
		expect(
			toUserBadges(
				{ sections: [{ subsections: [{ badges: [{ id: "n_1" }] }] }] },
				[],
			),
		).toEqual([]);
	});

	it("fails loudly when either answer is not what it should be", () => {
		expect(thrownBy(() => toUserBadges([], [])).message).toContain(
			"Odznaki użytkownika",
		);
		const error = thrownBy(() => toUserBadges(sectionsOf([]), { grants: [] }));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Nadane odznaki użytkownika");
		expect(
			thrownBy(() =>
				toUserBadges(sectionsOf([]), [{ grantId: "g-1", badgeId: "s_4" }]),
			).issues.map((issue) => issue.path),
		).toEqual(["0.grantedAtUtc"]);
	});
});

// ─── Progress ───────────────────────────────────────────────────────────────

/** One workout of `manageUserProgress/{uid}`, as the handler builds it. */
const progressWorkout = (
	id: string,
	completions: Record<string, unknown>[],
): Record<string, unknown> => ({
	id,
	title: `Trening ${id}`,
	durationSeconds: 1500,
	trainingTypeIds: ["mobility"],
	liveAtUtc: null,
	completions,
});

const completion = (
	completedAtUtc: string | null,
	challenge: Record<string, unknown> = {},
) => ({
	completedAtUtc,
	challengeId: null,
	attemptId: null,
	dayIndex: null,
	...challenge,
});

const attempt = (
	startedAtUtc: string,
	more: Record<string, unknown> = {},
): Record<string, unknown> => ({
	path: "beginner",
	mode: null,
	status: "inProgress",
	startedAtUtc,
	completedAtUtc: null,
	abortedAtUtc: null,
	uploadedAtUtc: null,
	dayCompletions: [],
	...more,
});

const progressChallenge = (
	id: string,
	attempts: Record<string, unknown>[],
): Record<string, unknown> => ({
	id,
	title: `Wyzwanie ${id}`,
	liveAtUtc: null,
	totalAttempts: attempts.length,
	completedAttempts: 0,
	abortedAttempts: 0,
	inProgressAttempts: attempts.length,
	attempts,
});

describe("toUserProgress", () => {
	it("flattens completions into one history, newest first", () => {
		const progress = toUserProgress({
			workouts: [
				progressWorkout("W1", [
					completion("2026-10-01T07:00:00.000Z"),
					completion("2026-11-03T07:00:00.000Z"),
				]),
				progressWorkout("W2", [
					completion("2026-10-15T07:00:00.000Z", {
						challengeId: "C12",
						attemptId: "a-1",
						dayIndex: 3,
					}),
				]),
			],
			challenges: [],
		});
		expect(
			progress.workouts.map((row) => [row.workoutId, row.completedAtUtc]),
		).toEqual([
			["W1", "2026-11-03T07:00:00.000Z"],
			["W2", "2026-10-15T07:00:00.000Z"],
			["W1", "2026-10-01T07:00:00.000Z"],
		]);
		// Which challenge day a completion belonged to comes along.
		expect(progress.workouts[1]).toEqual({
			workoutId: "W2",
			completedAtUtc: "2026-10-15T07:00:00.000Z",
			challengeId: "C12",
			attemptId: "a-1",
			dayIndex: 3,
		});
	});

	it("leaves out a completion without a date", () => {
		const progress = toUserProgress({
			workouts: [
				progressWorkout("W1", [
					completion(null),
					completion("2026-10-01T07:00:00.000Z"),
				]),
			],
		});
		expect(progress.workouts).toHaveLength(1);
	});

	it("flattens attempts into one history, newest first, with the days done", () => {
		const progress = toUserProgress({
			workouts: [],
			challenges: [
				progressChallenge("C1", [
					attempt("2026-08-01T06:00:00.000Z", {
						status: "aborted",
						abortedAtUtc: "2026-08-10T06:00:00.000Z",
						dayCompletions: [{ dayIndex: 1, workoutIds: ["W1"] }],
					}),
					attempt("2026-10-20T06:00:00.000Z", {
						path: "advanced",
						dayCompletions: [
							{ dayIndex: 1, workoutIds: ["W1"] },
							{ dayIndex: 2, workoutIds: [] },
							{ dayIndex: 3, workoutIds: ["W2"] },
						],
					}),
				]),
				progressChallenge("C12", [
					attempt("2026-09-05T06:00:00.000Z", {
						status: "completed",
						completedAtUtc: "2026-10-03T06:00:00.000Z",
						dayCompletions: Array.from({ length: 28 }, (_, i) => ({
							dayIndex: i + 1,
							workoutIds: [],
						})),
					}),
				]),
			],
		});
		expect(progress.challenges).toEqual([
			{
				challengeId: "C1",
				levelId: "advanced",
				startedAtUtc: "2026-10-20T06:00:00.000Z",
				completedAtUtc: null,
				abortedAtUtc: null,
				completedDays: 3,
				mode: null,
				status: "inProgress",
				uploadedAtUtc: null,
			},
			{
				challengeId: "C12",
				levelId: "beginner",
				startedAtUtc: "2026-09-05T06:00:00.000Z",
				completedAtUtc: "2026-10-03T06:00:00.000Z",
				abortedAtUtc: null,
				completedDays: 28,
				mode: null,
				status: "completed",
				uploadedAtUtc: null,
			},
			{
				challengeId: "C1",
				levelId: "beginner",
				startedAtUtc: "2026-08-01T06:00:00.000Z",
				completedAtUtc: null,
				abortedAtUtc: "2026-08-10T06:00:00.000Z",
				completedDays: 1,
				mode: null,
				status: "aborted",
				uploadedAtUtc: null,
			},
		]);
	});

	it("reads an attempt without a variant or days", () => {
		const progress = toUserProgress({
			challenges: [
				{ id: "C1", attempts: [{ startedAtUtc: "2026-08-01T06:00:00.000Z" }] },
			],
		});
		expect(progress.challenges).toEqual([
			{
				challengeId: "C1",
				levelId: null,
				startedAtUtc: "2026-08-01T06:00:00.000Z",
				completedAtUtc: null,
				abortedAtUtc: null,
				completedDays: 0,
			},
		]);
	});

	it("does not carry the grouping's own fields into the history", () => {
		const progress = toUserProgress({
			workouts: [
				progressWorkout("W1", [completion("2026-10-01T07:00:00.000Z")]),
			],
			challenges: [
				progressChallenge("C1", [attempt("2026-08-01T06:00:00.000Z")]),
			],
		});
		const text = JSON.stringify(progress);
		for (const field of [
			"title",
			"durationSeconds",
			"totalAttempts",
			"dayCompletions",
			'"path"',
			'"id"',
		]) {
			expect(text).not.toContain(field);
		}
	});

	it("reads a person who did nothing", () => {
		for (const raw of [
			{},
			{ workouts: [], challenges: [] },
			{ workouts: null, challenges: null },
			{
				workouts: [{ id: "W1" }, { id: "W2", completions: null }],
				challenges: [{ id: "C1" }, { id: "C2", attempts: null }],
			},
		]) {
			expect(toUserProgress(raw)).toEqual({ workouts: [], challenges: [] });
		}
	});

	it("fails loudly for an answer that is not progress", () => {
		const error = thrownBy(() => toUserProgress([]));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Postępy użytkownika");
		expect(
			thrownBy(() =>
				toUserProgress({ challenges: [{ id: "C1", attempts: [{}] }] }),
			).issues.map((issue) => issue.path),
		).toEqual(["challenges.0.attempts.0.startedAtUtc"]);
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

const ACCOUNT = `accounts/${UID}`;
const WRITABLE = capabilities({ writes: { users: "on", userBadges: "on" } });

const todayAccount = (overrides: Record<string, unknown> = {}) =>
	json({ hasProSubscription: true, account: firebaseRecord(overrides) });

const searchAnswer = (...users: Record<string, unknown>[]) =>
	json({
		users,
		totalMatches: users.length,
		truncated: false,
		indexedAtUtc: "2026-11-11T09:45:00.000Z",
	});

describe("usersArea: get", () => {
	it("reads one account, with the subscription and without the secrets", async () => {
		const backend = fakeBackend().on("GET", ACCOUNT, todayAccount());
		const api = usersArea(backend.transport, SWITCHED_OFF);

		const account = await api.get(UID);

		expect(account).toEqual({
			uid: UID,
			email: "anna@example.com",
			displayName: "Anna Nowak",
			emailVerified: true,
			disabled: false,
			providers: ["password", "google.com"],
			createdAtUtc: "2026-01-05T08:30:00.000Z",
			lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
			hasProSubscription: true,
		});
		expectNoSecrets(account);
		expect(backend.calls()).toEqual([`GET ${ACCOUNT}`]);
		expect(backend.only("GET", ACCOUNT).query).toEqual({});
	});

	it("reads a missing subscription state as none", async () => {
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			json({ account: firebaseRecord() }),
		);
		const account = await usersArea(backend.transport, SWITCHED_OFF).get(UID);
		expect(account.hasProSubscription).toBe(false);
	});

	it("reads today's 200 with only a message as not found", async () => {
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			json({ message: `User with id ${UID} not found` }),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).get(UID),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Nie ma takiego konta.");
	});

	it("reads the planned 404 as not found", async () => {
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			errorReply(404, `User not found: ${UID}`, { errorCode: null }),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).get(UID),
		);
		expect(error.kind).toBe("notFound");
		expect(error.status).toBe(404);
	});

	it("reads the planned typed answer, flat or under `account`", async () => {
		for (const answer of [
			{ ...wireUserSummary(), hasProSubscription: true },
			{ hasProSubscription: true, account: wireUserSummary() },
		]) {
			const backend = fakeBackend().on("GET", ACCOUNT, json(answer));
			const account = await usersArea(backend.transport, SWITCHED_OFF).get(UID);
			expect(account).toMatchObject({
				uid: UID,
				providers: ["password", "google.com"],
				createdAtUtc: "2026-01-05T08:30:00.000Z",
				hasProSubscription: true,
			});
		}
	});

	it("makes no request for an empty id", async () => {
		const backend = fakeBackend();
		const api = usersArea(backend.transport, SWITCHED_OFF);
		for (const uid of ["", "   "]) {
			expect((await failure(api.get(uid))).kind).toBe("notFound");
		}
		expect(backend.requests).toEqual([]);
	});

	it("makes no request for an id that would lead to another endpoint", async () => {
		const backend = fakeBackend();
		const api = usersArea(backend.transport, SWITCHED_OFF);
		for (const uid of [".", "..", " .. "]) {
			expect((await failure(api.get(uid))).kind).toBe("notFound");
			expect((await failure(api.badges(uid))).kind).toBe("notFound");
			expect((await failure(api.progress(uid))).kind).toBe("notFound");
		}
		expect(backend.requests).toEqual([]);
	});

	it("trims the id and keeps it inside its path segment", async () => {
		const backend = fakeBackend()
			.on("GET", ACCOUNT, todayAccount())
			.on(
				"GET",
				"accounts/a%2Fb%3Fc",
				json({ message: "User with id a/b?c not found" }),
			);
		const api = usersArea(backend.transport, SWITCHED_OFF);
		expect((await api.get(`  ${UID}\n`)).uid).toBe(UID);
		expect((await failure(api.get("a/b?c"))).kind).toBe("notFound");
		expect(backend.calls()).toEqual([
			`GET ${ACCOUNT}`,
			"GET accounts/a%2Fb%3Fc",
		]);
	});

	it("reports an account it cannot read as the backend's fault", async () => {
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			json({ hasProSubscription: false, account: { email: "x@example.com" } }),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).get(UID),
		);
		expect(error.kind).toBe("server");
	});

	it("reports a sign-in the backend refuses", async () => {
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			errorReply(
				403,
				"Wyglada na to, ze nie masz dostępu do tego zasobu. Miłego dnia!",
			),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).get(UID),
		);
		expect(error.kind).toBe("forbidden");
	});
});

describe("usersArea: search", () => {
	it("asks for nothing when the query is too short", async () => {
		const backend = fakeBackend();
		const api = usersArea(backend.transport, SWITCHED_OFF);
		for (const query of ["", " ", "an", "  an  "]) {
			expect(await api.search(query)).toEqual({
				users: [],
				totalMatches: 0,
				truncated: false,
			});
		}
		expect(backend.requests).toEqual([]);
	});

	it("searches with the trimmed query and the panel's limit", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			json({
				users: [
					wireUserSummary(),
					wireUserSummary({ uid: "u2", email: "anna.k@example.com" }),
				],
				totalMatches: 57,
				truncated: true,
				indexedAtUtc: "2026-11-11T09:45:00.000Z",
			}),
		);
		const api = usersArea(backend.transport, SWITCHED_OFF);

		const found = await api.search("  anna ");

		expect(found.users.map((user) => user.uid)).toEqual([UID, "u2"]);
		expect(found.users[0]).toMatchObject(wireUserSummary());
		expect(found.totalMatches).toBe(57);
		expect(found.truncated).toBe(true);
		expect(backend.calls()).toEqual(["GET manageUsers"]);
		expect(backend.only("GET", "manageUsers").query).toEqual({
			query: "anna",
			limit: "20",
		});
	});

	it("sends an address with its special characters intact", async () => {
		const backend = fakeBackend().on("GET", "manageUsers", searchAnswer());
		await usersArea(backend.transport, SWITCHED_OFF).search(
			"anna+test@example.com&limit=999",
		);
		expect(backend.only("GET", "manageUsers").query).toEqual({
			query: "anna+test@example.com&limit=999",
			limit: "20",
		});
	});

	it("returns an empty result for a query that is not an id", async () => {
		const backend = fakeBackend().on("GET", "manageUsers", searchAnswer());
		const found = await usersArea(backend.transport, SWITCHED_OFF).search(
			"nikt@example.com",
		);
		expect(found).toMatchObject({ users: [], totalMatches: 0 });
		expect(backend.calls()).toEqual(["GET manageUsers"]);
	});

	describe("a query that looks like an account id", () => {
		it("is looked up directly when the search finds nothing", async () => {
			const backend = fakeBackend()
				.on("GET", "manageUsers", searchAnswer())
				.on("GET", ACCOUNT, todayAccount());
			const api = usersArea(backend.transport, SWITCHED_OFF);

			const found = await api.search(UID);

			expect(found).toEqual({
				users: [
					{
						uid: UID,
						email: "anna@example.com",
						displayName: "Anna Nowak",
						emailVerified: true,
						disabled: false,
						providers: ["password", "google.com"],
						createdAtUtc: "2026-01-05T08:30:00.000Z",
						lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
					},
				],
				totalMatches: 1,
				truncated: false,
			});
			expectNoSecrets(found);
			expect(backend.calls()).toEqual(["GET manageUsers", `GET ${ACCOUNT}`]);
		});

		it("is not looked up when the search found someone", async () => {
			const backend = fakeBackend().on(
				"GET",
				"manageUsers",
				searchAnswer(wireUserSummary()),
			);
			const found = await usersArea(backend.transport, SWITCHED_OFF).search(
				UID,
			);
			expect(found.users).toHaveLength(1);
			expect(backend.calls()).toEqual(["GET manageUsers"]);
		});

		it("gives the empty result when there is no such account either", async () => {
			for (const answer of [
				json({ message: `User with id ${UID} not found` }),
				errorReply(404, `User not found: ${UID}`),
			]) {
				const backend = fakeBackend()
					.on("GET", "manageUsers", searchAnswer())
					.on("GET", ACCOUNT, answer);
				const found = await usersArea(backend.transport, SWITCHED_OFF).search(
					UID,
				);
				expect(found).toMatchObject({
					users: [],
					totalMatches: 0,
					truncated: false,
				});
			}
		});

		it("passes on a failure of the direct look-up", async () => {
			const backend = fakeBackend()
				.on("GET", "manageUsers", searchAnswer())
				.on("GET", ACCOUNT, errorReply(503, "Unavailable"));
			const error = await failure(
				usersArea(backend.transport, SWITCHED_OFF).search(UID),
			);
			expect(error.kind).toBe("server");
		});

		it.each([
			"anna.nowak@example.com",
			"Anna Nowak",
			"Qm3xT7pLr9VbN2sK8dH",
			"Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1Qm3xT7pLr9VbN",
			"Qm3xT7pLr9VbN2sK8dH/J4wZcYa1",
		])("does not take %j for an id", async (query) => {
			const backend = fakeBackend().on("GET", "manageUsers", searchAnswer());
			await usersArea(backend.transport, SWITCHED_OFF).search(query);
			expect(backend.calls()).toEqual(["GET manageUsers"]);
		});
	});

	it("reports the backend refusing the query", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			errorReply(400, "Every search term needs at least 2 characters", {
				errorCode: "WRONG_REQUEST",
			}),
		);
		const error = await failure(
			// One the panel's own rule lets through: the refusal is the backend's.
			usersArea(backend.transport, SWITCHED_OFF).search("anna"),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(400);
	});

	it("reports the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			errorReply(500, "Failed to search users: Error: quota exceeded"),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).search("anna"),
		);
		expect(error.kind).toBe("server");
	});

	it("fails loudly for an answer that is not a search result", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			json([wireUserSummary()]),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).search("anna"),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Wyniki wyszukiwania");
	});
});

describe("usersArea: badges and progress", () => {
	const BADGES = `manageUserBadges/${UID}`;
	const GRANTS = `manageUserBadges/${UID}/grants`;
	const PROGRESS = `manageUserProgress/${UID}`;

	it("reads a person's badges from the two lists the backend has", async () => {
		const backend = fakeBackend()
			.on(
				"GET",
				BADGES,
				json(sectionsOf([userBadge("n_1", true), userBadge("s_4", true)])),
			)
			.on(
				"GET",
				GRANTS,
				json([grant("g-1", "s_4", "2026-10-01T10:00:00.000Z")]),
			);
		const api = usersArea(backend.transport, SWITCHED_OFF);

		expect(await api.badges(UID)).toEqual([
			{
				badgeId: "s_4",
				earnedAtUtc: "2026-10-01T10:00:00.000Z",
				grantId: "g-1",
			},
			{ badgeId: "n_1", earnedAtUtc: "", grantId: null },
		]);
		expect(backend.calls().toSorted()).toEqual([
			`GET ${BADGES}`,
			`GET ${GRANTS}`,
		]);
	});

	it("fails when either of the two lists fails", async () => {
		const backend = fakeBackend()
			.on("GET", BADGES, json(sectionsOf([])))
			.on("GET", GRANTS, errorReply(404, `User not found: ${UID}`));
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).badges(UID),
		);
		expect(error.kind).toBe("notFound");
	});

	it("reads a person's progress", async () => {
		const backend = fakeBackend().on(
			"GET",
			PROGRESS,
			json({
				workouts: [
					progressWorkout("W1", [completion("2026-10-01T07:00:00.000Z")]),
				],
				challenges: [
					progressChallenge("C1", [attempt("2026-08-01T06:00:00.000Z")]),
				],
			}),
		);
		const api = usersArea(backend.transport, SWITCHED_OFF);

		const progress = await api.progress(UID);

		expect(progress.workouts.map((row) => row.workoutId)).toEqual(["W1"]);
		expect(progress.challenges.map((row) => row.challengeId)).toEqual(["C1"]);
		expect(backend.calls()).toEqual([`GET ${PROGRESS}`]);
	});

	it("reports a person the backend does not know", async () => {
		const backend = fakeBackend().on(
			"GET",
			PROGRESS,
			errorReply(404, `User not found: ${UID}`, { errorCode: null }),
		);
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).progress(UID),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe(`User not found: ${UID}`);
	});

	it("makes no request for an empty id", async () => {
		const backend = fakeBackend();
		const api = usersArea(backend.transport, SWITCHED_OFF);
		expect((await failure(api.badges(" "))).kind).toBe("notFound");
		expect((await failure(api.progress(""))).kind).toBe("notFound");
		expect(backend.requests).toEqual([]);
	});
});

describe("usersArea: changeEmail", () => {
	it("puts the trimmed address, then reads the account again", async () => {
		const backend = fakeBackend()
			.on(
				"PUT",
				ACCOUNT,
				json({
					result: `User ${UID} updated successfully`,
					user: {
						uid: UID,
						email: "anna.nowa@example.com",
						customClaims: { acceptedTermsAndPrivacyVersion: 3 },
						phoneNumber: "+48500100200",
					},
					oldEmail: "anna@example.com",
				}),
			)
			.on(
				"GET",
				ACCOUNT,
				todayAccount({ email: "anna.nowa@example.com", emailVerified: false }),
			);
		const api = usersArea(backend.transport, WRITABLE);

		const account = await api.changeEmail(UID, "  anna.nowa@example.com ");

		expect(account).toMatchObject({
			uid: UID,
			email: "anna.nowa@example.com",
			emailVerified: false,
			// The PUT's answer does not say; the account read after it does.
			hasProSubscription: true,
		});
		expectNoSecrets(account);
		expect(backend.calls()).toEqual([`PUT ${ACCOUNT}`, `GET ${ACCOUNT}`]);
		expect(bodyOf(backend.only("PUT", ACCOUNT))).toEqual({
			email: "anna.nowa@example.com",
		});
	});

	it("makes no request while accounts are read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			usersArea(backend.transport, SWITCHED_OFF).changeEmail(
				UID,
				"anna.nowa@example.com",
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Użytkownicy”");
		expect(backend.requests).toEqual([]);
	});

	it("has no test mode: an account cannot be marked as a test item", async () => {
		const backend = fakeBackend();
		const error = await failure(
			usersArea(
				backend.transport,
				capabilities({ writes: { users: "test-only" } }),
			).changeEmail(UID, "anna.nowa@example.com"),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("nie da się wypróbować");
		expect(backend.requests).toEqual([]);
	});

	it("does not read the account after a refused change", async () => {
		const backend = fakeBackend().on("PUT", ACCOUNT, errorReply(403, "Brak"));
		const error = await failure(
			usersArea(backend.transport, WRITABLE).changeEmail(UID, "a@example.com"),
		);
		expect(error.kind).toBe("forbidden");
		expect(backend.calls()).toEqual([`PUT ${ACCOUNT}`]);
	});
});

describe("usersArea: grantBadge and revokeBadge", () => {
	const BADGES = `manageUserBadges/${UID}`;
	const GRANTS = `manageUserBadges/${UID}/grants`;
	const GRANT = "manageBadges/grantManual";
	const REVOKE = "manageBadges/revokeManual";
	const held: UserBadge = {
		badgeId: "s_4",
		earnedAtUtc: "2026-10-01T10:00:00.000Z",
		grantId: "g-1",
	};

	it("grants a badge, then reads the person's badges", async () => {
		const backend = fakeBackend()
			.on("POST", GRANT, json({ result: `Granted badge s_4 to user ${UID}` }))
			.on("GET", BADGES, json(sectionsOf([userBadge("s_4", true)])))
			.on(
				"GET",
				GRANTS,
				json([grant("g-1", "s_4", "2026-10-01T10:00:00.000Z")]),
			);
		const api = usersArea(backend.transport, WRITABLE);

		expect(await api.grantBadge(UID, "s_4")).toEqual([held]);

		expect(backend.calls()[0]).toBe(`POST ${GRANT}`);
		expect(backend.calls().slice(1).toSorted()).toEqual([
			`GET ${BADGES}`,
			`GET ${GRANTS}`,
		]);
		expect(bodyOf(backend.only("POST", GRANT))).toEqual({
			userId: UID,
			badgeId: "s_4",
		});
	});

	it("reports a badge that cannot be given by hand", async () => {
		const backend = fakeBackend().on(
			"POST",
			GRANT,
			validationReply([
				{
					path: "badgeId",
					code: "NOT_MANUAL_BADGE",
					message: "Ręcznie można przyznać tylko odznakę ręczną.",
				},
			]),
		);
		const error = await failure(
			usersArea(backend.transport, WRITABLE).grantBadge(UID, "n_7"),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Ręcznie można przyznać tylko odznakę ręczną.");
		expect(error.issues).toEqual([
			{
				path: "badgeId",
				message: "Ręcznie można przyznać tylko odznakę ręczną.",
			},
		]);
		expect(error.status).toBe(422);
		expect(backend.calls()).toEqual([`POST ${GRANT}`]);
	});

	it("takes a badge back by the date it was given, then reads the badges", async () => {
		const backend = fakeBackend()
			.on("POST", REVOKE, json({ result: `Revoked badge s_4 for user ${UID}` }))
			.on("GET", BADGES, json(sectionsOf([userBadge("s_4", false)])))
			.on("GET", GRANTS, json([]));
		const api = usersArea(backend.transport, WRITABLE);

		expect(await api.revokeBadge(UID, held)).toEqual([]);

		expect(backend.calls()[0]).toBe(`POST ${REVOKE}`);
		// The backend finds the grant by its date (RevokeManualBadgeAdminDto).
		expect(bodyOf(backend.only("POST", REVOKE))).toEqual({
			userId: UID,
			badgeId: "s_4",
			grantedAtUtc: "2026-10-01T10:00:00.000Z",
		});
	});

	it("does not ask to take back a badge the person earned themselves", async () => {
		const backend = fakeBackend();
		const error = await failure(
			usersArea(backend.transport, WRITABLE).revokeBadge(UID, {
				badgeId: "n_1",
				earnedAtUtc: "",
				grantId: null,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("zdobył sam");
		expect(backend.requests).toEqual([]);
	});

	it("makes no request while badges of people are read-only", async () => {
		const backend = fakeBackend();
		for (const caps of [
			SWITCHED_OFF,
			// Open accounts do not open badges.
			capabilities({ writes: { users: "on" } }),
			// Neither can be tried on a test item.
			capabilities({ writes: { userBadges: "test-only" } }),
		]) {
			const api = usersArea(backend.transport, caps);
			expect((await failure(api.grantBadge(UID, "s_4"))).kind).toBe(
				"validation",
			);
			expect((await failure(api.revokeBadge(UID, held))).kind).toBe(
				"validation",
			);
		}
		expect(backend.requests).toEqual([]);
	});

	it("works with everything switched on", async () => {
		const backend = fakeBackend()
			.on("POST", GRANT, json({ result: "ok" }))
			.on("GET", BADGES, json(sectionsOf([])))
			.on("GET", GRANTS, json([]));
		expect(
			await usersArea(backend.transport, ALL_CAPABILITIES).grantBadge(
				UID,
				"s_4",
			),
		).toEqual([]);
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Answers below are the ones the backend's own tests show
// (tests/handlers/accountsPanelContract.test.ts).

/** Produkcja's features, with accounts accepted. */
const OPEN = production({ writes: { users: "on" } });

/** AdminUserAccountResponseDto: exactly these fields, and nothing else of the record. */
const typedAccount = (overrides: Record<string, unknown> = {}) => ({
	hasProSubscription: true,
	account: wireUserSummary(overrides),
});

describe("usersArea: get on the panel's route", () => {
	it("reads the typed record and the subscription", async () => {
		const backend = fakeBackend().on("GET", ACCOUNT, json(typedAccount()));
		const account = await usersArea(backend.transport, production()).get(UID);
		expect(account).toEqual({
			uid: UID,
			email: "anna@example.com",
			displayName: "Anna Nowak",
			emailVerified: true,
			disabled: false,
			providers: ["password", "google.com"],
			createdAtUtc: "2026-01-05T08:30:00.000Z",
			lastSignInAtUtc: "2026-11-03T12:00:00.000Z",
			hasProSubscription: true,
		});
	});

	it("reads an account that says nothing about itself", async () => {
		// "says null and false where the record says nothing".
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			json({
				hasProSubscription: false,
				account: {
					uid: UID,
					email: null,
					displayName: null,
					emailVerified: false,
					disabled: false,
					providers: [],
					createdAtUtc: null,
					lastSignInAtUtc: null,
				},
			}),
		);
		const account = await usersArea(backend.transport, production()).get(UID);
		expect(account).toMatchObject({
			email: null,
			providers: [],
			createdAtUtc: null,
			hasProSubscription: false,
		});
	});

	it("shows the backend's words that there is no such account", async () => {
		// "an unknown user is 404 for the panel".
		const backend = fakeBackend().on(
			"GET",
			ACCOUNT,
			notFoundReply(`User with id ${UID} not found`),
		);
		const error = await failure(
			usersArea(backend.transport, production()).get(UID),
		);
		expect(error.kind).toBe("notFound");
		expect(error.status).toBe(404);
		expect(error.message).toBe(`User with id ${UID} not found`);
	});
});

describe("usersArea: changeEmail on the panel's route", () => {
	it("takes the account from the answer, without reading it again", async () => {
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			json({
				result: `User ${UID} updated successfully`,
				...typedAccount({
					email: "anna.nowa@example.com",
					emailVerified: false,
				}),
				oldEmail: "anna@example.com",
			}),
		);
		const api = usersArea(backend.transport, OPEN);

		const account = await api.changeEmail(UID, "  anna.nowa@example.com ");

		expect(account).toMatchObject({
			uid: UID,
			email: "anna.nowa@example.com",
			emailVerified: false,
			hasProSubscription: true,
		});
		expect(backend.calls()).toEqual([`PUT ${ACCOUNT}`]);
		// The address and nothing else: any other field is refused there.
		expect(bodyOf(backend.only("PUT", ACCOUNT))).toEqual({
			email: "anna.nowa@example.com",
		});
		// Only what the account page shows is kept of the answer.
		expect(account).not.toHaveProperty("oldEmail");
		expect(account).not.toHaveProperty("result");
	});

	it.each([
		["EMAIL_TAKEN", "Ten adres e-mail ma już inne konto."],
		["INVALID_EMAIL", "To nie jest poprawny adres e-mail."],
	])("shows %s at the field, as the backend says it", async (code, message) => {
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			validationReply([{ path: "email", code, message }]),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN).changeEmail(UID, "taken@example.com"),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.message).toBe(message);
		expect(error.issues).toEqual([{ path: "email", message }]);
		// Nothing read after a refusal.
		expect(backend.calls()).toEqual([`PUT ${ACCOUNT}`]);
	});

	it("keeps the backend's sentence for a refusal of another field", async () => {
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			validationReply([
				{
					path: "displayName",
					code: "NOT_ALLOWED",
					message:
						"displayName cannot be changed from the admin panel; only email can",
				},
			]),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN).changeEmail(UID, "a@example.com"),
		);
		expect(error.issues).toEqual([
			{
				path: "displayName",
				message:
					"displayName cannot be changed from the admin panel; only email can",
			},
		]);
	});

	it("shows the backend's words that the account is gone", async () => {
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			notFoundReply(`User with id ${UID} not found`),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN).changeEmail(UID, "a@example.com"),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe(`User with id ${UID} not found`);
	});

	it("still reports a failure of Firebase itself as the backend's", async () => {
		// "a failure of Firebase itself is still a 500".
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			errorReply(500, `Failed to update user ${UID}: socket hang up`),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN).changeEmail(UID, "a@example.com"),
		);
		expect(error.kind).toBe("server");
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const error = await failure(
			usersArea(backend.transport, production()).changeEmail(
				UID,
				"a@example.com",
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Użytkownicy”");
		expect(backend.requests).toEqual([]);
	});
});

describe("usersArea: search on the panel's route", () => {
	it("does not ask for what the backend would refuse", async () => {
		// "the panel's search needs a term of three characters: 422 TOO_SHORT".
		// The rule is the panel's own now (domain/userRules); the screen says
		// what is wrong with the query before anything is asked.
		const backend = fakeBackend();
		const api = usersArea(backend.transport, production());
		for (const query of ["an no", "anna k", "ab, cd"]) {
			expect(await api.search(query)).toEqual({
				users: [],
				totalMatches: 0,
				truncated: false,
			});
		}
		expect(backend.requests).toEqual([]);
	});

	it("never sends a limit above the backend's, nor anything but the query and the limit", async () => {
		// "limit can be at most 20" and "refresh is not available to the admin panel".
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			json({ users: [], totalMatches: 0, truncated: false }),
		);
		await usersArea(backend.transport, production()).search("anna nowak");
		const { query } = backend.only("GET", "manageUsers");
		expect(Object.keys(query).toSorted()).toEqual(["limit", "query"]);
		expect(Number(query.limit)).toBeLessThanOrEqual(20);
	});

	it("still asks for nothing, and reports nothing, under three characters in all", async () => {
		const backend = fakeBackend();
		const api = usersArea(backend.transport, production());
		expect(await api.search("an")).toEqual({
			users: [],
			totalMatches: 0,
			truncated: false,
		});
		expect(backend.requests).toEqual([]);
	});

	it("searches, within the panel's limit, and says how fresh the answer is", async () => {
		// "the panel gets the search result as it is: the slim rows and the counts".
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			json({
				users: [wireUserSummary()],
				totalMatches: 31,
				truncated: true,
				indexedAtUtc: "2026-11-13T09:45:00.000Z",
			}),
		);
		const found = await usersArea(backend.transport, production()).search(
			"anna nowak",
		);
		expect(found).toMatchObject({
			totalMatches: 31,
			truncated: true,
			indexedAtUtc: "2026-11-13T09:45:00.000Z",
		});
		expect(backend.only("GET", "manageUsers").query).toEqual({
			query: "anna nowak",
			limit: "20",
		});
	});

	it("passes on the backend's own refusal, should one come", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageUsers",
			validationReply([
				{
					path: "query",
					code: "TOO_SHORT",
					message: "A search needs a term of at least 3 characters",
				},
			]),
		);
		const error = await failure(
			usersArea(backend.transport, production()).search("anna"),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("query");
	});

	it("looks an id up directly when the search finds nobody, and takes 404 for nobody", async () => {
		const backend = fakeBackend()
			.on(
				"GET",
				"manageUsers",
				json({ users: [], totalMatches: 0, truncated: false }),
			)
			.on("GET", ACCOUNT, notFoundReply(`User with id ${UID} not found`));
		const found = await usersArea(backend.transport, production()).search(UID);
		expect(found.users).toEqual([]);
		expect(backend.calls()).toEqual(["GET manageUsers", `GET ${ACCOUNT}`]);
	});
});

describe("toSearchResult: when the list of accounts was read", () => {
	it("is kept when the backend says it, and absent when it does not", () => {
		expect(
			toSearchResult({ users: [], indexedAtUtc: "2026-11-13T09:45:00.000Z" }),
		).toMatchObject({ indexedAtUtc: "2026-11-13T09:45:00.000Z" });
		expect(toSearchResult({ users: [] })).not.toHaveProperty("indexedAtUtc");
		expect(
			toSearchResult({ users: [], indexedAtUtc: null }),
		).not.toHaveProperty("indexedAtUtc");
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("usersArea: the stricter backend", () => {
	const OPEN_STRICT = production({ writes: { users: "on", userBadges: "on" } });
	const GRANT = "manageBadges/grantManual";
	const REVOKE = "manageBadges/revokeManual";
	const lists = (backend: ReturnType<typeof fakeBackend>) =>
		backend
			.on("GET", `manageUserBadges/${UID}`, json({ sections: [] }))
			.on("GET", `manageUserBadges/${UID}/grants`, json([]));

	it("sends an address without the spaces around it", async () => {
		// "an address with spaces around it is UNTRIMMED".
		const backend = fakeBackend().on(
			"PUT",
			ACCOUNT,
			json({
				result: "x",
				hasProSubscription: false,
				account: wireUserSummary({ email: "anna.nowa@example.com" }),
				oldEmail: "anna@example.com",
			}),
		);
		await usersArea(backend.transport, OPEN_STRICT).changeEmail(
			UID,
			" anna.nowa@example.com\n",
		);
		expect(bodyOf(backend.only("PUT", ACCOUNT))).toEqual({
			email: "anna.nowa@example.com",
		});
	});

	it("gives a badge with both ids exactly as stored", async () => {
		const backend = lists(fakeBackend()).on(
			"POST",
			GRANT,
			json({ result: `Granted badge s_4 to user ${UID}` }),
		);
		await usersArea(backend.transport, OPEN_STRICT).grantBadge(
			` ${UID} `,
			" s_4 ",
		);
		expect(bodyOf(backend.only("POST", GRANT))).toEqual({
			userId: UID,
			badgeId: "s_4",
		});
	});

	it("says a person holds the badge already", async () => {
		const backend = fakeBackend().on(
			"POST",
			GRANT,
			validationReply([
				{
					path: "badgeId",
					code: "ALREADY_GRANTED",
					message: `User ${UID} already has badge s_4`,
				},
			]),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN_STRICT).grantBadge(UID, "s_4"),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{ path: "badgeId", message: `User ${UID} already has badge s_4` },
		]);
		// The lists are not read after a refusal.
		expect(backend.calls()).toEqual([`POST ${GRANT}`]);
	});

	it("reports an account or a badge that is not there", async () => {
		// "the account must exist (404)".
		const backend = fakeBackend().on(
			"POST",
			GRANT,
			notFoundReply(`User ${UID} not found`),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN_STRICT).grantBadge(UID, "s_4"),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe(`User ${UID} not found`);
	});

	it("takes a badge back by the full instant the list of grants gave", async () => {
		const backend = lists(fakeBackend()).on(
			"POST",
			REVOKE,
			json({ result: "Revoked" }),
		);
		await usersArea(backend.transport, OPEN_STRICT).revokeBadge(UID, {
			badgeId: "s_4 ",
			earnedAtUtc: "2026-10-01T10:00:00.000Z",
			grantId: "g-1",
		});
		expect(bodyOf(backend.only("POST", REVOKE))).toEqual({
			userId: UID,
			badgeId: "s_4",
			grantedAtUtc: "2026-10-01T10:00:00.000Z",
		});
	});

	it("does not guess the moment of a grant from a bare date", async () => {
		const backend = fakeBackend().on(
			"POST",
			REVOKE,
			validationReply([
				{
					path: "grantedAtUtc",
					code: "INVALID_DATE",
					message:
						"grantedAtUtc must be the grant's full ISO 8601 date and time, e.g. 2026-01-31T10:00:00.000Z",
				},
			]),
		);
		const error = await failure(
			usersArea(backend.transport, OPEN_STRICT).revokeBadge(UID, {
				badgeId: "s_4",
				earnedAtUtc: "2026-10-01",
				grantId: "g-1",
			}),
		);
		// Sent as it was, refused at its field.
		expect(bodyOf(backend.only("POST", REVOKE)).grantedAtUtc).toBe(
			"2026-10-01",
		);
		expect(error.issues[0]?.path).toBe("grantedAtUtc");
	});
});

// ─── The backend as tightened once more (third pass) ────────────────────────

describe("usersArea: bodies with nothing of the panel's own", () => {
	const OPEN_STRICT = production({ writes: { users: "on", userBadges: "on" } });

	it("sends the fields each call takes, and no other", async () => {
		// BADGE_GRANT_FIELDS, BADGE_REVOKE_FIELDS and ACCOUNT_SAVE_FIELDS of
		// the backend's src/config/panelFields.ts.
		const backend = fakeBackend()
			.on("GET", `manageUserBadges/${UID}`, json({ sections: [] }))
			.on("GET", `manageUserBadges/${UID}/grants`, json([]))
			.on("POST", "manageBadges/grantManual", json({ result: "x" }))
			.on("POST", "manageBadges/revokeManual", json({ result: "x" }))
			.on(
				"PUT",
				ACCOUNT,
				json({
					result: "x",
					hasProSubscription: false,
					account: wireUserSummary(),
					oldEmail: null,
				}),
			);
		const api = usersArea(backend.transport, OPEN_STRICT);
		await api.grantBadge(UID, "s_4");
		await api.revokeBadge(UID, {
			badgeId: "s_4",
			earnedAtUtc: "2026-10-01T10:00:00.000Z",
			grantId: "g-1",
			// What a screen may have put on the row it shows.
			...{ badgeName: "Bieg", selected: true },
		});
		await api.changeEmail(UID, "anna.nowa@example.com");

		expect(
			Object.keys(
				bodyOf(backend.only("POST", "manageBadges/grantManual")),
			).toSorted(),
		).toEqual(["badgeId", "userId"]);
		expect(
			Object.keys(
				bodyOf(backend.only("POST", "manageBadges/revokeManual")),
			).toSorted(),
		).toEqual(["badgeId", "grantedAtUtc", "userId"]);
		expect(Object.keys(bodyOf(backend.only("PUT", ACCOUNT)))).toEqual([
			"email",
		]);
	});
});
