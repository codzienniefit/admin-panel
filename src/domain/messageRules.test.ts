import { describe, expect, it } from "vitest";
import { internalConfigFixture } from "@/data/api/mock/configFixtures";
import { blankMessage, type Message } from "@/data/schemas/message";
import {
	afterMessageAction,
	isEditable,
	messageActionIssues,
	messageEditIssues,
	messageIssues,
	recipientsText,
	requiredGroupValue,
	type TargetGroups,
} from "./messageRules";

const groups: TargetGroups = [
	...internalConfigFixture.draftMessageTargetGroups,
	{
		state: "challenge",
		label: "Uczestnicy wyzwania",
		requiresTargetGroupValue: "challengeId",
	},
];

const NOW = "2026-11-10T09:00:00.000Z";

const ready: Message = {
	...blankMessage("2026-11-01T08:00:00.000Z"),
	id: "M1",
	etag: "1",
	status: "draft",
	title: "Start wyzwania",
	from: "Codziennie Fit",
	targetGroup: "all",
	fancyContent: [
		{ type: "Title", content: "Ruszamy w poniedziałek", metadata: null },
		{
			type: "Text",
			content: "Siedem dni, <b>jeden</b> trening dziennie.",
			metadata: null,
		},
	],
	sentAtUtc: null,
	archivedAtUtc: null,
	updatedAtUtc: "2026-11-01T08:00:00.000Z",
};

const paths = (message: Message, purpose?: "draft" | "send") =>
	messageIssues(message, groups, purpose).map((issue) => issue.path);

describe("message rules", () => {
	it("lets a draft be saved with only a description", () => {
		expect(
			paths({ ...ready, from: "", targetGroup: null, fancyContent: [] }),
		).toEqual([]);
	});

	it("needs a description even for a draft", () => {
		expect(paths({ ...ready, title: "   " })).toEqual(["title"]);
	});

	it("refuses a target group the configuration does not have", () => {
		expect(paths({ ...ready, targetGroup: "vip" })).toEqual(["targetGroup"]);
	});

	it("accepts a complete message for sending", () => {
		expect(paths(ready, "send")).toEqual([]);
	});

	it("asks for the full set before sending", () => {
		expect(
			paths(
				{
					...ready,
					title: "Ab",
					from: "",
					targetGroup: null,
					fancyContent: [],
				},
				"send",
			),
		).toEqual(["title", "from", "targetGroup", "fancyContent"]);
	});

	it("wants a sender of at least three characters", () => {
		expect(paths({ ...ready, from: "CF" }, "send")).toEqual(["from"]);
		expect(paths({ ...ready, from: " CF " }, "send")).toEqual(["from"]);
	});

	it("refuses to send content the app would show wrongly", () => {
		const broken: Message = {
			...ready,
			fancyContent: [
				{ type: "Title", content: "Sprawdź <i>Pro</i>", metadata: null },
			],
		};
		// As a draft it can still be saved and fixed later.
		expect(paths(broken)).toEqual([]);
		expect(paths(broken, "send")).toEqual(["fancyContent"]);
	});

	it("needs the extra value when the group requires one", () => {
		expect(requiredGroupValue(groups, "challenge")).toBe("challengeId");
		expect(requiredGroupValue(groups, "all")).toBeNull();
		expect(requiredGroupValue(groups, null)).toBeNull();
		const toChallenge = { ...ready, targetGroup: "challenge" };
		expect(paths(toChallenge, "send")).toEqual(["targetGroupValue"]);
		expect(paths({ ...toChallenge, targetGroupValue: "  " }, "send")).toEqual([
			"targetGroupValue",
		]);
		expect(paths({ ...toChallenge, targetGroupValue: "C2" }, "send")).toEqual(
			[],
		);
		// A draft may leave it for later.
		expect(paths(toChallenge)).toEqual([]);
	});
});

describe("message actions", () => {
	const sent: Message = { ...ready, status: "sent", sentAtUtc: NOW };
	const archivedDraft: Message = {
		...ready,
		status: "archived",
		archivedAtUtc: NOW,
	};
	const messages = (
		message: Message,
		action: "send" | "archive" | "unarchive",
	) =>
		messageActionIssues(message, action, groups).map((issue) => issue.message);

	it("sends a complete draft", () => {
		expect(messages(ready, "send")).toEqual([]);
		expect(afterMessageAction(ready, "send", NOW)).toEqual({
			status: "sent",
			sentAtUtc: NOW,
			archivedAtUtc: null,
		});
	});

	it("refuses to send an incomplete draft, with the reasons", () => {
		expect(
			messageActionIssues({ ...ready, targetGroup: null }, "send", groups),
		).toEqual([{ path: "targetGroup", message: "Wybierz odbiorców" }]);
	});

	it("never sends the same message twice", () => {
		expect(messages(sent, "send")).toEqual([
			"Ta wiadomość została już wysłana",
		]);
	});

	it("refuses to send from the archive", () => {
		expect(messages(archivedDraft, "send")).toHaveLength(1);
		expect(messageActionIssues(archivedDraft, "send", groups)[0]?.path).toBe(
			"status",
		);
	});

	it("archives a draft or a sent message, once", () => {
		expect(messages(ready, "archive")).toEqual([]);
		expect(messages(sent, "archive")).toEqual([]);
		expect(messages(archivedDraft, "archive")).toHaveLength(1);
		expect(
			afterMessageAction(sent, "archive", "2026-12-01T00:00:00.000Z"),
		).toEqual({
			status: "archived",
			sentAtUtc: NOW,
			archivedAtUtc: "2026-12-01T00:00:00.000Z",
		});
	});

	it("brings a message back from the archive as what it was", () => {
		expect(messages(ready, "unarchive")).toHaveLength(1);
		expect(messages(archivedDraft, "unarchive")).toEqual([]);
		expect(afterMessageAction(archivedDraft, "unarchive", NOW).status).toBe(
			"draft",
		);
		const archivedSent: Message = { ...sent, status: "archived" };
		expect(afterMessageAction(archivedSent, "unarchive", NOW)).toEqual({
			status: "sent",
			sentAtUtc: NOW,
			archivedAtUtc: null,
		});
	});

	it("lets only a draft be edited", () => {
		expect(isEditable("draft")).toBe(true);
		expect(messageEditIssues("draft")).toEqual([]);
		for (const status of ["sent", "archived"] as const) {
			expect(isEditable(status)).toBe(false);
			expect(messageEditIssues(status).map((issue) => issue.path)).toEqual([
				"status",
			]);
		}
	});

	it("says in words who will get the message", () => {
		expect(recipientsText(groups, "all")).toBe("wszyscy użytkownicy aplikacji");
		expect(recipientsText(groups, "subscribers")).toContain("Pro");
		expect(recipientsText(groups, "challenge")).toBe("Uczestnicy wyzwania");
		expect(recipientsText(groups, null)).toContain("nie wybrano");
		expect(recipientsText(groups, "vip")).toBe("nieznana grupa odbiorców");
	});
});
