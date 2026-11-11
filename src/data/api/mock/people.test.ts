import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import { blankBadge } from "@/data/schemas/badge";
import { blankMessage, type Message } from "@/data/schemas/message";
import { USER_SEARCH_LIMIT } from "@/domain/userRules";
import { memoryStorage } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { defaultMockControls, type MockControls } from "./controls";
import { UNKNOWN_FIELD } from "./fixtures";
import { createMockApi } from "./index";
import { SNAPSHOT_KEY } from "./persistence";

// Contract tests for the messages, badges and users sections. Like the ones
// in mock.test.ts they are written against ApiClient only, so they can run
// against the HTTP adapter later.

function setup(overrides: Partial<MockControls> = {}) {
	const controls = createStore<MockControls>({
		...defaultMockControls,
		minLatencyMs: 0,
		maxLatencyMs: 0,
		...overrides,
	});
	const api = createMockApi({ controls, sleep: async () => {}, storage: null });
	return { api, controls };
}

type Api = ReturnType<typeof createMockApi>;

function unknownFieldsOf(value: unknown, found: string[] = []): string[] {
	if (Array.isArray(value)) {
		for (const item of value) unknownFieldsOf(item, found);
	} else if (typeof value === "object" && value !== null) {
		for (const [key, inner] of Object.entries(value)) {
			if (key === UNKNOWN_FIELD) found.push(String(inner));
			else unknownFieldsOf(inner, found);
		}
	}
	return found;
}

const caught = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected a refusal");
		},
		(error: unknown) => error as ApiError,
	);

const issuePaths = async (promise: Promise<unknown>) => {
	const error = await caught(promise);
	expect(error).toBeInstanceOf(ApiError);
	expect(error.kind).toBe("validation");
	return error.issues.map((issue) => issue.path);
};

describe("messages contract", () => {
	const complete = {
		...blankMessage("2026-11-10T09:00:00.000Z"),
		title: "Nowy plan na zimę",
		from: "Codziennie Fit",
		targetGroup: "all",
		fancyContent: [
			{ type: "Title", content: "Zimowa energia", metadata: null },
			{
				type: "Text",
				content: "Cztery tygodnie ruchu w domu.",
				metadata: null,
			},
		],
	};

	async function draftOf(api: Api, status: Message["status"] = "draft") {
		const found = (await api.messages.list()).find((m) => m.status === status);
		if (!found) throw new Error(`no ${status} message in the fixtures`);
		return found;
	}

	const stored = async (api: Api, id: string) => {
		const found = (await api.messages.list()).find((m) => m.id === id);
		if (!found) throw new Error(`message ${id} is gone`);
		return found;
	};

	it("lists messages in every status, with a field this panel does not know at every level", async () => {
		const { api } = setup();
		const messages = await api.messages.list();
		expect(new Set(messages.map((m) => m.status))).toEqual(
			new Set(["draft", "sent", "archived"]),
		);
		expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
		for (const message of messages) {
			const found = unknownFieldsOf(message);
			expect(found).toContain(`message:${message.id}`);
			expect(found.filter((f) => f === "block")).toHaveLength(
				message.fancyContent.length,
			);
			expect(message.status === "draft" ? message.sentAtUtc : "").toBeFalsy();
		}
		expect(messages.flatMap((m) => unknownFieldsOf(m))).toContain("metadata");
	});

	it("uses only target groups the configuration knows", async () => {
		const { api } = setup();
		const config = await api.config.internal();
		const known = new Set(config.draftMessageTargetGroups.map((g) => g.state));
		for (const message of await api.messages.list()) {
			if (message.targetGroup) expect(known).toContain(message.targetGroup);
		}
	});

	it("creates a draft with a new id, whatever else is asked for", async () => {
		const { api } = setup();
		const before = await api.messages.list();
		const created = await api.messages.create({
			...complete,
			// Not part of a create request; a client that sends them anyway
			// must not get a message that is already sent.
			status: "sent",
			sentAtUtc: "2026-01-01T00:00:00.000Z",
		});
		expect(created.id).toMatch(/^M\d+$/);
		expect(before.map((m) => m.id)).not.toContain(created.id);
		expect(created.etag).not.toBe("");
		expect(created).toMatchObject({
			status: "draft",
			sentAtUtc: null,
			archivedAtUtc: null,
			title: complete.title,
			createdAtUtc: complete.createdAtUtc,
		});
		expect(await stored(api, created.id)).toEqual(created);
	});

	it("saves an incomplete draft but needs a description", async () => {
		const { api } = setup();
		const draft = await api.messages.create({
			...blankMessage(),
			title: "Sam pomysł",
		});
		expect(draft.status).toBe("draft");
		expect(
			await issuePaths(api.messages.create({ ...blankMessage(), title: "  " })),
		).toEqual(["title"]);
		expect(
			await issuePaths(
				api.messages.save({ ...draft, title: "" }, { etag: draft.etag }),
			),
		).toEqual(["title"]);
		expect(
			await issuePaths(
				api.messages.save(
					{ ...draft, targetGroup: "vip" },
					{ etag: draft.etag },
				),
			),
		).toEqual(["targetGroup"]);
	});

	it("saves a draft, issues a new etag and keeps unknown fields", async () => {
		const { api } = setup();
		const before = await draftOf(api);
		expect(unknownFieldsOf(before).length).toBeGreaterThan(1);
		const saved = await api.messages.save(
			{ ...before, title: "Zmieniony opis" },
			{ etag: before.etag },
		);
		expect(saved.title).toBe("Zmieniony opis");
		expect(saved.etag).not.toBe(before.etag);
		expect(unknownFieldsOf(saved)).toEqual(unknownFieldsOf(before));
		expect(unknownFieldsOf(await stored(api, before.id))).toEqual(
			unknownFieldsOf(before),
		);
	});

	it("rejects a stale etag with the current version", async () => {
		const { api } = setup();
		const before = await draftOf(api);
		const current = await api.messages.save(
			{ ...before, title: "Pierwszy" },
			{ etag: before.etag },
		);
		const stale = api.messages.save(
			{ ...before, title: "Drugi" },
			{ etag: before.etag },
		);
		await expect(stale).rejects.toMatchObject({ kind: "conflict", current });
		expect((await stored(api, before.id)).title).toBe("Pierwszy");
	});

	it("does not let a save send, archive or re-date a message", async () => {
		const { api } = setup();
		const before = await draftOf(api);
		const saved = await api.messages.save(
			{
				...before,
				status: "sent",
				sentAtUtc: "2026-01-01T00:00:00.000Z",
				createdAtUtc: "2020-01-01T00:00:00.000Z",
			},
			{ etag: before.etag },
		);
		expect(saved).toMatchObject({
			status: "draft",
			sentAtUtc: null,
			createdAtUtc: before.createdAtUtc,
		});
	});

	it("sends a complete draft once", async () => {
		const { api } = setup();
		const draft = await api.messages.create(complete);
		const sent = await api.messages.send(draft.id, { etag: draft.etag });
		expect(sent.status).toBe("sent");
		expect(sent.sentAtUtc).toBeTruthy();
		expect(sent.etag).not.toBe(draft.etag);
		expect(unknownFieldsOf(sent)).toEqual(unknownFieldsOf(draft));

		// The same click again, still holding the version from before: stale.
		await expect(
			api.messages.send(draft.id, { etag: draft.etag }),
		).rejects.toMatchObject({ kind: "conflict", current: sent });
		// And knowingly, with the current version: refused all the same.
		const again = await caught(api.messages.send(sent.id, { etag: sent.etag }));
		expect(again).toMatchObject({
			kind: "validation",
			issues: [{ path: "status", message: "Ta wiadomość została już wysłana" }],
		});
		expect(await stored(api, draft.id)).toEqual(sent);
	});

	it("refuses to send a draft that is not ready, and leaves it a draft", async () => {
		const { api } = setup();
		const idea = await api.messages.create({
			...blankMessage(),
			title: "Sam pomysł",
		});
		expect(
			await issuePaths(api.messages.send(idea.id, { etag: idea.etag })),
		).toEqual(["from", "targetGroup", "fancyContent"]);

		const broken = await api.messages.create({
			...complete,
			fancyContent: [
				{ type: "Title", content: "Sprawdź <i>Pro</i>", metadata: null },
			],
		});
		expect(
			await issuePaths(api.messages.send(broken.id, { etag: broken.etag })),
		).toEqual(["fancyContent"]);
		expect((await stored(api, broken.id)).status).toBe("draft");
		expect((await stored(api, idea.id)).sentAtUtc).toBeNull();
	});

	it("refuses any change to a message that was sent", async () => {
		const { api } = setup();
		const sent = await draftOf(api, "sent");
		const error = await caught(
			api.messages.save({ ...sent, title: "Poprawka" }, { etag: sent.etag }),
		);
		expect(error).toMatchObject({
			kind: "validation",
			issues: [{ path: "status" }],
		});
		expect((await stored(api, sent.id)).title).toBe(sent.title);
	});

	it("archives and brings back, to what the message was before", async () => {
		const { api } = setup();
		const sent = await draftOf(api, "sent");
		const archived = await api.messages.archive(sent.id, { etag: sent.etag });
		expect(archived).toMatchObject({
			status: "archived",
			sentAtUtc: sent.sentAtUtc,
		});
		expect(archived.archivedAtUtc).toBeTruthy();
		expect(
			await issuePaths(api.messages.archive(sent.id, { etag: archived.etag })),
		).toEqual(["status"]);
		expect(
			await issuePaths(api.messages.send(sent.id, { etag: archived.etag })),
		).toEqual(["status"]);
		const back = await api.messages.unarchive(sent.id, {
			etag: archived.etag,
		});
		expect(back).toMatchObject({ status: "sent", archivedAtUtc: null });

		const draft = await api.messages.create(complete);
		const shelved = await api.messages.archive(draft.id, { etag: draft.etag });
		const restored = await api.messages.unarchive(draft.id, {
			etag: shelved.etag,
		});
		expect(restored.status).toBe("draft");
		expect(
			await issuePaths(
				api.messages.unarchive(draft.id, { etag: restored.etag }),
			),
		).toEqual(["status"]);
	});

	it("answers notFound for a message that does not exist", async () => {
		const { api } = setup();
		await expect(
			api.messages.send("M9999", { etag: "1" }),
		).rejects.toMatchObject({ kind: "notFound" });
		const draft = await draftOf(api);
		await expect(
			api.messages.save({ ...draft, id: "M9999" }, { etag: draft.etag }),
		).rejects.toMatchObject({ kind: "notFound" });
	});

	it("fails the next request when told to, without sending anything", async () => {
		const { api, controls } = setup({ failNextSave: true });
		const draft = await api.messages.create(complete).catch(() => null);
		expect(draft).toBeNull();
		expect(controls.get().failNextSave).toBe(false);

		const created = await api.messages.create(complete);
		controls.set((c) => ({ ...c, failNextSave: true }));
		await expect(
			api.messages.send(created.id, { etag: created.etag }),
		).rejects.toMatchObject({ kind: "server" });
		expect((await stored(api, created.id)).status).toBe("draft");
	});

	it("meets someone else's change when told to: on a save and on a send", async () => {
		const { api, controls } = setup({ conflictNextSave: "sameFields" });
		const before = await draftOf(api);
		const error = await caught(
			api.messages.save(
				{ ...before, title: "Mój opis" },
				{ etag: before.etag },
			),
		);
		expect(error.kind).toBe("conflict");
		const current = error.current as Message;
		expect(current.title).not.toBe(before.title);
		expect(current.title).not.toBe("Mój opis");
		expect(controls.get().conflictNextSave).toBeNull();

		controls.set((c) => ({ ...c, conflictNextSave: "otherField" }));
		const created = await api.messages.create(complete);
		// What would be sent is no longer what the person confirmed.
		await expect(
			api.messages.send(created.id, { etag: created.etag }),
		).rejects.toMatchObject({ kind: "conflict" });
		expect((await stored(api, created.id)).status).toBe("draft");
	});
});

describe("badges contract", () => {
	const complete = {
		...blankBadge(),
		name: "Nowa odznaka",
		imageRelativePath: "badges/nowa-odznaka.webp",
	};

	const badgeOf = async (api: Api, id: string) => {
		const found = (await api.badges.list()).find((badge) => badge.id === id);
		if (!found) throw new Error(`badge ${id} is gone`);
		return found;
	};

	it("lists every type, with a field this panel does not know", async () => {
		const { api } = setup();
		const badges = await api.badges.list();
		expect(new Set(badges.map((b) => b.type))).toEqual(
			new Set(["normal", "manual", "milestone", "perfections"]),
		);
		for (const badge of badges) {
			expect(unknownFieldsOf(badge)).toEqual([`badge:${badge.id}`]);
			expect(badge.imageRelativePath).toMatch(/^badges\//);
			expect(badge.etag).not.toBe("");
		}
	});

	it("uses only badge types the configuration knows", async () => {
		const { api } = setup();
		const config = await api.config.internal();
		const known = new Set(config.badgeTypes.map((type) => type.value));
		for (const badge of await api.badges.list()) {
			expect(known).toContain(badge.type);
		}
	});

	it("has a picture in the library for every sample badge", async () => {
		const { api } = setup();
		const paths = new Set((await api.media.list()).map((file) => file.path));
		for (const badge of await api.badges.list()) {
			expect(paths).toContain(badge.imageRelativePath);
		}
	});

	it("assigns the id on create and returns the stored badge", async () => {
		const { api } = setup();
		const before = await api.badges.list();
		const created = await api.badges.create(complete);
		expect(created.id).toMatch(/^n_\d+$/);
		expect(before.map((b) => b.id)).not.toContain(created.id);
		expect(created.etag).not.toBe("");
		expect(created.createdAtUtc).not.toBe("");
		expect(await badgeOf(api, created.id)).toEqual(created);
	});

	it("makes up a claim code for an event badge that has none", async () => {
		const { api } = setup();
		const created = await api.badges.create({
			...complete,
			type: "manual",
			specialCategory: "event",
			isClaimLinkActive: true,
		});
		expect(created.id).toMatch(/^s_\d+$/);
		expect(created.claimToken).toMatch(/^[A-Z0-9]{6,32}$/);
		// A code somebody chose is kept as it is.
		const chosen = await api.badges.create({
			...complete,
			type: "manual",
			specialCategory: "event",
			claimToken: "Wiosna2027",
		});
		expect(chosen.claimToken).toBe("Wiosna2027");
	});

	it("saves a badge, issues a new etag and keeps unknown fields", async () => {
		const { api } = setup();
		const before = await badgeOf(api, "n_2");
		const saved = await api.badges.save(
			{ ...before, name: "Mistrzyni rozciągania", comment: "nowa nazwa" },
			{ etag: before.etag },
		);
		expect(saved).toMatchObject({
			name: "Mistrzyni rozciągania",
			comment: "nowa nazwa",
		});
		expect(saved.etag).not.toBe(before.etag);
		expect(unknownFieldsOf(saved)).toEqual(unknownFieldsOf(before));
		expect(unknownFieldsOf(await badgeOf(api, "n_2"))).toEqual(["badge:n_2"]);
	});

	it("reports validation problems with field paths", async () => {
		const { api } = setup();
		expect(
			await issuePaths(
				api.badges.create({ ...complete, name: "", imageRelativePath: "" }),
			),
		).toEqual(["name", "imageRelativePath"]);
		expect(
			await issuePaths(api.badges.create({ ...complete, type: "milestone" })),
		).toEqual(["type"]);
		const before = await badgeOf(api, "n_2");
		expect(
			await issuePaths(
				api.badges.save({ ...before, type: "manual" }, { etag: before.etag }),
			),
		).toEqual(["type", "specialCategory"]);
	});

	it("refuses a claim code another badge already uses", async () => {
		const { api } = setup();
		const taken = (await badgeOf(api, "s_1")).claimToken;
		const other = await badgeOf(api, "s_2");
		expect(taken).toBeTruthy();
		expect(
			await issuePaths(
				api.badges.save(
					{ ...other, claimToken: taken?.toLowerCase() ?? null },
					{ etag: other.etag },
				),
			),
		).toEqual(["claimToken"]);
		// Its own code is not "taken".
		const own = await badgeOf(api, "s_1");
		await expect(
			api.badges.save(
				{ ...own, comment: "bez zmian kodu" },
				{ etag: own.etag },
			),
		).resolves.toMatchObject({ claimToken: taken });
	});

	it("rejects a stale etag with the current version", async () => {
		const { api } = setup();
		const before = await badgeOf(api, "n_2");
		const current = await api.badges.save(
			{ ...before, name: "Pierwsza zmiana" },
			{ etag: before.etag },
		);
		await expect(
			api.badges.save(
				{ ...before, name: "Druga zmiana" },
				{ etag: before.etag },
			),
		).rejects.toMatchObject({ kind: "conflict", current });
		expect((await badgeOf(api, "n_2")).name).toBe("Pierwsza zmiana");
	});

	it("keeps the section to itself: a save cannot move a badge", async () => {
		const { api } = setup();
		const before = await badgeOf(api, "n_3");
		expect(before.sectionId).toBe("challenges");
		const saved = await api.badges.save(
			{ ...before, sectionId: "gdzie-indziej", subsectionId: null },
			{ etag: before.etag },
		);
		expect(saved).toMatchObject({
			sectionId: before.sectionId,
			subsectionId: before.subsectionId,
		});
	});

	it("will not hide or delete a badge a challenge awards, and says which", async () => {
		const { api } = setup();
		const challenge = (await api.challenges.list()).find(
			(c) => c.badgeId === "n_3",
		);
		if (!challenge) throw new Error("no challenge awards n_3");
		const badge = await badgeOf(api, "n_3");

		const hide = await caught(
			api.badges.save({ ...badge, isHidden: true }, { etag: badge.etag }),
		);
		expect(hide.kind).toBe("validation");
		expect(hide.issues.map((issue) => issue.path)).toEqual(["isHidden"]);
		expect(hide.issues[0]?.message).toContain(challenge.title);

		const remove = await caught(
			api.badges.remove(badge.id, { etag: badge.etag }),
		);
		expect(remove.kind).toBe("validation");
		expect(remove.issues[0]?.message).toContain(challenge.title);
		expect(await badgeOf(api, "n_3")).toEqual(badge);
	});

	it("hides and deletes a badge once nothing awards it", async () => {
		const { api } = setup();
		const challenge = (await api.challenges.list()).find(
			(c) => c.badgeId === "n_3",
		);
		if (!challenge) throw new Error("no challenge awards n_3");
		await api.challenges.save(
			{ ...challenge, badgeId: null },
			{ etag: challenge.etag },
		);
		const badge = await badgeOf(api, "n_3");
		const hidden = await api.badges.save(
			{ ...badge, isHidden: true },
			{ etag: badge.etag },
		);
		expect(hidden.isHidden).toBe(true);

		// A stale version must not delete what someone has just changed.
		await expect(
			api.badges.remove(badge.id, { etag: badge.etag }),
		).rejects.toMatchObject({ kind: "conflict" });
		await api.badges.remove(badge.id, { etag: hidden.etag });
		expect((await api.badges.list()).map((b) => b.id)).not.toContain("n_3");
		await expect(
			api.badges.remove(badge.id, { etag: hidden.etag }),
		).rejects.toMatchObject({ kind: "notFound" });
	});

	it("lets workouts and challenges award only badges that exist now", async () => {
		const { api } = setup();
		const created = await api.badges.create(complete);
		const [workout] = await api.workouts.list();
		if (!workout) throw new Error("no workouts");
		const saved = await api.workouts.save(
			{ ...workout, badgeId: created.id },
			{ etag: workout.etag },
		);
		expect(saved.badgeId).toBe(created.id);

		// Now the new badge is in use, so it cannot be deleted either.
		expect(
			await issuePaths(api.badges.remove(created.id, { etag: created.etag })),
		).toEqual(["id"]);

		const manual = await api.badges.create({
			...complete,
			type: "manual",
			specialCategory: "specialTraining",
		});
		expect(
			await issuePaths(
				api.workouts.save(
					{ ...saved, badgeId: manual.id },
					{ etag: saved.etag },
				),
			),
		).toEqual(["badgeId"]);
	});

	it("fails or meets a conflict when told to", async () => {
		const { api, controls } = setup({ failNextSave: true });
		const before = await badgeOf(api, "n_2");
		await expect(
			api.badges.save({ ...before, name: "Zmiana" }, { etag: before.etag }),
		).rejects.toMatchObject({ kind: "server" });
		expect(await badgeOf(api, "n_2")).toEqual(before);

		controls.set((c) => ({ ...c, conflictNextSave: "otherField" }));
		const error = await caught(
			api.badges.save({ ...before, name: "Zmiana" }, { etag: before.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toMatchObject({
			name: before.name,
			comment: "zmienione przez innego admina",
		});
	});
});

describe("users contract", () => {
	const firstMatch = async (api: Api, query = "anna.testowa") => {
		const [user] = (await api.users.search(query)).users;
		if (!user) throw new Error(`nobody matches ${query}`);
		return user;
	};

	it("returns nobody for a query shorter than three characters", async () => {
		const { api } = setup();
		for (const query of ["", " ", "a", "an", "  an  ", "@e"]) {
			expect(await api.users.search(query)).toMatchObject({
				users: [],
				totalMatches: 0,
				truncated: false,
			});
		}
	});

	it("never returns more than the limit, and says when there is more", async () => {
		const { api } = setup();
		// Every sample address contains this, so it stands for "everyone".
		const everyone = await api.users.search("example.test");
		expect(everyone.users).toHaveLength(USER_SEARCH_LIMIT);
		expect(everyone.totalMatches).toBeGreaterThan(USER_SEARCH_LIMIT);
		expect(everyone.truncated).toBe(true);

		const few = await api.users.search("anna.testowa");
		expect(few.users.length).toBeGreaterThan(0);
		expect(few.users.length).toBeLessThan(USER_SEARCH_LIMIT);
		expect(few).toMatchObject({
			totalMatches: few.users.length,
			truncated: false,
		});
	});

	it("finds people by e-mail, by name and by id", async () => {
		const { api } = setup();
		const user = await firstMatch(api);
		expect(user.email).toContain("anna.testowa");
		const byId = await api.users.search(user.uid);
		expect(byId.users.map((u) => u.uid)).toEqual([user.uid]);
		const byName = await api.users.search("testowa anna");
		expect(byName.users.map((u) => u.uid)).toContain(user.uid);
		expect((await api.users.search("nie ma takiej osoby")).users).toEqual([]);
	});

	it("uses only made-up people", async () => {
		const { api } = setup();
		const { users } = await api.users.search("test-");
		expect(users.length).toBeGreaterThan(0);
		for (const user of users) {
			expect(user.email).toMatch(/@example\.test$/);
			expect(user.uid).toMatch(/^test-/);
			expect(unknownFieldsOf(user)).toHaveLength(1);
		}
	});

	it("returns one account, or notFound", async () => {
		const { api } = setup();
		const user = await firstMatch(api);
		const account = await api.users.get(user.uid);
		expect(account).toMatchObject({ uid: user.uid, email: user.email });
		expect(typeof account.hasProSubscription).toBe("boolean");
		for (const call of [
			api.users.get("test-nikt"),
			api.users.badges("test-nikt"),
			api.users.progress("test-nikt"),
			api.users.changeEmail("test-nikt", "ktos@example.test"),
			api.users.grantBadge("test-nikt", "s_1"),
		]) {
			await expect(call).rejects.toMatchObject({ kind: "notFound" });
		}
	});

	it("changes an e-mail address after checking it", async () => {
		const { api } = setup();
		const user = await firstMatch(api);
		const other = await firstMatch(api, "maria.testowa");
		const change = (email: string) => api.users.changeEmail(user.uid, email);

		expect(await issuePaths(change("to nie adres"))).toEqual(["email"]);
		expect(await issuePaths(change(""))).toEqual(["email"]);
		expect(await issuePaths(change(user.email ?? ""))).toEqual(["email"]);
		expect(await issuePaths(change(other.email?.toUpperCase() ?? ""))).toEqual([
			"email",
		]);
		expect((await api.users.get(user.uid)).email).toBe(user.email);

		const changed = await change("  Anna.Nowa@Example.Test ");
		expect(changed).toMatchObject({
			uid: user.uid,
			email: "anna.nowa@example.test",
			// The new address has not been confirmed by its owner.
			emailVerified: false,
		});
		expect(unknownFieldsOf(changed)).toEqual(unknownFieldsOf(user));
		expect((await api.users.get(user.uid)).email).toBe(
			"anna.nowa@example.test",
		);
		expect(
			(await api.users.search("anna.nowa")).users.map((u) => u.uid),
		).toEqual([user.uid]);
	});

	it("fails an e-mail change when told to, and changes nothing", async () => {
		const { api, controls } = setup();
		const user = await firstMatch(api);
		controls.set((c) => ({ ...c, failNextSave: true }));
		await expect(
			api.users.changeEmail(user.uid, "anna.nowa@example.test"),
		).rejects.toMatchObject({ kind: "server" });
		expect((await api.users.get(user.uid)).email).toBe(user.email);
	});

	it("lists a person's badges, all of them defined", async () => {
		const { api } = setup();
		const defined = new Set((await api.badges.list()).map((b) => b.id));
		const { users } = await api.users.search("example.test");
		const lists = await Promise.all(users.map((u) => api.users.badges(u.uid)));
		expect(lists.some((list) => list.length > 0)).toBe(true);
		for (const list of lists) {
			for (const held of list) expect(defined).toContain(held.badgeId);
			expect(new Set(list.map((h) => h.badgeId)).size).toBe(list.length);
		}
	});

	it("grants a manual badge once and takes it back", async () => {
		const { api } = setup();
		const user = await firstMatch(api, "maria.testowa");
		const before = await api.users.badges(user.uid);
		expect(before.map((h) => h.badgeId)).not.toContain("s_2");

		const after = await api.users.grantBadge(user.uid, "s_2");
		const granted = after.find((h) => h.badgeId === "s_2");
		expect(granted?.grantId).toBeTruthy();
		expect(after).toHaveLength(before.length + 1);
		expect(await api.users.badges(user.uid)).toEqual(after);

		expect(await issuePaths(api.users.grantBadge(user.uid, "s_2"))).toEqual([
			"badgeId",
		]);
		expect(await issuePaths(api.users.grantBadge(user.uid, "n_1"))).toEqual([
			"badgeId",
		]);
		expect(await issuePaths(api.users.grantBadge(user.uid, "brak"))).toEqual([
			"badgeId",
		]);

		if (!granted) throw new Error("the grant is missing");
		expect(await api.users.revokeBadge(user.uid, granted)).toEqual(before);
		await expect(
			api.users.revokeBadge(user.uid, granted),
		).rejects.toMatchObject({ kind: "notFound" });
	});

	it("will not take back a badge the person earned in the app", async () => {
		const { api } = setup();
		const { users } = await api.users.search("example.test");
		for (const user of users) {
			const earned = (await api.users.badges(user.uid)).find(
				(held) => !held.grantId,
			);
			if (!earned) continue;
			expect(await issuePaths(api.users.revokeBadge(user.uid, earned))).toEqual(
				["badgeId"],
			);
			return;
		}
		throw new Error("nobody in the sample has an earned badge");
	});

	it("will not take back someone else's grant", async () => {
		const { api } = setup();
		const giver = await firstMatch(api, "maria.testowa");
		const other = await firstMatch(api, "ewa.testowa");
		const granted = (await api.users.grantBadge(giver.uid, "s_2")).find(
			(h) => h.badgeId === "s_2",
		);
		if (!granted) throw new Error("the grant is missing");
		await expect(
			api.users.revokeBadge(other.uid, granted),
		).rejects.toMatchObject({ kind: "notFound" });
		expect((await api.users.badges(giver.uid)).map((h) => h.badgeId)).toContain(
			"s_2",
		);
	});

	it("reports progress that points at real workouts and challenges", async () => {
		const { api } = setup();
		const workouts = new Set((await api.workouts.list()).map((w) => w.id));
		const challenges = new Set((await api.challenges.list()).map((c) => c.id));
		const { users } = await api.users.search("example.test");
		let seen = 0;
		for (const user of users) {
			const progress = await api.users.progress(user.uid);
			seen += progress.workouts.length + progress.challenges.length;
			for (const done of progress.workouts) {
				expect(workouts).toContain(done.workoutId);
			}
			for (const attempt of progress.challenges) {
				expect(challenges).toContain(attempt.challengeId);
			}
			const dates = progress.workouts.map((w) => w.completedAtUtc);
			expect(dates).toEqual([...dates].sort().reverse());
			// The same person has the same history every time.
			expect(await api.users.progress(user.uid)).toEqual(progress);
		}
		expect(seen).toBeGreaterThan(0);
	});
});

describe("personal data and persistence", () => {
	const open = (storage: ReturnType<typeof memoryStorage>) =>
		createMockApi({
			controls: createStore<MockControls>({
				...defaultMockControls,
				minLatencyMs: 0,
				maxLatencyMs: 0,
			}),
			sleep: async () => {},
			storage,
		});

	it("keeps messages, badges and grants across a reload", async () => {
		const storage = memoryStorage();
		const before = open(storage);
		const draft = await before.messages.create({
			...blankMessage("2026-11-10T09:00:00.000Z"),
			title: "Przed odświeżeniem",
		});
		const badge = await before.badges.create({
			...blankBadge(),
			name: "Trwała odznaka",
			imageRelativePath: "badges/trwala.webp",
		});
		const [user] = (await before.users.search("maria.testowa")).users;
		if (!user) throw new Error("no such sample user");
		const held = await before.users.grantBadge(user.uid, "s_2");

		const after = open(storage);
		expect(await after.messages.list()).toContainEqual(draft);
		expect(await after.badges.list()).toContainEqual(badge);
		expect(await after.users.badges(user.uid)).toEqual(held);
	});

	it("writes no e-mail address and no search query to the browser's storage", async () => {
		const storage = memoryStorage();
		const api = open(storage);
		const [user] = (await api.users.search("maria.testowa")).users;
		if (!user) throw new Error("no such sample user");
		await api.users.get(user.uid);
		await api.users.changeEmail(user.uid, "maria.nowa@example.test");
		await api.users.grantBadge(user.uid, "s_2");
		// A save elsewhere writes the whole snapshot.
		const [workout] = await api.workouts.list();
		if (!workout) throw new Error("no workouts");
		await api.workouts.save(workout, { etag: workout.etag });

		const written = storage.data.get(SNAPSHOT_KEY) ?? "";
		expect(written).not.toBe("");
		// No address at all (every sample one is at example.test), and
		// nothing else that names the person who was looked up.
		expect(written).not.toContain("@");
		expect(written.toLowerCase()).not.toContain("maria");
		expect(written.toLowerCase()).not.toContain("testowa");
	});
});
