import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/data/api/errors";
import { memoryStorage, type StorageLike } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { defaultMockControls, type MockControls } from "./controls";
import { buildFixtures } from "./fixtures";
import { createKernel, disagree, type Stored } from "./kernel";
import { SNAPSHOT_KEY } from "./persistence";

interface Row extends Stored {
	title: string;
	equipmentIds: string[];
}

const joga: Row = {
	id: "W1",
	etag: "1",
	updatedAtUtc: "2026-09-01T08:00:00.000Z",
	title: "Poranna joga",
	equipmentIds: ["mata"],
};
const hiit: Row = {
	id: "W2",
	etag: "1",
	updatedAtUtc: "2026-09-02T08:00:00.000Z",
	title: "HIIT na schodach",
	equipmentIds: [],
};

function setup(
	options: {
		storage?: StorageLike | null;
		controls?: Partial<MockControls>;
	} = {},
) {
	const controls = createStore<MockControls>({
		...defaultMockControls,
		minLatencyMs: 0,
		maxLatencyMs: 0,
		...options.controls,
	});
	const pauses: number[] = [];
	let second = 0;
	const kernel = createKernel({
		controls,
		storage: options.storage ?? null,
		sleep: async (ms) => {
			pauses.push(ms);
		},
		now: () => `2026-11-11T10:00:${String(second++).padStart(2, "0")}.000Z`,
	});
	const workouts = () =>
		kernel.table<Row>(
			"workouts",
			() => [joga, hiit],
			(row) => row.id,
		);
	return { kernel, controls, pauses, workouts };
}

function snapshotIn(storage: ReturnType<typeof memoryStorage>): unknown {
	const raw = storage.data.get(SNAPSHOT_KEY);
	return raw === undefined ? undefined : JSON.parse(raw);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("disagree", () => {
	it("changes a text the user changed, starting from the stored one", () => {
		const stored = { title: "Poranna joga" };
		disagree(stored, { title: "Poranna joga dla początkujących" });
		expect(stored.title).toBe("Poranna joga (inny admin)");
	});

	it("writes a text where the stored value was not one", () => {
		const stored: Record<string, unknown> = { comment: null };
		disagree(stored, { comment: "Na wiosnę", videoUrl: "https://x.test/v" });
		expect(stored).toEqual({
			comment: "(inny admin)",
			videoUrl: "(inny admin)",
		});
	});

	it("moves a number away from both versions", () => {
		const stored = { lengthDays: 28 };
		disagree(stored, { lengthDays: 21 });
		expect(stored.lengthDays).toBe(26);
	});

	it("keeps a boolean opposite to the incoming one", () => {
		const stored = { pro: false, isHidden: true };
		disagree(stored, { pro: true, isHidden: false });
		expect(stored).toEqual({ pro: false, isHidden: true });
	});

	it("adds an entry to a list", () => {
		const stored: Record<string, unknown> = { goalsIds: ["kondycja"] };
		disagree(stored, { goalsIds: ["kondycja", "siła"], scratchpad: ["W3"] });
		expect(stored).toEqual({
			goalsIds: ["kondycja", "inny-admin"],
			scratchpad: ["inny-admin"],
		});
	});

	it("goes into a nested record and changes only what differs there", () => {
		const stored = {
			variants: {
				"p-easy": { prepNote: "Brakuje nagrań", notes: "bez zmian" },
				"p-hard": { prepNote: "", notes: "" },
			},
		};
		const untouched = stored.variants["p-hard"];
		disagree(stored, {
			variants: {
				"p-easy": { prepNote: "Nagrania są", notes: "bez zmian" },
				"p-hard": { prepNote: "", notes: "" },
			},
		});
		expect(stored.variants["p-easy"]).toEqual({
			prepNote: "Brakuje nagrań (inny admin)",
			notes: "bez zmian",
		});
		expect(stored.variants["p-hard"]).toBe(untouched);
	});

	it("builds its own version of a record the stored row does not have", () => {
		const stored: Record<string, unknown> = { days: {} };
		const incoming = {
			days: { "3": { note: "Dzień regeneracji", tint: "#fde68a" } },
			style: { tone: "blue", order: 2, inner: { emoji: "🧘" } },
		};
		disagree(stored, incoming);
		expect(stored).toEqual({
			days: {
				"3": {
					note: "Dzień regeneracji (inny admin)",
					tint: "#fde68a (inny admin)",
				},
			},
			style: {
				tone: "blue (inny admin)",
				order: 2,
				inner: { emoji: "🧘 (inny admin)" },
			},
		});
		// The incoming document is only read.
		expect(incoming.style.tone).toBe("blue");
	});

	it("never touches the id, the etag or the modification date", () => {
		const stored = { ...joga };
		disagree(stored, {
			...joga,
			id: "W99",
			etag: "41",
			updatedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(stored).toEqual(joga);
	});

	it("leaves equal fields alone", () => {
		const equipmentIds = ["mata", "taśma"];
		const settings = { color: "#3b82f6" };
		const stored = { title: "Joga", lengthDays: 28, equipmentIds, settings };
		disagree(stored, {
			title: "Joga",
			lengthDays: 28,
			equipmentIds: ["mata", "taśma"],
			settings: { color: "#3b82f6" },
		});
		expect(stored).toEqual({
			title: "Joga",
			lengthDays: 28,
			equipmentIds: ["mata", "taśma"],
			settings: { color: "#3b82f6" },
		});
		expect(stored.equipmentIds).toBe(equipmentIds);
		expect(stored.settings).toBe(settings);
	});

	it("changes exactly the fields that differ in a whole document", () => {
		const stored = {
			id: "C1",
			etag: "4",
			updatedAtUtc: "2026-10-01T00:00:00.000Z",
			title: "Wiosenne wyzwanie",
			subtitle: "Cztery tygodnie",
			lengthDays: 28,
			pro: false,
			goalsIds: ["kondycja"],
			onlyOnServer: "zostaje",
		};
		const before = structuredClone(stored);
		disagree(stored, {
			...before,
			etag: "3",
			title: "Wiosenne wyzwanie biegowe",
			goalsIds: [],
		});
		expect(stored).toEqual({
			...before,
			title: "Wiosenne wyzwanie (inny admin)",
			goalsIds: ["kondycja", "inny-admin"],
		});
	});

	it("leaves a field the user emptied as it was", () => {
		const stored = { internalTitle: "Notatka zespołu" };
		disagree(stored, { internalTitle: null });
		expect(stored.internalTitle).toBe("Notatka zespołu");
	});

	it("does nothing with values that are not records", () => {
		const list = ["W1"];
		expect(() => {
			disagree(null, { title: "x" });
			disagree({ title: "x" }, null);
			disagree(list, ["W2"]);
			disagree("tekst", "inny tekst");
		}).not.toThrow();
		expect(list).toEqual(["W1"]);
	});
});

describe("storing a row", () => {
	it("gives it a new etag and the time of the save", () => {
		const { kernel, workouts } = setup();
		const table = workouts();

		const saved = kernel.store(table, { ...joga, title: "Wieczorna joga" });

		expect(saved).toEqual({
			...joga,
			title: "Wieczorna joga",
			etag: "2",
			updatedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(table.get("W1")).toEqual(saved);
	});

	it("issues a different etag on every save", () => {
		const { kernel, workouts } = setup();
		const table = workouts();
		const first = kernel.store(table, joga);
		const second = kernel.store(table, first);
		const other = kernel.store(table, hiit);
		expect([first.etag, second.etag, other.etag]).toEqual(["2", "3", "4"]);
		expect(second.updatedAtUtc).toBe("2026-11-11T10:00:01.000Z");
	});

	it("adds a row that was not there", () => {
		const { kernel, workouts } = setup();
		const table = workouts();
		const pilates: Row = { ...joga, id: "W3", title: "Pilates z piłką" };
		kernel.store(table, pilates);
		expect([...table.keys()]).toEqual(["W1", "W2", "W3"]);
	});

	it("returns a copy, and keeps a copy of what it was given", () => {
		const { kernel, workouts } = setup();
		const table = workouts();
		const incoming = { ...joga, equipmentIds: ["mata"] };

		const saved = kernel.store(table, incoming);
		saved.equipmentIds.push("hantle");
		saved.title = "zmienione po zapisie";
		incoming.equipmentIds.push("taśma");

		expect(table.get("W1")).toMatchObject({
			title: "Poranna joga",
			equipmentIds: ["mata"],
		});
		expect(incoming.etag).toBe("1");
	});

	it("keeps a field it has no idea about", () => {
		const { kernel, workouts } = setup();
		const table = workouts();
		const fromNewerBackend = {
			...joga,
			x_addedByNewerBackend: { since: "2.4" },
		};
		const saved = kernel.store(table, fromNewerBackend);
		expect(saved).toHaveProperty("x_addedByNewerBackend", { since: "2.4" });
		expect(table.get("W1")).toHaveProperty("x_addedByNewerBackend", {
			since: "2.4",
		});
	});
});

describe("a table", () => {
	it("starts from copies of the initial rows, by key", () => {
		const seedRows = [structuredClone(joga), structuredClone(hiit)];
		const { kernel } = setup();
		const table = kernel.table<Row>(
			"workouts",
			() => seedRows,
			(row) => row.id,
		);
		const first = seedRows[0];
		if (first) first.title = "zmienione w danych startowych";

		expect([...table.keys()]).toEqual(["W1", "W2"]);
		expect(table.get("W1")?.title).toBe("Poranna joga");
	});
});

describe("checking the etag", () => {
	it("passes when the etag is the stored one", () => {
		const { kernel } = setup();
		expect(() => kernel.checkEtag(joga, "1")).not.toThrow();
	});

	it("passes when there is no stored row yet", () => {
		const { kernel } = setup();
		expect(() => kernel.checkEtag(undefined, "0")).not.toThrow();
	});

	it("refuses a stale etag with a copy of the stored row", () => {
		const { kernel } = setup();
		const stored = structuredClone(joga);
		stored.etag = "5";

		let thrown: unknown;
		try {
			kernel.checkEtag(stored, "4");
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ApiError);
		expect(thrown).toMatchObject({
			kind: "conflict",
			message: "Ktoś inny zapisał ten element w międzyczasie",
			current: stored,
		});
		if (!(thrown instanceof ApiError)) throw new Error("not an ApiError");
		expect(thrown.current).not.toBe(stored);
		// What the client does with its copy never reaches the server's row.
		stored.title = "zmienione później";
		expect(thrown.current).toMatchObject({ title: "Poranna joga" });
	});
});

describe("rejecting content", () => {
	it("does nothing for an empty list of problems", () => {
		const { kernel } = setup();
		expect(() => kernel.reject([])).not.toThrow();
	});

	it("throws a validation error that carries the problems", () => {
		const { kernel } = setup();
		const issues = [
			{ path: "title", message: "Nazwa jest wymagana" },
			{ path: "durationMinutes", message: "Podaj czas trwania" },
		];

		let thrown: unknown;
		try {
			kernel.reject(issues);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ApiError);
		expect(thrown).toMatchObject({
			kind: "validation",
			message: "Nazwa jest wymagana\nPodaj czas trwania",
			issues,
		});
	});
});

describe("a free id", () => {
	it("is the first number nobody uses", () => {
		const { kernel, workouts } = setup();
		expect(kernel.freeId("W", workouts())).toBe("W3");
		expect(kernel.freeId("W", new Map())).toBe("W1");
		expect(kernel.freeId("B", workouts())).toBe("B1");
	});

	it("fills a gap", () => {
		const { kernel } = setup();
		const taken = new Map([
			["M1", null],
			["M2", null],
			["M4", null],
		]);
		expect(kernel.freeId("M", taken)).toBe("M3");
	});
});

describe("a forced failure", () => {
	it("does not happen unless asked for", () => {
		const { kernel } = setup();
		expect(() => kernel.takeFailure()).not.toThrow();
	});

	it("happens once, then the flag is down again", () => {
		const { kernel, controls } = setup({ controls: { failNextSave: true } });

		expect(() => kernel.takeFailure()).toThrow(ApiError);
		expect(controls.get().failNextSave).toBe(false);
		expect(() => kernel.takeFailure()).not.toThrow();
	});

	it("is a server error", () => {
		const { kernel, controls } = setup();
		controls.set((c) => ({ ...c, failNextSave: true }));
		let thrown: unknown;
		try {
			kernel.takeFailure();
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({
			kind: "server",
			message: "Symulowany błąd serwera",
		});
	});
});

describe("a forced concurrent change", () => {
	const change = {
		otherField(stored: Row) {
			stored.equipmentIds = [...stored.equipmentIds, "hantle"];
		},
		sameFields: disagree,
	};

	it("does not happen unless asked for", () => {
		const { kernel } = setup();
		const stored = structuredClone(joga);
		kernel.takeConcurrentChange<Row>(
			stored,
			{ ...joga, title: "Nowa" },
			change,
		);
		expect(stored).toEqual(joga);
	});

	it("changes another field, moves the version, and happens once", () => {
		const { kernel, controls } = setup({
			controls: { conflictNextSave: "otherField" },
		});
		const stored = structuredClone(joga);
		const incoming = { ...joga, title: "Nowa" };

		kernel.takeConcurrentChange<Row>(stored, incoming, change);

		expect(stored).toEqual({
			...joga,
			equipmentIds: ["mata", "hantle"],
			etag: "2",
			updatedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(controls.get().conflictNextSave).toBeNull();

		const after = structuredClone(stored);
		kernel.takeConcurrentChange<Row>(stored, incoming, change);
		expect(stored).toEqual(after);
	});

	it("changes the very field that is being saved", () => {
		const { kernel, controls } = setup({
			controls: { conflictNextSave: "sameFields" },
		});
		const stored = structuredClone(joga);

		kernel.takeConcurrentChange<Row>(
			stored,
			{ ...joga, title: "Nowa" },
			change,
		);

		expect(stored).toMatchObject({
			title: "Poranna joga (inny admin)",
			equipmentIds: ["mata"],
			etag: "2",
		});
		expect(controls.get().conflictNextSave).toBeNull();
		// The save that follows is now stale.
		expect(() => kernel.checkEtag(stored, joga.etag)).toThrow(ApiError);
	});
});

describe("latency", () => {
	it("is none when the controls say so", async () => {
		const { kernel, pauses } = setup();
		await kernel.latency();
		expect(pauses).toEqual([0]);
	});

	it("lies between the two limits", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const { kernel, pauses } = setup({
			controls: { minLatencyMs: 100, maxLatencyMs: 300 },
		});
		await kernel.latency();
		expect(pauses).toEqual([200]);
	});

	it("follows the controls as they change", async () => {
		const { kernel, controls, pauses } = setup();
		controls.set((c) => ({ ...c, minLatencyMs: 80, maxLatencyMs: 80 }));
		await kernel.latency();
		expect(pauses).toEqual([80]);
	});

	it("is the lower limit when the limits are the wrong way round", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		const { kernel, pauses } = setup({
			controls: { minLatencyMs: 250, maxLatencyMs: 50 },
		});
		await kernel.latency();
		expect(pauses).toEqual([250]);
	});
});

describe("keeping the data across a reload", () => {
	it("gives a second kernel on the same storage the saved rows", () => {
		const storage = memoryStorage();
		const before = setup({ storage });
		const saved = before.kernel.store(before.workouts(), {
			...joga,
			title: "Wieczorna joga",
		});

		const after = setup({ storage });
		const table = after.workouts();

		expect(table.get("W1")).toEqual(saved);
		expect(table.get("W2")).toEqual(hiit);
	});

	it("goes on counting versions where the first one stopped", () => {
		const storage = memoryStorage();
		const before = setup({ storage });
		const table = before.workouts();
		before.kernel.store(table, joga);
		const last = before.kernel.store(table, hiit);

		const after = setup({ storage });
		expect(last.etag).toBe("3");
		expect(after.kernel.nextEtag()).toBe("4");
	});

	it("keeps a slot, written with the next save", () => {
		const storage = memoryStorage();
		const before = setup({ storage });
		const promoted = before.kernel.slot<string | null>("promoted", () => null);
		promoted.set("C2");
		expect(promoted.get()).toBe("C2");
		// Nothing is written until something is persisted.
		expect(storage.data.has(SNAPSHOT_KEY)).toBe(false);
		before.kernel.persist();

		const after = setup({ storage });
		expect(after.kernel.slot<string | null>("promoted", () => null).get()).toBe(
			"C2",
		);
		// A slot nobody saved yet starts from its initial value.
		expect(after.kernel.slot("folders", () => ["Wiosna"]).get()).toEqual([
			"Wiosna",
		]);
	});

	it("writes one snapshot with the dataset, the version and every slot", () => {
		const storage = memoryStorage();
		const { kernel, workouts } = setup({ storage });
		const table = workouts();
		kernel.slot("promoted", () => "C1");
		const saved = kernel.store(table, joga);

		expect([...storage.data.keys()]).toEqual([SNAPSHOT_KEY]);
		expect(snapshotIn(storage)).toEqual({
			dataset: "normal",
			version: 2,
			slots: { workouts: [saved, hiit], promoted: "C1" },
		});
	});

	it("starts from the initial rows when the kept slot is not a list", () => {
		const storage = memoryStorage({
			[SNAPSHOT_KEY]: JSON.stringify({
				dataset: "normal",
				version: 9,
				slots: { workouts: { W1: joga } },
			}),
		});
		const { kernel, workouts } = setup({ storage });
		expect([...workouts().keys()]).toEqual(["W1", "W2"]);
		expect(kernel.nextEtag()).toBe("10");
	});

	it("ignores a snapshot of another dataset", () => {
		const storage = memoryStorage();
		const before = setup({ storage });
		before.kernel.store(before.workouts(), { ...joga, title: "Zmieniona" });

		const stress = setup({ storage, controls: { dataset: "stress" } });

		expect(stress.kernel.dataset).toBe("stress");
		expect(stress.workouts().get("W1")).toEqual(joga);
		expect(stress.kernel.nextEtag()).toBe("2");
	});

	it.each([
		["text that is not JSON", "{nie json"],
		["a list", "[1,2,3]"],
		["a number", "42"],
		["a text", '"normal"'],
		["null", "null"],
		["a snapshot without a version", '{"dataset":"normal","slots":{}}'],
		[
			"a snapshot whose version is a text",
			'{"dataset":"normal","version":"7","slots":{"workouts":[]}}',
		],
		[
			"a snapshot whose slots are a list",
			'{"dataset":"normal","version":7,"slots":[]}',
		],
		["a snapshot without slots", '{"dataset":"normal","version":7}'],
	])("ignores %s", (_what, raw) => {
		const storage = memoryStorage({ [SNAPSHOT_KEY]: raw });
		const { kernel, workouts } = setup({ storage });
		expect([...workouts().values()]).toEqual([joga, hiit]);
		expect(kernel.nextEtag()).toBe("2");
	});

	it("ignores the snapshot when it is handed its data", () => {
		const storage = memoryStorage({
			[SNAPSHOT_KEY]: JSON.stringify({
				dataset: "normal",
				version: 9,
				slots: { workouts: [] },
			}),
		});
		const fixtures = buildFixtures("normal");
		const kernel = createKernel({
			fixtures,
			storage,
			controls: createStore<MockControls>(defaultMockControls),
			sleep: async () => {},
		});
		const table = kernel.table<Row>(
			"workouts",
			() => [joga],
			(row) => row.id,
		);
		expect(kernel.seed()).toBe(fixtures);
		expect([...table.keys()]).toEqual(["W1"]);
		expect(kernel.nextEtag()).toBe("2");
	});

	it("works in memory without a storage", () => {
		const { kernel, workouts } = setup({ storage: null });
		const table = workouts();
		expect(() => kernel.persist()).not.toThrow();
		expect(kernel.store(table, joga).etag).toBe("2");
	});
});

describe("a storage that refuses a large write", () => {
	const MARKER = "DUZY-PLIK-BASE64";

	/** Accepts anything except a value that contains an uploaded picture. */
	function smallStorage() {
		const inner = memoryStorage();
		const attempts: boolean[] = [];
		const storage: StorageLike = {
			getItem: inner.getItem,
			removeItem: inner.removeItem,
			setItem(key, value) {
				const tooBig = value.includes(MARKER);
				attempts.push(!tooBig);
				if (tooBig) throw new Error("QuotaExceededError");
				inner.setItem(key, value);
			},
		};
		return { storage, inner, attempts };
	}

	it("writes the snapshot again without what can be dropped", () => {
		const { storage, inner, attempts } = smallStorage();
		const { kernel, workouts } = setup({ storage });
		const table = workouts();
		const uploads = kernel.slot<Record<string, string>>(
			"uploads",
			() => ({}),
			true,
		);
		uploads.set({ "workouts/joga.webp": `data:image/webp;base64,${MARKER}` });

		const saved = kernel.store(table, { ...joga, title: "Wieczorna joga" });

		expect(attempts).toEqual([false, true]);
		expect(snapshotIn(inner)).toEqual({
			dataset: "normal",
			version: 2,
			slots: { workouts: [saved, hiit] },
		});
		// The picture is still there for as long as the page lives.
		expect(uploads.get()).toHaveProperty("workouts/joga.webp");

		const reloaded = setup({ storage });
		expect(reloaded.workouts().get("W1")).toEqual(saved);
		expect(
			reloaded.kernel
				.slot<Record<string, string>>("uploads", () => ({}), true)
				.get(),
		).toEqual({});
	});

	it("keeps droppable slots while they fit", () => {
		const { storage, inner, attempts } = smallStorage();
		const { kernel, workouts } = setup({ storage });
		workouts();
		kernel
			.slot<Record<string, string>>("uploads", () => ({}), true)
			.set({ "badges/maly.webp": "data:image/webp;base64,AAAA" });

		kernel.persist();

		expect(attempts).toEqual([true]);
		expect(snapshotIn(inner)).toMatchObject({
			slots: { uploads: { "badges/maly.webp": "data:image/webp;base64,AAAA" } },
		});
	});

	it("goes on in memory when even the records do not fit", () => {
		const { storage, inner, attempts } = smallStorage();
		const { kernel } = setup({ storage });
		const table = kernel.table<Row>(
			"workouts",
			() => [{ ...joga, title: MARKER }],
			(row) => row.id,
		);

		const saved = kernel.store(table, { ...joga, title: `${MARKER} 2` });

		expect(attempts).toEqual([false, false]);
		expect(inner.data.size).toBe(0);
		expect(table.get("W1")).toEqual(saved);
	});
});
