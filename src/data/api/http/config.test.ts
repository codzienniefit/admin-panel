import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { configArea } from "./config";
import {
	capabilities,
	errorReply,
	failure,
	fakeBackend,
	json,
	production,
	SWITCHED_OFF,
	validationReply,
} from "./testSupport";

// Answers below follow `workoutsConfig`, `internalConfig` and
// `manageChallenges/promotedChallenge` as they are today
// (docs/research/backend-audit.md §1a, §4a, §8 "Reference data").

const option = (id: string, title: string) => ({ id, title, visible: true });

/** WorkoutConfigDto. */
const workoutsConfig = (overrides: Record<string, unknown> = {}) => ({
	equipmentTypes: [option("mat", "Mata"), option("noeq", "Bez sprzętu")],
	trainingTypes: [option("mobility", "Mobilność")],
	trainingLevels: [option("beginner", "Początkujący")],
	challengeLevels: [
		option("beginner", "Początkujący"),
		option("advanced", "Zaawansowany"),
	],
	completionStatuses: [option("done", "Ukończone")],
	challengeCategories: [option("main", "Główne")],
	challengeGoals: [option("strength", "Siła")],
	difficultyLevels: [option("easy", "Łatwy")],
	duration: { fromSeconds: 300, toSeconds: 3600 },
	challengeDurationDays: { fromDays: 7, toDays: 90 },
	promotedChallengeId: "C1",
	updatedAtUtc: "2026-11-01T10:00:00.000Z",
	...overrides,
});

/** AdminInternalConfigDto. */
const internalConfig = (overrides: Record<string, unknown> = {}) => ({
	draftMessageStates: [
		{ state: "draft", label: "Szkic" },
		{ state: "sent", label: "Wysłana" },
		{ state: "archived", label: "Zarchiwizowana" },
	],
	draftMessageTargetGroups: [
		{ state: "all", label: "Wszyscy", requiresTargetGroupValue: null },
		{ state: "subscribers", label: "Pro", requiresTargetGroupValue: null },
		{
			state: "nonSubscribers",
			label: "Darmowi",
			requiresTargetGroupValue: null,
		},
	],
	badgeTypes: [
		{ value: "normal", label: "Trening/Wyzwanie" },
		{ value: "milestone", label: "Powtórzenia" },
		{ value: "manual", label: "Ręczne" },
		{ value: "perfections", label: "Ukończone na 100%" },
	],
	badgeSections: [
		{
			id: "special",
			label: "Specjalne",
			subsections: [{ id: "event", label: "Wydarzenia" }],
		},
	],
	promotedChallengeId: "C1",
	...overrides,
});

const PROMOTED = "manageChallenges/promotedChallenge";
const ON = capabilities({ writes: { promotedChallenge: "on" } });

describe("configArea: workouts", () => {
	it("reads the options for every select", async () => {
		const backend = fakeBackend().on(
			"GET",
			"workoutsConfig",
			json(workoutsConfig()),
		);
		const api = configArea(backend.transport, SWITCHED_OFF);

		const config = await api.workouts();

		expect(config.challengeLevels).toEqual([
			option("beginner", "Początkujący"),
			option("advanced", "Zaawansowany"),
		]);
		expect(config.duration).toEqual({ fromSeconds: 300, toSeconds: 3600 });
		// Kept as it came: this build has no field for it.
		expect(config.completionStatuses).toEqual([option("done", "Ukończone")]);
		expect(backend.calls()).toEqual(["GET workoutsConfig"]);
		expect(backend.only("GET", "workoutsConfig").query).toEqual({});
	});

	it("fails, naming the configuration and the list, when a list is missing", async () => {
		const backend = fakeBackend().on(
			"GET",
			"workoutsConfig",
			json(workoutsConfig({ challengeGoals: undefined })),
		);
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).workouts(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(200);
		expect(error.message).toContain("Konfiguracja treningów");
		expect(error.issues.map((issue) => issue.path)).toEqual(["challengeGoals"]);
	});

	it("fails when the answer is a page and not JSON", async () => {
		const backend = fakeBackend().on("GET", "workoutsConfig", {
			text: "<!doctype html><title>Codziennie Fit</title>",
		});
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).workouts(),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("to nie jest JSON");
	});

	it("passes on the backend being unavailable", async () => {
		const backend = fakeBackend().on("GET", "workoutsConfig", {
			status: 503,
			text: "Service Unavailable",
		});
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).workouts(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(503);
	});
});

describe("configArea: internal", () => {
	it("reads the panel's labels and the promoted challenge", async () => {
		const backend = fakeBackend().on(
			"GET",
			"internalConfig",
			json(internalConfig()),
		);
		const api = configArea(backend.transport, SWITCHED_OFF);

		const config = await api.internal();

		expect(config).toEqual(internalConfig());
		expect(backend.calls()).toEqual(["GET internalConfig"]);
	});

	it("reads no promoted challenge as null", async () => {
		const backend = fakeBackend().on(
			"GET",
			"internalConfig",
			json(internalConfig({ promotedChallengeId: null })),
		);
		const config = await configArea(backend.transport, SWITCHED_OFF).internal();
		expect(config.promotedChallengeId).toBeNull();
	});

	it("fails, naming the configuration, when it does not fit", async () => {
		const backend = fakeBackend().on(
			"GET",
			"internalConfig",
			json(internalConfig({ badgeTypes: "normal,manual" })),
		);
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).internal(),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Konfiguracja panelu");
		expect(error.issues.map((issue) => issue.path)).toEqual(["badgeTypes"]);
	});

	it("passes on the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			"internalConfig",
			errorReply(500, "Failed to return admin config"),
		);
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).internal(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

describe("configArea: setPromotedChallenge", () => {
	it("posts the id, then reads the configuration", async () => {
		const backend = fakeBackend()
			.on(
				"POST",
				PROMOTED,
				json({
					result: "Promoted challenge updated",
					promotedChallengeId: "C3",
				}),
			)
			.on(
				"GET",
				"internalConfig",
				json(internalConfig({ promotedChallengeId: "C3" })),
			);
		const api = configArea(backend.transport, ON);

		const config = await api.setPromotedChallenge("C3");

		expect(config.promotedChallengeId).toBe("C3");
		expect(config.badgeTypes).toHaveLength(4);
		expect(backend.calls()).toEqual([`POST ${PROMOTED}`, "GET internalConfig"]);
		expect(backend.only("POST", PROMOTED).body).toEqual({
			promotedChallengeId: "C3",
		});
	});

	it("trusts the answer to the change over a configuration still cached", async () => {
		// `internalConfig` is cached at the edge and the purge is unreliable
		// (audit §9.1): it can still say the old challenge.
		const backend = fakeBackend()
			.on(
				"POST",
				PROMOTED,
				json({
					result: "Promoted challenge updated",
					promotedChallengeId: "C3",
				}),
			)
			.on(
				"GET",
				"internalConfig",
				json(internalConfig({ promotedChallengeId: "C1" })),
			);
		const config = await configArea(backend.transport, ON).setPromotedChallenge(
			"C3",
		);
		expect(config.promotedChallengeId).toBe("C3");
	});

	it("clears the promoted challenge with null", async () => {
		const backend = fakeBackend()
			.on(
				"POST",
				PROMOTED,
				json({
					result: "Promoted challenge updated",
					promotedChallengeId: null,
				}),
			)
			.on(
				"GET",
				"internalConfig",
				json(internalConfig({ promotedChallengeId: "C1" })),
			);
		const config = await configArea(backend.transport, ON).setPromotedChallenge(
			null,
		);
		expect(config.promotedChallengeId).toBeNull();
		expect(backend.only("POST", PROMOTED).body).toEqual({
			promotedChallengeId: null,
		});
	});

	it("makes no request while the switch is off", async () => {
		const backend = fakeBackend();
		const error = await failure(
			configArea(backend.transport, SWITCHED_OFF).setPromotedChallenge("C3"),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Promowane wyzwanie”");
		expect(backend.requests).toEqual([]);
	});

	it("is its own switch: open challenges do not open it", async () => {
		const backend = fakeBackend();
		const error = await failure(
			configArea(
				backend.transport,
				capabilities({ writes: { challenges: "on" } }),
			).setPromotedChallenge("C3"),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toEqual([]);
	});

	it("has no test mode: every app user would see the change", async () => {
		const backend = fakeBackend();
		const error = await failure(
			configArea(
				backend.transport,
				capabilities({ writes: { promotedChallenge: "test-only" } }),
			).setPromotedChallenge("C3"),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("nie da się wypróbować");
		expect(backend.requests).toEqual([]);
	});

	it("reports a crash as the backend failing", async () => {
		const backend = fakeBackend().on(
			"POST",
			PROMOTED,
			errorReply(500, "Failed to update promoted challenge: RestError"),
		);
		const error = await failure(
			configArea(backend.transport, ALL_CAPABILITIES).setPromotedChallenge(
				"C3",
			),
		);
		expect(error.kind).toBe("server");
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────

describe("configArea: setPromotedChallenge on the panel's route", () => {
	const OPEN = production({ writes: { promotedChallenge: "on" } });

	it.each([
		["UNKNOWN_ID", "Wyzwanie C99 nie istnieje"],
		[
			"NOT_PUBLISHED",
			"Wyzwanie C99 jest szkicem albo zostało usunięte, więc nie może być promowane",
		],
	])("reports %s at the field", async (code, message) => {
		// manageChallengesEditing.test.ts, "the promoted challenge".
		const backend = fakeBackend().on(
			"POST",
			PROMOTED,
			validationReply(
				[{ path: "promotedChallengeId", code, message }],
				message,
			),
		);
		const error = await failure(
			configArea(backend.transport, OPEN).setPromotedChallenge("C99"),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.message).toBe(message);
		expect(error.issues).toEqual([{ path: "promotedChallengeId", message }]);
		// The configuration is not read after a refusal.
		expect(backend.calls()).toEqual([`POST ${PROMOTED}`]);
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const error = await failure(
			configArea(backend.transport, production()).setPromotedChallenge("C12"),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Promowane wyzwanie”");
		expect(backend.requests).toEqual([]);
	});
});

describe("configArea: setPromotedChallenge on the stricter backend", () => {
	const OPEN = production({ writes: { promotedChallenge: "on" } });
	const answered = (promotedChallengeId: string | null) =>
		json({ result: "Promoted challenge updated", promotedChallengeId });

	it.each([[""], ["  "], [null]])(
		"clears the promotion with null, also for %j",
		async (given) => {
			// "clearing the promoted challenge with \"\" (only null clears)".
			const backend = fakeBackend()
				.on("POST", PROMOTED, answered(null))
				.on("GET", "internalConfig", json(internalConfig()));
			const config = await configArea(
				backend.transport,
				OPEN,
			).setPromotedChallenge(given);
			expect(backend.only("POST", PROMOTED).body).toEqual({
				promotedChallengeId: null,
			});
			expect(config.promotedChallengeId).toBeNull();
		},
	);

	it("names the challenge by its id exactly as stored", async () => {
		const backend = fakeBackend()
			.on("POST", PROMOTED, answered("C12"))
			.on("GET", "internalConfig", json(internalConfig()));
		await configArea(backend.transport, OPEN).setPromotedChallenge(" C12 ");
		expect(backend.only("POST", PROMOTED).body).toEqual({
			promotedChallengeId: "C12",
		});
	});

	it("says only a published challenge can be promoted", async () => {
		const backend = fakeBackend().on(
			"POST",
			PROMOTED,
			validationReply(
				[
					{
						path: "promotedChallengeId",
						code: "NOT_PUBLISHED",
						message: "Promować można tylko opublikowane wyzwanie",
					},
				],
				"Promować można tylko opublikowane wyzwanie",
			),
		);
		const error = await failure(
			configArea(backend.transport, OPEN).setPromotedChallenge("C13"),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{
				path: "promotedChallengeId",
				message: "Promować można tylko opublikowane wyzwanie",
			},
		]);
	});
});
