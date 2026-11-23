import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import {
	blankMessage,
	type Message,
	type NewMessage,
} from "@/data/schemas/message";
import {
	fromMessage,
	messagesArea,
	messageVersion,
	toMessage,
} from "./messages";
import {
	capabilities,
	conflictReply,
	errorReply,
	failure,
	fakeBackend,
	json,
	notFoundReply,
	panelMessage,
	production,
	type Recorded,
	SWITCHED_OFF,
	tableEtag,
	validationReply,
	wireMessage,
} from "./testSupport";

// Rows and answers below follow `manageMessageDrafts` as it is today
// (docs/research/backend-audit.md §1a, §4a, §4f).

const ID = "2516735103999999999";
const CREATED = "2026-11-01T09:00:00.000Z";

const bodyOf = (request: Recorded) => request.body as Record<string, unknown>;

/** `{ count, messages }`, the answer of `manageMessageDrafts/list`. */
const listOf = (...messages: Record<string, unknown>[]) =>
	json({ count: messages.length, messages });

/**
 * DraftMessageDetailAdminResponseDto: the same message as an action answers
 * with it. Same content as the list row, other order, nulls spelled out.
 */
function detailOf(row: Record<string, unknown>): Record<string, unknown> {
	return {
		archivedAtUtc: row.archivedAtUtc ?? null,
		sentAtUtc: row.sentAtUtc ?? null,
		fancyContent: (row.fancyContent as Record<string, unknown>[]).map(
			(block) => ({ metadata: null, ...block }),
		),
		targetGroupValue: row.targetGroupValue ?? null,
		targetGroup: row.targetGroup,
		createdAtUtc: row.createdAtUtc,
		status: row.status,
		from: row.from,
		title: row.title,
		id: row.id,
	};
}

/** DraftMessageActionAdminResponseDto. */
const acted = (result: string, row: Record<string, unknown> | null) =>
	json({ result, message: row ? detailOf(row) : null });

function thrownBy(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		if (error instanceof ApiError) return error;
		throw error;
	}
	throw new Error("test: expected it to throw");
}

// ─── Reading ────────────────────────────────────────────────────────────────

describe("toMessage", () => {
	it("reads a draft as the list sends it", () => {
		const message = toMessage(wireMessage());
		expect(message).toEqual({
			id: ID,
			etag: message.etag,
			title: "[TEST] nowy plan",
			from: "Codziennie Fit",
			status: "draft",
			targetGroup: "all",
			// Left out by the backend when unset.
			targetGroupValue: null,
			fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
			createdAtUtc: CREATED,
			sentAtUtc: null,
			archivedAtUtc: null,
			// A draft has no later date than its creation.
			updatedAtUtc: CREATED,
		});
		expect(message.etag).toMatch(/^h:[0-9a-f]{8}$/);
	});

	it("dates a sent message by when it was sent", () => {
		const message = toMessage(
			wireMessage({ status: "sent", sentAtUtc: "2026-11-02T08:00:00.000Z" }),
		);
		expect(message.status).toBe("sent");
		expect(message.updatedAtUtc).toBe("2026-11-02T08:00:00.000Z");
	});

	it("dates an archived message by when it was archived", () => {
		const message = toMessage(
			wireMessage({
				status: "archived",
				sentAtUtc: "2026-11-02T08:00:00.000Z",
				archivedAtUtc: "2026-11-05T08:00:00.000Z",
			}),
		);
		expect(message.status).toBe("archived");
		expect(message.updatedAtUtc).toBe("2026-11-05T08:00:00.000Z");
	});

	it("takes the backend's own etag and date of change once it sends them", () => {
		const message = toMessage(
			wireMessage({ etag: 'W/"3"', updatedAtUtc: "2026-11-03T10:00:00.000Z" }),
		);
		expect(message.etag).toBe('W/"3"');
		expect(message.updatedAtUtc).toBe("2026-11-03T10:00:00.000Z");
	});

	it("keeps the target of a message for one challenge", () => {
		expect(
			toMessage(
				wireMessage({ targetGroup: "challenge", targetGroupValue: "C12" }),
			),
		).toMatchObject({ targetGroup: "challenge", targetGroupValue: "C12" });
	});

	it("reads a picture block with its measurements", () => {
		const block = {
			type: "Image",
			content: "",
			metadata: {
				imageRelativePath: "messages/a.webp",
				heightToWidthRatio: 0.5,
			},
		};
		expect(
			toMessage(wireMessage({ fancyContent: [block] })).fancyContent,
		).toEqual([block]);
	});

	it("reads a missing title or sender as empty", () => {
		expect(toMessage(wireMessage({ title: null, from: null }))).toMatchObject({
			title: "",
			from: "",
		});
		expect(
			toMessage(wireMessage({ title: undefined, from: undefined })),
		).toMatchObject({ title: "", from: "" });
	});

	it("keeps fields this build does not know", () => {
		expect(toMessage(wireMessage({ recipients: 1200 })).recipients).toBe(1200);
	});

	it("fails loudly for a row without an id or a creation date", () => {
		expect(
			thrownBy(() => toMessage(wireMessage({ id: undefined }))).issues.map(
				(issue) => issue.path,
			),
		).toEqual(["id"]);
		const error = thrownBy(() =>
			toMessage(wireMessage({ createdAtUtc: undefined })),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Wiadomość: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["createdAtUtc"]);
	});

	it("fails loudly for a status it does not know, naming the message", () => {
		const error = thrownBy(() => toMessage(wireMessage({ status: "queued" })));
		expect(error.kind).toBe("server");
		expect(error.message).toContain(`Wiadomość ${ID}: dane nie pasują`);
		expect(error.issues.map((issue) => issue.path)).toEqual(["status"]);
	});
});

describe("messageVersion", () => {
	const base = wireMessage({
		fancyContent: [
			{ type: "Title", content: "Nowość" },
			{
				type: "Image",
				content: "",
				metadata: {
					imageRelativePath: "messages/a.webp",
					heightToWidthRatio: 0.5,
				},
			},
		],
	});
	const version = (row: Record<string, unknown>) => toMessage(row).etag;

	it("is the same for the list's shape and an action's shape of one message", () => {
		expect(version(detailOf(base))).toBe(version(base));
		const sent = wireMessage({
			status: "sent",
			sentAtUtc: "2026-11-02T08:00:00.000Z",
			targetGroup: "challenge",
			targetGroupValue: "C12",
		});
		expect(version(detailOf(sent))).toBe(version(sent));
	});

	it("is what toMessage uses as the etag", () => {
		const message = toMessage(base);
		expect(message.etag).toBe(messageVersion(message));
	});

	it("does not depend on fields the panel made up or does not know", () => {
		const message = toMessage(base);
		expect(
			messageVersion({
				...message,
				etag: "other",
				updatedAtUtc: "2030-01-01T00:00:00.000Z",
				recipients: 5,
			}),
		).toBe(message.etag);
	});

	it.each([
		["title", { title: "[TEST] inny opis" }],
		["sender", { from: "Zespół" }],
		["status", { status: "archived" }],
		["target group", { targetGroup: "subscribers" }],
		["target value", { targetGroupValue: "C12" }],
		["sending date", { sentAtUtc: "2026-11-02T08:00:00.000Z" }],
		["archiving date", { archivedAtUtc: "2026-11-05T08:00:00.000Z" }],
		["creation date", { createdAtUtc: "2026-11-01T09:00:00.001Z" }],
		["id", { id: "2516735103999999998" }],
		[
			"text of a block",
			{
				fancyContent: [
					{ type: "Title", content: "Nowość!" },
					(base.fancyContent as unknown[])[1],
				],
			},
		],
		[
			"type of a block",
			{
				fancyContent: [
					{ type: "Text", content: "Nowość" },
					(base.fancyContent as unknown[])[1],
				],
			},
		],
		[
			"picture of a block",
			{
				fancyContent: [
					(base.fancyContent as unknown[])[0],
					{
						type: "Image",
						content: "",
						metadata: {
							imageRelativePath: "messages/b.webp",
							heightToWidthRatio: 0.5,
						},
					},
				],
			},
		],
		[
			"shape of a picture",
			{
				fancyContent: [
					(base.fancyContent as unknown[])[0],
					{
						type: "Image",
						content: "",
						metadata: {
							imageRelativePath: "messages/a.webp",
							heightToWidthRatio: 0.75,
						},
					},
				],
			},
		],
		[
			"order of blocks",
			{ fancyContent: (base.fancyContent as unknown[]).toReversed() },
		],
		[
			"number of blocks",
			{ fancyContent: [(base.fancyContent as unknown[])[0]] },
		],
	])("changes with the %s", (_what, change) => {
		expect(version({ ...base, ...change })).not.toBe(version(base));
	});
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("fromMessage", () => {
	const overTheWire = (body: Record<string, unknown>) =>
		JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

	it("sends a new message without an id, identified by its creation date", () => {
		const created: NewMessage = {
			...blankMessage(CREATED),
			title: "[TEST] nowość",
			from: "Codziennie Fit",
			targetGroup: "all",
			fancyContent: [{ type: "Text", content: "Cześć" }],
		};
		expect(overTheWire(fromMessage(created))).toEqual({
			title: "[TEST] nowość",
			from: "Codziennie Fit",
			targetGroup: "all",
			fancyContent: [{ type: "Text", content: "Cześć" }],
			createdAtUtc: CREATED,
		});
	});

	it("sends back the exact creation date of a stored draft, and its id", () => {
		// The backend finds the draft by this date (audit §4a, "no id").
		const body = overTheWire(fromMessage(toMessage(wireMessage())));
		expect(body).toMatchObject({
			id: ID,
			title: "[TEST] nowy plan",
			from: "Codziennie Fit",
			targetGroup: "all",
			fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
			createdAtUtc: CREATED,
		});
	});

	it("keeps a creation date in whatever precision it was stored", () => {
		for (const createdAtUtc of [
			"2026-11-01T09:00:00.123Z",
			"2026-11-01T09:00:00Z",
			"2026-11-01T10:00:00+01:00",
		]) {
			expect(
				fromMessage(toMessage(wireMessage({ createdAtUtc }))).createdAtUtc,
			).toBe(createdAtUtc);
		}
	});

	it("sends the target value only when there is one", () => {
		expect(
			overTheWire(fromMessage(toMessage(wireMessage()))),
		).not.toHaveProperty("targetGroupValue");
		expect(
			overTheWire(
				fromMessage(
					toMessage(
						wireMessage({ targetGroup: "challenge", targetGroupValue: "C12" }),
					),
				),
			),
		).toMatchObject({ targetGroup: "challenge", targetGroupValue: "C12" });
	});

	it("never sends the status, its dates or the version: those are the server's", () => {
		const body = overTheWire(
			fromMessage(
				toMessage(
					wireMessage({
						etag: 'W/"3"',
						status: "sent",
						sentAtUtc: "2026-11-02T08:00:00.000Z",
					}),
				),
			),
		);
		for (const field of [
			"etag",
			"status",
			"sentAtUtc",
			"archivedAtUtc",
			"updatedAtUtc",
			"overrideAlreadySent",
		]) {
			expect(body).not.toHaveProperty(field);
		}
	});

	it("sends the content blocks as they are", () => {
		const blocks = [
			{ type: "Title", content: "Nowość" },
			{
				type: "Image",
				content: "",
				metadata: {
					imageRelativePath: "messages/a.webp",
					heightToWidthRatio: 0.5,
				},
			},
		];
		expect(
			fromMessage(toMessage(wireMessage({ fancyContent: blocks })))
				.fancyContent,
		).toEqual(blocks);
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

const TODAY_ON = capabilities({
	writes: { messages: "on", sendMessage: "on" },
});
const TEST_ONLY = capabilities({
	writes: { messages: "test-only", sendMessage: "test-only" },
});

const LIST = "manageMessageDrafts/list";
const UPSERT = "manageMessageDrafts/upsert";
const PUBLISH = "manageMessageDrafts/publish";
const ARCHIVE = "manageMessageDrafts/archive";
const UNARCHIVE = "manageMessageDrafts/unarchive";

describe("messagesArea: list", () => {
	it("lists every message with one request", async () => {
		const backend = fakeBackend().on(
			"GET",
			LIST,
			listOf(
				wireMessage(),
				wireMessage({
					id: "2516735103999999000",
					status: "sent",
					createdAtUtc: "2026-10-01T09:00:00.000Z",
					sentAtUtc: "2026-10-02T09:00:00.000Z",
				}),
			),
		);
		const api = messagesArea(backend.transport, SWITCHED_OFF);
		expect((await api.list()).map((message) => message.status)).toEqual([
			"draft",
			"sent",
		]);
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
		expect(backend.only("GET", LIST).query).toEqual({});
	});

	it("reads an empty list", async () => {
		const backend = fakeBackend().on("GET", LIST, listOf());
		expect(await messagesArea(backend.transport, SWITCHED_OFF).list()).toEqual(
			[],
		);
	});

	it("fails when the answer has no list of messages", async () => {
		for (const answer of [[], { count: 0 }, { messages: null }]) {
			const backend = fakeBackend().on("GET", LIST, json(answer));
			const error = await failure(
				messagesArea(backend.transport, SWITCHED_OFF).list(),
			);
			expect(error.kind).toBe("server");
			expect(error.message).toContain("Lista wiadomości");
		}
	});

	it("passes on the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			LIST,
			errorReply(500, "Failed to list draft messages: RestError"),
		);
		const error = await failure(
			messagesArea(backend.transport, SWITCHED_OFF).list(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

describe("messagesArea: create", () => {
	const NEW_CREATED = "2026-11-11T09:00:00.000Z";
	const NEW_ID = "2516726463999999999";
	const created: NewMessage = {
		...blankMessage(NEW_CREATED),
		title: "[TEST] nowość",
		from: "Codziennie Fit",
		targetGroup: "subscribers",
		fancyContent: [{ type: "Text", content: "Cześć" }],
	};
	const stored = wireMessage({
		id: NEW_ID,
		title: "[TEST] nowość",
		targetGroup: "subscribers",
		createdAtUtc: NEW_CREATED,
		fancyContent: [{ type: "Text", content: "Cześć" }],
	});

	it("makes sure the creation date is free, posts, and returns the answer's message", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(wireMessage()))
			.on(
				"POST",
				UPSERT,
				acted(`Draft message created successfully with ID: ${NEW_ID}`, stored),
			);
		const api = messagesArea(backend.transport, TODAY_ON);

		const result = await api.create(created);

		expect(result).toMatchObject({
			id: NEW_ID,
			status: "draft",
			title: "[TEST] nowość",
			createdAtUtc: NEW_CREATED,
		});
		// The version it got is the one the list will show for it.
		expect(result.etag).toBe(toMessage(stored).etag);
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${UPSERT}`]);
		const post = backend.only("POST", UPSERT);
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toEqual({
			title: "[TEST] nowość",
			from: "Codziennie Fit",
			targetGroup: "subscribers",
			fancyContent: [{ type: "Text", content: "Cześć" }],
			createdAtUtc: NEW_CREATED,
		});
	});

	it("finds the new message by its creation date when the answer carries none", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(wireMessage()), listOf(stored, wireMessage()))
			.on("POST", UPSERT, acted("Draft message created successfully", null));
		const api = messagesArea(backend.transport, TODAY_ON);

		const result = await api.create(created);

		expect(result.id).toBe(NEW_ID);
		expect(backend.calls()).toEqual([
			`GET ${LIST}`,
			`POST ${UPSERT}`,
			`GET ${LIST}`,
		]);
	});

	it("says so when the answer carries none and the list does not show it", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(wireMessage()))
			.on("POST", UPSERT, acted("Draft message created successfully", null));
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).create(created),
		);
		expect(error.kind).toBe("notFound");
	});

	it("refuses, without posting, when a message has exactly that creation date", async () => {
		// The backend would take the save for a change to that message.
		const backend = fakeBackend().on(
			"GET",
			LIST,
			listOf(wireMessage({ createdAtUtc: NEW_CREATED, status: "sent" })),
		);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).create(created),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("już istnieje");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("does not post when it could not check the creation date", async () => {
		const backend = fakeBackend().on(
			"GET",
			LIST,
			errorReply(503, "Unavailable"),
		);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).create(created),
		);
		expect(error.kind).toBe("server");
		expect(backend.all("POST", UPSERT)).toEqual([]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(backend.transport, SWITCHED_OFF).create(created),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Wiadomości”");
		expect(backend.requests).toEqual([]);
	});

	it("creates only test items in test-only mode, marked in the title", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf())
			.on("POST", UPSERT, acted("Draft message created successfully", stored));
		const api = messagesArea(backend.transport, TEST_ONLY);

		const error = await failure(api.create({ ...created, title: "nowość" }));
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([{ path: "title", message: error.message }]);
		expect(error.message).toContain("„Opis wewnętrzny”");
		expect(backend.requests).toEqual([]);

		expect((await api.create(created)).id).toBe(NEW_ID);
	});

	it("reports a 400 as a refusal, with the backend's sentence", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf())
			.on(
				"POST",
				UPSERT,
				errorReply(
					400,
					"Invalid targetGroup 'everyone'. Valid values are: all, subscribers, nonSubscribers, challenge",
					{ errorCode: null },
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).create({
				...created,
				targetGroup: "everyone",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(400);
		expect(error.message).toContain("Invalid targetGroup 'everyone'");
	});
});

describe("messagesArea: save", () => {
	const stored = wireMessage();
	const loaded = toMessage(stored);
	const edited: Message = { ...loaded, title: "[TEST] nowy plan, poprawka" };
	const afterSave = wireMessage({ title: "[TEST] nowy plan, poprawka" });

	it("checks the stored version, then posts the draft under its creation date", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				UPSERT,
				acted(`Draft message updated successfully with ID: ${ID}`, afterSave),
			);
		const api = messagesArea(backend.transport, TODAY_ON);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({
			id: ID,
			title: "[TEST] nowy plan, poprawka",
			status: "draft",
		});
		expect(result.etag).toBe(toMessage(afterSave).etag);
		expect(result.etag).not.toBe(loaded.etag);
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${UPSERT}`]);
		const post = backend.only("POST", UPSERT);
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toMatchObject({
			id: ID,
			title: "[TEST] nowy plan, poprawka",
			from: "Codziennie Fit",
			targetGroup: "all",
			fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
			createdAtUtc: CREATED,
		});
		expect(bodyOf(post)).not.toHaveProperty("status");
		expect(bodyOf(post)).not.toHaveProperty("etag");
	});

	it("reads the list again when the answer carries no message", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored), listOf(afterSave))
			.on("POST", UPSERT, acted("Draft message updated successfully", null));
		const api = messagesArea(backend.transport, TODAY_ON);
		expect((await api.save(edited, { etag: loaded.etag })).title).toBe(
			"[TEST] nowy plan, poprawka",
		);
		expect(backend.calls()).toEqual([
			`GET ${LIST}`,
			`POST ${UPSERT}`,
			`GET ${LIST}`,
		]);
	});

	it.each(["sent", "archived"] as const)(
		"refuses to change a %s message, without a request",
		async (status) => {
			const backend = fakeBackend();
			for (const caps of [TODAY_ON, ALL_CAPABILITIES]) {
				const error = await failure(
					messagesArea(backend.transport, caps).save(
						{ ...edited, status },
						{ etag: loaded.etag },
					),
				);
				expect(error.kind).toBe("validation");
				expect(error.message).toContain("nie można zmienić");
			}
			expect(backend.requests).toEqual([]);
		},
	);

	it("reports a conflict, without posting, when someone changed the draft", async () => {
		const theirs = wireMessage({ from: "Patryk" });
		const backend = fakeBackend().on("GET", LIST, listOf(theirs));
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toMessage(theirs));
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("reports a conflict when the draft was sent in the meantime", async () => {
		const backend = fakeBackend().on(
			"GET",
			LIST,
			listOf(
				wireMessage({ status: "sent", sentAtUtc: "2026-11-02T08:00:00.000Z" }),
			),
		);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect((error.current as Message).status).toBe("sent");
		expect(backend.all("POST", UPSERT)).toEqual([]);
	});

	it("reports a draft that is gone as not found, without posting", async () => {
		const backend = fakeBackend().on("GET", LIST, listOf());
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(backend.transport, SWITCHED_OFF).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("saves only test items in test-only mode", async () => {
		const real = wireMessage({ title: "Nowy plan" });
		const backend = fakeBackend().on("GET", LIST, listOf(real));
		const api = messagesArea(backend.transport, TEST_ONLY);

		const marking = await failure(api.save(edited, { etag: loaded.etag }));
		expect(marking.kind).toBe("validation");
		expect(marking.issues[0]?.path).toBe("title");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);

		const unmarked = await failure(
			api.save({ ...edited, title: "Nowy plan" }, { etag: loaded.etag }),
		);
		expect(unmarked.kind).toBe("validation");
		expect(backend.requests).toHaveLength(1);
	});

	it("reports the backend refusing a published message", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				UPSERT,
				errorReply(
					400,
					`Message with id ${ID} is already published. Set overrideAlreadySent=true to override draft and saved messages.`,
					{ errorCode: null },
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(400);
	});

	it("reports a crash as the backend failing", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				UPSERT,
				errorReply(
					500,
					"Failed to process draft message. Error details: RestError",
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("server");
	});

	it("posts with If-Match once the backend versions messages", async () => {
		const versioned = wireMessage({ etag: 'W/"3"' });
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			json({
				result: "Draft message updated successfully",
				message: { ...detailOf(afterSave), etag: 'W/"4"' },
			}),
		);
		const api = messagesArea(backend.transport, ALL_CAPABILITIES);
		const result = await api.save(
			{ ...toMessage(versioned), title: "[TEST] nowy plan, poprawka" },
			{ etag: 'W/"3"' },
		);
		expect(result.etag).toBe('W/"4"');
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
		expect(backend.only("POST", UPSERT).headers["if-match"]).toBe('W/"3"');
	});

	it("turns a 409 with the current message into a conflict that carries it", async () => {
		const theirs = {
			...detailOf(wireMessage({ from: "Patryk" })),
			etag: 'W/"4"',
		};
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			errorReply(409, "Conflict", { current: theirs }),
		);
		const api = messagesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(
			api.save(toMessage(wireMessage({ etag: 'W/"3"' })), { etag: 'W/"3"' }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(409);
		expect(error.current).toEqual(toMessage(theirs));
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
	});
});

describe("messagesArea: send", () => {
	const stored = wireMessage();
	const loaded = toMessage(stored);
	const sent = wireMessage({
		status: "sent",
		sentAtUtc: "2026-11-11T10:00:00.000Z",
	});

	it("checks the stored version, then publishes for real", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on("POST", PUBLISH, acted("Draft message published successfully", sent));
		const api = messagesArea(backend.transport, TODAY_ON);

		const result = await api.send(ID, { etag: loaded.etag });

		expect(result).toMatchObject({
			id: ID,
			status: "sent",
			sentAtUtc: "2026-11-11T10:00:00.000Z",
			updatedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${PUBLISH}`]);
		expect(bodyOf(backend.only("POST", PUBLISH))).toEqual({
			id: ID,
			dryRun: false,
		});
	});

	it("cannot be tried on a test item: test-only mode refuses with no request", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(backend.transport, TEST_ONLY).send(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Wysyłanie wiadomości”");
		expect(error.message).toContain("nie da się wypróbować");
		expect(backend.requests).toEqual([]);
	});

	it("is its own switch: open messages do not open sending", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(
				backend.transport,
				capabilities({ writes: { messages: "on" } }),
			).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("tylko do odczytu");
		expect(backend.requests).toEqual([]);
	});

	it("makes no request while everything is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(backend.transport, SWITCHED_OFF).send(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("does not send a message someone changed after it was read", async () => {
		const theirs = wireMessage({
			fancyContent: [{ type: "Text", content: "Inna treść" }],
		});
		const backend = fakeBackend().on("GET", LIST, listOf(theirs));
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toMessage(theirs));
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("does not send a message that is not there", async () => {
		const backend = fakeBackend().on("GET", LIST, listOf());
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("notFound");
		expect(backend.all("POST", PUBLISH)).toEqual([]);
	});

	it("reads the list again when the answer carries no message", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored), listOf(sent))
			.on("POST", PUBLISH, acted("Draft message published successfully", null));
		const result = await messagesArea(backend.transport, TODAY_ON).send(ID, {
			etag: loaded.etag,
		});
		expect(result.status).toBe("sent");
		expect(backend.calls()).toEqual([
			`GET ${LIST}`,
			`POST ${PUBLISH}`,
			`GET ${LIST}`,
		]);
	});

	it("reports the backend refusing to publish", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				PUBLISH,
				errorReply(
					400,
					`Cannot publish message with ID ${ID}. Only draft messages can be published.`,
					{ errorCode: null },
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(400);
		expect(error.message).toContain("Only draft messages can be published");
	});

	it("reports a failed delivery as the backend failing", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				PUBLISH,
				errorReply(
					500,
					`Failed to publish draft message with ID ${ID}. Error details: -`,
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("server");
	});
});

describe("messagesArea: archive", () => {
	const stored = wireMessage();
	const loaded = toMessage(stored);
	const archived = wireMessage({
		status: "archived",
		archivedAtUtc: "2026-11-11T10:00:00.000Z",
	});

	it("checks the stored version, then archives for real", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on("POST", ARCHIVE, acted("Draft message archived", archived));
		const api = messagesArea(backend.transport, TODAY_ON);

		const result = await api.archive(ID, { etag: loaded.etag });

		expect(result).toMatchObject({
			status: "archived",
			archivedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${ARCHIVE}`]);
		expect(bodyOf(backend.only("POST", ARCHIVE))).toEqual({
			id: ID,
			dryRun: false,
		});
	});

	it("does not need sending to be switched on", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on("POST", ARCHIVE, acted("Draft message archived", archived));
		const api = messagesArea(
			backend.transport,
			capabilities({ writes: { messages: "on" } }),
		);
		expect((await api.archive(ID, { etag: loaded.etag })).status).toBe(
			"archived",
		);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(backend.transport, SWITCHED_OFF).archive(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("archives only test messages in test-only mode", async () => {
		const real = wireMessage({ id: "2516735103999990000", title: "Nowy plan" });
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored, real))
			.on("POST", ARCHIVE, acted("Draft message archived", archived));
		const api = messagesArea(backend.transport, TEST_ONLY);

		const error = await failure(
			api.archive("2516735103999990000", { etag: toMessage(real).etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("title");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);

		expect((await api.archive(ID, { etag: loaded.etag })).status).toBe(
			"archived",
		);
		expect(backend.all("POST", ARCHIVE)).toHaveLength(1);
	});

	it("does not archive a message someone changed after it was read", async () => {
		const backend = fakeBackend().on(
			"GET",
			LIST,
			listOf(wireMessage({ title: "[TEST] zmieniony" })),
		);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).archive(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("reports a message the backend no longer has", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				ARCHIVE,
				errorReply(404, `Draft message with ID ${ID} not found`, {
					errorCode: null,
				}),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).archive(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe(`Draft message with ID ${ID} not found`);
	});

	it("reports the backend refusing to archive a published message", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(stored))
			.on(
				"POST",
				ARCHIVE,
				errorReply(
					400,
					`Cannot archive message with ID ${ID} because it is already published. Published messages cannot be archived.`,
					{ errorCode: null },
				),
			);
		const error = await failure(
			messagesArea(backend.transport, TODAY_ON).archive(ID, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
	});
});

describe("messagesArea: unarchive", () => {
	const archived = wireMessage({
		status: "archived",
		archivedAtUtc: "2026-11-05T08:00:00.000Z",
	});
	const loaded = toMessage(archived);

	it("is refused, with no request, while the backend cannot do it", async () => {
		// Today there is no such endpoint (audit §1a lists list, upsert,
		// archive, publish and unsend).
		const backend = fakeBackend();
		for (const caps of [SWITCHED_OFF, TODAY_ON, TEST_ONLY]) {
			const error = await failure(
				messagesArea(backend.transport, caps).unarchive(ID, {
					etag: loaded.etag,
				}),
			);
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("nie potrafi jeszcze przywracać");
		}
		expect(backend.requests).toEqual([]);
	});

	it("checks the stored version, then asks the backend to bring it back", async () => {
		const restored = wireMessage();
		const backend = fakeBackend()
			.on("GET", LIST, listOf(archived))
			.on("POST", UNARCHIVE, acted("Draft message unarchived", restored));
		const api = messagesArea(backend.transport, ALL_CAPABILITIES);

		const result = await api.unarchive(ID, { etag: loaded.etag });

		expect(result).toMatchObject({ status: "draft", archivedAtUtc: null });
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${UNARCHIVE}`]);
		expect(bodyOf(backend.only("POST", UNARCHIVE))).toEqual({
			id: ID,
			dryRun: false,
		});
	});

	it("still needs the section to be writable", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(
				backend.transport,
				capabilities({ messageUnarchive: true }),
			).unarchive(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("tylko do odczytu");
		expect(backend.requests).toEqual([]);
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Rows and answers below are the ones the backend's own tests show
// (tests/handlers/messagesPanelContract.test.ts).

/** Produkcja's features, with messages and sending accepted. */
const OPEN = production({ writes: { messages: "on", sendMessage: "on" } });
const OPEN_FOR_TESTS = production({
	writes: { messages: "test-only", sendMessage: "on" },
});
const EDITING = { etag: true } as const;

/** DraftMessageSavedAdminDto: the answer to upsert, publish, archive and unarchive. */
const savedReply = (
	result: string,
	message: Record<string, unknown>,
	more: Record<string, unknown> = {},
) => json({ result, message, ...more });

describe("toMessage: a row of the panel's route", () => {
	it("reads the version the backend issued", () => {
		const message = toMessage(panelMessage());
		expect(message.etag).toBe(tableEtag(0));
		expect(message).toMatchObject({
			id: ID,
			status: "draft",
			targetGroup: "all",
			targetGroupValue: null,
		});
	});

	it("keeps the mark of a send that is under way: still a draft, not to be touched", () => {
		const message = toMessage(
			panelMessage({ sendingStartedAtUtc: "2026-11-13T10:00:30.000Z" }),
		);
		expect(message.status).toBe("draft");
		expect(message.sendingStartedAtUtc).toBe("2026-11-13T10:00:30.000Z");
	});

	it("reads an unfinished draft: no title, no sender, no group, no content", () => {
		// "the panel gets every message with its etag, and a draft without a
		// group as having none".
		const message = toMessage(
			panelMessage({
				id: "m2",
				title: "",
				from: "",
				targetGroup: null,
				fancyContent: [],
				createdAtUtc: "2026-11-02T10:00:00.000Z",
			}),
		);
		expect(message).toMatchObject({
			title: "",
			from: "",
			targetGroup: null,
			fancyContent: [],
			updatedAtUtc: "2026-11-02T10:00:00.000Z",
		});
	});

	it("falls back to a fingerprint for a row without an etag", () => {
		expect(toMessage(panelMessage({ etag: null })).etag).toMatch(/^h:/);
	});
});

describe("fromMessage: with the editing contract", () => {
	it("sends an empty group value as null: left out, the backend keeps the stored one", () => {
		const body = fromMessage(
			{
				...toMessage(panelMessage({ targetGroupValue: "C12" })),
				targetGroupValue: null,
			},
			EDITING,
		);
		expect(Object.keys(body)).toContain("targetGroupValue");
		expect(body.targetGroupValue).toBeNull();
	});

	it("sends the group value there is", () => {
		expect(
			fromMessage(
				toMessage(
					panelMessage({ targetGroup: "challenge", targetGroupValue: "C12" }),
				),
				EDITING,
			).targetGroupValue,
		).toBe("C12");
	});

	it("names the draft by its id and still sends its creation time", () => {
		const body = fromMessage(toMessage(panelMessage()), EDITING);
		expect(body.id).toBe(ID);
		expect(body.createdAtUtc).toBe(CREATED);
	});

	it("never sends what the backend owns", () => {
		const body = fromMessage(
			toMessage(
				panelMessage({
					status: "archived",
					archivedAtUtc: CREATED,
					sendingStartedAtUtc: null,
				}),
			),
			EDITING,
		);
		expect(body).not.toHaveProperty("sendingStartedAtUtc");
		for (const owned of [
			"etag",
			"status",
			"sentAtUtc",
			"archivedAtUtc",
			"updatedAtUtc",
		]) {
			expect(body, owned).not.toHaveProperty(owned);
		}
	});

	it("leaves the group value out, as before, without the contract", () => {
		for (const caps of [undefined, { etag: false }]) {
			expect(
				fromMessage(
					{ ...toMessage(panelMessage()), targetGroupValue: null },
					caps,
				),
			).not.toHaveProperty("targetGroupValue");
		}
	});
});

describe("messagesArea: create on the panel's route", () => {
	const draft: NewMessage = {
		...blankMessage(CREATED),
		title: "[TEST] nowy plan",
		from: "Codziennie Fit",
		targetGroup: "all",
		fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
	};

	it("asks the backend to create only, and takes the message from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			savedReply(
				`Draft message created successfully with ID: ${ID}`,
				panelMessage(),
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const created = await api.create(draft);

		expect(created).toMatchObject({
			id: ID,
			etag: tableEtag(0),
			status: "draft",
		});
		// No list first: the backend itself refuses to land on another draft.
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
		const post = backend.only("POST", UPSERT);
		expect(post.headers["if-none-match"]).toBe("*");
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toEqual({
			title: "[TEST] nowy plan",
			from: "Codziennie Fit",
			targetGroup: "all",
			targetGroupValue: null,
			fancyContent: [{ type: "Text", content: "Nowy plan już jest." }],
			createdAtUtc: CREATED,
		});
	});

	it("says so when a message with that creation time already exists", async () => {
		// "with If-None-Match: * … refused with 409 when that creation time is taken".
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			conflictReply(
				`A message created at ${CREATED} already exists (ID: m1)`,
				panelMessage({ id: "m1", title: "[TEST] m1" }),
				"ALREADY_EXISTS",
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const error = await failure(api.create(draft));

		// A refusal: the other draft is not "theirs" to merge into.
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(
			`A message created at ${CREATED} already exists (ID: m1)`,
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.current).toBeUndefined();
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
	});

	it("reports what is malformed at its field and its block", async () => {
		// "the panel is told every malformed field at once, each with its path".
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			validationReply([
				{
					path: "targetGroup",
					code: "INVALID_VALUE",
					message:
						"Invalid targetGroup 'everyone'. Valid values are: all, subscribers, nonSubscribers, challenge",
				},
				{
					path: "fancyContent.0",
					code: "INVALID_CONTENT",
					message: 'Item 1: Content cannot be empty for type "Text".',
				},
			]),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).create(draft),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"targetGroup",
			"fancyContent.0",
		]);
	});

	it("still reads the list first while the backend does not speak the editing contract", async () => {
		const backend = fakeBackend().on("GET", LIST, listOf(wireMessage()));
		const error = await failure(
			messagesArea(
				backend.transport,
				production({ etag: false, writes: { messages: "on" } }),
			).create(draft),
		);
		expect(error.kind).toBe("validation");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});
});

describe("messagesArea: save on the panel's route", () => {
	const loaded = toMessage(panelMessage());
	const edited: Message = { ...loaded, title: "[TEST] nowy plan, poprawka" };

	it("posts once, with If-Match, and takes the saved message from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			savedReply(
				`Draft message updated successfully with ID: ${ID}`,
				panelMessage({
					title: "[TEST] nowy plan, poprawka",
					etag: tableEtag(1),
				}),
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({
			title: "[TEST] nowy plan, poprawka",
			etag: tableEtag(1),
		});
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
		const post = backend.only("POST", UPSERT);
		expect(post.headers["if-match"]).toBe(tableEtag(0));
		expect(bodyOf(post)).toMatchObject({
			id: ID,
			createdAtUtc: CREATED,
			targetGroupValue: null,
		});
	});

	it("turns a stale version into a conflict that carries the stored message", async () => {
		const theirs = panelMessage({
			title: "[TEST] someone else",
			etag: tableEtag(1),
		});
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			conflictReply(
				`Message with id ${ID} was changed since it was loaded`,
				theirs,
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).save(edited, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toMessage(theirs));
		expect(backend.calls()).toEqual([`POST ${UPSERT}`]);
	});

	it("reports a draft that is gone as not found", async () => {
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			notFoundReply(`Draft message with ID ${ID} not found`),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).save(edited, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("notFound");
	});

	it("shows the backend's words that the message was sent in the meantime", async () => {
		const backend = fakeBackend().on(
			"POST",
			UPSERT,
			validationReply(
				[
					{
						path: "status",
						code: "ALREADY_SENT",
						message: "Only draft messages can be updated.",
					},
				],
				undefined,
				{ current: panelMessage({ status: "sent", sentAtUtc: CREATED }) },
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).save(edited, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Only draft messages can be updated.");
		expect(error.issues).toEqual([{ path: "status", message: error.message }]);
	});
});

describe("messagesArea: send, archive and unarchive name the version they are based on", () => {
	const loaded = toMessage(panelMessage());

	it("publishes for real, with If-Match and without reading the list first", async () => {
		// "the panel sends a complete draft and gets the sent message with its
		// new etag".
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			savedReply(
				`Draft message ${ID} published successfully`,
				panelMessage({
					status: "sent",
					sentAtUtc: "2026-11-13T10:01:00.000Z",
					etag: tableEtag(1),
				}),
				{ dryRun: false },
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const result = await api.send(ID, { etag: loaded.etag });

		expect(result).toMatchObject({
			status: "sent",
			sentAtUtc: "2026-11-13T10:01:00.000Z",
			etag: tableEtag(1),
		});
		expect(backend.calls()).toEqual([`POST ${PUBLISH}`]);
		const post = backend.only("POST", PUBLISH);
		expect(post.headers["if-match"]).toBe(tableEtag(0));
		// Never a dry run: `false` is spelled out.
		expect(bodyOf(post)).toEqual({ id: ID, dryRun: false });
	});

	it("does not send what someone changed in the meantime", async () => {
		// "stops the panel from sending what it did not see".
		const theirs = panelMessage({ title: "[TEST] edited", etag: tableEtag(1) });
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			conflictReply(
				`Message with id ${ID} was changed since it was loaded`,
				theirs,
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toMessage(theirs));
	});

	it("lists every reason a draft cannot be sent, at its field", async () => {
		// "and is refused when the panel tries to send it, with every problem listed".
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			validationReply([
				{
					path: "from",
					code: "TOO_SHORT",
					message: `From is less than 2 characters for message with id ${ID}`,
				},
				{
					path: "fancyContent",
					code: "REQUIRED",
					message: `FancyContent is empty for message with id ${ID}`,
				},
				{
					path: "targetGroup",
					code: "REQUIRED",
					message: `TargetGroup is not set for message with id ${ID}`,
				},
			]),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"from",
			"fancyContent",
			"targetGroup",
		]);
	});

	it("says a send is already under way, and does not take it for a change by someone else", async () => {
		// messagesPanelContract.test.ts: a second send while the first delivers.
		const claimed = panelMessage({
			sendingStartedAtUtc: "2026-11-13T10:00:30.000Z",
			etag: tableEtag(1),
		});
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			conflictReply(
				`Message with id ${ID} is being sent (started at 2026-11-13T10:00:30.000Z). Try again when it has finished, or in 10 minutes at the latest.`,
				claimed,
				"SENDING_IN_PROGRESS",
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		// A refusal: waiting is the thing to do, not merging and sending again.
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toContain(`Message with id ${ID} is being sent`);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.current).toBeUndefined();
		expect(backend.calls()).toEqual([`POST ${PUBLISH}`]);
	});

	it.each([
		[
			"an edit",
			UPSERT,
			(api: ReturnType<typeof messagesArea>) =>
				api.save(
					{ ...loaded, title: "[TEST] poprawka" },
					{ etag: loaded.etag },
				),
		],
		[
			"an archive",
			ARCHIVE,
			(api: ReturnType<typeof messagesArea>) =>
				api.archive(ID, { etag: loaded.etag }),
		],
	] as const)(
		"refuses %s of a message that is being sent the same way",
		async (_what, path, run) => {
			const backend = fakeBackend().on("POST", path, {
				status: 409,
				// Without `current` too: `refused(409, …)` of the backend.
				body: {
					error: `Message with id ${ID} is being sent (started at 2026-11-13T10:00:30.000Z). Try again when it has finished, or in 10 minutes at the latest.`,
					errorCode: "SENDING_IN_PROGRESS",
				},
			});
			const error = await failure(run(messagesArea(backend.transport, OPEN)));
			expect(error.kind).toBe("validation");
			expect(error.message).toContain(`Message with id ${ID} is being sent`);
			// Not read again, as a conflict without `current` would be.
			expect(backend.calls()).toEqual([`POST ${path}`]);
		},
	);

	it("shows a refusal, not a conflict, should the backend say an action named no version", async () => {
		// 428 VERSION_REQUIRED: every change to a stored message needs one.
		const backend = fakeBackend().on("POST", PUBLISH, {
			status: 428,
			body: {
				error: `Message ${ID} exists already; name the version this change is based on (If-Match header or etag field)`,
				errorCode: "VERSION_REQUIRED",
			},
		});
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(428);
		expect(error.message).toBe(
			`Message ${ID} exists already; name the version this change is based on (If-Match header or etag field)`,
		);
		expect(backend.calls()).toEqual([`POST ${PUBLISH}`]);
	});

	it("does not send a message twice", async () => {
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			validationReply(
				[
					{
						path: "status",
						code: "ALREADY_SENT",
						message: `Message with id ${ID} is already published. Published at: 2026-11-02T00:00:00.000Z`,
					},
				],
				undefined,
				{ current: panelMessage({ status: "sent" }) },
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe(
			`Message with id ${ID} is already published. Published at: 2026-11-02T00:00:00.000Z`,
		);
	});

	it("reports a message that is gone", async () => {
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			notFoundReply(`Draft message with ID ${ID} not found`),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("notFound");
	});

	it("archives with If-Match and takes the message from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			ARCHIVE,
			savedReply(
				`Draft message ${ID} archived successfully`,
				panelMessage({
					status: "archived",
					archivedAtUtc: "2026-11-13T10:01:00.000Z",
					etag: tableEtag(1),
				}),
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const result = await api.archive(ID, { etag: loaded.etag });

		expect(result).toMatchObject({ status: "archived", etag: tableEtag(1) });
		expect(backend.calls()).toEqual([`POST ${ARCHIVE}`]);
		expect(backend.only("POST", ARCHIVE).headers["if-match"]).toBe(
			tableEtag(0),
		);
	});

	it("shows the backend's words that a sent message cannot be archived", async () => {
		// "archiving a sent message is … 422 ALREADY_SENT for the panel".
		const sent = toMessage(
			panelMessage({ status: "sent", sentAtUtc: CREATED }),
		);
		const backend = fakeBackend().on(
			"POST",
			ARCHIVE,
			validationReply(
				[
					{
						path: "status",
						code: "ALREADY_SENT",
						message: `Cannot archive message with ID ${ID} because it is already published. Published messages cannot be archived.`,
					},
				],
				undefined,
				{ current: panelMessage({ status: "sent", sentAtUtc: CREATED }) },
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).archive(ID, { etag: sent.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.message).toBe(
			`Cannot archive message with ID ${ID} because it is already published. Published messages cannot be archived.`,
		);
		expect(error.issues).toEqual([{ path: "status", message: error.message }]);
	});

	it("brings a message back from the archive, to what it was", async () => {
		// "the panel archives a draft and brings it back".
		const archived = toMessage(
			panelMessage({
				status: "archived",
				archivedAtUtc: CREATED,
				etag: tableEtag(1),
			}),
		);
		const backend = fakeBackend().on(
			"POST",
			UNARCHIVE,
			savedReply(
				`Draft message ${ID} unarchived successfully`,
				panelMessage({ etag: tableEtag(2) }),
			),
		);
		const api = messagesArea(backend.transport, OPEN);

		const result = await api.unarchive(ID, { etag: archived.etag });

		expect(result).toMatchObject({
			status: "draft",
			archivedAtUtc: null,
			etag: tableEtag(2),
		});
		expect(backend.calls()).toEqual([`POST ${UNARCHIVE}`]);
		const post = backend.only("POST", UNARCHIVE);
		expect(post.headers["if-match"]).toBe(tableEtag(1));
		expect(bodyOf(post)).toEqual({ id: ID, dryRun: false });
	});

	it("is a conflict when the archived message was changed meanwhile", async () => {
		// "bringing back based on an older version is 409 with the stored message".
		const theirs = panelMessage({
			status: "archived",
			archivedAtUtc: CREATED,
			etag: tableEtag(2),
		});
		const backend = fakeBackend().on(
			"POST",
			UNARCHIVE,
			conflictReply(
				`Message with id ${ID} was changed since it was loaded`,
				theirs,
			),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).unarchive(ID, {
				etag: tableEtag(1),
			}),
		);
		expect(error.kind).toBe("conflict");
		expect((error.current as Message).status).toBe("archived");
	});

	it("still reads the list first where the stored [TEST] mark has to be seen", async () => {
		const real = panelMessage({ title: "prawdziwa wiadomość" });
		const backend = fakeBackend()
			.on("GET", LIST, listOf(real))
			.on(
				"POST",
				ARCHIVE,
				savedReply("x", panelMessage({ status: "archived" })),
			);
		const api = messagesArea(backend.transport, OPEN_FOR_TESTS);

		const error = await failure(api.archive(ID, { etag: tableEtag(0) }));

		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("title");
		expect(backend.calls()).toEqual([`GET ${LIST}`]);
	});

	it("archives a test message in that mode, with If-Match all the same", async () => {
		const backend = fakeBackend()
			.on("GET", LIST, listOf(panelMessage()))
			.on(
				"POST",
				ARCHIVE,
				savedReply(
					"x",
					panelMessage({ status: "archived", archivedAtUtc: CREATED }),
				),
			);
		const api = messagesArea(backend.transport, OPEN_FOR_TESTS);
		await api.archive(ID, { etag: tableEtag(0) });
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${ARCHIVE}`]);
		expect(backend.only("POST", ARCHIVE).headers["if-match"]).toBe(
			tableEtag(0),
		);
	});

	it("still compares with the list for a version the panel worked out itself", async () => {
		// A row the backend sent without an etag: nothing for it to check.
		const row = panelMessage({ etag: null });
		const unversioned = toMessage(row);
		const backend = fakeBackend()
			.on("GET", LIST, listOf(row))
			.on("POST", PUBLISH, savedReply("x", panelMessage({ status: "sent" })));
		const api = messagesArea(backend.transport, OPEN);
		await api.send(ID, { etag: unversioned.etag });
		expect(backend.calls()).toEqual([`GET ${LIST}`, `POST ${PUBLISH}`]);
		expect(backend.only("POST", PUBLISH).headers).not.toHaveProperty(
			"if-match",
		);
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const api = messagesArea(backend.transport, production());
		for (const run of [
			() => api.send(ID, { etag: loaded.etag }),
			() => api.archive(ID, { etag: loaded.etag }),
			// The backend can bring a message back now; the section is closed.
			() => api.unarchive(ID, { etag: loaded.etag }),
		]) {
			const error = await failure(run());
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("tylko do odczytu");
		}
		expect(backend.requests).toEqual([]);
	});

	it("goes back to refusing to unarchive when the switch is turned off again", async () => {
		const backend = fakeBackend();
		const error = await failure(
			messagesArea(
				backend.transport,
				production({ messageUnarchive: false, writes: { messages: "on" } }),
			).unarchive(ID, { etag: loaded.etag }),
		);
		expect(error.message).toContain("nie potrafi jeszcze przywracać");
		expect(backend.requests).toEqual([]);
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("messagesArea: the stricter backend", () => {
	const loaded = toMessage(panelMessage());

	it("passes on every reason a message cannot be sent, each at its field", async () => {
		// tests/handlers/messagesPanelContract.test.ts: sending is held to the
		// rules of the panel's form, the editor's content errors included.
		const backend = fakeBackend().on(
			"POST",
			PUBLISH,
			validationReply([
				{
					path: "from",
					code: "TOO_SHORT",
					message: `From is less than 3 characters for message with id ${ID}`,
				},
				{
					path: "fancyContent",
					code: "REQUIRED",
					message: `FancyContent is empty for message with id ${ID}`,
				},
				{
					path: "targetGroup",
					code: "REQUIRED",
					message: `TargetGroup is not set for message with id ${ID}`,
				},
				{
					path: "title",
					code: "TOO_SHORT",
					message: `Title is less than 3 characters for message with id ${ID}`,
				},
				{
					path: "targetGroupValue",
					code: "NOT_ALLOWED",
					message: `TargetGroupValue is set but target group all takes none, for message with id ${ID}`,
				},
			]),
		);
		const error = await failure(
			messagesArea(backend.transport, OPEN).send(ID, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"from",
			"fancyContent",
			"targetGroup",
			"title",
			"targetGroupValue",
		]);
		expect(error.issues[0]?.message).toBe(
			`From is less than 3 characters for message with id ${ID}`,
		);
		expect(error.message).toBe(
			error.issues.map((issue) => issue.message).join("; "),
		);
	});

	it("names a message by its id exactly as stored, and always says a send is for real", async () => {
		// "an id with spaces is refused"; "publish needs an explicit dryRun".
		const backend = fakeBackend()
			.on("POST", PUBLISH, savedReply("x", panelMessage({ status: "sent" })))
			.on(
				"POST",
				ARCHIVE,
				savedReply("x", panelMessage({ status: "archived" })),
			)
			.on("POST", UNARCHIVE, savedReply("x", panelMessage()));
		const api = messagesArea(backend.transport, OPEN);
		await api.send(` ${ID}\n`, { etag: loaded.etag });
		await api.archive(`${ID} `, { etag: loaded.etag });
		await api.unarchive(ID, { etag: loaded.etag });
		for (const request of backend.requests) {
			// Never `dryRun: true`: archiving and bringing back have none.
			expect(bodyOf(request), request.path).toEqual({ id: ID, dryRun: false });
		}
	});

	it("names the version in the header only, so header and body can never disagree", async () => {
		// "header and body naming different versions is etag: VERSION_MISMATCH".
		const backend = fakeBackend()
			.on("POST", UPSERT, savedReply("x", panelMessage({ etag: tableEtag(1) })))
			.on("POST", PUBLISH, savedReply("x", panelMessage({ status: "sent" })));
		const api = messagesArea(backend.transport, OPEN);
		await api.save(
			{ ...loaded, title: "[TEST] poprawka" },
			{ etag: loaded.etag },
		);
		await api.send(ID, { etag: loaded.etag });
		for (const request of backend.requests) {
			expect(request.headers["if-match"]).toBe(tableEtag(0));
			expect(bodyOf(request)).not.toHaveProperty("etag");
			// What only Retool's route may do is never asked for.
			expect(bodyOf(request)).not.toHaveProperty("overrideAlreadySent");
		}
	});
});

// ─── The backend as tightened once more (third pass) ────────────────────────

describe("fromMessage: descriptions, senders, dates and nothing of the panel's own", () => {
	const EDITING_CONTRACT = { etag: true } as const;
	// MESSAGE_SAVE_FIELDS of the backend's src/config/panelFields.ts.
	const MESSAGE = [
		"id",
		"etag",
		"title",
		"from",
		"status",
		"createdAtUtc",
		"targetGroup",
		"targetGroupValue",
		"fancyContent",
		"sentAtUtc",
		"archivedAtUtc",
		"sendingStartedAtUtc",
		"overrideAlreadySent",
	];

	it("sends the description and the sender without the spaces around them", () => {
		const body = fromMessage(
			{
				...toMessage(panelMessage()),
				title: " [TEST] nowy plan ",
				from: "Codziennie Fit\n",
			},
			EDITING_CONTRACT,
		);
		expect(body.title).toBe("[TEST] nowy plan");
		expect(body.from).toBe("Codziennie Fit");
	});

	it("sends the moment the draft was made as a full instant", () => {
		expect(
			fromMessage(toMessage(panelMessage()), EDITING_CONTRACT).createdAtUtc,
		).toBe(CREATED);
		expect(
			fromMessage(
				{ ...blankMessage("2026-11-13T10:00+01:00"), title: "x" },
				EDITING_CONTRACT,
			).createdAtUtc,
		).toBe("2026-11-13T09:00:00.000Z");
	});

	it("sends only fields the backend takes or returns for a message", () => {
		const bodies = [
			fromMessage(
				toMessage(
					panelMessage({
						sendingStartedAtUtc: "2026-11-13T10:00:30.000Z",
						fancyContent: [
							{ type: "Text", content: "Cześć!" },
							{
								type: "Image",
								content: "",
								metadata: {
									imageRelativePath: "messages/a.webp",
									heightToWidthRatio: 0.5,
								},
							},
						],
					}),
				),
				EDITING_CONTRACT,
			),
			fromMessage(
				{ ...blankMessage(CREATED), title: "Nowa" },
				EDITING_CONTRACT,
			),
		];
		for (const body of bodies) {
			expect(Object.keys(body).filter((key) => !MESSAGE.includes(key))).toEqual(
				[],
			);
			for (const block of body.fancyContent as Record<string, unknown>[]) {
				expect(
					Object.keys(block).filter(
						(key) => !["type", "content", "metadata"].includes(key),
					),
				).toEqual([]);
				if (block.metadata) {
					expect(Object.keys(block.metadata).toSorted()).toEqual([
						"heightToWidthRatio",
						"imageRelativePath",
					]);
				}
			}
		}
		// The panel's own: the "last changed" time it works out for the list.
		expect(bodies[0]).not.toHaveProperty("updatedAtUtc");
		// A new message carries no id of its own.
		expect(bodies[1]).not.toHaveProperty("id");
	});

	it("names a message, and nothing about what is in it, in an action", async () => {
		// MESSAGE_ACTION_FIELDS: id, dryRun, etag.
		const loaded = toMessage(panelMessage());
		const backend = fakeBackend()
			.on("POST", PUBLISH, savedReply("x", panelMessage({ status: "sent" })))
			.on(
				"POST",
				ARCHIVE,
				savedReply("x", panelMessage({ status: "archived" })),
			)
			.on("POST", UNARCHIVE, savedReply("x", panelMessage()));
		const api = messagesArea(backend.transport, OPEN);
		await api.send(ID, { etag: loaded.etag });
		await api.archive(ID, { etag: loaded.etag });
		await api.unarchive(ID, { etag: loaded.etag });
		for (const request of backend.requests) {
			expect(
				Object.keys(bodyOf(request)).filter(
					(key) => !["id", "dryRun", "etag"].includes(key),
				),
			).toEqual([]);
		}
	});
});
