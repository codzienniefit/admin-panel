import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import { type Badge, blankBadge, type NewBadge } from "@/data/schemas/badge";
import { badgesArea, fromBadge, toBadge } from "./badges";
import {
	capabilities,
	conflictReply,
	errorReply,
	failure,
	fakeBackend,
	json,
	notFoundReply,
	panelBadge,
	production,
	type Recorded,
	SWITCHED_OFF,
	tableEtag,
	validationReply,
	wireBadge,
} from "./testSupport";

// Rows and answers below follow `manageBadges` as it is today
// (docs/research/backend-audit.md §1a, §4a, §4d, §5b).

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

// ─── Rows of each type, as `GET manageBadges` lists them ────────────────────

const normalBadge = (overrides: Record<string, unknown> = {}) =>
	wireBadge(overrides);

const manualBadge = (overrides: Record<string, unknown> = {}) =>
	wireBadge({
		id: "s_3",
		name: "Trening specjalny",
		type: "manual",
		specialCategory: "specialTraining",
		sectionId: "special",
		subsectionId: "specialTraining",
		assignedToWorkouts: [],
		...overrides,
	});

const eventBadge = (overrides: Record<string, unknown> = {}) =>
	manualBadge({
		id: "s_4",
		name: "Bieg Niepodległości",
		specialCategory: "event",
		subsectionId: "event",
		claimToken: "BIEG2026",
		isClaimLinkActive: true,
		...overrides,
	});

const milestoneBadge = (overrides: Record<string, unknown> = {}) =>
	wireBadge({
		id: "m_running_10",
		name: "10 biegów",
		type: "milestone",
		repeatCategory: "running",
		milestoneCount: 10,
		sectionId: "repeat",
		subsectionId: "running",
		activeFromUtc: "2026-01-01T00:00:00.000Z",
		activeTillUtc: "2026-12-31T23:59:59.000Z",
		assignedToWorkouts: [],
		...overrides,
	});

const perfectionsBadge = (overrides: Record<string, unknown> = {}) =>
	wireBadge({
		id: "pc_2",
		name: "Wyzwanie na 100%",
		type: "perfections",
		sectionId: "challenges",
		subsectionId: "perfect",
		assignedToWorkouts: [],
		assignedToChallenges: [{ id: "C12", name: "Wiosenne", type: "plan" }],
		...overrides,
	});

// ─── The backend's own rules ────────────────────────────────────────────────

/**
 * `validateBadgeUpsertDto` of the backend
 * (src/modules/services/badgeValidationService.ts; messages quoted in the
 * audit §4d), ported rule by rule, to check that a body would be accepted.
 */
function backendProblems(dto: Record<string, unknown>): string[] {
	const errors: string[] = [];
	const trimmed = (value: unknown) =>
		typeof value === "string" ? value.trim() : "";
	const set = (value: unknown) => value !== null && value !== undefined;

	if (!trimmed(dto.name)) errors.push("name is required");
	if (!trimmed(dto.imageRelativePath)) {
		errors.push("imageRelativePath is required");
	}
	if (!trimmed(dto.imageRelativePath).startsWith("badges/")) {
		errors.push('imageRelativePath must start with "badges/"');
	}
	const types = ["normal", "manual", "milestone", "perfections"];
	if (!types.includes(dto.type as string)) {
		errors.push("type must be one of the four");
	}
	const claims = Boolean(trimmed(dto.claimToken)) || set(dto.isClaimLinkActive);
	if (dto.type !== "manual" && claims) {
		errors.push(
			'claimToken/isClaimLinkActive are only allowed for manual badges with specialCategory "event"',
		);
	}
	if (dto.type !== "manual") {
		for (const field of ["activeFromUtc", "activeTillUtc"]) {
			const value = trimmed(dto[field]);
			if (value && Number.isNaN(new Date(value).getTime())) {
				errors.push(`${field} must be a valid ISO date`);
			}
		}
	}
	const placed = set(dto.sectionId) || set(dto.subsectionId);
	const repeats = set(dto.repeatCategory) || set(dto.milestoneCount);
	if (dto.type === "milestone") {
		if (!trimmed(dto.repeatCategory)) {
			errors.push("repeatCategory is required for milestone badges");
		}
		if (!trimmed(dto.id) && !Number.isInteger(dto.milestoneCount)) {
			errors.push("milestoneCount is required for new milestone badges");
		}
		if (placed) {
			errors.push(
				"sectionId/subsectionId must not be set for milestone badges",
			);
		}
		if (set(dto.specialCategory)) {
			errors.push("specialCategory must not be set for milestone badges");
		}
	}
	if (dto.type === "normal") {
		if (placed) {
			errors.push("sectionId/subsectionId must not be set for normal badges");
		}
		if (dto.specialCategory) {
			errors.push("specialCategory must not be set for normal badges");
		}
		if (repeats) {
			errors.push(
				"repeatCategory/milestoneCount must not be set for normal badges",
			);
		}
	}
	if (dto.type === "manual") {
		if (!dto.specialCategory) {
			errors.push("specialCategory is required for manual badges");
		}
		if (repeats) {
			errors.push(
				"repeatCategory/milestoneCount must not be set for manual badges",
			);
		}
		if (placed) {
			errors.push("sectionId/subsectionId must not be set for manual badges");
		}
		if (trimmed(dto.activeFromUtc) || trimmed(dto.activeTillUtc)) {
			errors.push(
				"activeFromUtc/activeTillUtc must not be set for manual badges",
			);
		}
		const isEvent = dto.specialCategory === "event";
		if (!isEvent && claims) {
			errors.push(
				'claimToken/isClaimLinkActive are only allowed for manual badges with specialCategory "event"',
			);
		}
		if (
			isEvent &&
			trimmed(dto.claimToken) &&
			!/^[A-Z0-9]{6,32}$/.test(trimmed(dto.claimToken).toUpperCase())
		) {
			errors.push(
				"claimToken must be 6-32 characters, letters and digits only",
			);
		}
	}
	return errors;
}

/** The body as the backend gets it: through JSON. */
const overTheWire = (body: Record<string, unknown>) =>
	JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

// ─── Reading ────────────────────────────────────────────────────────────────

describe("toBadge", () => {
	it("reads a row as the backend sends it today", () => {
		expect(toBadge(normalBadge())).toEqual({
			id: "n_7",
			etag: "t:2026-10-20T08:15:00.000Z",
			name: "Pierwszy trening",
			type: "normal",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			isHidden: null,
			sectionId: "workouts",
			subsectionId: "first",
			specialCategory: null,
			repeatCategory: null,
			milestoneCount: null,
			activeFromUtc: null,
			activeTillUtc: null,
			claimToken: null,
			isClaimLinkActive: null,
			createdAtUtc: "2026-01-05T10:00:00.000Z",
			updatedAtUtc: "2026-10-20T08:15:00.000Z",
			// Kept as they came: what the badge is awarded for.
			assignedToWorkouts: [{ id: "W12", name: "Mobilność bioder" }],
			assignedToChallenges: [],
		});
	});

	it("reads an event badge with its claim code", () => {
		expect(toBadge(eventBadge())).toMatchObject({
			type: "manual",
			specialCategory: "event",
			claimToken: "BIEG2026",
			isClaimLinkActive: true,
		});
	});

	it("reads a milestone badge with its count and dates", () => {
		expect(toBadge(milestoneBadge())).toMatchObject({
			type: "milestone",
			repeatCategory: "running",
			milestoneCount: 10,
			activeFromUtc: "2026-01-01T00:00:00.000Z",
			activeTillUtc: "2026-12-31T23:59:59.000Z",
		});
	});

	it("takes the backend's etag once it sends one", () => {
		expect(toBadge(normalBadge({ etag: 'W/"5"' })).etag).toBe('W/"5"');
	});

	it("reads a row that has little more than an id", () => {
		const badge = toBadge({ id: "legacy-uuid" });
		expect(badge).toMatchObject({
			id: "legacy-uuid",
			name: "",
			type: "normal",
			imageRelativePath: "",
			comment: null,
			isHidden: false,
			sectionId: null,
			subsectionId: null,
			specialCategory: null,
			repeatCategory: null,
			milestoneCount: null,
			activeFromUtc: null,
			activeTillUtc: null,
			claimToken: null,
			isClaimLinkActive: false,
			createdAtUtc: "",
			updatedAtUtc: "",
		});
		expect(badge.etag).toMatch(/^h:[0-9a-f]{8}$/);
	});

	it("reads nulls the same as missing fields", () => {
		expect(
			toBadge({ id: "n_1", name: null, type: null, imageRelativePath: null }),
		).toMatchObject({ name: "", type: "normal", imageRelativePath: "" });
	});

	it("keeps a type this build does not know", () => {
		expect(toBadge(normalBadge({ type: "seasonal" })).type).toBe("seasonal");
	});

	it("fails loudly for a row without an id", () => {
		const error = thrownBy(() => toBadge({ name: "Bez id" }));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Odznaka: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["id"]);
	});

	it("fails loudly, naming the badge and the field", () => {
		const error = thrownBy(() =>
			toBadge(milestoneBadge({ milestoneCount: "10" })),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Odznaka m_running_10: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["milestoneCount"]);
	});
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("fromBadge", () => {
	describe("a loaded badge, saved unchanged, passes the backend's rules", () => {
		it.each([
			["normal", normalBadge()],
			["manual", manualBadge()],
			["event", eventBadge()],
			["milestone", milestoneBadge()],
			["perfections", perfectionsBadge()],
			["hidden normal", normalBadge({ isHidden: true })],
			[
				"normal with dates",
				normalBadge({ activeFromUtc: "2026-01-01T00:00:00.000Z" }),
			],
			["event with a paused link", eventBadge({ isClaimLinkActive: false })],
		])("%s", (_name, row) => {
			const body = overTheWire(fromBadge(toBadge(row)));
			expect(backendProblems(body)).toEqual([]);
		});

		it("is checked by rules that do refuse the row as it was loaded", () => {
			// Sending a list row straight back is what the rules are there to stop.
			for (const row of [
				normalBadge(),
				manualBadge(),
				eventBadge(),
				milestoneBadge(),
			]) {
				expect(backendProblems(toBadge(row))).not.toEqual([]);
			}
		});
	});

	it("never sends what the backend works out itself", () => {
		for (const row of [
			normalBadge({ etag: 'W/"5"' }),
			manualBadge(),
			eventBadge(),
			milestoneBadge(),
			perfectionsBadge(),
		]) {
			const body = fromBadge(toBadge(row));
			for (const field of [
				"etag",
				"sectionId",
				"subsectionId",
				"createdAtUtc",
				"updatedAtUtc",
				"assignedToWorkouts",
				"assignedToChallenges",
			]) {
				expect(body, `${String(row.type)}: ${field}`).not.toHaveProperty(field);
			}
		}
	});

	it("sends a normal badge with its dates and nothing of the other types", () => {
		const body = fromBadge(
			toBadge(
				normalBadge({
					activeFromUtc: "2026-01-01T00:00:00.000Z",
					activeTillUtc: "2026-06-30T00:00:00.000Z",
				}),
			),
		);
		expect(body).toEqual({
			id: "n_7",
			name: "Pierwszy trening",
			type: "normal",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			isHidden: null,
			activeFromUtc: "2026-01-01T00:00:00.000Z",
			activeTillUtc: "2026-06-30T00:00:00.000Z",
		});
	});

	it("sends a manual badge with its category and without dates", () => {
		expect(fromBadge(toBadge(manualBadge()))).toEqual({
			id: "s_3",
			name: "Trening specjalny",
			type: "manual",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			isHidden: null,
			specialCategory: "specialTraining",
		});
	});

	it("sends an event badge with its claim code and link switch", () => {
		expect(fromBadge(toBadge(eventBadge()))).toEqual({
			id: "s_4",
			name: "Bieg Niepodległości",
			type: "manual",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			isHidden: null,
			specialCategory: "event",
			claimToken: "BIEG2026",
			isClaimLinkActive: true,
		});
	});

	it.each([null, "", "   "])(
		"leaves out the claim code %j, so the backend keeps or makes one",
		(claimToken) => {
			const body = fromBadge({ ...toBadge(eventBadge()), claimToken });
			expect(body).not.toHaveProperty("claimToken");
			expect(body.isClaimLinkActive).toBe(true);
			expect(backendProblems(overTheWire(body))).toEqual([]);
		},
	);

	it("sends a milestone badge with its count, category and dates", () => {
		expect(fromBadge(toBadge(milestoneBadge()))).toEqual({
			id: "m_running_10",
			name: "10 biegów",
			type: "milestone",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			isHidden: null,
			repeatCategory: "running",
			milestoneCount: 10,
			activeFromUtc: "2026-01-01T00:00:00.000Z",
			activeTillUtc: "2026-12-31T23:59:59.000Z",
		});
	});

	it("drops a category left over from another type", () => {
		// The type was changed in the form; the old type's fields are still set.
		const wasManual = { ...toBadge(eventBadge()), type: "normal" };
		const body = fromBadge(wasManual);
		expect(body).not.toHaveProperty("specialCategory");
		expect(body).not.toHaveProperty("claimToken");
		expect(body).not.toHaveProperty("isClaimLinkActive");
		expect(backendProblems(overTheWire(body))).toEqual([]);

		const wasMilestone = {
			...toBadge(milestoneBadge()),
			type: "manual",
			specialCategory: "specialTraining",
		};
		const manual = fromBadge(wasMilestone);
		expect(manual).not.toHaveProperty("repeatCategory");
		expect(manual).not.toHaveProperty("milestoneCount");
		expect(manual).not.toHaveProperty("activeFromUtc");
		expect(manual).not.toHaveProperty("activeTillUtc");
		expect(backendProblems(overTheWire(manual))).toEqual([]);
	});

	describe("a new badge", () => {
		const created = (change: Partial<NewBadge>): NewBadge => ({
			...blankBadge(),
			name: "Nowa odznaka",
			imageRelativePath: "badges/nowa.webp",
			comment: "[TEST] nowa",
			...change,
		});

		it("goes out with a null id, so the backend assigns it", () => {
			expect(fromBadge(created({}))).toEqual({
				id: null,
				name: "Nowa odznaka",
				type: "normal",
				imageRelativePath: "badges/nowa.webp",
				comment: "[TEST] nowa",
				isHidden: false,
				activeFromUtc: null,
				activeTillUtc: null,
			});
		});

		it.each([
			["normal", created({})],
			[
				"manual",
				created({ type: "manual", specialCategory: "specialTraining" }),
			],
			["event", created({ type: "manual", specialCategory: "event" })],
			[
				"event with its own code",
				created({
					type: "manual",
					specialCategory: "event",
					claimToken: "wiosna26",
					isClaimLinkActive: true,
				}),
			],
		])("passes the backend's rules: %s", (_name, badge) => {
			expect(backendProblems(overTheWire(fromBadge(badge)))).toEqual([]);
		});
	});

	it("keeps fields this build does not know", () => {
		const body = fromBadge(toBadge(normalBadge({ shareCaption: "Brawo!" })));
		expect(body.shareCaption).toBe("Brawo!");
	});

	it("does not change the badge it was given", () => {
		const badge = toBadge(eventBadge());
		const before = structuredClone(badge);
		fromBadge(badge);
		expect(badge).toEqual(before);
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

const TODAY_ON = capabilities({ writes: { badges: "on" } });
const TEST_ONLY = capabilities({ writes: { badges: "test-only" } });

/** `{ result, savedBadges: BadgeUpsertAdminDto[] }`: no section, no dates of change. */
const saved = (row: Record<string, unknown>) => {
	const {
		sectionId: _section,
		subsectionId: _subsection,
		createdAtUtc: _created,
		updatedAtUtc: _updated,
		assignedToWorkouts: _workouts,
		assignedToChallenges: _challenges,
		...dto
	} = row;
	return json({ result: `Badge ${String(row.id)} saved`, savedBadges: [dto] });
};

describe("badgesArea: list", () => {
	it("lists every badge with one request", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageBadges",
			json([normalBadge(), eventBadge(), milestoneBadge()]),
		);
		const api = badgesArea(backend.transport, SWITCHED_OFF);
		expect((await api.list()).map((badge) => [badge.id, badge.type])).toEqual([
			["n_7", "normal"],
			["s_4", "manual"],
			["m_running_10", "milestone"],
		]);
		expect(backend.calls()).toEqual(["GET manageBadges"]);
		expect(backend.only("GET", "manageBadges").query).toEqual({});
	});

	it("fails when the answer is not a list", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageBadges",
			json({ badges: [] }),
		);
		const error = await failure(
			badgesArea(backend.transport, SWITCHED_OFF).list(),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Lista odznak");
	});

	it("passes on the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageBadges",
			errorReply(500, "Failed to fetch badges: RestError"),
		);
		const error = await failure(
			badgesArea(backend.transport, SWITCHED_OFF).list(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

describe("badgesArea: create", () => {
	const created: NewBadge = {
		...blankBadge(),
		name: "Bieg Niepodległości",
		imageRelativePath: "badges/bieg.webp",
		comment: "[TEST] bieg",
		type: "manual",
		specialCategory: "event",
	};

	it("posts the badge and finds the stored one in the list by the saved id", async () => {
		const stored = eventBadge({ id: "s_9", claimToken: "K7Q2ZP" });
		const backend = fakeBackend()
			.on("POST", "manageBadges", saved(stored))
			.on("GET", "manageBadges", json([normalBadge(), stored]));
		const api = badgesArea(backend.transport, TODAY_ON);

		const result = await api.create(created);

		// From the list: it has the section and the generated claim code.
		expect(result).toEqual(toBadge(stored));
		expect(result.claimToken).toBe("K7Q2ZP");
		expect(result.sectionId).toBe("special");
		expect(backend.calls()).toEqual(["POST manageBadges", "GET manageBadges"]);
		const post = backend.only("POST", "manageBadges");
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toEqual({
			id: null,
			name: "Bieg Niepodległości",
			imageRelativePath: "badges/bieg.webp",
			comment: "[TEST] bieg",
			type: "manual",
			specialCategory: "event",
			isHidden: false,
			isClaimLinkActive: false,
		});
		expect(backendProblems(bodyOf(post))).toEqual([]);
	});

	it("says so when the answer names no badge", async () => {
		for (const answer of [
			{ result: "Badge saved" },
			{ result: "Badge saved", savedBadges: [] },
			{ result: "Badge saved", savedBadges: null },
		]) {
			const backend = fakeBackend().on("POST", "manageBadges", json(answer));
			const error = await failure(
				badgesArea(backend.transport, TODAY_ON).create(created),
			);
			expect(error.kind).toBe("server");
			expect(error.message).toContain("nie podał jej identyfikatora");
			expect(backend.calls()).toEqual(["POST manageBadges"]);
		}
	});

	it("says so when the saved badge is not in the list afterwards", async () => {
		const backend = fakeBackend()
			.on("POST", "manageBadges", saved(eventBadge({ id: "s_9" })))
			.on("GET", "manageBadges", json([normalBadge()]));
		const error = await failure(
			badgesArea(backend.transport, TODAY_ON).create(created),
		);
		expect(error.kind).toBe("notFound");
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			badgesArea(backend.transport, SWITCHED_OFF).create(created),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Odznaki”");
		expect(backend.requests).toEqual([]);
	});

	it("creates only test items in test-only mode, marked in the comment", async () => {
		const stored = eventBadge({ id: "s_9" });
		const backend = fakeBackend()
			.on("POST", "manageBadges", saved(stored))
			.on("GET", "manageBadges", json([stored]));
		const api = badgesArea(backend.transport, TEST_ONLY);

		const error = await failure(api.create({ ...created, comment: "bieg" }));
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([{ path: "comment", message: error.message }]);
		expect(error.message).toContain("„Komentarz”");
		expect(backend.requests).toEqual([]);

		expect((await api.create(created)).id).toBe("s_9");
	});

	it("reports a crash as the backend failing", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			errorReply(500, "Failed to process badge request: Error: boom"),
		);
		const error = await failure(
			badgesArea(backend.transport, TODAY_ON).create(created),
		);
		expect(error.kind).toBe("server");
	});
});

describe("badgesArea: save", () => {
	const stored = normalBadge();
	const loaded = toBadge(stored);
	const edited: Badge = { ...loaded, name: "Pierwszy trening!" };
	const afterSave = normalBadge({
		name: "Pierwszy trening!",
		updatedAtUtc: "2026-11-11T10:00:05.000Z",
	});

	it("checks the stored version in the list, posts, and reads the list again", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]), json([afterSave]))
			.on("POST", "manageBadges", saved(afterSave));
		const api = badgesArea(backend.transport, TODAY_ON);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toEqual(toBadge(afterSave));
		expect(result.etag).toBe("t:2026-11-11T10:00:05.000Z");
		expect(backend.calls()).toEqual([
			"GET manageBadges",
			"POST manageBadges",
			"GET manageBadges",
		]);
		const post = backend.only("POST", "manageBadges");
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toEqual({
			id: "n_7",
			name: "Pierwszy trening!",
			imageRelativePath: "badges/pierwszy.webp",
			comment: "[TEST] za pierwszy trening",
			type: "normal",
			isHidden: null,
			activeFromUtc: null,
			activeTillUtc: null,
		});
		expect(backendProblems(bodyOf(post))).toEqual([]);
	});

	it("reports a conflict, without posting, when someone saved in between", async () => {
		const theirs = normalBadge({
			name: "Nazwa Patryka",
			updatedAtUtc: "2026-11-11T09:59:00.000Z",
		});
		const backend = fakeBackend().on("GET", "manageBadges", json([theirs]));
		const error = await failure(
			badgesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toBadge(theirs));
		expect(backend.calls()).toEqual(["GET manageBadges"]);
	});

	it("reports a badge that is gone as not found, without posting", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageBadges",
			json([eventBadge()]),
		);
		const error = await failure(
			badgesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
		expect(backend.calls()).toEqual(["GET manageBadges"]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			badgesArea(backend.transport, SWITCHED_OFF).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("saves only test items in test-only mode", async () => {
		const real = normalBadge({ comment: "za pierwszy trening" });
		const backend = fakeBackend().on("GET", "manageBadges", json([real]));
		const api = badgesArea(backend.transport, TEST_ONLY);

		const marking = await failure(api.save(edited, { etag: loaded.etag }));
		expect(marking.kind).toBe("validation");
		expect(marking.issues[0]?.path).toBe("comment");
		expect(backend.calls()).toEqual(["GET manageBadges"]);

		const unmarked = await failure(
			api.save({ ...edited, comment: null }, { etag: loaded.etag }),
		);
		expect(unmarked.kind).toBe("validation");
		expect(backend.requests).toHaveLength(1);
	});

	it("posts with If-Match once the backend has etags", async () => {
		const versioned = normalBadge({ etag: 'W/"5"' });
		const after = normalBadge({ etag: 'W/"6"', name: "Pierwszy trening!" });
		const backend = fakeBackend()
			.on("POST", "manageBadges", saved(after))
			.on("GET", "manageBadges", json([after]));
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const badge = { ...toBadge(versioned), name: "Pierwszy trening!" };

		const result = await api.save(badge, { etag: 'W/"5"' });

		expect(result.etag).toBe('W/"6"');
		expect(backend.calls()).toEqual(["POST manageBadges", "GET manageBadges"]);
		expect(backend.only("POST", "manageBadges").headers["if-match"]).toBe(
			'W/"5"',
		);
	});

	it("turns a 409 with the current badge into a conflict that carries it", async () => {
		const theirs = normalBadge({ etag: 'W/"6"', name: "Nazwa Patryka" });
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			errorReply(409, "Conflict", { current: theirs }),
		);
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(
			api.save(
				{ ...toBadge(normalBadge({ etag: 'W/"5"' })), name: "Moja nazwa" },
				{ etag: 'W/"5"' },
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(409);
		expect(error.current).toEqual(toBadge(theirs));
		expect(backend.calls()).toEqual(["POST manageBadges"]);
	});

	it("finds the current badge in the list when the 409 came without it", async () => {
		const theirs = normalBadge({ etag: 'W/"6"', name: "Nazwa Patryka" });
		const backend = fakeBackend()
			.on("POST", "manageBadges", errorReply(409, "Conflict"))
			.on("GET", "manageBadges", json([theirs]));
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(
			api.save(toBadge(normalBadge({ etag: 'W/"5"' })), { etag: 'W/"5"' }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toBadge(theirs));
	});
});

describe("badgesArea: remove", () => {
	const versioned = normalBadge({ etag: 'W/"5"', assignedToWorkouts: [] });

	it("is refused, with no request, while the backend cannot delete badges", async () => {
		// Today the DELETE handler answers 501 and is not even registered.
		const backend = fakeBackend();
		for (const caps of [SWITCHED_OFF, TODAY_ON, TEST_ONLY]) {
			const error = await failure(
				badgesArea(backend.transport, caps).remove("n_7", { etag: 'W/"5"' }),
			);
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("nie potrafi jeszcze usuwać odznak");
		}
		expect(backend.requests).toEqual([]);
	});

	it("checks the stored badge, then deletes it by id with If-Match", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([versioned]))
			.on("DELETE", "manageBadges/n_7", { status: 204 });
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);

		expect(await api.remove("n_7", { etag: 'W/"5"' })).toBeUndefined();

		expect(backend.calls()).toEqual([
			"GET manageBadges",
			"DELETE manageBadges/n_7",
		]);
		const request = backend.only("DELETE", "manageBadges/n_7");
		expect(request.headers["if-match"]).toBe('W/"5"');
		expect(request.body).toBeUndefined();
	});

	it("sends no If-Match for a version the panel worked out itself", async () => {
		const row = normalBadge();
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([row]))
			.on("DELETE", "manageBadges/n_7", { status: 204 });
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		await api.remove("n_7", { etag: toBadge(row).etag });
		expect(
			backend.only("DELETE", "manageBadges/n_7").headers,
		).not.toHaveProperty("if-match");
	});

	it("does not delete a badge someone changed in between", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageBadges",
			json([normalBadge({ etag: 'W/"6"' })]),
		);
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.remove("n_7", { etag: 'W/"5"' }));
		expect(error.kind).toBe("conflict");
		expect((error.current as Badge).etag).toBe('W/"6"');
		expect(backend.calls()).toEqual(["GET manageBadges"]);
	});

	it("does not delete a badge that is not there", async () => {
		const backend = fakeBackend().on("GET", "manageBadges", json([]));
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.remove("n_7", { etag: 'W/"5"' }));
		expect(error.kind).toBe("notFound");
		expect(backend.calls()).toEqual(["GET manageBadges"]);
	});

	it("deletes only test badges in test-only mode", async () => {
		const caps = capabilities({
			writes: { badges: "test-only" },
			badgeDelete: true,
			etag: true,
		});
		const backend = fakeBackend()
			.on(
				"GET",
				"manageBadges",
				json([
					versioned,
					normalBadge({ id: "n_8", etag: 'W/"1"', comment: "prawdziwa" }),
				]),
			)
			.on("DELETE", "manageBadges/n_7", { status: 204 });
		const api = badgesArea(backend.transport, caps);

		const error = await failure(api.remove("n_8", { etag: 'W/"1"' }));
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("comment");
		expect(backend.calls()).toEqual(["GET manageBadges"]);

		await api.remove("n_7", { etag: 'W/"5"' });
		expect(backend.all("DELETE", "manageBadges/n_7")).toHaveLength(1);
	});

	it("keeps the id inside its path segment", async () => {
		const odd = normalBadge({ id: "a/b?c", etag: 'W/"5"' });
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([odd]))
			.on("DELETE", "manageBadges/a%2Fb%3Fc", { status: 204 });
		await badgesArea(backend.transport, ALL_CAPABILITIES).remove("a/b?c", {
			etag: 'W/"5"',
		});
		expect(backend.calls()).toEqual([
			"GET manageBadges",
			"DELETE manageBadges/a%2Fb%3Fc",
		]);
	});

	it("turns the backend's 409 into a conflict with the badge as it is now", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([versioned]))
			.on("DELETE", "manageBadges/n_7", errorReply(409, "Conflict"));
		const api = badgesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.remove("n_7", { etag: 'W/"5"' }));
		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(409);
		expect(error.current).toEqual(toBadge(versioned));
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Rows and answers below are the ones the backend's own tests show
// (tests/handlers/manageBadgesPanelContract.test.ts).

/** Produkcja's features, with the section accepted. */
const OPEN = production({ writes: { badges: "on" } });
const OPEN_FOR_TESTS = production({ writes: { badges: "test-only" } });
const EDITING = { etag: true } as const;

/**
 * What the backend makes of a save of an existing badge on the panel's
 * route (`keepOmitted` in its manageBadgesHandler.ts): a field the request
 * leaves out is taken from the stored badge; null stays null.
 */
function completedFrom(
	body: Record<string, unknown>,
	stored: Record<string, unknown>,
): Record<string, unknown> {
	const completed = { ...body };
	for (const field of [
		"name",
		"imageRelativePath",
		"comment",
		"type",
		"specialCategory",
		"repeatCategory",
		"milestoneCount",
		"activeFromUtc",
		"activeTillUtc",
		"isHidden",
		"claimToken",
		"isClaimLinkActive",
	]) {
		if (completed[field] === undefined) completed[field] = stored[field];
	}
	return completed;
}

describe("fromBadge: with the editing contract", () => {
	it.each([
		["normal", normalBadge()],
		["manual", manualBadge()],
		["event", eventBadge()],
		["milestone", milestoneBadge()],
		["perfections", perfectionsBadge()],
		["event with a paused link", eventBadge({ isClaimLinkActive: false })],
	])(
		"a loaded %s badge, saved unchanged, passes the backend's rules",
		(_name, row) => {
			const body = overTheWire(fromBadge(toBadge(row), EDITING));
			expect(backendProblems(completedFrom(body, row))).toEqual([]);
		},
	);

	it("sends the fields of other types as null instead of leaving them out", () => {
		expect(fromBadge(toBadge(normalBadge()), EDITING)).toMatchObject({
			specialCategory: null,
			repeatCategory: null,
			milestoneCount: null,
			claimToken: null,
			isClaimLinkActive: null,
		});
		expect(fromBadge(toBadge(manualBadge()), EDITING)).toMatchObject({
			specialCategory: "specialTraining",
			activeFromUtc: null,
			activeTillUtc: null,
			repeatCategory: null,
			milestoneCount: null,
			claimToken: null,
			isClaimLinkActive: null,
		});
		expect(fromBadge(toBadge(milestoneBadge()), EDITING)).toMatchObject({
			specialCategory: null,
			repeatCategory: "running",
			milestoneCount: 10,
			claimToken: null,
			isClaimLinkActive: null,
		});
	});

	it("clears the code and the link of an event badge that becomes a special training", () => {
		// The type cannot change (the backend answers IMMUTABLE), but the kind
		// of a manual badge can, and what belonged to the kind it had must go:
		// left out, the stored code would come back in and be refused.
		const stored = eventBadge();
		const changed = { ...toBadge(stored), specialCategory: "specialTraining" };
		const body = overTheWire(fromBadge(changed, EDITING));
		expect(body).toMatchObject({ claimToken: null, isClaimLinkActive: null });
		expect(backendProblems(completedFrom(body, stored))).toEqual([]);
		// The body of before the contract, completed the way the backend
		// completes one now, keeps the stored claim code and is refused.
		const cutDown = overTheWire(fromBadge(changed));
		expect(backendProblems(completedFrom(cutDown, stored))).not.toEqual([]);
	});

	it("sends a changed type as it is: refusing that is the backend's to do", () => {
		const body = fromBadge(
			{ ...toBadge(eventBadge()), type: "normal" },
			EDITING,
		);
		expect(body.type).toBe("normal");
	});

	describe("nothing the backend would refuse for its spelling alone", () => {
		it("sends a name and a picture without the spaces around them", () => {
			const body = fromBadge(
				{
					...toBadge(normalBadge()),
					name: "  Pierwszy trening ",
					imageRelativePath: " badges/pierwszy.webp\n",
				},
				EDITING,
			);
			expect(body.name).toBe("Pierwszy trening");
			expect(body.imageRelativePath).toBe("badges/pierwszy.webp");
		});

		it("sends a claim code in capitals, as it is stored", () => {
			for (const claimToken of ["bieg2026", " Bieg2026 ", "BIEG2026"]) {
				expect(
					fromBadge({ ...toBadge(eventBadge()), claimToken }, EDITING)
						.claimToken,
				).toBe("BIEG2026");
			}
		});

		it("does not turn a code that is wrong into one that is right", () => {
			// Too short, or with a letter the app cannot read: sent as typed (in
			// capitals), for the backend to refuse at the field.
			expect(
				fromBadge({ ...toBadge(eventBadge()), claimToken: "żółw" }, EDITING)
					.claimToken,
			).toBe("ŻÓŁW");
		});

		it("sends no date as null, never as an empty text", () => {
			const body = fromBadge(
				{ ...toBadge(normalBadge()), activeFromUtc: "", activeTillUtc: "  " },
				EDITING,
			);
			expect(body.activeFromUtc).toBeNull();
			expect(body.activeTillUtc).toBeNull();
		});

		it("sends a date as the full instant it is", () => {
			const body = fromBadge(
				{
					...toBadge(normalBadge()),
					activeFromUtc: "2026-01-01T00:00:00.000Z",
					// A moment with its zone, in a spelling the backend does not take.
					activeTillUtc: "2026-12-31T23:59+01:00",
				},
				EDITING,
			);
			expect(body.activeFromUtc).toBe("2026-01-01T00:00:00.000Z");
			expect(body.activeTillUtc).toBe("2026-12-31T22:59:00.000Z");
		});

		it("does not guess which moment a bare date or a time without a zone means", () => {
			const body = fromBadge(
				{
					...toBadge(normalBadge()),
					activeFromUtc: "2026-01-01",
					activeTillUtc: "2026-12-31T23:59:00",
				},
				EDITING,
			);
			// Sent as they are: the backend refuses them at their fields.
			expect(body.activeFromUtc).toBe("2026-01-01");
			expect(body.activeTillUtc).toBe("2026-12-31T23:59:00");
		});

		it("leaves the count of a milestone badge out rather than send null", () => {
			// "milestoneCount: null on a milestone is refused (omit to keep)".
			const body = fromBadge(
				{ ...toBadge(milestoneBadge()), milestoneCount: null },
				EDITING,
			);
			expect(body).not.toHaveProperty("milestoneCount");
			expect(fromBadge(toBadge(milestoneBadge()), EDITING).milestoneCount).toBe(
				10,
			);
		});

		it("says whether the link of an event badge is on only when it knows", () => {
			expect(
				fromBadge(
					{ ...toBadge(eventBadge()), isClaimLinkActive: false },
					EDITING,
				).isClaimLinkActive,
			).toBe(false);
			// Not known: left out, so the stored answer is kept, and a new badge
			// is refused at this field instead of being given one by default.
			expect(
				fromBadge(
					{ ...toBadge(eventBadge()), isClaimLinkActive: null },
					EDITING,
				),
			).not.toHaveProperty("isClaimLinkActive");
		});

		it("sends null, never an empty text, for the id of a new badge", () => {
			expect(fromBadge(blankBadge(), EDITING).id).toBeNull();
		});

		it("does none of this without the contract", () => {
			const body = fromBadge({
				...toBadge(eventBadge()),
				name: " Bieg ",
				claimToken: "bieg2026",
			});
			expect(body.name).toBe(" Bieg ");
			expect(body.claimToken).toBe("bieg2026");
		});
	});

	it("clears a date that was emptied", () => {
		const badge = toBadge(
			normalBadge({ activeTillUtc: "2026-12-31T00:00:00.000Z" }),
		);
		const body = fromBadge({ ...badge, activeTillUtc: null }, EDITING);
		expect(Object.keys(body)).toContain("activeTillUtc");
		expect(body.activeTillUtc).toBeNull();
	});

	it("still leaves an empty claim code of an event badge out, to keep or get one", () => {
		for (const claimToken of [null, "", "  "]) {
			const body = fromBadge({ ...toBadge(eventBadge()), claimToken }, EDITING);
			expect(body).not.toHaveProperty("claimToken");
			expect(body.isClaimLinkActive).toBe(true);
		}
	});

	it("still never sends what the backend works out itself", () => {
		const body = fromBadge(toBadge(panelBadge()), EDITING);
		for (const field of [
			"etag",
			"sectionId",
			"subsectionId",
			"createdAtUtc",
			"updatedAtUtc",
			"assignedToWorkouts",
			"assignedToChallenges",
		]) {
			expect(body, field).not.toHaveProperty(field);
		}
	});

	it("cuts the body down, as before, without the contract", () => {
		for (const caps of [undefined, { etag: false }]) {
			const body = fromBadge(toBadge(normalBadge()), caps);
			for (const field of [
				"specialCategory",
				"repeatCategory",
				"milestoneCount",
				"claimToken",
				"isClaimLinkActive",
			]) {
				expect(body, field).not.toHaveProperty(field);
			}
		}
	});
});

describe("badgesArea: the panel's routes", () => {
	const stored = panelBadge();
	const loaded = toBadge(stored);

	it("reads the list with each badge's version", async () => {
		const backend = fakeBackend().on("GET", "manageBadges", json([stored]));
		const [badge] = await badgesArea(backend.transport, production()).list();
		expect(badge?.etag).toBe(tableEtag(0));
		expect(badge?.sectionId).toBe("workouts");
	});

	it("takes a saved badge from the answer, without reading the list again", async () => {
		// "the panel gets the saved badge itself, with its id and etag and
		// everything the list shows".
		const after = panelBadge({ name: "Pierwszy trening!", etag: tableEtag(1) });
		const backend = fakeBackend().on("POST", "manageBadges", json(after));
		const api = badgesArea(backend.transport, OPEN);

		const result = await api.save(
			{ ...loaded, name: "Pierwszy trening!" },
			{ etag: loaded.etag },
		);

		expect(result).toEqual(toBadge(after));
		expect(backend.calls()).toEqual(["POST manageBadges"]);
		const post = backend.only("POST", "manageBadges");
		expect(post.headers["if-match"]).toBe(tableEtag(0));
		expect(bodyOf(post)).toMatchObject({
			id: "n_7",
			name: "Pierwszy trening!",
			specialCategory: null,
			claimToken: null,
		});
	});

	it("takes a new badge, with the id the backend gave it, from the answer", async () => {
		const answer = panelBadge({
			id: "n_8",
			name: "New",
			comment: "[TEST] new",
			sectionId: null,
			subsectionId: null,
			isHidden: null,
			assignedToWorkouts: [],
		});
		const backend = fakeBackend().on("POST", "manageBadges", json(answer));
		const created = await badgesArea(backend.transport, OPEN).create({
			...blankBadge(),
			name: "New",
			imageRelativePath: "badges/new.webp",
			comment: "[TEST] new",
		});
		expect(created).toMatchObject({ id: "n_8", etag: tableEtag(0) });
		expect(backend.calls()).toEqual(["POST manageBadges"]);
		expect(bodyOf(backend.only("POST", "manageBadges")).id).toBeNull();
	});

	it("still reads the list after an answer that only names the badge", async () => {
		// Retool's route, and the fallback: `{ result, savedBadges }`.
		const after = panelBadge({ etag: tableEtag(1) });
		const backend = fakeBackend()
			.on("POST", "manageBadges", saved(after))
			.on("GET", "manageBadges", json([after]));
		const result = await badgesArea(backend.transport, OPEN).save(loaded, {
			etag: loaded.etag,
		});
		expect(result.etag).toBe(tableEtag(1));
		expect(backend.calls()).toEqual(["POST manageBadges", "GET manageBadges"]);
	});

	it("reports each problem of a refused save at its field", async () => {
		// "the same refused save is 422 for the panel".
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			validationReply(
				[
					{ path: "name", code: "REQUIRED", message: "name is required" },
					{
						path: "imageRelativePath",
						code: "INVALID_VALUE",
						message: 'imageRelativePath must start with "badges/"',
					},
				],
				'Validation failed: name is required; imageRelativePath must start with "badges/"',
			),
		);
		const error = await failure(
			badgesArea(backend.transport, OPEN).save(
				{ ...loaded, name: "", imageRelativePath: "images/x.webp" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		// As the backend words them, at their fields.
		expect(error.issues).toEqual([
			{ path: "name", message: "name is required" },
			{
				path: "imageRelativePath",
				message: 'imageRelativePath must start with "badges/"',
			},
		]);
		expect(error.message).toBe(
			'Validation failed: name is required; imageRelativePath must start with "badges/"',
		);
	});

	it("turns a stale version into a conflict that carries the stored badge", async () => {
		const theirs = panelBadge({ name: "Someone else", etag: tableEtag(1) });
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			conflictReply("Badge n_7 was changed since it was loaded", theirs),
		);
		const error = await failure(
			badgesArea(backend.transport, OPEN).save(loaded, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toBadge(theirs));
		expect(backend.calls()).toEqual(["POST manageBadges"]);
	});

	it("reports a badge that is gone as not found", async () => {
		// "an etag for a badge that is gone is 404 for the panel".
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			notFoundReply("Badge n_7 not found"),
		);
		const error = await failure(
			badgesArea(backend.transport, OPEN).save(loaded, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("notFound");
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const api = badgesArea(backend.transport, production());
		for (const run of [
			() => api.save(loaded, { etag: loaded.etag }),
			() => api.create({ ...blankBadge(), comment: "[TEST] x" }),
			// The backend can delete now; the section is still closed.
			() => api.remove("n_7", { etag: loaded.etag }),
		]) {
			const error = await failure(run());
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("„Odznaki”");
		}
		expect(backend.requests).toEqual([]);
	});
});

describe("badgesArea: remove on the panel's route", () => {
	const stored = panelBadge({ assignedToWorkouts: [] });
	const loaded = toBadge(stored);
	const DELETE = "manageBadges/n_7";

	it("deletes a badge nothing uses", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]))
			.on(
				"DELETE",
				DELETE,
				json({
					result: "Badge n_7 deleted",
					id: "n_7",
					deletedAtUtc: "2026-11-13T10:01:00.000Z",
					deletedBy: "uid-ada",
				}),
			);
		const api = badgesArea(backend.transport, OPEN);

		expect(await api.remove("n_7", { etag: loaded.etag })).toBeUndefined();

		expect(backend.calls()).toEqual(["GET manageBadges", `DELETE ${DELETE}`]);
		expect(backend.only("DELETE", DELETE).headers["if-match"]).toBe(
			tableEtag(0),
		);
	});

	it("is refused, in the backend's words, while workouts and challenges award the badge", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]))
			.on(
				"DELETE",
				DELETE,
				conflictReply(
					"Badge n_7 is in use and cannot be deleted: assigned to 1 workout(s): W12; assigned to 1 challenge(s): C1",
					stored,
					"BADGE_IN_USE",
					{
						inUse: {
							workouts: [{ id: "W12", name: "Mobilność bioder" }],
							challenges: [{ id: "C1", name: "Plan na start", type: "plan" }],
							users: [],
							userGrantCount: 0,
							earnedByProgress: false,
							claimLinkActive: false,
						},
					},
				),
			);
		const api = badgesArea(backend.transport, OPEN);

		const error = await failure(api.remove("n_7", { etag: loaded.etag }));

		// A refusal: nothing to merge, nothing to try again.
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			"Badge n_7 is in use and cannot be deleted: assigned to 1 workout(s): W12; assigned to 1 challenge(s): C1",
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.current).toBeUndefined();
		// Not read again, as a conflict would be.
		expect(backend.calls()).toEqual(["GET manageBadges", `DELETE ${DELETE}`]);
	});

	it("is a conflict, with the stored badge, when it was changed meanwhile", async () => {
		// The list read just before still showed the version the panel has.
		const theirs = panelBadge({ name: "Edited since", etag: tableEtag(1) });
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]))
			.on(
				"DELETE",
				DELETE,
				conflictReply("Badge n_7 was changed since it was loaded", theirs),
			);
		const error = await failure(
			badgesArea(backend.transport, OPEN).remove("n_7", { etag: loaded.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toBadge(theirs));
	});

	it("shows a refusal, not a conflict, should the backend say the delete named no version", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]))
			.on("DELETE", DELETE, {
				status: 428,
				body: {
					error:
						"Badge n_7 exists already; name the version this change is based on (If-Match header or etag field)",
					errorCode: "VERSION_REQUIRED",
				},
			});
		const error = await failure(
			badgesArea(backend.transport, OPEN).remove("n_7", { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(428);
		expect(error.message).toBe(
			"Badge n_7 exists already; name the version this change is based on (If-Match header or etag field)",
		);
	});

	it("reports a badge someone deleted a moment ago", async () => {
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored]))
			.on("DELETE", DELETE, notFoundReply("Badge n_7 not found"));
		const error = await failure(
			badgesArea(backend.transport, OPEN).remove("n_7", { etag: loaded.etag }),
		);
		expect(error.kind).toBe("notFound");
	});

	it("deletes only a test badge while only test items may be changed", async () => {
		const real = panelBadge({ id: "n_8", comment: "prawdziwa" });
		const backend = fakeBackend()
			.on("GET", "manageBadges", json([stored, real]))
			.on("DELETE", DELETE, json({ result: "Badge n_7 deleted", id: "n_7" }));
		const api = badgesArea(backend.transport, OPEN_FOR_TESTS);

		const error = await failure(api.remove("n_8", { etag: tableEtag(0) }));
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("comment");
		expect(backend.all("DELETE", "manageBadges/n_8")).toEqual([]);

		await api.remove("n_7", { etag: loaded.etag });
		expect(backend.all("DELETE", DELETE)).toHaveLength(1);
	});

	it("goes back to refusing when the switch is turned off again", async () => {
		const backend = fakeBackend();
		const error = await failure(
			badgesArea(
				backend.transport,
				production({ badgeDelete: false, writes: { badges: "on" } }),
			).remove("n_7", { etag: loaded.etag }),
		);
		expect(error.message).toContain("nie potrafi jeszcze usuwać odznak");
		expect(backend.requests).toEqual([]);
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("badgesArea: the stricter backend", () => {
	const OPEN_STRICT = production({ writes: { badges: "on" } });
	const loaded = toBadge(panelBadge());

	it("sends a badge in the form it is stored in", async () => {
		const event = toBadge(
			panelBadge({
				id: "s_4",
				type: "manual",
				specialCategory: "event",
				claimToken: "BIEG2026",
				isClaimLinkActive: true,
				sectionId: "special",
				subsectionId: "event",
				assignedToWorkouts: [],
			}),
		);
		const backend = fakeBackend().on("POST", "manageBadges", (request) =>
			json(panelBadge({ ...bodyOf(request), etag: tableEtag(1) })),
		);
		await badgesArea(backend.transport, OPEN_STRICT).save(
			{ ...event, name: " Bieg Niepodległości ", claimToken: "bieg2027" },
			{ etag: event.etag },
		);
		expect(bodyOf(backend.only("POST", "manageBadges"))).toMatchObject({
			id: "s_4",
			name: "Bieg Niepodległości",
			claimToken: "BIEG2027",
			isClaimLinkActive: true,
			activeFromUtc: null,
			activeTillUtc: null,
		});
	});

	it("keeps the backend's sentence for a refusal", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			validationReply([
				{
					path: "repeatCategory",
					code: "INVALID_VALUE",
					message: 'Unknown repeatCategory "x". Valid: running, classic',
				},
			]),
		);
		const error = await failure(
			badgesArea(backend.transport, OPEN_STRICT).save(loaded, {
				etag: loaded.etag,
			}),
		);
		expect(error.message).toBe(
			'Unknown repeatCategory "x". Valid: running, classic',
		);
	});

	it("reports a badge that is gone: a save under its id does not make a new one", async () => {
		// "an unknown id is 404": the panel names an id only for a badge it loaded.
		const backend = fakeBackend().on(
			"POST",
			"manageBadges",
			notFoundReply("Badge n_7 not found"),
		);
		const error = await failure(
			badgesArea(backend.transport, OPEN_STRICT).save(loaded, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
		expect(backend.calls()).toEqual(["POST manageBadges"]);
	});
});

// ─── The backend as tightened once more (third pass) ────────────────────────

describe("fromBadge: nothing of the panel's own", () => {
	// BADGE_SAVE_FIELDS of the backend's src/config/panelFields.ts: what
	// BadgeUpsertAdminDto takes and what BadgeAdminDto returns.
	const BADGE = [
		"id",
		"name",
		"imageRelativePath",
		"comment",
		"type",
		"sectionId",
		"subsectionId",
		"specialCategory",
		"repeatCategory",
		"milestoneCount",
		"activeFromUtc",
		"activeTillUtc",
		"isHidden",
		"claimToken",
		"isClaimLinkActive",
		"etag",
		"createdAtUtc",
		"updatedAtUtc",
		"assignedToWorkouts",
		"assignedToChallenges",
	];

	it.each([
		["normal", normalBadge()],
		["manual", manualBadge()],
		["event", eventBadge()],
		["milestone", milestoneBadge()],
		["perfections", perfectionsBadge()],
		["a row of the panel's route", panelBadge()],
	])(
		"sends only fields the backend takes or returns for a %s badge",
		(_name, row) => {
			const body = fromBadge(toBadge(row), { etag: true });
			expect(Object.keys(body).filter((key) => !BADGE.includes(key))).toEqual(
				[],
			);
		},
	);

	it("does the same for a new badge, which carries no id of its own", () => {
		const body = fromBadge(
			{ ...blankBadge(), name: "Nowa", imageRelativePath: "badges/nowa.webp" },
			{ etag: true },
		);
		expect(Object.keys(body).filter((key) => !BADGE.includes(key))).toEqual([]);
		expect(body.id).toBeNull();
	});
});
