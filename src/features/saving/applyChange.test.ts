import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/data/api/errors";
import { toast } from "@/ui/toast";
import {
	applyChange,
	asSent,
	type ChangeResult,
	type ChangeTarget,
	previewChange,
	saveOrToast,
	settleChange,
	toastIssues,
} from "./applyChange";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

interface Row {
	id: string;
	title: string;
	tags: string[];
	extra?: string;
}

function target(row: Row, fail?: unknown) {
	let stored = structuredClone(row);
	const writes: Array<Partial<Row>> = [];
	const api: ChangeTarget<Row> = {
		get: (id) => (id === stored.id ? stored : undefined),
		update: async (_id, apply) => {
			if (fail) throw fail;
			const draft = structuredClone(stored);
			apply(draft);
			const changed: Partial<Row> = {};
			for (const key of Object.keys({ ...stored, ...draft }) as (keyof Row)[]) {
				if (JSON.stringify(stored[key]) !== JSON.stringify(draft[key])) {
					Object.assign(changed, { [key]: draft[key] });
				}
			}
			writes.push(changed);
			stored = draft;
		},
	};
	return { api, writes, read: () => stored };
}

const row: Row = { id: "1", title: "Stary", tags: ["a"], extra: "x" };

describe("applyChange", () => {
	it("saves only the fields that differ", async () => {
		const { api, writes } = target(row);
		const result = await applyChange(api, row, (draft) => {
			draft.title = "Nowy";
			draft.tags = ["a"];
		});
		expect(result).toEqual({ ok: true, changed: true, merged: false });
		expect(writes).toEqual([{ title: "Nowy" }]);
	});

	it("does not save when nothing changed", async () => {
		const { api, writes } = target(row);
		const result = await applyChange(api, row, (draft) => {
			draft.title = "Stary";
		});
		expect(result).toEqual({ ok: true, changed: false, merged: false });
		expect(writes).toEqual([]);
	});

	it("returns the rule problems and saves nothing", async () => {
		const { api, writes } = target(row);
		const result = await applyChange(
			api,
			row,
			(draft) => {
				draft.title = "";
			},
			{
				issuesOf: (candidate) =>
					candidate.title ? [] : [{ path: "title", message: "Brak" }],
			},
		);
		expect(result).toEqual({
			ok: false,
			issues: [{ path: "title", message: "Brak" }],
		});
		expect(writes).toEqual([]);
	});

	it("compares with what is on screen now, not with the copy it was handed", async () => {
		// Someone else's change to another field arrived in the meantime.
		const { api, writes } = target({ ...row, tags: ["a", "b"] });
		await applyChange(api, row, (draft) => {
			draft.title = "Nowy";
		});
		// Only the title goes out; the stale tags of the old copy do not.
		expect(writes[0]).not.toHaveProperty("title", undefined);
		expect(writes[0]?.title).toBe("Nowy");
	});

	it("removes a field the change deleted", async () => {
		const { api, read } = target(row);
		await applyChange(api, row, (draft) => {
			delete draft.extra;
		});
		expect(read()).not.toHaveProperty("extra");
	});

	it("turns a validation refusal from the server into problems", async () => {
		const issues = [{ path: "title", message: "Za krótka" }];
		const { api } = target(
			row,
			new ApiError("validation", "Za krótka", { issues }),
		);
		expect(
			await applyChange(api, row, (draft) => {
				draft.title = "N";
			}),
		).toEqual({ ok: false, issues });
	});

	it("lets a conflict or a failure through to the caller", async () => {
		const { api } = target(row, new ApiError("server", "Serwer nie odpowiada"));
		await expect(
			applyChange(api, row, (draft) => {
				draft.title = "N";
			}),
		).rejects.toThrow("Serwer nie odpowiada");
	});

	it("never mutates the object it was given", async () => {
		const { api } = target(row);
		const before = structuredClone(row);
		await applyChange(api, row, (draft) => {
			draft.tags.push("z");
		});
		expect(row).toEqual(before);
	});
});

describe("settleChange", () => {
	it("hands back the result of a save that went through", async () => {
		const saved: ChangeResult = { ok: true, changed: true, merged: true };
		expect(await settleChange(async () => saved)).toBe(saved);
	});

	it("hands back the problems the rules found", async () => {
		const refused: ChangeResult = {
			ok: false,
			issues: [{ path: "title", message: "Nazwa jest wymagana" }],
		};
		expect(await settleChange(async () => refused)).toBe(refused);
	});

	it("is null when the save stopped on a conflict or a failure", async () => {
		const conflict = new ApiError("conflict", "Ktoś inny zmienił to samo");
		expect(
			await settleChange(async () => {
				throw conflict;
			}),
		).toBeNull();
		expect(await settleChange(() => Promise.reject("sieć"))).toBeNull();
	});

	it("works on a real change", async () => {
		const { api, read } = target(row);
		const result = await settleChange(() =>
			applyChange(api, row, (draft) => {
				draft.title = "Wiosenne wyzwanie";
			}),
		);
		expect(result).toEqual({ ok: true, changed: true, merged: false });
		expect(read().title).toBe("Wiosenne wyzwanie");

		const failing = target(row, new ApiError("server", "Serwer nie odpowiada"));
		expect(
			await settleChange(() =>
				applyChange(failing.api, row, (draft) => {
					draft.title = "Nie dojdzie";
				}),
			),
		).toBeNull();
	});
});

describe("saveOrToast", () => {
	beforeEach(() => {
		vi.mocked(toast).mockClear();
	});

	it("is true when the change was saved, and says nothing itself", async () => {
		const saved = await saveOrToast("Nie można opublikować", async () => ({
			ok: true,
			changed: true,
			merged: false,
		}));
		expect(saved).toBe(true);
		expect(toast).not.toHaveBeenCalled();
	});

	it("is true when there was nothing to change", async () => {
		const { api, writes } = target(row);
		const saved = await saveOrToast("Nie można opublikować", () =>
			applyChange(api, row, (draft) => {
				draft.title = "Stary";
			}),
		);
		expect(saved).toBe(true);
		expect(writes).toEqual([]);
		expect(toast).not.toHaveBeenCalled();
	});

	it("is false and shows the problems when the rules refuse", async () => {
		const { api, writes } = target(row);
		const saving = saveOrToast("Nie można opublikować", () =>
			applyChange(
				api,
				row,
				(draft) => {
					draft.title = "";
					draft.tags = [];
				},
				{
					issuesOf: () => [
						{ path: "title", message: "Nazwa jest wymagana" },
						{ path: "tags", message: "Wybierz cel" },
					],
				},
			),
		);

		await expect(saving).resolves.toBe(false);
		expect(writes).toEqual([]);
		expect(toast).toHaveBeenCalledTimes(1);
		expect(toast).toHaveBeenCalledWith({
			title: "Nie można opublikować",
			description: "Nazwa jest wymagana · Wybierz cel",
			tone: "red",
		});
	});

	it("shows what the server refused as well", async () => {
		const issues = [{ path: "title", message: "Taka nazwa już istnieje" }];
		const { api } = target(
			row,
			new ApiError("validation", "Taka nazwa już istnieje", { issues }),
		);
		const saved = await saveOrToast("Nie udało się zmienić nazwy", () =>
			applyChange(api, row, (draft) => {
				draft.title = "Poranna joga";
			}),
		);
		expect(saved).toBe(false);
		expect(toast).toHaveBeenCalledWith({
			title: "Nie udało się zmienić nazwy",
			description: "Taka nazwa już istnieje",
			tone: "red",
		});
	});

	it("is false and silent when the save throws", async () => {
		const { api } = target(row, new ApiError("server", "Serwer nie odpowiada"));
		const saving = saveOrToast("Nie można opublikować", () =>
			applyChange(api, row, (draft) => {
				draft.title = "Nie dojdzie";
			}),
		);
		// The saver holds the edits and HeldEditsNotice explains.
		await expect(saving).resolves.toBe(false);
		expect(toast).not.toHaveBeenCalled();
	});
});

describe("toastIssues", () => {
	beforeEach(() => {
		vi.mocked(toast).mockClear();
	});

	it("lists at most four problems in one red toast", () => {
		toastIssues(
			"Nie można wysłać",
			["Brak tytułu", "Brak nadawcy", "Brak grupy", "Brak treści", "Piąty"].map(
				(message, index) => ({ path: `pole${index}`, message }),
			),
		);
		expect(toast).toHaveBeenCalledTimes(1);
		expect(toast).toHaveBeenCalledWith({
			title: "Nie można wysłać",
			description: "Brak tytułu · Brak nadawcy · Brak grupy · Brak treści",
			tone: "red",
		});
	});
});

describe("previewChange", () => {
	it("shows the server's version and the entity with the change applied", () => {
		const { api, writes } = target(row);
		const versions = previewChange(api, row, (draft) => {
			draft.title = "Nowy";
		});
		expect(versions).toEqual({
			before: row,
			after: { ...row, title: "Nowy" },
		});
		// Looking is not saving.
		expect(writes).toEqual([]);
	});

	it("takes 'before' from the server, not from edits still on screen", () => {
		const onScreen: Row = { ...row, title: "Na ekranie" };
		const api: ChangeTarget<Row> = {
			get: () => onScreen,
			saved: () => row,
			update: async () => {},
		};
		const versions = previewChange(api, onScreen, (draft) => {
			draft.tags = ["a", "b"];
		});
		expect(versions.before).toEqual(row);
		expect(versions.after).toEqual({ ...onScreen, tags: ["a", "b"] });
	});

	it("keeps a field this build does not know on both sides", () => {
		const withUnknown = { ...row, x_addedByNewerBackend: "zostaje" };
		const { api } = target(withUnknown);
		const versions = previewChange(api, withUnknown, (draft) => {
			draft.title = "Nowy";
		});
		expect(versions.before).toMatchObject({ x_addedByNewerBackend: "zostaje" });
		expect(versions.after).toMatchObject({ x_addedByNewerBackend: "zostaje" });
	});

	it("leaves the entity it was given untouched", () => {
		const { api } = target(row);
		const copy = structuredClone(row);
		previewChange(api, row, (draft) => {
			draft.tags.push("b");
		});
		expect(row).toEqual(copy);
	});

	it("leaves out the collection's own bookkeeping, which is never sent", () => {
		const marked = {
			...row,
			$key: "1",
			$origin: "remote",
			$hasPendingWrites: false,
			$collectionId: "rows",
		};
		const { api } = target(marked);
		const versions = previewChange(api, marked, (draft) => {
			draft.title = "Nowy";
		});
		expect(versions.before).toEqual(row);
		expect(versions.after).toEqual({ ...row, title: "Nowy" });
	});
});

describe("asSent", () => {
	it("drops only the library's top-level marks", () => {
		expect(
			asSent({ id: "1", $key: "1", price: "$5", nested: { $ref: "kept" } }),
		).toEqual({ id: "1", price: "$5", nested: { $ref: "kept" } });
	});
});
