import { describe, expect, it } from "vitest";
import { blankMessage, type Message } from "@/data/schemas/message";
import { filterMessages } from "./messageFilters";

const make = (id: string, patch: Partial<Message>): Message => ({
	...blankMessage("2026-01-01T00:00:00.000Z"),
	id,
	etag: "1",
	status: "draft",
	from: "Codziennie Fit",
	sentAtUtc: null,
	archivedAtUtc: null,
	updatedAtUtc: "2026-01-01T00:00:00.000Z",
	...patch,
});

const messages = [
	make("M1", {
		title: "Życzenia świąteczne",
		status: "sent",
		targetGroup: "all",
		createdAtUtc: "2026-02-01T00:00:00.000Z",
		sentAtUtc: "2026-02-03T00:00:00.000Z",
	}),
	make("M2", {
		title: "Zapowiedź wyzwania",
		targetGroup: "subscribers",
		createdAtUtc: "2026-04-01T00:00:00.000Z",
	}),
	make("M3", {
		title: "Ankieta",
		from: "Zespół Łódź",
		status: "sent",
		targetGroup: "subscribers",
		createdAtUtc: "2026-03-01T00:00:00.000Z",
		sentAtUtc: "2026-03-01T06:00:00.000Z",
	}),
	make("M4", {
		title: "Stara promocja",
		status: "archived",
		targetGroup: "all",
		createdAtUtc: "2025-01-01T00:00:00.000Z",
	}),
];

const ids = (list: Message[]) => list.map((message) => message.id);

describe("message filters", () => {
	it("hides the archive unless it is asked for", () => {
		expect(ids(filterMessages(messages, {}))).toEqual(["M2", "M3", "M1"]);
		expect(ids(filterMessages(messages, { status: "archived" }))).toEqual([
			"M4",
		]);
	});

	it("filters by status and by target group", () => {
		expect(ids(filterMessages(messages, { status: "sent" }))).toEqual([
			"M3",
			"M1",
		]);
		expect(ids(filterMessages(messages, { group: "subscribers" }))).toEqual([
			"M2",
			"M3",
		]);
		expect(
			ids(filterMessages(messages, { status: "draft", group: "all" })),
		).toEqual([]);
	});

	it("searches the description, the sender and the id, without diacritics", () => {
		expect(ids(filterMessages(messages, { q: "zyczenia" }))).toEqual(["M1"]);
		expect(ids(filterMessages(messages, { q: "lodz" }))).toEqual(["M3"]);
		expect(ids(filterMessages(messages, { q: "m2" }))).toEqual(["M2"]);
		expect(ids(filterMessages(messages, { q: "nic takiego" }))).toEqual([]);
	});

	it("sorts by creation, by sending (unsent last) and by description", () => {
		expect(ids(filterMessages(messages, { sort: "created" }))).toEqual([
			"M2",
			"M3",
			"M1",
		]);
		expect(ids(filterMessages(messages, { sort: "sent" }))).toEqual([
			"M3",
			"M1",
			"M2",
		]);
		expect(ids(filterMessages(messages, { sort: "title" }))).toEqual([
			"M3",
			"M2",
			"M1",
		]);
	});

	it("does not reorder the list it was given", () => {
		const before = ids(messages);
		filterMessages(messages, { sort: "title" });
		expect(ids(messages)).toEqual(before);
	});
});
