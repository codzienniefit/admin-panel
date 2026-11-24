import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ALL_CAPABILITIES,
	type Capabilities,
	isReadOnly,
	PRODUCTION_CAPABILITIES,
} from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import { blankBadge } from "@/data/schemas/badge";
import { blankChallenge } from "@/data/schemas/challenge";
import { blankMessage } from "@/data/schemas/message";
import { blankOffer } from "@/data/schemas/offer";
import { blankPlanning, UNSAVED_ETAG } from "@/data/schemas/planning";
import { blankWorkout } from "@/data/schemas/workout";
import { toBadge } from "./badges";
import { toChallenge } from "./challenges";
import { createHttpApi } from "./index";
import { toMessage } from "./messages";
import { toOffer } from "./offers";
import { defaultPlannerSettings } from "./panelDocs";
import {
	capabilities,
	docEtag,
	type FakeBackend,
	failure,
	fakeBackend,
	firebaseRecord,
	json,
	panelChallenge,
	panelDoc,
	panelPath,
	production,
	SWITCHED_OFF,
	wireBadge,
	wireChallenge,
	wireMessage,
	wireUserSummary,
	wireWorkout,
} from "./testSupport";
import { toWorkout } from "./workouts";

// The client as a whole: every area wired to one transport and one set of
// capabilities, and the two things only the whole can show: the challenge
// list shared with the planning list, and Produkcja refusing every write.

afterEach(() => {
	vi.useRealTimers();
});

const UID = "Qm3xT7pLr9VbN2sK8dHfJ4wZcYa1";
const PLANNING = "manage/panelDocs/challengePlanning";

const api = (backend: FakeBackend, caps: Capabilities): ApiClient =>
	createHttpApi({ transport: backend.transport, capabilities: caps });

/** A backend that answers every read the panel makes on a first load. */
function readableBackend(): FakeBackend {
	return fakeBackend()
		.on(
			"GET",
			"manageChallenges",
			json([wireChallenge({ id: "C1" }), wireChallenge({ id: "C12" })]),
		)
		.on("GET", "manageWorkouts", json([wireWorkout()]))
		.on("GET", "manageBadges", json([wireBadge()]))
		.on(
			"GET",
			"manageMessageDrafts/list",
			json({ count: 1, messages: [wireMessage()] }),
		)
		.on(
			"GET",
			"manageMedia/files",
			json({
				files: [
					{
						path: "workouts/a.webp",
						type: "image",
						createdAtUtc: "2026-11-03T12:00:00.000Z",
					},
				],
			}),
		)
		.on(
			"GET",
			"manageUsers",
			json({ users: [wireUserSummary()], totalMatches: 1, truncated: false }),
		)
		.on(
			"GET",
			`accounts/${UID}`,
			json({ hasProSubscription: false, account: firebaseRecord() }),
		)
		.on("GET", `manageUserBadges/${UID}`, json({ sections: [] }))
		.on("GET", `manageUserBadges/${UID}/grants`, json([]))
		.on(
			"GET",
			`manageUserProgress/${UID}`,
			json({ workouts: [], challenges: [] }),
		);
}

describe("createHttpApi", () => {
	it("has every section of the ApiClient", () => {
		const client = api(fakeBackend(), PRODUCTION_CAPABILITIES);
		expect(Object.keys(client).toSorted()).toEqual([
			"badges",
			"cache",
			"challenges",
			"config",
			"media",
			"messages",
			"offers",
			"planning",
			"settings",
			"users",
			"workouts",
		]);
		expect(Object.keys(client.challenges).toSorted()).toEqual([
			"create",
			"list",
			"save",
		]);
		expect(Object.keys(client.planning).toSorted()).toEqual(["list", "save"]);
		expect(Object.keys(client.settings).toSorted()).toEqual([
			"planner",
			"savePlanner",
		]);
	});

	it("makes no request just by being created", () => {
		const backend = fakeBackend();
		api(backend, ALL_CAPABILITIES);
		expect(backend.requests).toEqual([]);
	});
});

describe("Produkcja today: everything can be read", () => {
	it("is what PRODUCTION_CAPABILITIES describes", () => {
		expect(isReadOnly(PRODUCTION_CAPABILITIES)).toBe(true);
	});

	it("reads every section, each from its own endpoint", async () => {
		const backend = readableBackend();
		const client = api(backend, PRODUCTION_CAPABILITIES);

		expect((await client.challenges.list()).map((item) => item.id)).toEqual([
			"C1",
			"C12",
		]);
		expect((await client.workouts.list()).map((item) => item.id)).toEqual([
			"W12",
		]);
		expect((await client.badges.list()).map((item) => item.id)).toEqual([
			"n_7",
		]);
		expect((await client.messages.list()).map((item) => item.status)).toEqual([
			"draft",
		]);
		expect((await client.media.list()).map((item) => item.path)).toEqual([
			"workouts/a.webp",
		]);
		expect((await client.users.search("anna@example.com")).totalMatches).toBe(
			1,
		);
		expect((await client.users.get(UID)).uid).toBe(UID);
		expect(await client.users.badges(UID)).toEqual([]);
		expect(await client.users.progress(UID)).toEqual({
			workouts: [],
			challenges: [],
		});

		expect(backend.requests.every((request) => request.method === "GET")).toBe(
			true,
		);
		expect(backend.calls().toSorted()).toEqual(
			[
				"GET manageChallenges",
				"GET manageWorkouts",
				"GET manageBadges",
				"GET manageMessageDrafts/list",
				"GET manageMedia/files",
				"GET manageUsers",
				`GET accounts/${UID}`,
				`GET manageUserBadges/${UID}`,
				`GET manageUserBadges/${UID}/grants`,
				`GET manageUserProgress/${UID}`,
			].toSorted(),
		);
	});

	it("reads planning documents and the planner's settings from the store", async () => {
		const backend = readableBackend()
			.on(
				"GET",
				PLANNING,
				json([
					{
						id: "C12",
						etag: '"0f8fad5bd9cb469fa16570867728950e"',
						updatedAtUtc: "2026-11-13T10:00:00.000Z",
						updatedBy: "uid-ada",
						body: { note: "Start po majówce" },
					},
				]),
			)
			.on("GET", "manage/panelDocs/settings/planner", {
				status: 404,
				body: {
					error: "Nie ma takiego dokumentu.",
					errorCode: "PANEL_DOC_NOT_FOUND",
				},
			});
		const client = api(backend, PRODUCTION_CAPABILITIES);

		expect(
			(await client.planning.list()).map((item) => [item.id, item.note]),
		).toEqual([
			["C1", ""],
			["C12", "Start po majówce"],
		]);
		expect(await client.settings.planner()).toEqual(defaultPlannerSettings());
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`GET ${PLANNING}`,
			"GET manage/panelDocs/settings/planner",
		]);
		expect(backend.only("GET", PLANNING).query).toEqual({ bodies: "true" });
	});

	it("asks for the bin as well, where the panel shows it", async () => {
		const backend = readableBackend();
		const client = api(backend, PRODUCTION_CAPABILITIES);
		await client.challenges.list();
		await client.workouts.list();
		expect(backend.only("GET", "manageChallenges").query).toEqual({
			includeDeleted: "true",
		});
		expect(backend.only("GET", "manageWorkouts").query).toEqual({
			includeDeleted: "true",
		});
	});

	it("gives blank planning and default settings without asking for a store that is not there", async () => {
		// The fallback: the `planning` switch back off.
		const backend = readableBackend();
		const client = api(backend, production({ planning: false }));

		expect(await client.planning.list()).toEqual([
			blankPlanning("C1"),
			blankPlanning("C12"),
		]);
		expect(await client.settings.planner()).toEqual(defaultPlannerSettings());

		// Only the challenge ids were needed.
		expect(backend.calls()).toEqual(["GET manageChallenges"]);
	});

	it("links a file through the panel's own address", () => {
		const backend = fakeBackend();
		expect(
			api(backend, PRODUCTION_CAPABILITIES).media.urlFor("workouts/a.webp"),
		).toBe("/api/files?path=workouts%2Fa.webp");
		expect(backend.requests).toEqual([]);
	});
});

describe("Produkcja today: nothing can be written", () => {
	const challenge = toChallenge(wireChallenge());
	const workout = toWorkout(wireWorkout());
	const badge = toBadge(wireBadge());
	const message = toMessage(wireMessage());
	const offer = toOffer({
		id: "o_1",
		etag: 'W/"1"',
		code: "LATO2026",
		offeringId: "promo",
		active: true,
	});
	const file = new Blob(["abc"], { type: "image/webp" });

	// Every call of the ApiClient that changes something, each on an item
	// that carries the [TEST] mark, so the mark alone opens nothing.
	const writes: [string, (client: ApiClient) => Promise<unknown>][] = [
		[
			"challenges.create",
			(client) =>
				client.challenges.create({
					...blankChallenge(),
					internalTitle: "[TEST] nowe",
				}),
		],
		[
			"challenges.save",
			(client) => client.challenges.save(challenge, { etag: challenge.etag }),
		],
		[
			"workouts.create",
			(client) =>
				client.workouts.create({
					...blankWorkout(),
					internalTitle: "[TEST] nowy",
					videoUrl: "https://youtu.be/dQw4w9WgXcQ",
				}),
		],
		[
			"workouts.save",
			(client) => client.workouts.save(workout, { etag: workout.etag }),
		],
		[
			"badges.create",
			(client) =>
				client.badges.create({ ...blankBadge(), comment: "[TEST] nowa" }),
		],
		[
			"badges.save",
			(client) => client.badges.save(badge, { etag: badge.etag }),
		],
		[
			"badges.remove",
			(client) => client.badges.remove(badge.id, { etag: badge.etag }),
		],
		[
			"messages.create",
			(client) =>
				client.messages.create({ ...blankMessage(), title: "[TEST] nowa" }),
		],
		[
			"messages.save",
			(client) => client.messages.save(message, { etag: message.etag }),
		],
		[
			"messages.send",
			(client) => client.messages.send(message.id, { etag: message.etag }),
		],
		[
			"messages.archive",
			(client) => client.messages.archive(message.id, { etag: message.etag }),
		],
		[
			"messages.unarchive",
			(client) => client.messages.unarchive(message.id, { etag: message.etag }),
		],
		[
			"media.upload",
			(client) => client.media.upload(file, { relativePath: "test/a.webp" }),
		],
		[
			"config.setPromotedChallenge",
			(client) => client.config.setPromotedChallenge("C12"),
		],
		[
			"config.setPromotedChallenge(null)",
			(client) => client.config.setPromotedChallenge(null),
		],
		[
			"users.changeEmail",
			(client) => client.users.changeEmail(UID, "anna.nowa@example.com"),
		],
		["users.grantBadge", (client) => client.users.grantBadge(UID, "s_4")],
		[
			"users.revokeBadge",
			(client) =>
				client.users.revokeBadge(UID, {
					badgeId: "s_4",
					earnedAtUtc: "2026-10-01T10:00:00.000Z",
					grantId: "g-1",
				}),
		],
		[
			"planning.save",
			(client) =>
				client.planning.save(blankPlanning("C12"), { etag: UNSAVED_ETAG }),
		],
		[
			"settings.savePlanner",
			(client) =>
				client.settings.savePlanner(defaultPlannerSettings(), {
					etag: UNSAVED_ETAG,
				}),
		],
		[
			"offers.create",
			(client) => client.offers.create({ ...blankOffer(), code: "TEST_NOWA" }),
		],
		[
			"offers.save",
			(client) => client.offers.save(offer, { etag: offer.etag }),
		],
		[
			"offers.setActive",
			(client) =>
				client.offers.setActive(offer.id, false, { etag: offer.etag }),
		],
	];

	it.each(writes)(
		"%s is refused without a single request",
		async (_call, run) => {
			const backend = fakeBackend();
			const error = await failure(run(api(backend, PRODUCTION_CAPABILITIES)));
			// A refusal the screen shows next to the form, not a failure to retry.
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("Produkcja");
			expect(error.issues).toHaveLength(1);
			expect(error.status).toBeUndefined();
			expect(backend.requests).toEqual([]);
		},
	);

	it("lets the app's cache be cleared: that changes no data", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageCache/purge",
			json({ purgedAtUtc: "2026-11-16T10:00:00.000Z" }),
		);
		const client = api(backend, PRODUCTION_CAPABILITIES);
		expect(await client.cache.purge()).toEqual({
			purgedAtUtc: "2026-11-16T10:00:00.000Z",
		});
		expect(backend.calls()).toEqual(["POST manageCache/purge"]);
	});

	it("covers every call of the ApiClient that is not a read", () => {
		// Open on purpose: it changes no data (the test above).
		const openInProduction = new Set(["cache.purge"]);
		const reads = new Set([
			"config.workouts",
			"config.internal",
			"challenges.list",
			"workouts.list",
			"media.list",
			"media.urlFor",
			"badges.list",
			"messages.list",
			"users.search",
			"users.get",
			"users.badges",
			"users.progress",
			"planning.list",
			"settings.planner",
			"offers.list",
			"offers.choices",
		]);
		const client = api(fakeBackend(), PRODUCTION_CAPABILITIES);
		const all = Object.entries(client).flatMap(([area, calls]) =>
			Object.keys(calls).map((call) => `${area}.${call}`),
		);
		const covered = new Set(
			writes.map(([call]) => call.replace(/\(.*\)$/, "")),
		);
		expect(
			all
				.filter((call) => !reads.has(call) && !openInProduction.has(call))
				.toSorted(),
		).toEqual([...covered].toSorted());
	});

	it("still refuses when one other section is opened", async () => {
		for (const caps of [
			capabilities({ writes: { workouts: "on" } }),
			production({ writes: { workouts: "on" } }),
		]) {
			const backend = fakeBackend();
			const client = api(backend, caps);
			for (const [call, run] of writes) {
				if (call.startsWith("workouts.")) continue;
				expect((await failure(run(client))).kind, call).toBe("validation");
			}
			expect(backend.requests).toEqual([]);
		}
	});

	it.each(writes)(
		"%s was refused the same way before the backend had its features",
		async (_call, run) => {
			const backend = fakeBackend();
			const error = await failure(run(api(backend, SWITCHED_OFF)));
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("Produkcja");
			expect(error.status).toBeUndefined();
			expect(backend.requests).toEqual([]);
		},
	);
});

describe("the challenge list is shared with the planning list", () => {
	// Without the planning store the challenge list is the only request
	// either list makes, so what is shared shows in the list of calls.
	const NO_STORE = SWITCHED_OFF;

	it("loads the challenges once, and the documents once, in Produkcja as it is", async () => {
		const backend = readableBackend().on("GET", PLANNING, json([]));
		const client = api(backend, PRODUCTION_CAPABILITIES);

		const [challenges, planning] = await Promise.all([
			client.challenges.list(),
			client.planning.list(),
		]);

		expect(challenges.map((item) => item.id)).toEqual(["C1", "C12"]);
		expect(planning).toEqual([blankPlanning("C1"), blankPlanning("C12")]);
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`GET ${PLANNING}`,
		]);
	});

	it("loads the challenges once when both lists are asked for together", async () => {
		const backend = readableBackend();
		const client = api(backend, NO_STORE);

		const [challenges, planning] = await Promise.all([
			client.challenges.list(),
			client.planning.list(),
		]);

		expect(challenges.map((item) => item.id)).toEqual(["C1", "C12"]);
		expect(planning.map((item) => item.id)).toEqual(["C1", "C12"]);
		expect(backend.calls()).toEqual(["GET manageChallenges"]);
	});

	it("does the same whichever of the two is asked for first", async () => {
		const backend = readableBackend();
		const client = api(backend, NO_STORE);
		const planning = client.planning.list();
		const challenges = client.challenges.list();
		await Promise.all([planning, challenges]);
		expect(backend.calls()).toEqual(["GET manageChallenges"]);
	});

	it("loads them once for callers of the challenge list at the same moment", async () => {
		const backend = readableBackend();
		const client = api(backend, NO_STORE);
		await Promise.all([client.challenges.list(), client.challenges.list()]);
		expect(backend.calls()).toEqual(["GET manageChallenges"]);
	});

	it("never answers the challenge list itself from memory", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([wireChallenge({ id: "C1" })]),
			json([wireChallenge({ id: "C1" }), wireChallenge({ id: "C2" })]),
		);
		const client = api(backend, NO_STORE);
		expect(await client.challenges.list()).toHaveLength(1);
		expect(await client.challenges.list()).toHaveLength(2);
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"GET manageChallenges",
		]);
	});

	it("uses challenge ids loaded a moment ago for the planning list", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-11T10:00:00.000Z"));
		const backend = readableBackend();
		const client = api(backend, NO_STORE);

		await client.challenges.list();
		vi.setSystemTime(new Date("2026-11-11T10:00:09.000Z"));
		expect((await client.planning.list()).map((item) => item.id)).toEqual([
			"C1",
			"C12",
		]);
		expect(backend.calls()).toEqual(["GET manageChallenges"]);
	});

	it("loads the challenges again for the planning list once they are ten seconds old", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-11T10:00:00.000Z"));
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([wireChallenge({ id: "C1" })]),
			json([wireChallenge({ id: "C1" }), wireChallenge({ id: "C2" })]),
		);
		const client = api(backend, NO_STORE);

		await client.challenges.list();
		vi.setSystemTime(new Date("2026-11-11T10:00:10.000Z"));
		expect((await client.planning.list()).map((item) => item.id)).toEqual([
			"C1",
			"C2",
		]);
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"GET manageChallenges",
		]);
	});

	it("fails the planning list when the challenges cannot be loaded, and recovers", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			{ status: 503 },
			json([wireChallenge({ id: "C1" })]),
		);
		const client = api(backend, NO_STORE);
		expect((await failure(client.planning.list())).kind).toBe("server");
		expect((await client.planning.list()).map((item) => item.id)).toEqual([
			"C1",
		]);
	});
});

describe("a backend that has everything", () => {
	it("reads planning documents and settings from the store", async () => {
		const backend = readableBackend()
			.on(
				"GET",
				PLANNING,
				json([
					{
						id: "C12",
						etag: 'W/"1"',
						updatedAtUtc: "2026-11-10T09:00:00.000Z",
						body: { note: "Start po majówce" },
					},
				]),
			)
			.on("GET", "manage/panelDocs/settings/planner", {
				status: 404,
				body: { error: "Not found" },
			});
		const client = api(backend, ALL_CAPABILITIES);

		const planning = await client.planning.list();

		expect(planning.map((item) => [item.id, item.etag, item.note])).toEqual([
			["C1", UNSAVED_ETAG, ""],
			["C12", 'W/"1"', "Start po majówce"],
		]);
		expect(await client.settings.planner()).toEqual(defaultPlannerSettings());
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`GET ${PLANNING}`,
			"GET manage/panelDocs/settings/planner",
		]);
	});

	it("lets a write through to the backend", async () => {
		const etag = 'W/"1"';
		const stored = wireWorkout({ etag, status: "published" });
		const backend = fakeBackend().on(
			"POST",
			"manageWorkouts",
			json({ ...stored, title: "Nowy tytuł", etag: 'W/"2"' }),
		);
		const client = api(backend, ALL_CAPABILITIES);
		const result = await client.workouts.save(
			{ ...toWorkout(stored), title: "Nowy tytuł" },
			{ etag },
		);
		expect(result).toMatchObject({ title: "Nowy tytuł", etag: 'W/"2"' });
		expect(backend.calls()).toEqual(["POST manageWorkouts"]);
	});
});

describe("the whole client on the backend as built", () => {
	it("keeps what was planned about a variant when the backend gives it an id", async () => {
		// Planned while the variant had none (the panel showed
		// "level-beginner"); then the challenge was saved from Retool.
		const backend = fakeBackend()
			.on("GET", "manageChallenges", json([panelChallenge()]))
			.on(
				"GET",
				PLANNING,
				json([
					panelDoc("C12", {
						note: "Start po majówce",
						variants: {
							"level-beginner": {
								planTypeId: null,
								prepStatus: "in_progress",
								prepNote: "brakuje nagrań",
								notes: "",
								days: {},
								cards: {},
							},
						},
					}),
				]),
			);
		const client = api(backend, PRODUCTION_CAPABILITIES);

		const [challenges, planning] = await Promise.all([
			client.challenges.list(),
			client.planning.list(),
		]);

		const pathId = challenges[0]?.paths[0]?.pathId ?? "";
		expect(pathId).toBe("p_0a1b2c3d4e5f");
		expect(planning[0]?.variants[pathId]?.prepNote).toBe("brakuje nagrań");
		expect(planning[0]?.variants).not.toHaveProperty("level-beginner");
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`GET ${PLANNING}`,
		]);
	});

	it("shows a variant from before path ids under the id a save will propose", async () => {
		const backend = fakeBackend()
			.on(
				"GET",
				"manageChallenges",
				json([panelChallenge({ paths: [panelPath({ pathId: null })] })]),
			)
			.on(
				"GET",
				PLANNING,
				json([
					panelDoc("C12", {
						variants: {
							"level-beginner": {
								planTypeId: "balanced",
								prepStatus: "ready",
								prepNote: "",
								notes: "",
								days: {},
								cards: {},
							},
						},
					}),
				]),
			);
		const client = api(backend, PRODUCTION_CAPABILITIES);
		const challenges = await client.challenges.list();
		const planning = await client.planning.list();
		expect(challenges[0]?.paths[0]?.pathId).toBe("level-beginner");
		expect(planning[0]?.variants["level-beginner"]?.planTypeId).toBe(
			"balanced",
		);
	});

	it("keeps a planning save away from a challenge the list showed in the bin", async () => {
		const backend = fakeBackend()
			.on(
				"GET",
				"manageChallenges",
				json([panelChallenge({ status: "deleted", hidden: true })]),
			)
			.on("GET", PLANNING, json([]));
		const client = api(backend, production({ writes: { planning: "on" } }));
		const [blank] = await client.planning.list();

		const error = await failure(
			client.planning.save(
				{ ...blankPlanning("C12"), note: "x" },
				{ etag: blank?.etag ?? UNSAVED_ETAG },
			),
		);

		expect(error.kind).toBe("validation");
		expect(error.message).toContain("jest w koszu");
		expect(backend.all("PUT", `${PLANNING}/C12`)).toEqual([]);
	});

	it("does not load the challenges just to save a planning document", async () => {
		const backend = fakeBackend().on("PUT", `${PLANNING}/C12`, {
			status: 201,
			body: panelDoc("C12", { note: "x" }),
			etag: docEtag(1),
		});
		const client = api(backend, production({ writes: { planning: "on" } }));
		const saved = await client.planning.save(
			{ ...blankPlanning("C12"), note: "x" },
			{ etag: UNSAVED_ETAG },
		);
		expect(saved.etag).toBe(docEtag(1));
		expect(backend.calls()).toEqual([`PUT ${PLANNING}/C12`]);
	});
});
