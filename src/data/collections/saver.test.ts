import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import type { SaveOptions } from "@/data/api/types";
import { createSaver, type Versioned } from "./saver";

// The saver against a small pretend server: rows with etags, a stale etag
// answered with a conflict that carries the current row. No collection, no
// clock: `sleep` only records how long the saver wanted to wait.

const UNKNOWN = "x_addedByNewerBackend";
const ID = "C1";

interface PlanDay {
	dayIndex: number;
	workoutIds: string[];
	[key: string]: unknown;
}

interface Doc extends Versioned {
	title: string;
	subtitle: string;
	lengthDays: number;
	goalsIds: string[];
	settings: { color: string; [key: string]: unknown };
	paths: Array<{
		pathId: string;
		levelId: string;
		days: PlanDay[];
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

const wiosna: Doc = {
	id: ID,
	etag: "1",
	title: "Wiosenne wyzwanie biegowe",
	subtitle: "Cztery tygodnie do pierwszych 5 km",
	lengthDays: 28,
	goalsIds: ["kondycja"],
	settings: { color: "#3b82f6" },
	paths: [
		{
			pathId: "p-easy",
			levelId: "beginner",
			days: [
				{ dayIndex: 1, workoutIds: ["W1"] },
				{ dayIndex: 2, workoutIds: [] },
			],
		},
	],
};

const networkDown = () => new ApiError("network", "Brak połączenia");
const serverDown = () => new ApiError("server", "Serwer nie odpowiada");

/** Lets everything that is not waiting on a gate run. */
async function tick() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup(initial: Doc = wiosna) {
	const rows = new Map<string, Doc>([[initial.id, structuredClone(initial)]]);
	let version = Number(initial.etag);
	const sent: Array<{ item: Doc; etag: string }> = [];
	const failures: unknown[] = [];
	const pauses: number[] = [];
	const written: Doc[] = [];
	const updates: Doc[] = [];
	const collection = new Map<string, Doc>([
		[initial.id, structuredClone(initial)],
	]);
	const screen = new Map<string, Doc>();
	const world: {
		/** Something another admin does just before each save arrives. */
		beforeSave: (() => void) | null;
		/** While set, a save that reached the server does not answer. */
		gate: Promise<void> | null;
	} = { beforeSave: null, gate: null };

	function stored(): Doc {
		const row = rows.get(ID);
		if (!row) throw new Error("the row is gone from the server");
		return structuredClone(row);
	}

	/** Another admin saves a change; returns the row as it is afterwards. */
	function otherAdmin(change: (row: Doc) => void): Doc {
		const row = stored();
		change(row);
		row.etag = String(++version);
		rows.set(row.id, row);
		return structuredClone(row);
	}

	const saver = createSaver<Doc>({
		async save(item: Doc, options: SaveOptions) {
			sent.push({ item: structuredClone(item), etag: options.etag });
			if (world.gate) await world.gate;
			world.beforeSave?.();
			const failure = failures.shift();
			if (failure !== undefined) throw failure;
			const current = rows.get(item.id);
			if (current && current.etag !== options.etag) {
				throw new ApiError<Doc>(
					"conflict",
					"Ktoś inny zapisał ten element w międzyczasie",
					{ current: structuredClone(current) },
				);
			}
			const saved = { ...structuredClone(item), etag: String(++version) };
			rows.set(saved.id, saved);
			return structuredClone(saved);
		},
		writeBack(item) {
			written.push(structuredClone(item));
			collection.set(item.id, structuredClone(item));
		},
		readVisible: (id) => screen.get(id),
		// What the collection does with a user edit: change the row, then save
		// it through the same saver.
		async update(id, change) {
			const before = collection.get(id);
			if (!before) throw new Error(`no row ${id} in the collection`);
			const draft = structuredClone(before);
			change(draft);
			updates.push(structuredClone(draft));
			await saver.persist(before, draft);
		},
		sleep: async (ms) => {
			pauses.push(ms);
		},
	});

	const phase = () => saver.status.get()[ID];

	return {
		saver,
		sent,
		failures,
		pauses,
		written,
		updates,
		screen,
		world,
		stored,
		otherAdmin,
		phase,
	};
}

function gate() {
	let open: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { open, waiting };
}

describe("a plain save", () => {
	it("sends the user's change with the latest etag and ends saved", async () => {
		const { saver, sent, written, stored, phase } = setup();
		saver.remember([wiosna]);
		const mine = { ...wiosna, title: "Wiosenne wyzwanie biegowe 2026" };

		await saver.persist(wiosna, mine);

		expect(sent).toEqual([{ item: mine, etag: "1" }]);
		expect(stored()).toEqual({ ...mine, etag: "2" });
		expect(written).toEqual([{ ...mine, etag: "2" }]);
		expect(phase()).toEqual({
			phase: "saved",
			at: expect.any(Number),
			mergedWithOthers: false,
		});
		expect(saver.held.get()).toBeNull();
	});

	it("starts from the base when the server version was never remembered", async () => {
		const { saver, sent, phase } = setup();
		await saver.persist(wiosna, { ...wiosna, lengthDays: 21 });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.etag).toBe("1");
		expect(sent[0]?.item.lengthDays).toBe(21);
		expect(phase()).toMatchObject({ phase: "saved", mergedWithOthers: false });
	});

	it("shows saving while the request is on its way", async () => {
		const { saver, world, phase } = setup();
		const { open, waiting } = gate();
		world.gate = waiting;
		expect(phase()).toBeUndefined();

		const saving = saver.persist(wiosna, { ...wiosna, title: "W drodze" });
		await tick();
		expect(phase()).toEqual({ phase: "saving" });

		open();
		await saving;
		expect(phase()).toMatchObject({ phase: "saved" });
	});

	it("keeps the status of every entity apart", async () => {
		const { saver } = setup();
		saver.markDirty("C2");
		await saver.persist(wiosna, { ...wiosna, title: "Tylko ten" });
		expect(saver.status.get().C2).toEqual({ phase: "dirty" });
		expect(saver.status.get()[ID]).toMatchObject({ phase: "saved" });
	});
});

describe("fields this build does not know", () => {
	it("are sent back when the screen's copy carries them", async () => {
		const base: Doc = {
			...wiosna,
			[UNKNOWN]: "zostaw mnie",
			settings: { color: "#3b82f6", [UNKNOWN]: { od: "backendu" } },
		};
		const { saver, sent, stored } = setup(base);
		saver.remember([base]);

		await saver.persist(base, { ...base, subtitle: "Nowy podtytuł" });

		expect(sent[0]?.item[UNKNOWN]).toBe("zostaw mnie");
		expect(sent[0]?.item.settings[UNKNOWN]).toEqual({ od: "backendu" });
		expect(stored()[UNKNOWN]).toBe("zostaw mnie");
		expect(stored().settings[UNKNOWN]).toEqual({ od: "backendu" });
	});

	it("survive when only the server's version has them, at every level", async () => {
		const { saver, sent, stored, otherAdmin } = setup();
		// A newer backend started returning fields the open editor never saw.
		const theirs = otherAdmin((row) => {
			row[UNKNOWN] = "challenge";
			row.settings[UNKNOWN] = "settings";
			const path = row.paths[0];
			const day = path?.days[1];
			if (!path || !day) throw new Error("sample data has no second day");
			path[UNKNOWN] = "path";
			day[UNKNOWN] = "day";
			day.workoutIds = ["W7"];
		});
		saver.remember([theirs]);

		const mine = structuredClone(wiosna);
		mine.title = "Wiosna w biegu";
		mine.settings.color = "#16a34a";
		mine.paths[0]?.days[0]?.workoutIds.push("W3");
		await saver.persist(wiosna, mine);

		const item = sent[0]?.item;
		expect(item?.[UNKNOWN]).toBe("challenge");
		expect(item?.settings).toEqual({ color: "#16a34a", [UNKNOWN]: "settings" });
		expect(item?.paths[0]?.[UNKNOWN]).toBe("path");
		expect(item?.paths[0]?.days).toEqual([
			{ dayIndex: 1, workoutIds: ["W1", "W3"] },
			{ dayIndex: 2, workoutIds: ["W7"], [UNKNOWN]: "day" },
		]);
		expect(item?.title).toBe("Wiosna w biegu");
		expect(stored()).toEqual({ ...item, etag: "3" });
	});
});

describe("a change someone else made to another field", () => {
	it("is merged when the collection had already fetched it", async () => {
		const { saver, sent, otherAdmin, stored, phase } = setup();
		const theirs = otherAdmin((row) => {
			row.subtitle = "Podtytuł od Patryka";
		});
		saver.remember([theirs]);

		await saver.persist(wiosna, { ...wiosna, title: "Mój tytuł" });

		expect(sent).toHaveLength(1);
		expect(sent[0]?.etag).toBe("2");
		expect(sent[0]?.item).toMatchObject({
			title: "Mój tytuł",
			subtitle: "Podtytuł od Patryka",
		});
		expect(stored()).toMatchObject({
			title: "Mój tytuł",
			subtitle: "Podtytuł od Patryka",
			etag: "3",
		});
		expect(phase()).toMatchObject({ phase: "saved", mergedWithOthers: true });
		expect(saver.held.get()).toBeNull();
	});

	it("is merged when the server answers with a conflict", async () => {
		const { saver, sent, otherAdmin, stored, written, phase, pauses } = setup();
		saver.remember([wiosna]);
		otherAdmin((row) => {
			row.goalsIds = ["kondycja", "redukcja"];
		});

		await saver.persist(wiosna, { ...wiosna, title: "Mój tytuł" });

		expect(sent.map((request) => request.etag)).toEqual(["1", "2"]);
		expect(sent[0]?.item.goalsIds).toEqual(["kondycja"]);
		expect(sent[1]?.item).toMatchObject({
			title: "Mój tytuł",
			goalsIds: ["kondycja", "redukcja"],
		});
		expect(stored()).toMatchObject({
			title: "Mój tytuł",
			goalsIds: ["kondycja", "redukcja"],
			etag: "3",
		});
		// Only the confirmed result reaches the collection, and at once.
		expect(written).toEqual([stored()]);
		expect(pauses).toEqual([]);
		expect(phase()).toMatchObject({ phase: "saved", mergedWithOthers: true });
	});

	it("is merged day by day inside the same variant", async () => {
		const { saver, sent, otherAdmin } = setup();
		otherAdmin((row) => {
			const day = row.paths[0]?.days[1];
			if (day) day.workoutIds = ["W9"];
		});
		const mine = structuredClone(wiosna);
		mine.paths[0]?.days[0]?.workoutIds.unshift("W4");

		await saver.persist(wiosna, mine);

		expect(sent[1]?.item.paths[0]?.days).toEqual([
			{ dayIndex: 1, workoutIds: ["W4", "W1"] },
			{ dayIndex: 2, workoutIds: ["W9"] },
		]);
	});

	it("counts as merged, without a clash, when both wrote the same value", async () => {
		const { saver, otherAdmin, phase } = setup();
		const theirs = otherAdmin((row) => {
			row.lengthDays = 30;
		});
		saver.remember([theirs]);
		await saver.persist(wiosna, { ...wiosna, lengthDays: 30 });
		// The etag moved, so the save did build on someone else's version.
		expect(phase()).toMatchObject({ phase: "saved", mergedWithOthers: true });
		expect(saver.held.get()).toBeNull();
	});
});

describe("a change someone else made to the same field", () => {
	it("stops the save and hands both versions to the user", async () => {
		const { saver, sent, otherAdmin, written, stored, phase } = setup();
		const theirs = otherAdmin((row) => {
			row.title = "Tytuł Patryka";
		});
		saver.remember([theirs]);
		const mine = { ...wiosna, title: "Mój tytuł", lengthDays: 21 };

		const saving = saver.persist(wiosna, mine);

		await expect(saving).rejects.toBeInstanceOf(ApiError);
		await expect(saving).rejects.toMatchObject({
			kind: "conflict",
			message: "Ktoś inny zmienił to samo w międzyczasie",
			current: theirs,
		});
		expect(sent).toEqual([]);
		expect(stored().title).toBe("Tytuł Patryka");
		expect(saver.held.get()).toEqual({
			id: ID,
			reason: "conflict",
			base: wiosna,
			mine,
			theirs,
			conflicts: ["title"],
			message: "Ktoś inny zmienił to samo w międzyczasie",
		});
		expect(phase()).toEqual({ phase: "conflict" });
		expect(written).toEqual([theirs]);
	});

	it("is found from the server's conflict answer too", async () => {
		const { saver, sent, otherAdmin, written, phase } = setup();
		saver.remember([wiosna]);
		const theirs = otherAdmin((row) => {
			row.title = "Tytuł Patryka";
		});

		await expect(
			saver.persist(wiosna, { ...wiosna, title: "Mój tytuł" }),
		).rejects.toMatchObject({ kind: "conflict", current: theirs });

		expect(sent).toHaveLength(1);
		expect(saver.held.get()).toMatchObject({
			reason: "conflict",
			theirs,
			conflicts: ["title"],
		});
		expect(written).toEqual([theirs]);
		expect(phase()).toEqual({ phase: "conflict" });
	});

	it("names every clashing place, nested ones by their identity", async () => {
		const { saver, otherAdmin } = setup();
		const theirs = otherAdmin((row) => {
			row.subtitle = "Ich podtytuł";
			row.settings.color = "#dc2626";
			const day = row.paths[0]?.days[0];
			if (day) day.workoutIds = ["W2"];
		});
		saver.remember([theirs]);
		const mine = structuredClone(wiosna);
		mine.subtitle = "Mój podtytuł";
		mine.settings.color = "#16a34a";
		mine.paths[0]?.days[0]?.workoutIds.push("W5");

		await expect(saver.persist(wiosna, mine)).rejects.toMatchObject({
			kind: "conflict",
		});
		expect(saver.held.get()?.conflicts.toSorted()).toEqual([
			"paths[p-easy].days[1].workoutIds",
			"settings.color",
			"subtitle",
		]);
	});

	it("keeps later edits that are still on screen", async () => {
		const { saver, otherAdmin, screen } = setup();
		const theirs = otherAdmin((row) => {
			row.title = "Tytuł Patryka";
		});
		saver.remember([theirs]);
		const mine = { ...wiosna, title: "Mój tytuł" };
		const typedSince = { ...mine, subtitle: "Dopisane po zapisie" };
		screen.set(ID, typedSince);

		await expect(saver.persist(wiosna, mine)).rejects.toMatchObject({
			kind: "conflict",
		});
		expect(saver.held.get()?.mine).toEqual(typedSince);
	});
});

describe("a save that fails", () => {
	it("is tried again after a network or server error", async () => {
		const { saver, sent, failures, pauses, stored, phase } = setup();
		failures.push(networkDown(), serverDown());

		await saver.persist(wiosna, { ...wiosna, title: "Za trzecim razem" });

		expect(sent).toHaveLength(3);
		expect(new Set(sent.map((request) => request.etag))).toEqual(
			new Set(["1"]),
		);
		expect(pauses).toEqual([300, 600]);
		expect(stored().title).toBe("Za trzecim razem");
		expect(phase()).toMatchObject({ phase: "saved", mergedWithOthers: false });
		expect(saver.held.get()).toBeNull();
	});

	it("gives up after the retries and keeps the edits", async () => {
		const { saver, sent, failures, pauses, written, stored, phase } = setup();
		const last = networkDown();
		failures.push(serverDown(), serverDown(), last);
		const mine = { ...wiosna, title: "Nie dojdzie" };

		await expect(saver.persist(wiosna, mine)).rejects.toBe(last);

		expect(sent).toHaveLength(3);
		expect(pauses).toEqual([300, 600]);
		expect(stored().title).toBe(wiosna.title);
		expect(saver.held.get()).toEqual({
			id: ID,
			reason: "error",
			base: wiosna,
			mine,
			theirs: wiosna,
			conflicts: [],
			message: "Brak połączenia",
		});
		expect(phase()).toEqual({ phase: "error", message: "Brak połączenia" });
		expect(written).toEqual([wiosna]);
	});

	it("is not tried again for an error that would repeat", async () => {
		const { saver, sent, failures, pauses, phase } = setup();
		failures.push(new ApiError("forbidden", "Brak uprawnień"));

		await expect(
			saver.persist(wiosna, { ...wiosna, title: "Nie wolno" }),
		).rejects.toMatchObject({ kind: "forbidden" });

		expect(sent).toHaveLength(1);
		expect(pauses).toEqual([]);
		expect(saver.held.get()).toMatchObject({
			reason: "error",
			message: "Brak uprawnień",
		});
		expect(phase()).toEqual({ phase: "error", message: "Brak uprawnień" });
	});

	it("explains a failure that has no text of its own", async () => {
		const { saver, sent, failures, phase } = setup();
		failures.push("coś pękło");

		await expect(
			saver.persist(wiosna, { ...wiosna, title: "Bez opisu" }),
		).rejects.toBe("coś pękło");

		expect(sent).toHaveLength(1);
		expect(saver.held.get()?.message).toBe("Nie udało się zapisać");
		expect(phase()).toEqual({
			phase: "error",
			message: "Nie udało się zapisać",
		});
	});

	it("holds a conflict that came without the current version as an error", async () => {
		const { saver, sent, failures } = setup();
		failures.push(new ApiError("conflict", "Wersja nieaktualna"));

		await expect(
			saver.persist(wiosna, { ...wiosna, title: "Bez aktualnej wersji" }),
		).rejects.toMatchObject({ kind: "conflict" });

		expect(sent).toHaveLength(1);
		expect(saver.held.get()).toMatchObject({
			reason: "error",
			conflicts: [],
			message: "Wersja nieaktualna",
		});
	});

	it("rethrows a validation refusal and holds nothing", async () => {
		const { saver, sent, failures, written, pauses, phase } = setup();
		const refusal = new ApiError("validation", "Nazwa jest wymagana", {
			issues: [{ path: "title", message: "Nazwa jest wymagana" }],
		});
		failures.push(refusal);

		await expect(saver.persist(wiosna, { ...wiosna, title: " " })).rejects.toBe(
			refusal,
		);

		expect(sent).toHaveLength(1);
		expect(pauses).toEqual([]);
		expect(saver.held.get()).toBeNull();
		expect(written).toEqual([]);
		expect(phase()).toEqual({ phase: "idle" });
	});

	it("gives up when the server keeps answering with a conflict", async () => {
		const { saver, sent, world, otherAdmin, written, stored, phase } = setup();
		let round = 0;
		// Someone saves an unrelated field just before every attempt.
		world.beforeSave = () => {
			otherAdmin((row) => {
				row.subtitle = `Poprawka nr ${++round}`;
			});
		};
		const mine = { ...wiosna, title: "Nie nadążam" };

		const failure = await saver.persist(wiosna, mine).catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(ApiError);
		expect(failure).toMatchObject({
			kind: "conflict",
			message: "Zbyt wiele równoczesnych zmian, spróbuj ponownie",
			current: stored(),
		});
		expect(sent.map((request) => request.etag)).toEqual(["1", "2", "3", "4"]);
		expect(stored().title).toBe(wiosna.title);
		expect(saver.held.get()).toEqual({
			id: ID,
			reason: "error",
			base: wiosna,
			mine,
			theirs: stored(),
			conflicts: [],
			message: "Zbyt wiele równoczesnych zmian, spróbuj ponownie",
		});
		expect(phase()).toEqual({
			phase: "error",
			message: "Zbyt wiele równoczesnych zmian, spróbuj ponownie",
		});
		expect(written).toEqual([stored()]);
	});
});

describe("saves of the same entity", () => {
	it("run one after another, the second on the etag of the first", async () => {
		const { saver, sent, world, stored } = setup();
		saver.remember([wiosna]);
		const { open, waiting } = gate();
		world.gate = waiting;
		const first = { ...wiosna, title: "Pierwsza zmiana" };
		const second = { ...first, subtitle: "Druga zmiana" };

		const saving = Promise.all([
			saver.persist(wiosna, first),
			saver.persist(first, second),
		]);
		await tick();
		// The second has not left: the first is still unanswered.
		expect(sent).toHaveLength(1);

		open();
		await saving;

		expect(sent.map((request) => request.etag)).toEqual(["1", "2"]);
		expect(sent[1]?.item).toMatchObject({
			title: "Pierwsza zmiana",
			subtitle: "Druga zmiana",
		});
		expect(stored()).toMatchObject({
			title: "Pierwsza zmiana",
			subtitle: "Druga zmiana",
			etag: "3",
		});
	});

	it("do not wait for each other across entities", async () => {
		const lato: Doc = { ...wiosna, id: "C2", title: "Letnie wyzwanie" };
		const { saver, sent, world } = setup();
		const { open, waiting } = gate();
		world.gate = waiting;

		const saving = Promise.all([
			saver.persist(wiosna, { ...wiosna, title: "Wiosna" }),
			saver.persist(lato, { ...lato, title: "Lato" }),
		]);
		await tick();
		expect(sent.map((request) => request.item.id)).toEqual([ID, "C2"]);

		open();
		await saving;
	});

	it("go on after one of them failed", async () => {
		const { saver, sent, failures, stored, phase } = setup();
		failures.push(new ApiError("validation", "Nazwa jest wymagana"));

		const first = saver.persist(wiosna, { ...wiosna, title: "" });
		const second = saver.persist(wiosna, { ...wiosna, title: "Poprawiony" });

		await expect(first).rejects.toMatchObject({ kind: "validation" });
		await expect(second).resolves.toBeUndefined();
		expect(sent.map((request) => request.item.title)).toEqual([
			"",
			"Poprawiony",
		]);
		expect(stored().title).toBe("Poprawiony");
		expect(phase()).toMatchObject({ phase: "saved" });
	});
});

describe("markDirty", () => {
	it("marks an entity nobody saved yet", () => {
		const { saver, phase } = setup();
		saver.markDirty(ID);
		expect(phase()).toEqual({ phase: "dirty" });
	});

	it("does not overwrite saving", async () => {
		const { saver, world, phase } = setup();
		const { open, waiting } = gate();
		world.gate = waiting;
		const saving = saver.persist(wiosna, { ...wiosna, title: "W drodze" });
		await tick();

		saver.markDirty(ID);
		expect(phase()).toEqual({ phase: "saving" });

		open();
		await saving;
		expect(phase()).toMatchObject({ phase: "saved" });
		saver.markDirty(ID);
		expect(phase()).toEqual({ phase: "dirty" });
	});
});

describe("held edits", () => {
	/** The title clashes; the length is this user's alone. */
	async function clash(mine: Doc) {
		const context = setup();
		const theirs = context.otherAdmin((row) => {
			row.title = "Tytuł Patryka";
			row.goalsIds = ["siła"];
		});
		context.saver.remember([theirs]);
		await expect(context.saver.persist(wiosna, mine)).rejects.toMatchObject({
			kind: "conflict",
		});
		return { ...context, theirs };
	}

	it("put back with 'mine' let this user's value win the clash", async () => {
		const mine = { ...wiosna, title: "Mój tytuł", lengthDays: 21 };
		const { saver, updates, stored, phase, theirs } = await clash(mine);

		await saver.reapplyHeld("mine");

		expect(updates).toEqual([
			{ ...theirs, title: "Mój tytuł", lengthDays: 21 },
		]);
		expect(stored()).toMatchObject({
			title: "Mój tytuł",
			lengthDays: 21,
			goalsIds: ["siła"],
		});
		expect(saver.held.get()).toBeNull();
		expect(phase()).toMatchObject({ phase: "saved" });
	});

	it("put back with 'theirs' keep only what did not clash", async () => {
		const mine = { ...wiosna, title: "Mój tytuł", lengthDays: 21 };
		const { saver, updates, stored, theirs } = await clash(mine);

		await saver.reapplyHeld("theirs");

		expect(updates).toEqual([{ ...theirs, lengthDays: 21 }]);
		expect(stored()).toMatchObject({
			title: "Tytuł Patryka",
			lengthDays: 21,
			goalsIds: ["siła"],
		});
		expect(saver.held.get()).toBeNull();
	});

	it("change nothing when taking theirs leaves no difference", async () => {
		const mine = { ...wiosna, title: "Mój tytuł" };
		const { saver, updates, sent, phase } = await clash(mine);

		await saver.reapplyHeld("theirs");

		expect(updates).toEqual([]);
		expect(sent).toEqual([]);
		expect(saver.held.get()).toBeNull();
		expect(phase()).toEqual({ phase: "idle" });
	});

	it("go on top of a version fetched after the save stopped", async () => {
		const mine = { ...wiosna, title: "Mój tytuł", lengthDays: 21 };
		const { saver, updates, otherAdmin, written } = await clash(mine);
		const newer = otherAdmin((row) => {
			row.subtitle = "Jeszcze jedna poprawka";
		});
		saver.remember([newer]);

		await saver.reapplyHeld("theirs");

		// The row in the collection is still the version written back when
		// the save stopped; the edits are worked out against the newer one.
		expect(updates).toEqual([
			{
				...written[0],
				lengthDays: 21,
				subtitle: "Jeszcze jedna poprawka",
				etag: newer.etag,
			},
		]);
	});

	it("are saved again after a failure", async () => {
		const { saver, failures, updates, stored, phase } = setup();
		failures.push(new ApiError("forbidden", "Sesja wygasła"));
		const mine = { ...wiosna, subtitle: "Druga próba" };
		await expect(saver.persist(wiosna, mine)).rejects.toMatchObject({
			kind: "forbidden",
		});

		await saver.reapplyHeld("mine");

		expect(updates).toEqual([mine]);
		expect(stored().subtitle).toBe("Druga próba");
		expect(saver.held.get()).toBeNull();
		expect(phase()).toMatchObject({ phase: "saved" });
	});

	it("can be thrown away", async () => {
		const mine = { ...wiosna, title: "Mój tytuł", lengthDays: 21 };
		const { saver, updates, sent, stored, phase } = await clash(mine);

		saver.dismissHeld();

		expect(saver.held.get()).toBeNull();
		expect(phase()).toEqual({ phase: "idle" });
		expect(updates).toEqual([]);
		expect(sent).toEqual([]);
		expect(stored()).toMatchObject({ title: "Tytuł Patryka", lengthDays: 28 });
	});

	it("do nothing when there are none", async () => {
		const { saver, updates } = setup();
		let notified = 0;
		saver.status.subscribe(() => notified++);

		await saver.reapplyHeld("mine");
		saver.dismissHeld();

		expect(updates).toEqual([]);
		expect(notified).toBe(0);
		expect(saver.status.get()).toEqual({});
	});
});
