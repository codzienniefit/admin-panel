import { describe, expect, it, vi } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import {
	blankPlanning,
	type Planning,
	planningSchema,
	UNSAVED_ETAG,
} from "@/data/schemas/planning";
import {
	type PlannerSettings,
	plannerSettingsSchema,
} from "@/data/schemas/settings";
import { DEFAULT_PLAN_TYPES } from "@/domain/conditions";
import { toChallenge } from "./challenges";
import {
	carryVariantKeys,
	defaultPlannerSettings,
	fromDoc,
	type PanelDocsDeps,
	panelDocsArea,
	toDocBody,
	versionHeader,
} from "./panelDocs";
import {
	capabilities,
	conflictReply,
	docEtag,
	errorReply,
	failure,
	fakeBackend,
	json,
	panelChallenge,
	panelDoc,
	production,
	type Recorded,
	SWITCHED_OFF,
} from "./testSupport";

// Answers in the first part follow the contract proposed in
// docs/BACKEND-SCOPE.md B3 (B3.1, B3.5–B3.8), written before the store
// existed: an envelope `{ id, etag, updatedAtUtc, body }`, `If-Match` /
// `If-None-Match: *` on PUT, 409 with the current document. The store as it
// was built (2026-11-13) is at the end of the file.

const PLANNING = "manage/panelDocs/challengePlanning";
const SETTINGS = "manage/panelDocs/settings/planner";

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

/** What the panel keeps about one challenge, as it stored it. */
const planningBody = (overrides: Record<string, unknown> = {}) => ({
	calendarColor: "#ff8800",
	note: "Start po majówce",
	folderId: "f-wiosna",
	scratchpad: ["W1", "W7"],
	customPlanTypes: [],
	conditionOverrides: {},
	variants: {
		p_1: {
			planTypeId: "balanced",
			prepStatus: "in_progress",
			prepNote: "brakuje dwóch nagrań",
			notes: "",
			days: { "1": { note: "na start", tint: "#eeeeee" } },
			cards: { "1:W1": { color: "#00aa00" } },
		},
	},
	...overrides,
});

const settingsBody = (overrides: Record<string, unknown> = {}) => ({
	planTypes: [
		{
			id: "running",
			name: "Biegowy",
			description: "",
			conditions: [{ type: "minimum", scope: "all", value: 3 }],
		},
	],
	trainingTypeStyles: { mobility: { tone: "teal", emoji: "🧘" } },
	folders: [{ id: "f-wiosna", name: "Wiosna" }],
	...overrides,
});

/** The store's envelope around a body. */
const doc = (
	id: string,
	body: Record<string, unknown>,
	more: Record<string, unknown> = {},
) => ({
	id,
	etag: 'W/"1"',
	updatedAtUtc: "2026-11-10T09:00:00.000Z",
	updatedBy: "Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1",
	body,
	...more,
});

// ─── The mapping ────────────────────────────────────────────────────────────

describe("fromDoc", () => {
	it("is the body with the identity and version the store keeps beside it", () => {
		expect(
			fromDoc(doc("C12", planningBody()), planningSchema, "Dokument", {
				id: "",
			}),
		).toEqual({
			...planningBody(),
			id: "C12",
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
	});

	it("takes the version from the ETag header when the envelope has none", () => {
		const planning = fromDoc(
			doc("C12", planningBody(), { etag: undefined }),
			planningSchema,
			"Dokument",
			{ id: "C12", etag: '"0x8DC"' },
		);
		expect(planning.etag).toBe('"0x8DC"');
	});

	it("prefers the envelope's version over the header's", () => {
		const planning = fromDoc(
			doc("C12", planningBody()),
			planningSchema,
			"Dokument",
			{ id: "C12", etag: '"header"' },
		);
		expect(planning.etag).toBe('W/"1"');
	});

	it("has an empty version when the store sent none at all", () => {
		for (const fallbackEtag of [null, undefined]) {
			const planning = fromDoc(
				doc("C12", planningBody(), { etag: null }),
				planningSchema,
				"Dokument",
				{ id: "C12", etag: fallbackEtag },
			);
			expect(planning.etag).toBe("");
		}
	});

	it("takes the id it asked for when the envelope names none", () => {
		const planning = fromDoc(
			{ etag: 'W/"1"', body: planningBody() },
			planningSchema,
			"Dokument",
			{ id: "C12" },
		);
		expect(planning.id).toBe("C12");
		expect(planning.updatedAtUtc).toBe("");
	});

	it("lets the store's values win over the same names inside the body", () => {
		const planning = fromDoc(
			doc(
				"C12",
				planningBody({
					id: "C1",
					etag: "stale",
					updatedAtUtc: "2020-01-01T00:00:00.000Z",
				}),
			),
			planningSchema,
			"Dokument",
			{ id: "" },
		);
		expect(planning).toMatchObject({
			id: "C12",
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
	});

	it("keeps body fields this build does not know, at every depth", () => {
		const planning = fromDoc(
			doc(
				"C12",
				planningBody({
					aiProfile: { style: "krótko" },
					variants: {
						p_1: { planTypeId: null, checklist: ["nagrania"] },
					},
				}),
			),
			planningSchema,
			"Dokument",
			{ id: "" },
		);
		expect(planning.aiProfile).toEqual({ style: "krótko" });
		expect(planning.variants.p_1?.checklist).toEqual(["nagrania"]);
	});

	it("does not carry the store's bookkeeping into the entity", () => {
		const planning = fromDoc(
			doc("C12", planningBody()),
			planningSchema,
			"Dokument",
			{ id: "" },
		);
		expect(planning).not.toHaveProperty("updatedBy");
		expect(planning).not.toHaveProperty("body");
	});

	it("reads a document with an empty or missing body as a blank one", () => {
		for (const body of [{}, null, undefined]) {
			expect(
				fromDoc(
					{ id: "C12", etag: 'W/"1"', updatedAtUtc: "", body },
					planningSchema,
					"Dokument",
					{ id: "" },
				),
			).toEqual({ ...blankPlanning("C12"), etag: 'W/"1"' });
		}
	});

	it("reads the planner's settings the same way", () => {
		expect(
			fromDoc(
				doc("planner", settingsBody()),
				plannerSettingsSchema,
				"Ustawienia",
				{
					id: "planner",
				},
			),
		).toEqual({
			...settingsBody(),
			id: "planner",
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
	});

	it("fails loudly, with the name it was given, for what is not a document", () => {
		for (const raw of [undefined, null, "tekst", [doc("C12", {})]]) {
			const error = thrownBy(() =>
				fromDoc(raw, planningSchema, "Dokument planowania", { id: "C12" }),
			);
			expect(error.kind).toBe("server");
			expect(error.message).toContain("Dokument planowania: dane nie pasują");
		}
	});

	it("fails loudly, naming the field, for a body that does not fit", () => {
		const error = thrownBy(() =>
			fromDoc(
				doc("C12", planningBody({ scratchpad: "W1,W7" })),
				planningSchema,
				"Dokument planowania",
				{ id: "" },
			),
		);
		expect(error.kind).toBe("server");
		expect(error.issues.map((issue) => issue.path)).toEqual(["scratchpad"]);
	});
});

describe("toDocBody", () => {
	it("is the entity without what the store keeps itself", () => {
		const planning: Planning = {
			...blankPlanning("C12"),
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
			note: "Start po majówce",
		};
		const body = toDocBody(planning);
		expect(body).toEqual({
			calendarColor: null,
			note: "Start po majówce",
			folderId: null,
			scratchpad: [],
			customPlanTypes: [],
			conditionOverrides: {},
			variants: {},
		});
	});

	it("keeps fields this build does not know", () => {
		expect(
			toDocBody({
				id: "C12",
				etag: "1",
				updatedAtUtc: "",
				aiProfile: { a: 1 },
			}),
		).toEqual({ aiProfile: { a: 1 } });
	});

	it("gives back what fromDoc read, so a save changes only what was edited", () => {
		const body = planningBody({ aiProfile: { style: "krótko" } });
		expect(
			toDocBody(
				fromDoc(doc("C12", body), planningSchema, "Dokument", { id: "" }),
			),
		).toEqual(body);
	});

	it("does not change the entity it was given", () => {
		const planning = { ...blankPlanning("C12"), etag: 'W/"1"' };
		const before = structuredClone(planning);
		toDocBody(planning);
		expect(planning).toEqual(before);
	});
});

describe("versionHeader", () => {
	it("asks the store to create only, for a document nobody saved yet", () => {
		expect(UNSAVED_ETAG).toBe("0");
		expect(versionHeader(UNSAVED_ETAG)).toEqual({ "if-none-match": "*" });
		expect(versionHeader("")).toEqual({ "if-none-match": "*" });
	});

	it("asks the store to replace exactly the version the change is based on", () => {
		expect(versionHeader('W/"1"')).toEqual({ "if-match": 'W/"1"' });
		expect(versionHeader('"0x8DC1234"')).toEqual({
			"if-match": '"0x8DC1234"',
		});
	});

	it("never sends both, and never neither", () => {
		for (const etag of ["", "0", 'W/"1"', "7"]) {
			expect(Object.keys(versionHeader(etag))).toHaveLength(1);
		}
	});
});

describe("defaultPlannerSettings", () => {
	it("is the unsaved document with the built-in plan types", () => {
		expect(defaultPlannerSettings()).toEqual({
			id: "planner",
			etag: UNSAVED_ETAG,
			updatedAtUtc: "",
			planTypes: DEFAULT_PLAN_TYPES,
			trainingTypeStyles: {},
			folders: [],
		});
		expect(DEFAULT_PLAN_TYPES.length).toBeGreaterThan(0);
	});

	it("fits the settings schema", () => {
		expect(
			plannerSettingsSchema.safeParse(defaultPlannerSettings()).success,
		).toBe(true);
	});

	it("is a copy each time: changing one does not change the built-in types", () => {
		const first = defaultPlannerSettings();
		const original = structuredClone(DEFAULT_PLAN_TYPES);
		first.planTypes[0]?.conditions.push({
			type: "limit",
			scope: "all",
			value: 9,
		});
		first.planTypes.pop();
		first.folders.push({ id: "f", name: "F" });
		expect(DEFAULT_PLAN_TYPES).toEqual(original);
		expect(defaultPlannerSettings().planTypes).toEqual(original);
		expect(defaultPlannerSettings().folders).toEqual([]);
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

// The store is there and the panel may save in it. Until 2026-11-13 the
// first meant the second; saving is a write mode of its own now.
const PLANNING_ON = capabilities({
	planning: true,
	writes: { planning: "on" },
});

const challengeIds = (...ids: string[]) => ({
	challengeIds: vi.fn(async () => ids),
});

describe("panelDocsArea: planning.list", () => {
	it("gives a blank document per challenge, with no request, while there is no store", async () => {
		const backend = fakeBackend();
		const deps = challengeIds("C1", "C12");
		const { planning } = panelDocsArea(backend.transport, SWITCHED_OFF, deps);

		expect(await planning.list()).toEqual([
			blankPlanning("C1"),
			blankPlanning("C12"),
		]);
		expect(backend.requests).toEqual([]);
		expect(deps.challengeIds).toHaveBeenCalledTimes(1);
	});

	it("marks those blank documents as never saved", async () => {
		const { planning } = panelDocsArea(
			fakeBackend().transport,
			SWITCHED_OFF,
			challengeIds("C1"),
		);
		expect((await planning.list())[0]?.etag).toBe(UNSAVED_ETAG);
	});

	it("reads every document in one request, bodies included", async () => {
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([doc("C12", planningBody())]),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1", "C12", "C13"),
		);

		const list = await planning.list();

		expect(backend.calls()).toEqual([`GET ${PLANNING}`]);
		expect(backend.only("GET", PLANNING).query).toEqual({ bodies: "true" });
		// One per challenge, in the challenges' order; unplanned ones blank.
		expect(list).toEqual([
			blankPlanning("C1"),
			{
				...planningBody(),
				id: "C12",
				etag: 'W/"1"',
				updatedAtUtc: "2026-11-10T09:00:00.000Z",
			},
			blankPlanning("C13"),
		]);
	});

	it("does not show the document of a challenge that is gone", async () => {
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([doc("C99", planningBody()), doc("C1", planningBody())]),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1"),
		);
		expect((await planning.list()).map((item) => item.id)).toEqual(["C1"]);
	});

	it("reads an empty store as blank documents", async () => {
		const backend = fakeBackend().on("GET", PLANNING, json([]));
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1"),
		);
		expect(await planning.list()).toEqual([blankPlanning("C1")]);
	});

	it("has nothing to list when there are no challenges", async () => {
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([doc("C99", planningBody())]),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds(),
		);
		expect(await planning.list()).toEqual([]);
	});

	it("fails when the store fails, rather than showing blank documents", async () => {
		// A blank document saved over a real one would lose the team's notes.
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			errorReply(500, "Failed to list panel docs: RestError"),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1"),
		);
		const error = await failure(planning.list());
		expect(error.kind).toBe("server");
	});

	it("fails when one document cannot be read", async () => {
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([doc("C1", planningBody({ variants: [] }))]),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1"),
		);
		const error = await failure(planning.list());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Dokument planowania");
	});

	it("fails when the answer is not a list", async () => {
		const backend = fakeBackend().on("GET", PLANNING, json({ docs: [] }));
		const { planning } = panelDocsArea(
			backend.transport,
			PLANNING_ON,
			challengeIds("C1"),
		);
		const error = await failure(planning.list());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Dokumenty planowania");
	});

	it("fails, with no request of its own, when the challenges cannot be listed", async () => {
		const backend = fakeBackend();
		const down = new ApiError("network", "Brak sieci");
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, {
			challengeIds: async () => {
				throw down;
			},
		});
		expect(await failure(planning.list())).toBe(down);
		expect(backend.requests).toEqual([]);
	});
});

describe("panelDocsArea: planning.save", () => {
	const deps = challengeIds("C12");
	const edited: Planning = {
		...blankPlanning("C12"),
		note: "Start po majówce",
		scratchpad: ["W1"],
	};

	it("is refused, with no request, while there is no store", async () => {
		const backend = fakeBackend();
		const { planning } = panelDocsArea(backend.transport, SWITCHED_OFF, deps);
		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("nie zapisuje jeszcze notatek");
		expect(backend.requests).toEqual([]);
	});

	it("is not opened by any of the content sections", async () => {
		const backend = fakeBackend();
		const { planning } = panelDocsArea(
			backend.transport,
			{ ...ALL_CAPABILITIES, planning: false },
			deps,
		);
		expect(
			(await failure(planning.save(edited, { etag: UNSAVED_ETAG }))).kind,
		).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("creates the document on its first save, and only if nobody else did", async () => {
		const backend = fakeBackend().on(
			"PUT",
			`${PLANNING}/C12`,
			json(doc("C12", toDocBody(edited))),
		);
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const result = await planning.save(edited, { etag: UNSAVED_ETAG });

		expect(result).toEqual({
			...edited,
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
		expect(backend.calls()).toEqual([`PUT ${PLANNING}/C12`]);
		const put = backend.only("PUT", `${PLANNING}/C12`);
		expect(put.headers["if-none-match"]).toBe("*");
		expect(put.headers).not.toHaveProperty("if-match");
		expect(put.query).toEqual({});
		// The body alone: the store keeps id, version and date itself.
		expect(bodyOf(put)).toEqual({
			calendarColor: null,
			note: "Start po majówce",
			folderId: null,
			scratchpad: ["W1"],
			customPlanTypes: [],
			conditionOverrides: {},
			variants: {},
		});
	});

	it("replaces exactly the version the change is based on", async () => {
		const stored: Planning = { ...edited, etag: 'W/"1"' };
		const backend = fakeBackend().on(
			"PUT",
			`${PLANNING}/C12`,
			json(doc("C12", toDocBody(stored), { etag: 'W/"2"' })),
		);
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const result = await planning.save(stored, { etag: 'W/"1"' });

		expect(result.etag).toBe('W/"2"');
		const put = backend.only("PUT", `${PLANNING}/C12`);
		expect(put.headers["if-match"]).toBe('W/"1"');
		expect(put.headers).not.toHaveProperty("if-none-match");
	});

	it("takes the new version from the ETag header when the body names none", async () => {
		const backend = fakeBackend().on("PUT", `${PLANNING}/C12`, {
			body: {
				id: "C12",
				updatedAtUtc: "2026-11-11T10:00:00.000Z",
				body: toDocBody(edited),
			},
			etag: '"0x8DC2"',
		});
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const result = await planning.save(edited, { etag: UNSAVED_ETAG });
		expect(result.etag).toBe('"0x8DC2"');
		expect(result.updatedAtUtc).toBe("2026-11-11T10:00:00.000Z");
	});

	it("sends back fields this build does not know", async () => {
		const loaded = fromDoc(
			doc("C12", planningBody({ aiProfile: { style: "krótko" } })),
			planningSchema,
			"Dokument",
			{ id: "" },
		);
		const backend = fakeBackend().on("PUT", `${PLANNING}/C12`, (request) =>
			json(doc("C12", bodyOf(request), { etag: 'W/"2"' })),
		);
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const result = await planning.save(
			{ ...loaded, note: "Zmieniona" },
			{ etag: loaded.etag },
		);

		expect(bodyOf(backend.only("PUT", `${PLANNING}/C12`))).toEqual(
			planningBody({ aiProfile: { style: "krótko" }, note: "Zmieniona" }),
		);
		expect(result.aiProfile).toEqual({ style: "krótko" });
	});

	it("keeps the challenge id inside its path segment", async () => {
		const backend = fakeBackend().on(
			"PUT",
			`${PLANNING}/a%2Fb%3Fc`,
			json(doc("a/b?c", {})),
		);
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const result = await planning.save(blankPlanning("a/b?c"), {
			etag: UNSAVED_ETAG,
		});
		expect(result.id).toBe("a/b?c");
	});

	it.each([409, 412])(
		"turns a %i with the current document into a conflict that carries it",
		async (status) => {
			const theirs = doc("C12", planningBody({ note: "Notatka Patryka" }), {
				etag: 'W/"7"',
			});
			const backend = fakeBackend().on(
				"PUT",
				`${PLANNING}/C12`,
				errorReply(status, "Conflict", { current: theirs }),
			);
			const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);

			const error = await failure(planning.save(edited, { etag: 'W/"1"' }));

			expect(error.kind).toBe("conflict");
			expect(error.status).toBe(status);
			expect(error.current).toEqual({
				...planningBody({ note: "Notatka Patryka" }),
				id: "C12",
				etag: 'W/"7"',
				updatedAtUtc: "2026-11-10T09:00:00.000Z",
			});
			// No second request to find out what is stored.
			expect(backend.calls()).toEqual([`PUT ${PLANNING}/C12`]);
		},
	);

	it("reads the current document when the refusal came without it", async () => {
		// For example a first save that lost to someone else's first save.
		const backend = fakeBackend()
			.on("PUT", `${PLANNING}/C12`, { status: 412 })
			.on("GET", `${PLANNING}/C12`, {
				body: { id: "C12", updatedAtUtc: "", body: planningBody() },
				etag: 'W/"7"',
			});
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));

		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(412);
		expect(error.current).toMatchObject({
			id: "C12",
			etag: 'W/"7"',
			note: "Start po majówce",
		});
		expect(backend.calls()).toEqual([
			`PUT ${PLANNING}/C12`,
			`GET ${PLANNING}/C12`,
		]);
	});

	it("is still a conflict when the current document cannot be read", async () => {
		const backend = fakeBackend()
			.on("PUT", `${PLANNING}/C12`, errorReply(409, "Conflict"))
			.on("GET", `${PLANNING}/C12`, errorReply(503, "Unavailable"));
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const error = await failure(planning.save(edited, { etag: 'W/"1"' }));
		expect(error.kind).toBe("conflict");
		expect(error.current).toBeUndefined();
	});

	it("passes on any other failure as it is", async () => {
		const backend = fakeBackend().on(
			"PUT",
			`${PLANNING}/C12`,
			errorReply(500, "Failed to save panel doc: RestError"),
		);
		const { planning } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const error = await failure(planning.save(edited, { etag: 'W/"1"' }));
		expect(error.kind).toBe("server");
		expect(backend.calls()).toEqual([`PUT ${PLANNING}/C12`]);
	});
});

describe("panelDocsArea: settings.planner", () => {
	const deps = challengeIds();

	it("gives the defaults, with no request, while there is no store", async () => {
		const backend = fakeBackend();
		const { settings } = panelDocsArea(backend.transport, SWITCHED_OFF, deps);
		expect(await settings.planner()).toEqual(defaultPlannerSettings());
		expect(backend.requests).toEqual([]);
	});

	it("reads the one settings document", async () => {
		const backend = fakeBackend().on(
			"GET",
			SETTINGS,
			json(doc("planner", settingsBody())),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		expect(await settings.planner()).toEqual({
			...settingsBody(),
			id: "planner",
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
		expect(backend.calls()).toEqual([`GET ${SETTINGS}`]);
	});

	it("takes the version from the ETag header when the body names none", async () => {
		const backend = fakeBackend().on("GET", SETTINGS, {
			body: { body: settingsBody() },
			etag: '"0x8DC"',
		});
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		expect(await settings.planner()).toMatchObject({
			id: "planner",
			etag: '"0x8DC"',
		});
	});

	it("gives the defaults, marked unsaved, when nobody saved settings yet", async () => {
		const backend = fakeBackend().on(
			"GET",
			SETTINGS,
			errorReply(404, "Document settings/planner not found"),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const result = await settings.planner();
		expect(result).toEqual(defaultPlannerSettings());
		expect(result.etag).toBe(UNSAVED_ETAG);
	});

	it("does not take any other failure for 'not saved yet'", async () => {
		// Defaults saved over the team's real settings would wipe them.
		for (const answer of [
			errorReply(500, "Failed to read panel doc: RestError"),
			{ status: 503 },
			{ status: 401 },
			errorReply(403, "Brak dostępu"),
		]) {
			const backend = fakeBackend().on("GET", SETTINGS, answer);
			const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
			const error = await failure(settings.planner());
			expect(error.kind).not.toBe("notFound");
		}
	});

	it("fails for a settings document it cannot read", async () => {
		const backend = fakeBackend().on(
			"GET",
			SETTINGS,
			json(doc("planner", settingsBody({ folders: "wiosna" }))),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const error = await failure(settings.planner());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Ustawienia planera");
	});
});

describe("panelDocsArea: settings.savePlanner", () => {
	const deps = challengeIds();
	const edited: PlannerSettings = {
		...defaultPlannerSettings(),
		folders: [{ id: "f-wiosna", name: "Wiosna" }],
	};

	it("is refused, with no request, while there is no store", async () => {
		const backend = fakeBackend();
		const { settings } = panelDocsArea(backend.transport, SWITCHED_OFF, deps);
		const error = await failure(
			settings.savePlanner(edited, { etag: UNSAVED_ETAG }),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("ustawień planera");
		expect(backend.requests).toEqual([]);
	});

	it("creates the document on the first save of the defaults", async () => {
		const backend = fakeBackend().on("PUT", SETTINGS, (request) =>
			json(doc("planner", bodyOf(request))),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const result = await settings.savePlanner(edited, { etag: UNSAVED_ETAG });

		expect(result).toEqual({
			...edited,
			etag: 'W/"1"',
			updatedAtUtc: "2026-11-10T09:00:00.000Z",
		});
		const put = backend.only("PUT", SETTINGS);
		expect(put.headers["if-none-match"]).toBe("*");
		expect(put.headers).not.toHaveProperty("if-match");
		expect(bodyOf(put)).toEqual({
			planTypes: JSON.parse(JSON.stringify(DEFAULT_PLAN_TYPES)),
			trainingTypeStyles: {},
			folders: [{ id: "f-wiosna", name: "Wiosna" }],
		});
	});

	it("replaces exactly the version the change is based on", async () => {
		const backend = fakeBackend().on("PUT", SETTINGS, (request) =>
			json(doc("planner", bodyOf(request), { etag: 'W/"2"' })),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const result = await settings.savePlanner(
			{ ...edited, etag: 'W/"1"' },
			{ etag: 'W/"1"' },
		);
		expect(result.etag).toBe('W/"2"');
		expect(backend.only("PUT", SETTINGS).headers["if-match"]).toBe('W/"1"');
	});

	it("saves under the one known id even when the entity has none", async () => {
		const backend = fakeBackend().on("PUT", SETTINGS, (request) =>
			json(doc("planner", bodyOf(request))),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const result = await settings.savePlanner(
			{ ...edited, id: "" },
			{ etag: UNSAVED_ETAG },
		);
		expect(result.id).toBe("planner");
		expect(backend.calls()).toEqual([`PUT ${SETTINGS}`]);
	});

	it("turns a 409 with the current settings into a conflict that carries them", async () => {
		const theirs = doc(
			"planner",
			settingsBody({ folders: [{ id: "f-lato", name: "Lato" }] }),
			{ etag: 'W/"7"' },
		);
		const backend = fakeBackend().on(
			"PUT",
			SETTINGS,
			errorReply(409, "Conflict", { current: theirs }),
		);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);

		const error = await failure(
			settings.savePlanner({ ...edited, etag: 'W/"1"' }, { etag: 'W/"1"' }),
		);

		expect(error.kind).toBe("conflict");
		expect(error.current).toMatchObject({
			id: "planner",
			etag: 'W/"7"',
			folders: [{ id: "f-lato", name: "Lato" }],
		});
		expect(backend.calls()).toEqual([`PUT ${SETTINGS}`]);
	});

	it("reads the current settings when the conflict came without them", async () => {
		const backend = fakeBackend()
			.on("PUT", SETTINGS, { status: 412 })
			.on(
				"GET",
				SETTINGS,
				json(doc("planner", settingsBody(), { etag: 'W/"7"' })),
			);
		const { settings } = panelDocsArea(backend.transport, PLANNING_ON, deps);
		const error = await failure(
			settings.savePlanner(edited, { etag: UNSAVED_ETAG }),
		);
		expect(error.kind).toBe("conflict");
		expect((error.current as PlannerSettings).etag).toBe('W/"7"');
		expect(backend.calls()).toEqual([`PUT ${SETTINGS}`, `GET ${SETTINGS}`]);
	});
});

// ─── The store as built on 2026-11-13 ───────────────────────────────────────
//
// Answers below are the ones the backend's own tests show
// (tests/handlers/panelDocsHandler.test.ts).

const variant = (notes: string) => ({
	planTypeId: null,
	prepStatus: "in_progress" as const,
	prepNote: "",
	notes,
	days: {},
	cards: {},
});

const planned = (variants: Planning["variants"]): Planning => ({
	...blankPlanning("C12"),
	etag: docEtag(1),
	variants,
});

describe("carryVariantKeys", () => {
	it("moves what was planned under a made-up id to the id the backend gave the variant", () => {
		const before = planned({ "level-beginner": variant("notatki") });
		const after = carryVariantKeys(before, [
			{ pathId: "p_0a1b2c3d4e5f", levelId: "beginner" },
		]);
		expect(after.variants).toEqual({ p_0a1b2c3d4e5f: variant("notatki") });
		// The document it was given is not changed.
		expect(before.variants).toEqual({ "level-beginner": variant("notatki") });
		expect(after.etag).toBe(docEtag(1));
	});

	it("moves the id that could never be proposed as well", () => {
		const after = carryVariantKeys(
			planned({
				"level:poziom 1": variant("a"),
				"level:beginner": variant("b"),
			}),
			[
				{ pathId: "p_111111111111", levelId: "poziom 1" },
				{ pathId: "p_222222222222", levelId: "beginner" },
			],
		);
		expect(after.variants).toEqual({
			p_111111111111: variant("a"),
			p_222222222222: variant("b"),
		});
	});

	it("follows the numbering of two variants at one level", () => {
		const after = carryVariantKeys(
			planned({
				"level-beginner": variant("pierwszy"),
				"level-beginner-2": variant("drugi"),
			}),
			[
				{ pathId: "p_111111111111", levelId: "beginner" },
				{ pathId: "p_222222222222", levelId: "beginner" },
			],
		);
		expect(after.variants).toEqual({
			p_111111111111: variant("pierwszy"),
			p_222222222222: variant("drugi"),
		});
	});

	it("leaves alone a key that is still a variant's id", () => {
		// Adopted by the backend on the panel's own save: nothing changed.
		const document = planned({ "level-beginner": variant("notatki") });
		expect(
			carryVariantKeys(document, [
				{ pathId: "level-beginner", levelId: "beginner" },
			]),
		).toBe(document);
	});

	it("does not hand a variant the notes of another that still has that id", () => {
		// The adopted variant moved to another level; Retool added a new one
		// at its old level. The notes stay with the variant they were about.
		const document = planned({ "level-beginner": variant("o pierwszym") });
		expect(
			carryVariantKeys(document, [
				{ pathId: "level-beginner", levelId: "advanced" },
				{ pathId: "p_222222222222", levelId: "beginner" },
			]),
		).toBe(document);
	});

	it("does not write over what is already planned under the new id", () => {
		const document = planned({
			"level-beginner": variant("stare"),
			p_0a1b2c3d4e5f: variant("nowe"),
		});
		expect(
			carryVariantKeys(document, [
				{ pathId: "p_0a1b2c3d4e5f", levelId: "beginner" },
			]),
		).toBe(document);
	});

	it("leaves alone what belongs to no variant it can name", () => {
		const document = planned({
			"level-advanced": variant("poziom, którego już nie ma"),
			p_gone: variant("wariant, którego już nie ma"),
		});
		expect(
			carryVariantKeys(document, [
				{ pathId: "p_0a1b2c3d4e5f", levelId: "beginner" },
			]),
		).toBe(document);
		expect(carryVariantKeys(document, [])).toBe(document);
	});
});

/** What createHttpApi gives the area: the challenges, loaded or as last loaded. */
function challengesOf(...rows: Record<string, unknown>[]) {
	const list = rows.map((row) => toChallenge(row, production()));
	return {
		challengeIds: vi.fn(async () => list.map((challenge) => challenge.id)),
		challenges: vi.fn(async () => list),
		lastChallenges: vi.fn(() => list),
	} satisfies PanelDocsDeps;
}

describe("panelDocsArea: planning.list on the store as built", () => {
	it("reads the documents and gives a blank one to a challenge without", async () => {
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([panelDoc("C12", planningBody())]),
		);
		const deps = challengesOf(panelChallenge(), panelChallenge({ id: "C13" }));
		const { planning } = panelDocsArea(backend.transport, production(), deps);

		const list = await planning.list();

		expect(list.map((item) => [item.id, item.etag])).toEqual([
			["C12", docEtag(1)],
			["C13", UNSAVED_ETAG],
		]);
		expect(list[0]?.updatedAtUtc).toBe("2026-11-13T10:00:00.000Z");
		// Who saved it last is the store's own; not part of the document.
		expect(list[0]).not.toHaveProperty("updatedBy");
		expect(backend.only("GET", PLANNING).query).toEqual({ bodies: "true" });
		// The challenges came with their variants: not asked for twice.
		expect(deps.challenges).toHaveBeenCalledTimes(1);
		expect(deps.challengeIds).not.toHaveBeenCalled();
	});

	it("follows a variant whose id the backend has assigned since", async () => {
		// Planned while the variant had no id; saved from Retool afterwards.
		const backend = fakeBackend().on(
			"GET",
			PLANNING,
			json([
				panelDoc(
					"C12",
					planningBody({ variants: { "level-beginner": variant("x") } }),
				),
			]),
		);
		const { planning } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(panelChallenge()),
		);
		const [document] = await planning.list();
		expect(Object.keys(document?.variants ?? {})).toEqual(["p_0a1b2c3d4e5f"]);
	});

	it("shows a blank document for a challenge in the bin, whose document is there too", async () => {
		// "no longer shows a planning document once its challenge is deleted".
		const backend = fakeBackend().on("GET", PLANNING, json([]));
		const { planning } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(panelChallenge({ status: "deleted", hidden: true })),
		);
		expect(await planning.list()).toEqual([blankPlanning("C12")]);
	});

	it("reports a kind the backend does not know", async () => {
		const backend = fakeBackend().on("GET", PLANNING, {
			status: 400,
			body: {
				error: "Nieznany rodzaj dokumentu.",
				errorCode: "PANEL_DOC_UNKNOWN_KIND",
			},
		});
		const { planning } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(panelChallenge()),
		);
		const error = await failure(planning.list());
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Nieznany rodzaj dokumentu.");
	});
});

describe("panelDocsArea: who may save, now that the store is there", () => {
	const edited: Planning = {
		...blankPlanning("C12"),
		note: "Start po majówce",
	};
	const DOC = `${PLANNING}/C12`;

	it("refuses every save, without a request, in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const { planning, settings } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(panelChallenge()),
		);
		for (const run of [
			() => planning.save(edited, { etag: UNSAVED_ETAG }),
			() =>
				planning.save({ ...edited, etag: docEtag(1) }, { etag: docEtag(1) }),
			() =>
				settings.savePlanner(defaultPlannerSettings(), { etag: UNSAVED_ETAG }),
		]) {
			const error = await failure(run());
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("tylko do odczytu");
			expect(error.message).toContain("„Planowanie”");
		}
		expect(backend.requests).toEqual([]);
	});

	it("is not opened by any of the content sections", async () => {
		const backend = fakeBackend();
		const { planning } = panelDocsArea(
			backend.transport,
			production({ writes: { challenges: "on", workouts: "on" } }),
			challengesOf(panelChallenge()),
		);
		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("still says there is no store while the feature is off, whatever the write mode", async () => {
		const backend = fakeBackend();
		const { planning } = panelDocsArea(
			backend.transport,
			production({ planning: false, writes: { planning: "on" } }),
			challengesOf(panelChallenge()),
		);
		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));
		expect(error.message).toContain("nie zapisuje jeszcze notatek");
		expect(backend.requests).toEqual([]);
	});

	describe("test-only", () => {
		const TEST_ONLY = production({ writes: { planning: "test-only" } });

		it("saves the document of a challenge that is a test item", async () => {
			const backend = fakeBackend().on("PUT", DOC, {
				status: 201,
				body: panelDoc("C12", toDocBody(edited)),
				etag: docEtag(1),
			});
			const deps = challengesOf(
				panelChallenge({ internalTitle: "[TEST] wiosna" }),
			);
			const { planning } = panelDocsArea(backend.transport, TEST_ONLY, deps);

			const saved = await planning.save(edited, { etag: UNSAVED_ETAG });

			expect(saved.etag).toBe(docEtag(1));
			expect(backend.calls()).toEqual([`PUT ${DOC}`]);
		});

		it("refuses the document of a real challenge, without a request", async () => {
			const backend = fakeBackend();
			const { planning } = panelDocsArea(
				backend.transport,
				TEST_ONLY,
				challengesOf(panelChallenge({ internalTitle: "wiosna 2026" })),
			);
			const error = await failure(
				planning.save(edited, { etag: UNSAVED_ETAG }),
			);
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("[TEST]");
			expect(error.message).toContain("„Komentarz wewnętrzny wyzwania”");
			expect(backend.requests).toEqual([]);
		});

		it("refuses when it cannot tell which challenge the document belongs to", async () => {
			const backend = fakeBackend();
			for (const deps of [
				challengesOf(
					panelChallenge({ id: "C99", internalTitle: "[TEST] inne" }),
				),
				{ challengeIds: async () => ["C12"] },
			]) {
				const { planning } = panelDocsArea(backend.transport, TEST_ONLY, deps);
				const error = await failure(
					planning.save(edited, { etag: UNSAVED_ETAG }),
				);
				expect(error.kind).toBe("validation");
			}
			expect(backend.requests).toEqual([]);
		});

		it("keeps the planner's settings closed: there is no test version of them", async () => {
			const backend = fakeBackend();
			const { settings } = panelDocsArea(
				backend.transport,
				TEST_ONLY,
				challengesOf(),
			);
			const error = await failure(
				settings.savePlanner(defaultPlannerSettings(), { etag: UNSAVED_ETAG }),
			);
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("nie da się wypróbować");
			expect(backend.requests).toEqual([]);
		});
	});
});

describe("panelDocsArea: saving in the store as built", () => {
	const OPEN = production({ writes: { planning: "on" } });
	const DOC = `${PLANNING}/C12`;
	const edited: Planning = {
		...blankPlanning("C12"),
		note: "Start po majówce",
	};
	const deps = () => challengesOf(panelChallenge());

	it("creates a document: 201, with its version in the body and the header", async () => {
		// "creates a document with If-None-Match: * and answers with it".
		const backend = fakeBackend().on("PUT", DOC, {
			status: 201,
			body: panelDoc("C12", toDocBody(edited)),
			etag: docEtag(1),
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());

		const saved = await planning.save(edited, { etag: UNSAVED_ETAG });

		expect(saved).toEqual({
			...edited,
			etag: docEtag(1),
			updatedAtUtc: "2026-11-13T10:00:00.000Z",
		});
		const put = backend.only("PUT", DOC);
		expect(put.headers["if-none-match"]).toBe("*");
		expect(put.headers).not.toHaveProperty("if-match");
	});

	it("saves a new version with the quoted etag it was given, as it is", async () => {
		const backend = fakeBackend().on("PUT", DOC, {
			body: panelDoc("C12", toDocBody(edited), { etag: docEtag(2) }),
			etag: docEtag(2),
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());

		const saved = await planning.save(
			{ ...edited, etag: docEtag(1) },
			{ etag: docEtag(1) },
		);

		expect(saved.etag).toBe(docEtag(2));
		const put = backend.only("PUT", DOC);
		expect(put.headers["if-match"]).toBe(docEtag(1));
		expect(put.headers).not.toHaveProperty("if-none-match");
	});

	it("turns PANEL_DOC_CONFLICT into a conflict that carries the stored document", async () => {
		// "refuses a save based on a stale etag with 409 and the current document".
		const theirs = panelDoc("C12", planningBody({ note: "Notatka Patryka" }), {
			etag: docEtag(2),
			updatedBy: "uid-bob",
		});
		const backend = fakeBackend().on(
			"PUT",
			DOC,
			conflictReply(
				"Ktoś zmienił ten dokument w międzyczasie.",
				theirs,
				"PANEL_DOC_CONFLICT",
			),
		);
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());

		const error = await failure(planning.save(edited, { etag: docEtag(1) }));

		expect(error.kind).toBe("conflict");
		expect(error.message).toBe("Ktoś zmienił ten dokument w międzyczasie.");
		expect((error.current as Planning).note).toBe("Notatka Patryka");
		expect((error.current as Planning).etag).toBe(docEtag(2));
		expect(backend.calls()).toEqual([`PUT ${DOC}`]);
	});

	it("reads the stored document of a conflict the way the list reads it", async () => {
		// Theirs still names the variant by the id that was made up for it;
		// what is merged into is the document as this panel shows it.
		const theirs = panelDoc(
			"C12",
			planningBody({ variants: { "level-beginner": variant("ich notatki") } }),
			{ etag: docEtag(2) },
		);
		const backend = fakeBackend().on(
			"PUT",
			DOC,
			conflictReply(
				"Ktoś zmienił ten dokument w międzyczasie.",
				theirs,
				"PANEL_DOC_CONFLICT",
			),
		);
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: docEtag(1) }));
		expect(Object.keys((error.current as Planning).variants)).toEqual([
			"p_0a1b2c3d4e5f",
		]);
	});

	it("is a conflict when someone else created the document first", async () => {
		// "refuses to create a document that exists, with 409 and the stored document".
		const theirs = panelDoc("C12", planningBody({ note: "Pierwsza" }));
		const backend = fakeBackend().on(
			"PUT",
			DOC,
			conflictReply(
				"Ktoś zmienił ten dokument w międzyczasie.",
				theirs,
				"PANEL_DOC_CONFLICT",
			),
		);
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));
		expect(error.kind).toBe("conflict");
		expect((error.current as Planning).etag).toBe(docEtag(1));
	});

	it("reads the document when the conflict came with `current: null`", async () => {
		const backend = fakeBackend()
			.on(
				"PUT",
				DOC,
				conflictReply(
					"Ktoś zmienił ten dokument w międzyczasie.",
					null,
					"PANEL_DOC_CONFLICT",
				),
			)
			.on("GET", DOC, {
				body: panelDoc("C12", planningBody({ note: "Odczytana" })),
				etag: docEtag(1),
			});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: docEtag(9) }));
		expect(error.kind).toBe("conflict");
		expect((error.current as Planning).note).toBe("Odczytana");
		expect(backend.calls()).toEqual([`PUT ${DOC}`, `GET ${DOC}`]);
	});

	it("says a document is gone, and does not create it again, when its version was named", async () => {
		// "answers 404 for a save based on a version of a document that does
		// not exist": not a conflict to merge into.
		const backend = fakeBackend().on("PUT", DOC, {
			status: 404,
			body: {
				error: "Nie ma takiego dokumentu.",
				errorCode: "PANEL_DOC_NOT_FOUND",
			},
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());

		const error = await failure(planning.save(edited, { etag: docEtag(1) }));

		expect(error.kind).toBe("notFound");
		expect(error.status).toBe(404);
		// the backend's own words, as they are
		expect(error.message).toBe("Nie ma takiego dokumentu.");
		// One request: no second try as a create.
		expect(backend.calls()).toEqual([`PUT ${DOC}`]);
	});

	it("does not save the document of a challenge that is in the bin", async () => {
		// The list shows a blank one in its place; saving that would take the
		// place of the document the challenge comes back with.
		const backend = fakeBackend();
		const { planning } = panelDocsArea(
			backend.transport,
			OPEN,
			challengesOf(panelChallenge({ status: "deleted", hidden: true })),
		);
		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("jest w koszu");
		expect(backend.requests).toEqual([]);
	});

	it("goes by the challenges as last loaded for that, without loading them", async () => {
		const backend = fakeBackend().on("PUT", DOC, {
			status: 201,
			body: panelDoc("C12", toDocBody(edited)),
		});
		const loaded = deps();
		const { planning } = panelDocsArea(backend.transport, OPEN, loaded);
		await planning.save(edited, { etag: UNSAVED_ETAG });
		expect(loaded.lastChallenges).toHaveBeenCalledTimes(1);
		expect(loaded.challenges).not.toHaveBeenCalled();
		expect(loaded.challengeIds).not.toHaveBeenCalled();
	});

	it("saves when no challenges were loaded yet: the backend is the one that knows", async () => {
		const backend = fakeBackend().on("PUT", DOC, {
			status: 201,
			body: panelDoc("C12", toDocBody(edited)),
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, {
			challengeIds: async () => [],
			lastChallenges: () => undefined,
		});
		expect((await planning.save(edited, { etag: UNSAVED_ETAG })).etag).toBe(
			docEtag(1),
		);
	});

	it("reports a document that is too large in the store's own words", async () => {
		const backend = fakeBackend().on("PUT", DOC, {
			status: 413,
			body: {
				error: "Dokument jest za duży, żeby go zapisać.",
				errorCode: "PANEL_DOC_TOO_LARGE",
			},
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: docEtag(1) }));
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(413);
		expect(error.message).toBe("Dokument jest za duży, żeby go zapisać.");
	});

	it("reports a save the store says named no version as the panel's fault, once", async () => {
		const backend = fakeBackend().on("PUT", DOC, {
			status: 428,
			body: {
				error:
					"Zapis wymaga wersji dokumentu: nagłówka If-Match albo If-None-Match: *.",
				errorCode: "PANEL_DOC_VERSION_REQUIRED",
			},
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: docEtag(1) }));
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(428);
		expect(backend.calls()).toEqual([`PUT ${DOC}`]);
	});

	it.each([
		["PANEL_DOC_BAD_ID", "Nieprawidłowy identyfikator dokumentu."],
		["PANEL_DOC_BAD_BODY", "Dokument musi być obiektem JSON."],
	])("reports %s as a refusal", async (errorCode, text) => {
		const backend = fakeBackend().on("PUT", DOC, {
			status: 400,
			body: { error: text, errorCode },
		});
		const { planning } = panelDocsArea(backend.transport, OPEN, deps());
		const error = await failure(planning.save(edited, { etag: docEtag(1) }));
		expect(error.kind).toBe("validation");
		expect(error.message).toBe(text);
	});
});

describe("panelDocsArea: the planner's settings in the store as built", () => {
	const OPEN = production({ writes: { planning: "on" } });

	it("reads them with the version from the body", async () => {
		const backend = fakeBackend().on("GET", SETTINGS, {
			body: panelDoc("planner", settingsBody()),
			etag: docEtag(1),
		});
		const { settings } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(),
		);
		const read = await settings.planner();
		expect(read.etag).toBe(docEtag(1));
		expect(read.folders).toEqual([{ id: "f-wiosna", name: "Wiosna" }]);
	});

	it("gives the defaults when nobody saved them yet", async () => {
		// "answers 404 for a document nobody has saved (B3.6)".
		const backend = fakeBackend().on("GET", SETTINGS, {
			status: 404,
			body: {
				error: "Nie ma takiego dokumentu.",
				errorCode: "PANEL_DOC_NOT_FOUND",
			},
		});
		const { settings } = panelDocsArea(
			backend.transport,
			production(),
			challengesOf(),
		);
		expect(await settings.planner()).toEqual(defaultPlannerSettings());
	});

	it("says the settings are gone when their version was named and they are not there", async () => {
		const backend = fakeBackend().on("PUT", SETTINGS, {
			status: 404,
			body: {
				error: "Nie ma takiego dokumentu.",
				errorCode: "PANEL_DOC_NOT_FOUND",
			},
		});
		const { settings } = panelDocsArea(backend.transport, OPEN, challengesOf());
		const error = await failure(
			settings.savePlanner(
				{ ...defaultPlannerSettings(), etag: docEtag(1) },
				{ etag: docEtag(1) },
			),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Nie ma takiego dokumentu.");
	});

	it("creates them on the first save", async () => {
		const backend = fakeBackend().on("PUT", SETTINGS, (request) => ({
			status: 201,
			body: panelDoc("planner", bodyOf(request)),
			etag: docEtag(1),
		}));
		const { settings } = panelDocsArea(backend.transport, OPEN, challengesOf());
		const saved = await settings.savePlanner(defaultPlannerSettings(), {
			etag: UNSAVED_ETAG,
		});
		expect(saved.etag).toBe(docEtag(1));
		expect(backend.only("PUT", SETTINGS).headers["if-none-match"]).toBe("*");
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("panelDocsArea: a document that is in the bin with its challenge", () => {
	const OPEN = production({ writes: { planning: "on" } });
	const DOC = `${PLANNING}/C12`;
	const edited: Planning = {
		...blankPlanning("C12"),
		note: "Start po majówce",
	};

	it("shows the backend's sentence as a refusal, and merges nothing", async () => {
		// "a create over the planning document of a challenge that is in the
		// bin is 409 PANEL_DOC_DELETED with current: null".
		const backend = fakeBackend().on("PUT", DOC, {
			status: 409,
			body: {
				error:
					"Ten dokument jest w koszu razem ze swoim challenge'em. Przywróć challenge, żeby go odzyskać.",
				errorCode: "PANEL_DOC_DELETED",
				current: null,
			},
		});
		// The panel did not know the challenge was in the bin (no list loaded).
		const { planning } = panelDocsArea(backend.transport, OPEN, {
			challengeIds: async () => ["C12"],
		});

		const error = await failure(planning.save(edited, { etag: UNSAVED_ETAG }));

		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			"Ten dokument jest w koszu razem ze swoim challenge'em. Przywróć challenge, żeby go odzyskać.",
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.current).toBeUndefined();
		// Not read again and not tried again, as a conflict would be.
		expect(backend.calls()).toEqual([`PUT ${DOC}`]);
	});
});
