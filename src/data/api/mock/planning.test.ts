import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import { blankVariantPlanning, UNSAVED_ETAG } from "@/data/schemas/planning";
import { createStore } from "@/lib/store";
import { defaultMockControls, type MockControls } from "./controls";
import { UNKNOWN_FIELD } from "./fixtures";
import { createMockApi } from "./index";

// Contract of the planning and settings endpoints; holds for any ApiClient.

function setup(overrides: Partial<MockControls> = {}) {
	const controls = createStore<MockControls>({
		...defaultMockControls,
		minLatencyMs: 0,
		maxLatencyMs: 0,
		...overrides,
	});
	return {
		api: createMockApi({ controls, sleep: async () => {}, storage: null }),
		controls,
	};
}

const kindOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
		return "resolved";
	} catch (error) {
		return error instanceof ApiError ? error.kind : "other";
	}
};

describe("planning documents", () => {
	it("lists exactly one document per challenge", async () => {
		const { api } = setup();
		const [challenges, planning] = await Promise.all([
			api.challenges.list(),
			api.planning.list(),
		]);
		expect(planning.map((p) => p.id).sort()).toEqual(
			challenges.map((c) => c.id).sort(),
		);
	});

	it("gives a challenge created later a blank document, saved on first use", async () => {
		const { api } = setup();
		const [template] = await api.challenges.list();
		if (!template) throw new Error("fixtures are empty");
		const { id: _id, etag: _etag, updatedAtUtc: _at, ...fields } = template;
		const created = await api.challenges.create({
			...fields,
			title: "Nowe",
			status: "draft",
		});
		const blank = (await api.planning.list()).find((p) => p.id === created.id);
		expect(blank).toMatchObject({
			etag: UNSAVED_ETAG,
			scratchpad: [],
			variants: {},
		});

		const saved = await api.planning.save(
			{
				...blank,
				id: created.id,
				etag: UNSAVED_ETAG,
				note: "pierwsza",
			} as never,
			{ etag: UNSAVED_ETAG },
		);
		expect(saved.note).toBe("pierwsza");
		expect(saved.etag).not.toBe(UNSAVED_ETAG);
		expect(
			(await api.planning.list()).find((p) => p.id === created.id)?.note,
		).toBe("pierwsza");
	});

	it("saves with the current etag and refuses a stale one with the current row", async () => {
		const { api } = setup();
		const [document] = await api.planning.list();
		if (!document) throw new Error("no planning");
		const saved = await api.planning.save(
			{ ...document, note: "raz" },
			{ etag: document.etag },
		);
		expect(saved.etag).not.toBe(document.etag);
		try {
			await api.planning.save(
				{ ...document, note: "dwa" },
				{ etag: document.etag },
			);
			throw new Error("should have conflicted");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).kind).toBe("conflict");
			expect((error as ApiError<typeof saved>).current?.note).toBe("raz");
		}
	});

	it("keeps fields it does not know, at every level", async () => {
		const { api } = setup();
		const document = (await api.planning.list()).find(
			(p) => Object.keys(p.variants).length > 0,
		);
		if (!document) throw new Error("no planned variant in fixtures");
		const pathId = Object.keys(document.variants)[0] ?? "";
		expect((document as Record<string, unknown>)[UNKNOWN_FIELD]).toBeDefined();
		expect(
			(document.variants[pathId] as Record<string, unknown>)[UNKNOWN_FIELD],
		).toBeDefined();

		const saved = await api.planning.save(
			{ ...document, note: "zmiana" },
			{ etag: document.etag },
		);
		expect((saved as Record<string, unknown>)[UNKNOWN_FIELD]).toBe(
			(document as Record<string, unknown>)[UNKNOWN_FIELD],
		);
		expect(
			(saved.variants[pathId] as Record<string, unknown>)[UNKNOWN_FIELD],
		).toBe(
			(document.variants[pathId] as Record<string, unknown>)[UNKNOWN_FIELD],
		);
	});

	it("refuses invalid colours with the place they are in", async () => {
		const { api } = setup();
		const [document] = await api.planning.list();
		if (!document) throw new Error("no planning");
		try {
			await api.planning.save(
				{ ...document, calendarColor: "zielony" },
				{ etag: document.etag },
			);
			throw new Error("should have been refused");
		} catch (error) {
			expect((error as ApiError).kind).toBe("validation");
			expect((error as ApiError).issues[0]?.path).toBe("calendarColor");
		}
	});

	it("answers notFound for a challenge that does not exist", async () => {
		const { api } = setup();
		const [document] = await api.planning.list();
		if (!document) throw new Error("no planning");
		expect(
			await kindOf(
				api.planning.save(
					{ ...document, id: "C-nope" },
					{ etag: document.etag },
				),
			),
		).toBe("notFound");
	});

	it("fails once when told to, then works", async () => {
		const { api } = setup({ failNextSave: true });
		const [document] = await api.planning.list();
		if (!document) throw new Error("no planning");
		const attempt = () =>
			api.planning.save({ ...document, note: "x" }, { etag: document.etag });
		expect(await kindOf(attempt())).toBe("server");
		expect(await kindOf(attempt())).toBe("resolved");
	});

	it("can play another admin changing the very same note", async () => {
		const { api } = setup({ conflictNextSave: "sameFields" });
		const [document] = await api.planning.list();
		if (!document) throw new Error("no planning");
		const pathId = Object.keys(document.variants)[0] ?? "p-x";
		const mine = structuredClone(document);
		mine.variants[pathId] = {
			...(mine.variants[pathId] ?? blankVariantPlanning()),
			notes: "moje notatki",
		};
		try {
			await api.planning.save(mine, { etag: document.etag });
			throw new Error("should have conflicted");
		} catch (error) {
			const current = (error as ApiError<typeof document>).current;
			expect((error as ApiError).kind).toBe("conflict");
			expect(current?.variants[pathId]?.notes).not.toBe("moje notatki");
			expect(current?.variants[pathId]?.notes).not.toBe(
				document.variants[pathId]?.notes ?? "",
			);
		}
	});
});

describe("planner settings", () => {
	it("serves plan types, styles and folders", async () => {
		const { api } = setup();
		const settings = await api.settings.planner();
		expect(settings.planTypes.length).toBeGreaterThan(0);
		expect(settings.folders.length).toBeGreaterThan(0);
		expect(settings.trainingTypeStyles.cardio).toMatchObject({ tone: "red" });
	});

	it("saves, keeps unknown fields, and refuses a stale etag", async () => {
		const { api } = setup();
		const settings = await api.settings.planner();
		const saved = await api.settings.savePlanner(
			{
				...settings,
				folders: [...settings.folders, { id: "f-new", name: "Nowy" }],
			},
			{ etag: settings.etag },
		);
		expect(saved.folders.map((f) => f.id)).toContain("f-new");
		expect((saved as Record<string, unknown>)[UNKNOWN_FIELD]).toBe(
			(settings as Record<string, unknown>)[UNKNOWN_FIELD],
		);
		expect(
			await kindOf(api.settings.savePlanner(settings, { etag: settings.etag })),
		).toBe("conflict");
		expect((await api.settings.planner()).etag).toBe(saved.etag);
	});

	it("refuses a duplicate folder name and an unknown colour", async () => {
		const { api } = setup();
		const settings = await api.settings.planner();
		const first = settings.folders[0];
		if (!first) throw new Error("no folders in fixtures");
		expect(
			await kindOf(
				api.settings.savePlanner(
					{
						...settings,
						folders: [...settings.folders, { id: "f-2", name: first.name }],
					},
					{ etag: settings.etag },
				),
			),
		).toBe("validation");
		expect(
			await kindOf(
				api.settings.savePlanner(
					{
						...settings,
						trainingTypeStyles: { cardio: { tone: "neon", emoji: "" } },
					},
					{ etag: settings.etag },
				),
			),
		).toBe("validation");
	});

	it("survives a reload when stored", async () => {
		const memory = new Map<string, string>();
		const storage = {
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value),
			removeItem: (key: string) => void memory.delete(key),
		};
		const controls = () =>
			createStore<MockControls>({
				...defaultMockControls,
				minLatencyMs: 0,
				maxLatencyMs: 0,
			});
		const open = () =>
			createMockApi({ controls: controls(), sleep: async () => {}, storage });

		const before = open();
		const settings = await before.settings.planner();
		await before.settings.savePlanner(
			{ ...settings, folders: [{ id: "f-kept", name: "Zostaje" }] },
			{ etag: settings.etag },
		);
		const [document] = await before.planning.list();
		if (!document) throw new Error("no planning");
		await before.planning.save(
			{ ...document, note: "po odświeżeniu" },
			{ etag: document.etag },
		);

		const after = open();
		expect((await after.settings.planner()).folders).toEqual([
			expect.objectContaining({ id: "f-kept", name: "Zostaje" }),
		]);
		expect(
			(await after.planning.list()).find((p) => p.id === document.id)?.note,
		).toBe("po odświeżeniu");
	});
});
