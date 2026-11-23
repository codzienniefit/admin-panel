import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import {
	blankChallenge,
	blankPath,
	type Challenge,
	type NewChallenge,
} from "@/data/schemas/challenge";
import {
	challengesArea,
	formerPathIds,
	fromChallenge,
	isDerivedPathId,
	isFrequencyText,
	pathById,
	pathIdsOf,
	readChallenge,
	readFrequency,
	toChallenge,
} from "./challenges";
import {
	capabilities,
	conflictReply,
	errorReply,
	failure,
	fakeBackend,
	json,
	notFoundReply,
	panelChallenge,
	panelPath,
	production,
	type Recorded,
	SWITCHED_OFF,
	tableEtag,
	validationReply,
	wireChallenge,
	wirePath,
} from "./testSupport";

// Rows and answers below follow `manageChallenges` as it is today
// (docs/research/backend-audit.md §1a, §4a, §4b) and as it is planned
// (docs/BACKEND-SCOPE.md B1, B2.1–B2.3, B3.3).

const PLANNED_ETAG = "W/\"datetime'2026-11-10T09%3A00%3A00.0000000Z'\"";
const NEWER_ETAG = "W/\"datetime'2026-11-11T07%3A30%3A00.0000000Z'\"";

/** The same challenge as a backend with etags, statuses and path ids sends it. */
const plannedChallenge = (overrides: Record<string, unknown> = {}) =>
	wireChallenge({
		etag: PLANNED_ETAG,
		status: "published",
		paths: [wirePath({ pathId: "p_1" })],
		...overrides,
	});

const bodyOf = (request: Recorded) => request.body as Record<string, unknown>;
const pathsOf = (body: Record<string, unknown>) =>
	body.paths as Record<string, unknown>[];

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

describe("toChallenge", () => {
	it("reads a row as the backend sends it today", () => {
		const challenge = toChallenge(wireChallenge());
		expect(challenge).toMatchObject({
			id: "C12",
			title: "Wiosenne wyzwanie",
			subtitle: "28 dni ruchu",
			internalTitle: "[TEST] wiosna 2026",
			status: "published",
			pro: true,
			lengthDays: 2,
			visibleDaysUpFront: 7,
			imageRelativePath: "challenges/c12.webp",
			categoryId: "main",
			goalsIds: ["strength"],
			difficultyLevelsIds: ["easy"],
			addedAtUtc: "2026-03-01T08:00:00.000Z",
			updatedAtUtc: "2026-11-03T12:00:00.000Z",
			unlockedByEntitlementIds: ["pro"],
			discountedForEntitlementIds: [],
			offeringId: null,
			offeringDiscountedId: null,
			badgeId: null,
			perfectCompletionBadgeId: null,
			recommendedNext: [{ id: "C3" }],
		});
		expect(challenge.descriptionFancyContent).toEqual([
			{ type: "Title", content: "Zaczynamy" },
			{
				type: "Image",
				content: "",
				metadata: {
					imageRelativePath: "challenges/c12-opis.webp",
					heightToWidthRatio: 0.56,
				},
			},
		]);
	});

	it("reads the three dates the backend leaves out when unset as empty", () => {
		const challenge = toChallenge(wireChallenge());
		expect(challenge.liveAtUtc).toBeNull();
		expect(challenge.endsAtUtc).toBeNull();
		expect(challenge.availableAtUtc).toBeNull();
	});

	it("keeps the dates of a live challenge", () => {
		const challenge = toChallenge(
			wireChallenge({
				liveAtUtc: "2026-12-01T18:00:00.000Z",
				endsAtUtc: "2026-12-29T18:00:00.000Z",
				availableAtUtc: "2026-11-20T08:00:00.000Z",
			}),
		);
		expect(challenge).toMatchObject({
			liveAtUtc: "2026-12-01T18:00:00.000Z",
			endsAtUtc: "2026-12-29T18:00:00.000Z",
			availableAtUtc: "2026-11-20T08:00:00.000Z",
		});
	});

	describe("version", () => {
		it("is the time of the last change on today's backend", () => {
			expect(toChallenge(wireChallenge()).etag).toBe(
				"t:2026-11-03T12:00:00.000Z",
			);
		});

		it("is the backend's etag once it sends one", () => {
			expect(toChallenge(plannedChallenge()).etag).toBe(PLANNED_ETAG);
		});

		it("is a fingerprint for a row without either", () => {
			const row = wireChallenge({ updatedAtUtc: undefined });
			const challenge = toChallenge(row);
			expect(challenge.etag).toMatch(/^h:[0-9a-f]{8}$/);
			expect(challenge.updatedAtUtc).toBe("");
			expect(toChallenge(structuredClone(row)).etag).toBe(challenge.etag);
			expect(toChallenge({ ...row, title: "Inny tytuł" }).etag).not.toBe(
				challenge.etag,
			);
		});
	});

	describe("status", () => {
		it("comes from `hidden` on today's backend", () => {
			expect(toChallenge(wireChallenge({ hidden: false })).status).toBe(
				"published",
			);
			expect(toChallenge(wireChallenge({ hidden: true })).status).toBe(
				"hidden",
			);
			expect(toChallenge(wireChallenge({ hidden: undefined })).status).toBe(
				"published",
			);
		});

		it.each(["draft", "published", "hidden", "deleted"])(
			"is the backend's own %s once it sends one",
			(status) => {
				expect(
					toChallenge(
						plannedChallenge({ status, hidden: status !== "published" }),
					).status,
				).toBe(status);
			},
		);
	});

	describe("variants", () => {
		it("reads a variant, with an id made from its level", () => {
			const [path] = toChallenge(wireChallenge()).paths;
			expect(path).toEqual({
				pathId: "level:beginner",
				levelId: "beginner",
				equipmentIds: ["mat"],
				difficultyLevelsIds: ["easy"],
				frequency: 3,
				minimumDaysToComplete: 1,
				description: "Dla początkujących",
				pro: false,
				days: [
					{ dayIndex: 1, workoutIds: ["W1", "W2"], type: "workout" },
					{ dayIndex: 2, workoutIds: [], type: "restday" },
				],
			});
		});

		it("keeps the backend's own path id once it sends one", () => {
			const challenge = toChallenge(plannedChallenge());
			expect(challenge.paths.map((path) => path.pathId)).toEqual(["p_1"]);
		});

		it("tells two variants at the same level apart", () => {
			// Nothing in the backend forbids it (audit §4b, "not validated").
			const challenge = toChallenge(
				wireChallenge({
					paths: [
						wirePath({ levelId: "beginner", description: "A" }),
						wirePath({ levelId: "advanced", description: "B" }),
						wirePath({ levelId: "beginner", description: "C" }),
						wirePath({ levelId: "beginner", description: "D" }),
					],
				}),
			);
			expect(challenge.paths.map((path) => path.pathId)).toEqual([
				"level:beginner",
				"level:advanced",
				"level:beginner#2",
				"level:beginner#3",
			]);
			expect(challenge.paths.map((path) => path.description)).toEqual([
				"A",
				"B",
				"C",
				"D",
			]);
		});

		it("gives the same variant the same id on every read", () => {
			const row = wireChallenge({
				paths: [wirePath(), wirePath(), wirePath({ levelId: "advanced" })],
			});
			const ids = (challenge: Challenge) =>
				challenge.paths.map((path) => path.pathId);
			expect(ids(toChallenge(row))).toEqual(
				ids(toChallenge(structuredClone(row))),
			);
		});

		it.each([
			["3", 3, undefined],
			[" 4 ", 4, undefined],
			[3, 3, undefined],
			["3-4", 3, "3-4"],
			["3,5", 3.5, "3,5"],
			["3.0", 3, "3.0"],
			["3 razy w tygodniu", 3, "3 razy w tygodniu"],
			["codziennie", 1, "codziennie"],
			["", 1, ""],
			[null, 1, undefined],
			[undefined, 1, undefined],
		])("reads the frequency %j as %s", (frequency, expected, text) => {
			const [path] = toChallenge(
				wireChallenge({ paths: [wirePath({ frequency })] }),
			).paths;
			expect(path?.frequency).toBe(expected);
			expect(path?.frequencyText).toBe(text);
		});

		it("reads a variant from an older row that lacks newer fields", () => {
			const challenge = toChallenge(
				wireChallenge({
					paths: [
						{
							levelId: "beginner",
							frequency: "2",
							days: [
								{ dayIndex: 1, workoutIds: null },
								{ dayIndex: 2 },
								{ dayIndex: 3, workoutIds: ["W1"] },
							],
						},
						{ levelId: "advanced", minimumDaysToComplete: null, days: null },
						{ levelId: "expert", minimumDaysToComplete: 2.9 },
					],
				}),
			);
			expect(challenge.paths).toEqual([
				{
					pathId: "level:beginner",
					levelId: "beginner",
					frequency: 2,
					minimumDaysToComplete: 0,
					description: null,
					pro: false,
					difficultyLevelsIds: [],
					days: [
						{ dayIndex: 1, workoutIds: [] },
						{ dayIndex: 2, workoutIds: [] },
						{ dayIndex: 3, workoutIds: ["W1"] },
					],
				},
				{
					pathId: "level:advanced",
					levelId: "advanced",
					frequency: 1,
					minimumDaysToComplete: 0,
					description: null,
					pro: false,
					difficultyLevelsIds: [],
					days: [],
				},
				{
					pathId: "level:expert",
					levelId: "expert",
					frequency: 1,
					minimumDaysToComplete: 2,
					description: null,
					pro: false,
					difficultyLevelsIds: [],
					days: [],
				},
			]);
		});
	});

	describe("legacy and sloppy rows", () => {
		it("reads a row that has little more than an id", () => {
			const challenge = toChallenge({ id: "C1" });
			expect(challenge).toMatchObject({
				id: "C1",
				title: "",
				subtitle: "",
				internalTitle: null,
				status: "published",
				pro: false,
				lengthDays: 1,
				visibleDaysUpFront: null,
				imageRelativePath: null,
				descriptionFancyContent: [],
				categoryId: null,
				goalsIds: [],
				difficultyLevelsIds: [],
				addedAtUtc: "",
				updatedAtUtc: "",
				unlockedByEntitlementIds: [],
				discountedForEntitlementIds: [],
				recommendedNext: [],
				paths: [],
			});
			expect(challenge.etag).toMatch(/^h:/);
		});

		it("reads nulls the same as missing fields", () => {
			const challenge = toChallenge({
				id: "C1",
				title: null,
				subtitle: null,
				hidden: null,
				pro: null,
				lengthDays: null,
				paths: null,
				goalsIds: null,
				difficultyLevelsIds: null,
				unlockedByEntitlementIds: null,
				discountedForEntitlementIds: null,
				recommendedNext: null,
				updatedAtUtc: null,
				etag: null,
				status: null,
			});
			expect(challenge).toMatchObject({
				title: "",
				status: "published",
				pro: false,
				lengthDays: 1,
				paths: [],
				goalsIds: [],
				difficultyLevelsIds: [],
				unlockedByEntitlementIds: [],
				discountedForEntitlementIds: [],
				recommendedNext: [],
				updatedAtUtc: "",
			});
			// The schema keeps a null subtitle; it goes out as "" (see fromChallenge).
			expect(challenge.subtitle ?? "").toBe("");
		});

		it("takes a missing length from the longest variant", () => {
			const days = (count: number) =>
				Array.from({ length: count }, (_, i) => ({
					dayIndex: i + 1,
					workoutIds: [],
				}));
			const challenge = toChallenge(
				wireChallenge({
					lengthDays: null,
					paths: [
						wirePath({ levelId: "a", days: days(7) }),
						wirePath({ levelId: "b", days: days(21) }),
						wirePath({ levelId: "c", days: null }),
					],
				}),
			);
			expect(challenge.lengthDays).toBe(21);
		});

		it("keeps the stored length even when it differs from the day count", () => {
			// `lengthDays` is a free number in the backend (audit §6).
			expect(toChallenge(wireChallenge({ lengthDays: 28 })).lengthDays).toBe(
				28,
			);
		});

		it("makes the length a whole number of at least one day", () => {
			expect(toChallenge(wireChallenge({ lengthDays: 28.7 })).lengthDays).toBe(
				28,
			);
			expect(toChallenge(wireChallenge({ lengthDays: 0 })).lengthDays).toBe(1);
			expect(toChallenge(wireChallenge({ lengthDays: -5 })).lengthDays).toBe(1);
		});
	});

	describe("fields this build does not know", () => {
		it("keeps them on the challenge, on a variant and on a day", () => {
			const challenge = toChallenge(
				wireChallenge({
					futureField: { since: "v1.70" },
					paths: [
						wirePath({
							workoutsLength: 55,
							days: [{ dayIndex: 1, workoutIds: [], note: "wolne" }],
						}),
					],
				}),
			);
			expect(challenge.futureField).toEqual({ since: "v1.70" });
			expect(challenge.paths[0]?.workoutsLength).toBe(55);
			expect(challenge.paths[0]?.equipmentIds).toEqual(["mat"]);
			expect(challenge.paths[0]?.days[0]).toEqual({
				dayIndex: 1,
				workoutIds: [],
				note: "wolne",
			});
		});
	});

	describe("a row that cannot be read", () => {
		it("fails loudly when there is no id", () => {
			const error = thrownBy(() => toChallenge({ title: "Bez id" }));
			expect(error.kind).toBe("server");
			expect(error.message).toContain("Wyzwanie: dane nie pasują");
			expect(error.issues.map((issue) => issue.path)).toEqual(["id"]);
		});

		it("fails loudly, naming the challenge and the field", () => {
			const error = thrownBy(() =>
				toChallenge(
					wireChallenge({
						paths: [wirePath({ days: [{ dayIndex: 0, workoutIds: [] }] })],
					}),
				),
			);
			expect(error.kind).toBe("server");
			expect(error.message).toContain("Wyzwanie C12: dane nie pasują");
			expect(error.issues.map((issue) => issue.path)).toEqual([
				"paths.0.days.0.dayIndex",
			]);
		});

		it("fails for a variant without a level", () => {
			const error = thrownBy(() =>
				toChallenge(wireChallenge({ paths: [{ frequency: "3", days: [] }] })),
			);
			expect(error.kind).toBe("server");
			expect(error.issues.map((issue) => issue.path)).toEqual([
				"paths.0.levelId",
			]);
		});

		it.each([undefined, null, "C12", []])(
			"fails for %j, which is not a row",
			(raw) => {
				expect(thrownBy(() => toChallenge(raw)).kind).toBe("server");
			},
		);
	});
});

describe("readFrequency", () => {
	it("reads a plain number, as text or as a number", () => {
		expect(readFrequency("3")).toEqual({ frequency: 3 });
		expect(readFrequency(3)).toEqual({ frequency: 3 });
		expect(readFrequency("3.5")).toEqual({ frequency: 3.5 });
		expect(readFrequency("  5 ")).toEqual({ frequency: 5 });
	});

	it("keeps the text of anything else next to its leading number", () => {
		expect(readFrequency("3-4")).toEqual({
			frequency: 3,
			frequencyText: "3-4",
		});
		expect(readFrequency("3,5")).toEqual({
			frequency: 3.5,
			frequencyText: "3,5",
		});
		expect(readFrequency("2x w tygodniu")).toEqual({
			frequency: 2,
			frequencyText: "2x w tygodniu",
		});
	});

	it("counts text without a number as once a week and keeps the text", () => {
		expect(readFrequency("codziennie")).toEqual({
			frequency: 1,
			frequencyText: "codziennie",
		});
	});

	it("counts nothing as once a week", () => {
		for (const raw of [null, undefined, Number.NaN]) {
			expect(readFrequency(raw)).toEqual({ frequency: 1 });
		}
	});

	it("keeps an empty text, so a save does not turn it into a number", () => {
		for (const raw of ["", "   "]) {
			expect(readFrequency(raw)).toEqual({ frequency: 1, frequencyText: "" });
		}
		const challenge = toChallenge(
			wireChallenge({ paths: [wirePath({ frequency: "" })] }),
		);
		// Before the editing contract the backend stored whatever came.
		const [sent] = fromChallenge(challenge, SWITCHED_OFF).paths as {
			frequency: unknown;
		}[];
		expect(sent?.frequency).toBe("");
	});

	it("sends the number the planner shows when the backend would refuse the kept text", () => {
		// Under the editing contract a frequency is a text that starts with a
		// number of at least one. A kept "" or "codziennie" would be refused
		// whatever the planner shows, and choosing 1 again would not help.
		const sentFor = (frequency: string, change?: number) => {
			const challenge = toChallenge(
				wireChallenge({ paths: [wirePath({ frequency })] }),
			);
			const [path] = challenge.paths;
			const edited =
				change === undefined || !path
					? challenge
					: { ...challenge, paths: [{ ...path, frequency: change }] };
			const [sent] = fromChallenge(edited, ALL_CAPABILITIES).paths as {
				frequency: unknown;
			}[];
			return sent?.frequency;
		};
		expect(sentFor("")).toBe("1");
		expect(sentFor("   ")).toBe("1");
		expect(sentFor("codziennie")).toBe("1");
		expect(sentFor("0")).toBe("0");
		expect(sentFor("", 4)).toBe("4");
		// What the backend takes is still sent back as it was.
		expect(sentFor("3-4")).toBe("3-4");
		expect(sentFor("3,5")).toBe("3,5");
		expect(sentFor(" 3 ")).toBe("3");
		expect(sentFor("3-4", 5)).toBe("5");
	});
});

describe("isFrequencyText", () => {
	it("takes what the backend takes: a text that starts with a number of at least one", () => {
		for (const text of ["3", "3-4", "3,5", "1", "2.5", "10 razy"]) {
			expect(isFrequencyText(text), text).toBe(true);
		}
	});

	it("refuses what the backend refuses", () => {
		for (const value of [
			"",
			" ",
			" 3",
			"3 ",
			"abc",
			"0",
			"0,5",
			"-2",
			3,
			null,
			undefined,
			`3${"-4".repeat(20)}`,
		]) {
			expect(isFrequencyText(value), String(value)).toBe(false);
		}
	});
});

describe("isDerivedPathId", () => {
	it("knows the ids this client makes up", () => {
		expect(isDerivedPathId("level:beginner")).toBe(true);
		expect(isDerivedPathId("level:beginner#2")).toBe(true);
	});

	it("leaves the backend's and the panel's own ids alone", () => {
		expect(isDerivedPathId("p_1")).toBe(false);
		expect(isDerivedPathId("beginner")).toBe(false);
		expect(isDerivedPathId("my-level:1")).toBe(false);
		expect(isDerivedPathId("")).toBe(false);
	});
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("fromChallenge", () => {
	const NOW = "2026-11-11T10:00:00.000Z";
	const now = () => NOW;

	it("sends back what was loaded, field for field", () => {
		const wire = wireChallenge({
			liveAtUtc: "2026-12-01T18:00:00.000Z",
			futureField: { since: "v1.70" },
			paths: [
				wirePath({ frequency: "3-4", workoutsLength: 55 }),
				wirePath({ levelId: "advanced", futurePathField: true }),
			],
		});
		const body = fromChallenge(toChallenge(wire), SWITCHED_OFF, now);
		expect(body).toMatchObject(wire);
		// Nothing the panel made up for itself goes out, and nothing else is
		// added but the two unset dates, as explicit nulls.
		expect(Object.keys(body).toSorted()).toEqual(
			[...Object.keys(wire), "availableAtUtc", "endsAtUtc"].toSorted(),
		);
		expect(body.endsAtUtc).toBeNull();
		expect(body.availableAtUtc).toBeNull();
		for (const [index, path] of pathsOf(body).entries()) {
			expect(Object.keys(path).toSorted()).toEqual(
				Object.keys((wire.paths as object[])[index] ?? {}).toSorted(),
			);
		}
	});

	it("never sends the version or what the panel worked out from it", () => {
		const body = fromChallenge(toChallenge(wireChallenge()), SWITCHED_OFF, now);
		expect(body).not.toHaveProperty("etag");
		expect(body).not.toHaveProperty("status");
		for (const path of pathsOf(body)) {
			expect(path).not.toHaveProperty("pathId");
			expect(path).not.toHaveProperty("frequencyText");
		}
	});

	describe("status", () => {
		const challenge = (status: Challenge["status"]) => ({
			...toChallenge(wireChallenge({ hidden: status === "published" })),
			status,
		});

		it("is `hidden` alone for a backend without statuses", () => {
			expect(
				fromChallenge(challenge("published"), SWITCHED_OFF, now),
			).toMatchObject({ hidden: false });
			expect(
				fromChallenge(challenge("hidden"), SWITCHED_OFF, now),
			).toMatchObject({ hidden: true });
			expect(
				fromChallenge(challenge("hidden"), SWITCHED_OFF, now),
			).not.toHaveProperty("status");
		});

		it("stores a draft as hidden there, so it is not published by a save", () => {
			const body = fromChallenge(challenge("draft"), SWITCHED_OFF, now);
			expect(body.hidden).toBe(true);
			expect(body).not.toHaveProperty("status");
		});

		it("refuses to delete there", () => {
			const error = thrownBy(() =>
				fromChallenge(challenge("deleted"), SWITCHED_OFF, now),
			);
			expect(error.kind).toBe("validation");
			expect(error.issues[0]?.path).toBe("status");
		});

		it.each([
			["draft", true],
			["published", false],
			["hidden", true],
			["deleted", true],
		] as const)(
			"is %s with hidden=%s for a backend with statuses",
			(status, hidden) => {
				const body = fromChallenge(challenge(status), ALL_CAPABILITIES, now);
				expect(body.status).toBe(status);
				expect(body.hidden).toBe(hidden);
			},
		);
	});

	describe("identity and dates", () => {
		it("sends the id of an existing challenge", () => {
			expect(fromChallenge(toChallenge(wireChallenge()), SWITCHED_OFF).id).toBe(
				"C12",
			);
		});

		it("sends a null id for a new one, so the backend assigns it", () => {
			const created: NewChallenge = {
				...blankChallenge("2026-11-11T09:00:00.000Z"),
				title: "Nowe",
			};
			const body = fromChallenge(created, SWITCHED_OFF, now);
			expect(body).toHaveProperty("id", null);
			expect(body.addedAtUtc).toBe("2026-11-11T09:00:00.000Z");
			// Required by the backend's type and ignored by it.
			expect(body.updatedAtUtc).toBe(NOW);
		});

		it("fills in a time of change when the loaded row had none", () => {
			const loaded = toChallenge(wireChallenge({ updatedAtUtc: null }));
			expect(fromChallenge(loaded, SWITCHED_OFF, now).updatedAtUtc).toBe(NOW);
			expect(String(fromChallenge(loaded, SWITCHED_OFF).updatedAtUtc)).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
			);
		});

		it("sends empty text where the backend's type wants text", () => {
			const body = fromChallenge(
				{ ...blankChallenge(), subtitle: null, imageRelativePath: null },
				SWITCHED_OFF,
				now,
			);
			expect(body.subtitle).toBe("");
			expect(body.imageRelativePath).toBe("");
		});

		it("sends an unset optional field as an explicit null", () => {
			const body = fromChallenge(blankChallenge(), SWITCHED_OFF, now);
			expect(body).toMatchObject({
				internalTitle: null,
				categoryId: null,
				liveAtUtc: null,
				endsAtUtc: null,
				availableAtUtc: null,
				offeringId: null,
				offeringDiscountedId: null,
				badgeId: null,
				perfectCompletionBadgeId: null,
				recommendedNext: [],
				paths: [],
			});
		});
	});

	describe("variants", () => {
		const withPath = (path: Record<string, unknown>) =>
			toChallenge(wireChallenge({ paths: [wirePath(path)] }));
		const sent = (challenge: Challenge) => {
			const [path] = pathsOf(fromChallenge(challenge, SWITCHED_OFF, now));
			if (!path) throw new Error("test: no path was sent");
			return path;
		};

		it("never sends an id made from the level", () => {
			const challenge = toChallenge(
				wireChallenge({ paths: [wirePath(), wirePath()] }),
			);
			expect(challenge.paths.map((path) => path.pathId)).toEqual([
				"level:beginner",
				"level:beginner#2",
			]);
			for (const path of pathsOf(fromChallenge(challenge, SWITCHED_OFF, now))) {
				expect(path).not.toHaveProperty("pathId");
				expect(path.levelId).toBe("beginner");
			}
		});

		it("sends back a path id the backend issued", () => {
			expect(sent(toChallenge(plannedChallenge())).pathId).toBe("p_1");
		});

		it("sends the id of a variant added in the panel", () => {
			const challenge: Challenge = {
				...toChallenge(wireChallenge()),
				paths: [blankPath("0c5f7a1e", "advanced", 2)],
			};
			expect(sent(challenge)).toEqual({
				pathId: "0c5f7a1e",
				levelId: "advanced",
				frequency: "3",
				minimumDaysToComplete: 0,
				description: null,
				pro: false,
				difficultyLevelsIds: [],
				days: [
					{ dayIndex: 1, workoutIds: [] },
					{ dayIndex: 2, workoutIds: [] },
				],
			});
		});

		it.each(["3", "3-4", "3,5", "3.0", "3 razy w tygodniu", "codziennie"])(
			"sends the frequency %j back as it was",
			(frequency) => {
				expect(sent(withPath({ frequency })).frequency).toBe(frequency);
			},
		);

		it("sends the frequency as text, which is what the backend stores", () => {
			expect(sent(withPath({ frequency: 3 })).frequency).toBe("3");
		});

		it("sends the new number once it was changed in the planner", () => {
			const challenge = withPath({ frequency: "3-4" });
			const [path] = challenge.paths;
			if (!path) throw new Error("test: no path");
			expect(path.frequencyText).toBe("3-4");
			path.frequency = 5;
			expect(sent(challenge).frequency).toBe("5");
		});

		it("keeps the text when the number was set to what the text says", () => {
			const challenge = withPath({ frequency: "3-4" });
			const [path] = challenge.paths;
			if (!path) throw new Error("test: no path");
			path.frequency = 4;
			path.frequency = 3;
			expect(sent(challenge).frequency).toBe("3-4");
		});

		it("sends the days as they are, rest days included", () => {
			expect(sent(withPath({})).days).toEqual([
				{ dayIndex: 1, workoutIds: ["W1", "W2"], type: "workout" },
				{ dayIndex: 2, workoutIds: [], type: "restday" },
			]);
		});
	});
});

// ─── The calls ──────────────────────────────────────────────────────────────

/** Today's backend with the section accepted. */
const TODAY_ON = capabilities({ writes: { challenges: "on" } });
/** Today's backend while the section is being tried on test items. */
const TEST_ONLY = capabilities({ writes: { challenges: "test-only" } });

const SAVED_TODAY = (id: string) =>
	json({
		result: `Challenge ${id} updated`,
		// The internal model, in the backend's own casing.
		update: { Id: id, Title: "x", Hidden: false, Paths: [] },
	});

describe("challengesArea: reading", () => {
	it("lists every challenge with one request", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([wireChallenge(), wireChallenge({ id: "C13", hidden: true })]),
		);
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const list = await api.list();
		expect(list.map((challenge) => [challenge.id, challenge.status])).toEqual([
			["C12", "published"],
			["C13", "hidden"],
		]);
		expect(backend.requests).toHaveLength(1);
		expect(backend.only("GET", "manageChallenges")).toMatchObject({
			query: {},
			body: undefined,
			sender: "send",
		});
	});

	it("reads an empty list", async () => {
		const backend = fakeBackend().on("GET", "manageChallenges", json([]));
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		expect(await api.list()).toEqual([]);
	});

	it("fails the whole list when one row cannot be read", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([wireChallenge(), { title: "bez id" }]),
		);
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.list());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Wyzwanie");
	});

	it("fails when the answer is not a list", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json({ challenges: [] }),
		);
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.list());
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Lista wyzwań");
	});

	it("passes on the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			errorReply(500, "Failed to return challenges: RestError: busy"),
		);
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.list());
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});

	it("reads one challenge by its id", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C12",
			json(wireChallenge()),
		);
		const area = challengesArea(backend.transport, SWITCHED_OFF);
		expect((await area.read("C12")).id).toBe("C12");
		expect(backend.calls()).toEqual(["GET manageChallenges/C12"]);
	});

	it("keeps an odd id inside its path segment", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/a%2Fb%3Fc",
			json(wireChallenge({ id: "a/b?c" })),
		);
		const area = challengesArea(backend.transport, SWITCHED_OFF);
		expect((await area.read("a/b?c")).id).toBe("a/b?c");
		expect(backend.only("GET", "manageChallenges/a%2Fb%3Fc").query).toEqual({});
	});

	it("makes no request for an id that would lead to another endpoint", async () => {
		const backend = fakeBackend();
		const area = challengesArea(backend.transport, SWITCHED_OFF);
		for (const id of ["", ".", ".."]) {
			expect((await failure(area.read(id))).kind).toBe("notFound");
		}
		expect(backend.requests).toEqual([]);
	});

	it("says so when the challenge is not there", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C99",
			errorReply(404, "Challenge C99 not found", { errorCode: null }),
		);
		const area = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(area.read("C99"));
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Challenge C99 not found");
	});
});

describe("challengesArea: create", () => {
	const created: NewChallenge = {
		...blankChallenge("2026-11-11T09:00:00.000Z"),
		title: "Jesienne wyzwanie",
		internalTitle: "[TEST] jesień",
		status: "hidden",
		lengthDays: 2,
		paths: [blankPath("0c5f7a1e", "beginner", 2)],
	};

	it("posts the challenge without an id and reads back what was stored", async () => {
		const stored = wireChallenge({ id: "C13", title: "Jesienne wyzwanie" });
		const backend = fakeBackend()
			.on("POST", "manageChallenges", SAVED_TODAY("C13"))
			.on("GET", "manageChallenges/C13", json(stored));
		const { api } = challengesArea(backend.transport, TODAY_ON);

		const result = await api.create(created);

		expect(result).toEqual(toChallenge(stored));
		expect(backend.calls()).toEqual([
			"POST manageChallenges",
			"GET manageChallenges/C13",
		]);
		const post = backend.only("POST", "manageChallenges");
		expect(post.query).toEqual({});
		expect(post.headers).not.toHaveProperty("if-match");
		expect(post.headers["content-type"]).toBe("application/json");
		const body = bodyOf(post);
		expect(body).toMatchObject({
			id: null,
			title: "Jesienne wyzwanie",
			internalTitle: "[TEST] jesień",
			hidden: true,
			subtitle: "",
			imageRelativePath: "",
			addedAtUtc: "2026-11-11T09:00:00.000Z",
			lengthDays: 2,
			paths: [
				{
					levelId: "beginner",
					frequency: "3",
					days: [
						{ dayIndex: 1, workoutIds: [] },
						{ dayIndex: 2, workoutIds: [] },
					],
				},
			],
		});
		expect(body).not.toHaveProperty("etag");
		expect(body).not.toHaveProperty("status");
	});

	it("finds the new id in the sentence when that is all the answer has", async () => {
		const backend = fakeBackend()
			.on("POST", "manageChallenges", json({ result: "Challenge C14 updated" }))
			.on("GET", "manageChallenges/C14", json(wireChallenge({ id: "C14" })));
		const { api } = challengesArea(backend.transport, TODAY_ON);
		expect((await api.create(created)).id).toBe("C14");
	});

	it("takes the saved challenge from the answer once the backend sends it", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(plannedChallenge({ id: "C13", status: "draft", hidden: true })),
		);
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		const result = await api.create({ ...created, status: "draft" });
		expect(result).toMatchObject({
			id: "C13",
			etag: PLANNED_ETAG,
			status: "draft",
		});
		// No second request to find out what was stored.
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
		expect(bodyOf(backend.only("POST", "manageChallenges"))).toMatchObject({
			id: null,
			status: "draft",
			hidden: true,
		});
	});

	it("says so when the save went through but the answer names no challenge", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json({ result: "ok" }),
		);
		const { api } = challengesArea(backend.transport, TODAY_ON);
		const error = await failure(api.create(created));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("nie podał jego identyfikatora");
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.create(created));
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Wyzwania”");
		expect(backend.requests).toEqual([]);
	});

	it("creates only test items in test-only mode", async () => {
		const backend = fakeBackend()
			.on("POST", "manageChallenges", SAVED_TODAY("C13"))
			.on("GET", "manageChallenges/C13", json(wireChallenge({ id: "C13" })));
		const { api } = challengesArea(backend.transport, TEST_ONLY);

		const error = await failure(
			api.create({ ...created, internalTitle: "jesień" }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{ path: "internalTitle", message: error.message },
		]);
		expect(backend.requests).toEqual([]);

		expect((await api.create(created)).id).toBe("C13");
		expect(backend.calls()).toEqual([
			"POST manageChallenges",
			"GET manageChallenges/C13",
		]);
	});

	it("refuses to create a deleted challenge on a backend without statuses", async () => {
		const backend = fakeBackend();
		const { api } = challengesArea(backend.transport, TODAY_ON);
		const error = await failure(api.create({ ...created, status: "deleted" }));
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("status");
		expect(backend.requests).toEqual([]);
	});
});

describe("challengesArea: save on today's backend", () => {
	const stored = wireChallenge();
	const loaded = toChallenge(stored);
	const edited: Challenge = { ...loaded, title: "Nowy tytuł" };
	const afterSave = wireChallenge({
		title: "Nowy tytuł",
		updatedAtUtc: "2026-11-11T10:00:05.000Z",
	});

	it("checks the stored version, posts, and reads back what was stored", async () => {
		const backend = fakeBackend()
			.on("GET", "manageChallenges/C12", json(stored), json(afterSave))
			.on("POST", "manageChallenges", SAVED_TODAY("C12"));
		const { api } = challengesArea(backend.transport, TODAY_ON);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toEqual(toChallenge(afterSave));
		expect(result.etag).toBe("t:2026-11-11T10:00:05.000Z");
		expect(backend.calls()).toEqual([
			"GET manageChallenges/C12",
			"POST manageChallenges",
			"GET manageChallenges/C12",
		]);
		const post = backend.only("POST", "manageChallenges");
		// Today's backend knows no If-Match.
		expect(post.headers).not.toHaveProperty("if-match");
		expect(bodyOf(post)).toMatchObject({
			...stored,
			title: "Nowy tytuł",
		});
	});

	it("reports a conflict, without posting, when someone saved in between", async () => {
		const theirs = wireChallenge({
			title: "Tytuł Patryka",
			updatedAtUtc: "2026-11-11T09:59:00.000Z",
		});
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C12",
			json(theirs),
		);
		const { api } = challengesArea(backend.transport, TODAY_ON);

		const error = await failure(api.save(edited, { etag: loaded.etag }));

		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toChallenge(theirs));
		expect(backend.calls()).toEqual(["GET manageChallenges/C12"]);
	});

	it("reports a challenge that is gone as not found, without posting", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C12",
			errorReply(404, "Challenge C12 not found"),
		);
		const { api } = challengesArea(backend.transport, TODAY_ON);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("notFound");
		expect(backend.calls()).toEqual(["GET manageChallenges/C12"]);
	});

	it("makes no request while the section is read-only", async () => {
		const backend = fakeBackend();
		const { api } = challengesArea(backend.transport, SWITCHED_OFF);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("tylko do odczytu");
		expect(backend.requests).toEqual([]);
	});

	it("does not post a delete the backend cannot do", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C12",
			json(stored),
		);
		const { api } = challengesArea(backend.transport, TODAY_ON);
		const error = await failure(
			api.save({ ...edited, status: "deleted" }, { etag: loaded.etag }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("status");
		expect(backend.all("POST", "manageChallenges")).toEqual([]);
	});

	describe("test-only mode", () => {
		it("saves a test item", async () => {
			const backend = fakeBackend()
				.on("GET", "manageChallenges/C12", json(stored), json(afterSave))
				.on("POST", "manageChallenges", SAVED_TODAY("C12"));
			const { api } = challengesArea(backend.transport, TEST_ONLY);
			expect((await api.save(edited, { etag: loaded.etag })).title).toBe(
				"Nowy tytuł",
			);
			expect(backend.calls()).toEqual([
				"GET manageChallenges/C12",
				"POST manageChallenges",
				"GET manageChallenges/C12",
			]);
		});

		it("makes no request for a change that drops the mark", async () => {
			const backend = fakeBackend();
			const { api } = challengesArea(backend.transport, TEST_ONLY);
			const error = await failure(
				api.save(
					{ ...edited, internalTitle: "wiosna 2026" },
					{ etag: loaded.etag },
				),
			);
			expect(error.kind).toBe("validation");
			expect(error.issues).toEqual([
				{ path: "internalTitle", message: error.message },
			]);
			expect(backend.requests).toEqual([]);
		});

		it("does not let the mark be added to a real challenge", async () => {
			const real = wireChallenge({ internalTitle: "wiosna 2026" });
			const backend = fakeBackend().on(
				"GET",
				"manageChallenges/C12",
				json(real),
			);
			const { api } = challengesArea(backend.transport, TEST_ONLY);
			const error = await failure(
				api.save(
					{ ...toChallenge(real), internalTitle: "[TEST] wiosna 2026" },
					{ etag: loaded.etag },
				),
			);
			expect(error.kind).toBe("validation");
			expect(error.issues[0]?.path).toBe("internalTitle");
			expect(backend.calls()).toEqual(["GET manageChallenges/C12"]);
		});
	});

	describe("the backend's answers to the post", () => {
		const setup = (answer: ReturnType<typeof json>) => {
			const backend = fakeBackend()
				.on("GET", "manageChallenges/C12", json(stored))
				.on("POST", "manageChallenges", answer);
			return {
				backend,
				api: challengesArea(backend.transport, TODAY_ON).api,
			};
		};

		it("reports a crash as the backend failing", async () => {
			const { api, backend } = setup(
				errorReply(
					500,
					"Failed to update challenge: TypeError: Cannot read properties of null (reading 'sort')",
				),
			);
			const error = await failure(api.save(edited, { etag: loaded.etag }));
			expect(error.kind).toBe("server");
			expect(error.status).toBe(500);
			// Nothing is read again after a failed save.
			expect(backend.calls()).toEqual([
				"GET manageChallenges/C12",
				"POST manageChallenges",
			]);
		});

		it("reports a lost connection as a network error", async () => {
			const backend = fakeBackend()
				.on("GET", "manageChallenges/C12", json(stored))
				.on("POST", "manageChallenges", () => {
					throw new TypeError("Failed to fetch");
				});
			const { api } = challengesArea(backend.transport, TODAY_ON);
			const error = await failure(api.save(edited, { etag: loaded.etag }));
			expect(error.kind).toBe("network");
		});

		it("reports a refused sign-in as it is", async () => {
			const { api } = setup({ status: 401 });
			expect(
				(await failure(api.save(edited, { etag: loaded.etag }))).kind,
			).toBe("unauthorized");
		});
	});
});

describe("challengesArea: save on a backend with etags", () => {
	const stored = plannedChallenge();
	const loaded = toChallenge(stored);
	const edited: Challenge = { ...loaded, title: "Nowy tytuł" };

	it("posts with If-Match and takes the saved challenge from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(plannedChallenge({ title: "Nowy tytuł", etag: NEWER_ETAG })),
		);
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({ title: "Nowy tytuł", etag: NEWER_ETAG });
		// One request: no read before, no read after.
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
		const post = backend.only("POST", "manageChallenges");
		expect(post.headers["if-match"]).toBe(PLANNED_ETAG);
		expect(bodyOf(post)).toMatchObject({
			id: "C12",
			status: "published",
			hidden: false,
			paths: [{ pathId: "p_1", levelId: "beginner" }],
		});
	});

	it("sends the version the change is based on, not the entity's own", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(plannedChallenge()),
		);
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		await api.save({ ...edited, etag: NEWER_ETAG }, { etag: PLANNED_ETAG });
		expect(backend.only("POST", "manageChallenges").headers["if-match"]).toBe(
			PLANNED_ETAG,
		);
	});

	it("reads the challenge when the answer is still only a sentence", async () => {
		const backend = fakeBackend()
			.on("POST", "manageChallenges", SAVED_TODAY("C12"))
			.on(
				"GET",
				"manageChallenges/C12",
				json(plannedChallenge({ etag: NEWER_ETAG })),
			);
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		expect((await api.save(edited, { etag: loaded.etag })).etag).toBe(
			NEWER_ETAG,
		);
		expect(backend.calls()).toEqual([
			"POST manageChallenges",
			"GET manageChallenges/C12",
		]);
	});

	it.each([409, 412])(
		"turns a %i with the current challenge into a conflict that carries it",
		async (status) => {
			const theirs = plannedChallenge({
				title: "Tytuł Patryka",
				etag: NEWER_ETAG,
			});
			const backend = fakeBackend().on(
				"POST",
				"manageChallenges",
				errorReply(status, "Conflict", { current: theirs }),
			);
			const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);

			const error = await failure(api.save(edited, { etag: loaded.etag }));

			expect(error.kind).toBe("conflict");
			expect(error.status).toBe(status);
			// In the panel's shape, ready to merge with.
			expect(error.current).toEqual(toChallenge(theirs));
			expect((error.current as Challenge).etag).toBe(NEWER_ETAG);
			expect(backend.calls()).toEqual(["POST manageChallenges"]);
		},
	);

	it("reads the current challenge when the 409 came without it", async () => {
		const theirs = plannedChallenge({
			title: "Tytuł Patryka",
			etag: NEWER_ETAG,
		});
		const backend = fakeBackend()
			.on("POST", "manageChallenges", errorReply(409, "Conflict"))
			.on("GET", "manageChallenges/C12", json(theirs));
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);

		const error = await failure(api.save(edited, { etag: loaded.etag }));

		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toChallenge(theirs));
		expect(backend.calls()).toEqual([
			"POST manageChallenges",
			"GET manageChallenges/C12",
		]);
	});

	it("is still a conflict when the current challenge cannot be read", async () => {
		const backend = fakeBackend()
			.on("POST", "manageChallenges", errorReply(409, "Conflict"))
			.on("GET", "manageChallenges/C12", errorReply(503, "Unavailable"));
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("conflict");
		expect(error.current).toBeUndefined();
	});

	it("takes the field paths of a 422 from the answer", async () => {
		const backend = fakeBackend().on("POST", "manageChallenges", {
			status: 422,
			body: {
				error: "Nieznany levelId: x\nTytuł jest wymagany",
				errorCode: "VALIDATION",
				issues: [
					{
						path: "paths.0.levelId",
						code: "UNKNOWN_LEVEL",
						message: "Nieznany levelId: x",
					},
					{ path: "title", code: "REQUIRED", message: "Tytuł jest wymagany" },
				],
			},
		});
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		const error = await failure(api.save(edited, { etag: loaded.etag }));
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		// The backend names a variant by its place in the request; the panel's
		// forms name it by its id (see "pathById" below).
		expect(error.issues).toEqual([
			{ path: "paths.p_1.levelId", message: "Nieznany levelId: x" },
			{ path: "title", message: "Tytuł jest wymagany" },
		]);
	});

	it("can delete, which is a status like any other there", async () => {
		// Asked for as what it is: the backend changes the status and nothing
		// else on a delete, whatever else a save carries.
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges/C12/status",
			json(plannedChallenge({ status: "deleted", hidden: true })),
		);
		const { api } = challengesArea(backend.transport, ALL_CAPABILITIES);
		const result = await api.save(
			{ ...edited, status: "deleted" },
			{ etag: loaded.etag },
		);
		expect(result.status).toBe("deleted");
		expect(backend.calls()).toEqual(["POST manageChallenges/C12/status"]);
		const post = backend.only("POST", "manageChallenges/C12/status");
		expect(bodyOf(post)).toEqual({ status: "deleted" });
		expect(post.headers["if-match"]).toBe(PLANNED_ETAG);
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Rows and answers below are the ones the backend's own tests show
// (tests/handlers/manageChallengesEditing.test.ts,
// tests/functions/contentStatusRoutes.test.ts).

/** Produkcja's features, with the section accepted. */
const OPEN = production({ writes: { challenges: "on" } });
/** The same while the section is tried on test items. */
const OPEN_FOR_TESTS = production({ writes: { challenges: "test-only" } });

const STATUS = (id: string) => `manageChallenges/${id}/status`;

/** A challenge stored before variants had ids: `pathId` is null until its next save. */
const fromBeforePathIds = (overrides: Record<string, unknown> = {}) =>
	panelChallenge({ paths: [panelPath({ pathId: null })], ...overrides });

describe("pathIdsOf", () => {
	it("keeps the ids the backend gave", () => {
		expect(
			pathIdsOf(
				[
					{ pathId: "p_0a1b2c3d4e5f", levelId: "beginner" },
					{ pathId: "panel-made-1", levelId: "advanced" },
				],
				true,
			),
		).toEqual({ ids: ["p_0a1b2c3d4e5f", "panel-made-1"], madeUp: false });
	});

	it("makes one up from the level, in the form a save can propose", () => {
		expect(
			pathIdsOf(
				[{ pathId: null, levelId: "beginner" }, { levelId: "advanced" }],
				true,
			),
		).toEqual({ ids: ["level-beginner", "level-advanced"], madeUp: true });
	});

	it("makes it up the old way when it will not be proposed", () => {
		expect(pathIdsOf([{ pathId: null, levelId: "beginner" }], false)).toEqual({
			ids: ["level:beginner"],
			madeUp: true,
		});
	});

	it("only proposes what the backend would take as a path id", () => {
		// Its rule: letters, digits, "_" and "-", at most 64.
		const long = "x".repeat(60);
		expect(
			pathIdsOf(
				[
					{ pathId: null, levelId: "poziom 1" },
					{ pathId: null, levelId: "zażółć" },
					{ pathId: null, levelId: long },
					{ pathId: null, levelId: "a_b-c" },
				],
				true,
			).ids,
		).toEqual([
			"level:poziom 1",
			"level:zażółć",
			`level:${long}`,
			"level-a_b-c",
		]);
	});

	it("numbers a second variant at the same level", () => {
		expect(
			pathIdsOf(
				[
					{ pathId: null, levelId: "beginner" },
					{ pathId: null, levelId: "beginner" },
					{ pathId: null, levelId: "beginner" },
				],
				true,
			).ids,
		).toEqual(["level-beginner", "level-beginner-2", "level-beginner-3"]);
		expect(
			pathIdsOf(
				[
					{ pathId: null, levelId: "beginner" },
					{ pathId: null, levelId: "beginner" },
				],
				false,
			).ids,
		).toEqual(["level:beginner", "level:beginner#2"]);
	});

	it("never makes up an id another variant of the challenge has", () => {
		// The first was adopted earlier and its level changed since; a variant
		// Retool added at that level has no id yet.
		expect(
			pathIdsOf(
				[
					{ pathId: null, levelId: "beginner" },
					{ pathId: "level-beginner", levelId: "advanced" },
				],
				true,
			).ids,
		).toEqual(["level-beginner-2", "level-beginner"]);
	});

	it("gives a repeated id a made-up one, so every variant can be told apart", () => {
		const { ids, madeUp } = pathIdsOf(
			[
				{ pathId: "p_1", levelId: "beginner" },
				{ pathId: "p_1", levelId: "advanced" },
			],
			false,
		);
		expect(ids).toEqual(["p_1", "level:advanced#2"]);
		expect(madeUp).toBe(true);
	});

	it("has nothing to do for a challenge without variants", () => {
		expect(pathIdsOf([], true)).toEqual({ ids: [], madeUp: false });
	});
});

describe("formerPathIds", () => {
	it("lists both ids a variant could have had before the backend gave it one", () => {
		expect(formerPathIds(["beginner", "advanced"])).toEqual([
			["level-beginner", "level:beginner"],
			["level-advanced", "level:advanced"],
		]);
	});

	it("follows the numbering of variants at one level", () => {
		expect(formerPathIds(["beginner", "beginner"])).toEqual([
			["level-beginner", "level:beginner"],
			["level-beginner-2", "level:beginner#2"],
		]);
	});

	it("has one id where the level could never be proposed", () => {
		expect(formerPathIds(["poziom 1"])).toEqual([["level:poziom 1"]]);
	});
});

describe("pathById", () => {
	const ids = ["p_aaa", "level-advanced"];

	it("names a variant by its id instead of its place in the request", () => {
		expect(pathById("paths.0.levelId", ids)).toBe("paths.p_aaa.levelId");
		expect(pathById("paths.1.days.2.workoutIds", ids)).toBe(
			"paths.level-advanced.days.2.workoutIds",
		);
		expect(pathById("paths.1", ids)).toBe("paths.level-advanced");
	});

	it("leaves every other path alone", () => {
		for (const path of [
			"",
			"title",
			"paths",
			"descriptionFancyContent.0",
			"paths.x.days",
			"mypaths.0.days",
			"paths.0x.days",
		]) {
			expect(pathById(path, ids)).toBe(path);
		}
	});

	it("leaves a place that names no variant it knows", () => {
		expect(pathById("paths.2.levelId", ids)).toBe("paths.2.levelId");
		expect(pathById("paths.0.levelId", [])).toBe("paths.0.levelId");
	});
});

describe("toChallenge: a row of the panel's route", () => {
	it("reads the version, the status and the variant's own id", () => {
		const challenge = toChallenge(
			panelChallenge({ status: "draft", hidden: true }),
			OPEN,
		);
		expect(challenge.etag).toBe(tableEtag(0));
		expect(challenge.status).toBe("draft");
		expect(challenge.paths[0]?.pathId).toBe("p_0a1b2c3d4e5f");
	});

	it("reads a row from before statuses by what it derives to", () => {
		// The backend sends the derived status itself: published or hidden.
		expect(
			toChallenge(panelChallenge({ status: "hidden", hidden: true }), OPEN)
				.status,
		).toBe("hidden");
	});

	it("keeps when and by whom a challenge was deleted", () => {
		const challenge = toChallenge(
			panelChallenge({
				status: "deleted",
				hidden: true,
				deletedAtUtc: "2026-11-13T09:00:00.000Z",
				deletedBy: "admin-9",
			}),
			OPEN,
		);
		expect(challenge).toMatchObject({
			status: "deleted",
			deletedAtUtc: "2026-11-13T09:00:00.000Z",
			deletedBy: "admin-9",
		});
	});

	it("falls back to the time of the last change for a row without an etag", () => {
		// `etag: null` is what the DTO allows for a row built in code.
		expect(toChallenge(panelChallenge({ etag: null }), OPEN).etag).toBe(
			"t:2026-11-03T12:00:00.000Z",
		);
	});

	it("gives a variant from before path ids an id a save can propose", () => {
		const read = readChallenge(fromBeforePathIds(), OPEN);
		expect(read.challenge.paths[0]?.pathId).toBe("level-beginner");
		expect(isDerivedPathId("level-beginner")).toBe(false);
		// Part of it was made up here.
		expect(read.whole).toBe(false);
		expect(readChallenge(panelChallenge(), OPEN).whole).toBe(true);
	});

	it("makes that id up the old way while the planning store is off", () => {
		for (const caps of [undefined, production({ planning: false })]) {
			const challenge = toChallenge(fromBeforePathIds(), caps);
			expect(challenge.paths[0]?.pathId).toBe("level:beginner");
		}
	});

	it("keeps what a save said publishing would refuse, variants named by id", () => {
		const challenge = toChallenge(
			panelChallenge({
				status: "draft",
				hidden: true,
				warnings: [
					{
						path: "imageRelativePath",
						code: "REQUIRED",
						message: "Wybierz miniaturkę",
					},
					{
						path: "paths.0.days",
						code: "LENGTH_MISMATCH",
						message: "Poziom beginner ma 2 dni, a wyzwanie trwa 28",
					},
				],
			}),
			OPEN,
		);
		expect(challenge.warnings).toEqual([
			{
				path: "imageRelativePath",
				code: "REQUIRED",
				message: "Wybierz miniaturkę",
			},
			{
				path: "paths.p_0a1b2c3d4e5f.days",
				code: "LENGTH_MISMATCH",
				message: "Poziom beginner ma 2 dni, a wyzwanie trwa 28",
			},
		]);
	});

	it("has no warnings on a challenge whose save had none, or that was only read", () => {
		expect(
			toChallenge(panelChallenge({ warnings: [] }), OPEN),
		).not.toHaveProperty("warnings");
		expect(toChallenge(panelChallenge(), OPEN)).not.toHaveProperty("warnings");
	});

	it("fails loudly for warnings that are not a list", () => {
		const error = thrownBy(() =>
			toChallenge(panelChallenge({ warnings: "brak miniaturki" }), OPEN),
		);
		expect(error.kind).toBe("server");
	});
});

describe("fromChallenge: what a save sends to the panel's route", () => {
	const NOW = "2026-11-13T10:00:00.000Z";
	const now = () => NOW;

	it("sends the status in words, and `hidden` beside it", () => {
		const body = fromChallenge(
			{ ...toChallenge(panelChallenge(), OPEN), status: "draft" },
			OPEN,
			now,
		);
		expect(body.status).toBe("draft");
		expect(body.hidden).toBe(true);
	});

	it("proposes the id it made up, so the variant keeps it after the save", () => {
		const body = fromChallenge(
			toChallenge(fromBeforePathIds(), OPEN),
			OPEN,
			now,
		);
		expect(pathsOf(body)[0]).toMatchObject({
			pathId: "level-beginner",
			levelId: "beginner",
		});
	});

	it("still keeps to itself an id the backend could not take", () => {
		const body = fromChallenge(
			toChallenge(
				panelChallenge({
					paths: [panelPath({ pathId: null, levelId: "poziom 1" })],
				}),
				OPEN,
			),
			OPEN,
			now,
		);
		expect(pathsOf(body)[0]).not.toHaveProperty("pathId");
	});

	it("sends the id the panel gave a new variant", () => {
		const challenge = toChallenge(panelChallenge(), OPEN);
		const body = fromChallenge(
			{
				...challenge,
				paths: [...challenge.paths, blankPath("p-1a2b3c4d5e", "advanced", 2)],
			},
			OPEN,
			now,
		);
		expect(pathsOf(body).map((path) => path.pathId)).toEqual([
			"p_0a1b2c3d4e5f",
			"p-1a2b3c4d5e",
		]);
	});

	it("never sends back what the backend keeps about the challenge itself", () => {
		const deleted = toChallenge(
			panelChallenge({
				status: "deleted",
				hidden: true,
				deletedAtUtc: "2026-11-13T09:00:00.000Z",
				deletedBy: "admin-9",
				warnings: [
					{ path: "title", code: "REQUIRED", message: "Nazwa jest wymagana" },
				],
			}),
			OPEN,
		);
		expect(deleted).toHaveProperty("warnings");
		const body = fromChallenge({ ...deleted, status: "draft" }, OPEN, now);
		for (const field of ["warnings", "deletedAtUtc", "deletedBy", "etag"]) {
			expect(body, field).not.toHaveProperty(field);
		}
	});

	it("clears an emptied field with null, which the backend does not take for 'keep'", () => {
		const challenge = toChallenge(
			panelChallenge({
				internalTitle: "[TEST] wiosna",
				categoryId: "main",
				badgeId: "n_7",
				liveAtUtc: "2026-12-01T18:00:00.000Z",
			}),
			OPEN,
		);
		const body = fromChallenge(
			{
				...challenge,
				internalTitle: null,
				categoryId: null,
				badgeId: null,
				liveAtUtc: null,
			},
			OPEN,
			now,
		);
		// Present and null: a field left out would keep its stored value, the
		// three dates like any other.
		expect(body).toMatchObject({
			internalTitle: null,
			categoryId: null,
			badgeId: null,
			liveAtUtc: null,
		});
		for (const field of [
			"internalTitle",
			"categoryId",
			"badgeId",
			"liveAtUtc",
		]) {
			expect(Object.keys(body), field).toContain(field);
		}
	});

	it("sends back, untouched, what the backend worked out for a variant", () => {
		const body = fromChallenge(toChallenge(panelChallenge(), OPEN), OPEN, now);
		expect(pathsOf(body)[0]).toMatchObject({
			workoutsCount: 2,
			workoutsLength: { fromMinutes: 20, toMinutes: 30 },
			days: [
				{ dayIndex: 1, workoutIds: ["W1", "W2"], type: "workout" },
				{ dayIndex: 2, workoutIds: [], type: "restday" },
			],
		});
	});
});

describe("challengesArea: reading, in Produkcja as it is", () => {
	it("asks for the bin as well and reads what is in it", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([
				panelChallenge(),
				panelChallenge({
					id: "C13",
					status: "deleted",
					hidden: true,
					deletedAtUtc: "2026-11-13T09:00:00.000Z",
					deletedBy: "admin-9",
				}),
				panelChallenge({ id: "C14", status: "draft", hidden: true }),
			]),
		);
		const { api } = challengesArea(backend.transport, production());

		const list = await api.list();

		expect(list.map((challenge) => [challenge.id, challenge.status])).toEqual([
			["C12", "published"],
			["C13", "deleted"],
			["C14", "draft"],
		]);
		expect(backend.only("GET", "manageChallenges").query).toEqual({
			includeDeleted: "true",
		});
	});

	it("does not ask for the bin while there are no statuses", async () => {
		const backend = fakeBackend().on("GET", "manageChallenges", json([]));
		await challengesArea(
			backend.transport,
			production({ status: false }),
		).api.list();
		expect(backend.only("GET", "manageChallenges").query).toEqual({});
	});

	it("reads one challenge, also one in the bin", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges/C13",
			json(panelChallenge({ id: "C13", status: "deleted", hidden: true })),
		);
		const area = challengesArea(backend.transport, production());
		expect((await area.read("C13")).status).toBe("deleted");
	});

	it("reports a challenge that is not there", async () => {
		// GET by id still answers the old 404, with a null code.
		const backend = fakeBackend().on("GET", "manageChallenges/C404", {
			status: 404,
			body: { error: "Challenge C404 not found", errorCode: null },
		});
		const area = challengesArea(backend.transport, production());
		const error = await failure(area.read("C404"));
		expect(error.kind).toBe("notFound");
		expect(error.message).toBe("Challenge C404 not found");
	});

	it("reports a status filter the backend refuses", async () => {
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			errorReply(
				400,
				"Unknown status 'archived'. Valid values are: draft, published, hidden, deleted",
				{ errorCode: null },
			),
		);
		const error = await failure(
			challengesArea(backend.transport, production()).api.list(),
		);
		expect(error.kind).toBe("validation");
	});
});

describe("challengesArea: create, once the section is open", () => {
	const draft: NewChallenge = {
		...blankChallenge("2026-11-13T09:00:00.000Z"),
		title: "Pomysł na plan",
		internalTitle: "[TEST] pomysł",
		lengthDays: 2,
		paths: [blankPath("p-1a2b3c4d5e", "beginner", 2)],
	};

	it("takes the new challenge, its id, its version and its warnings from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(
				panelChallenge({
					id: "C2",
					title: "Pomysł na plan",
					status: "draft",
					hidden: true,
					imageRelativePath: null,
					paths: [panelPath({ pathId: "p-1a2b3c4d5e", days: [] })],
					warnings: [
						{
							path: "imageRelativePath",
							code: "REQUIRED",
							message: "Wybierz miniaturkę",
						},
						{
							path: "paths.0.days",
							code: "REQUIRED",
							message: "Dodaj przynajmniej jeden dzień do poziomu beginner",
						},
					],
				}),
			),
		);
		const { api } = challengesArea(backend.transport, OPEN);

		const created = await api.create(draft);

		expect(created).toMatchObject({
			id: "C2",
			etag: tableEtag(0),
			status: "draft",
		});
		expect(created.warnings).toEqual([
			{
				path: "imageRelativePath",
				code: "REQUIRED",
				message: "Wybierz miniaturkę",
			},
			{
				path: "paths.p-1a2b3c4d5e.days",
				code: "REQUIRED",
				message: "Dodaj przynajmniej jeden dzień do poziomu beginner",
			},
		]);
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
		const post = backend.only("POST", "manageChallenges");
		expect(bodyOf(post)).toMatchObject({
			id: null,
			status: "draft",
			hidden: true,
		});
		expect(pathsOf(bodyOf(post))[0]?.pathId).toBe("p-1a2b3c4d5e");
		// A create names no version.
		expect(post.headers).not.toHaveProperty("if-match");
	});

	it("names the variant of a refusal by its id, and keeps the day", async () => {
		// "answers the panel 422 with one issue per problem".
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply(
				[
					{
						path: "categoryId",
						code: "UNKNOWN_ID",
						message: "Nieznana categoryId: nope",
					},
					{
						path: "paths.0.levelId",
						code: "UNKNOWN_ID",
						message: "Nieznany levelId: martian",
					},
					{
						path: "paths.0.days.1.workoutIds",
						code: "UNKNOWN_ID",
						message: "Nieznany workoutId: W404",
					},
				],
				"Nieznana categoryId: nope\nNieznany levelId: martian\nNieznany workoutId: W404",
			),
		);
		const { api } = challengesArea(backend.transport, OPEN);

		const error = await failure(api.create(draft));

		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.issues).toEqual([
			{ path: "categoryId", message: "Nieznana categoryId: nope" },
			{
				path: "paths.p-1a2b3c4d5e.levelId",
				message: "Nieznany levelId: martian",
			},
			{
				path: "paths.p-1a2b3c4d5e.days.1.workoutIds",
				message: "Nieznany workoutId: W404",
			},
		]);
		expect(error.message).toBe(
			"Nieznana categoryId: nope\nNieznany levelId: martian\nNieznany workoutId: W404",
		);
	});

	it("leaves a refusal that names no variant exactly as it came", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply([
				{ path: "title", code: "REQUIRED", message: "Nazwa jest wymagana" },
			]),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.create({
				...draft,
				title: "",
			}),
		);
		expect(error.issues).toEqual([
			{ path: "title", message: "Nazwa jest wymagana" },
		]);
	});

	it("refuses to create a deleted challenge as the backend does", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply([
				{
					path: "status",
					code: "INVALID_STATUS_TRANSITION",
					message: "Nie można utworzyć wyzwania od razu jako usuniętego",
				},
			]),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.create({
				...draft,
				status: "deleted",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("status");
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const error = await failure(
			challengesArea(backend.transport, production()).api.create(draft),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Wyzwania”");
		expect(backend.requests).toEqual([]);
	});
});

describe("challengesArea: save, once the section is open", () => {
	const stored = panelChallenge();
	const loaded = toChallenge(stored, OPEN);
	const edited: Challenge = { ...loaded, title: "Nowy tytuł" };

	it("posts once, with If-Match, and takes the saved challenge from the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(
				panelChallenge({
					title: "Nowy tytuł",
					etag: tableEtag(1),
					warnings: [],
				}),
			),
		);
		const { api } = challengesArea(backend.transport, OPEN);

		const result = await api.save(edited, { etag: loaded.etag });

		expect(result).toMatchObject({ title: "Nowy tytuł", etag: tableEtag(1) });
		expect(result).not.toHaveProperty("warnings");
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
		const post = backend.only("POST", "manageChallenges");
		expect(post.headers["if-match"]).toBe(tableEtag(0));
		expect(bodyOf(post)).toMatchObject({
			id: "C12",
			title: "Nowy tytuł",
			status: "published",
			hidden: false,
		});
		expect(bodyOf(post)).not.toHaveProperty("etag");
	});

	it("keeps a variant's id through its first save by proposing the one it showed", async () => {
		const before = toChallenge(fromBeforePathIds(), OPEN);
		const backend = fakeBackend().on("POST", "manageChallenges", (request) => {
			const sent = bodyOf(request);
			// The backend stores the id a path proposes ("accepts the id a new
			// path proposes").
			return json(
				panelChallenge({
					title: "Nowy tytuł",
					etag: tableEtag(1),
					paths: [panelPath({ pathId: pathsOf(sent)[0]?.pathId })],
					warnings: [],
				}),
			);
		});
		const { api } = challengesArea(backend.transport, OPEN);

		const result = await api.save(
			{ ...before, title: "Nowy tytuł" },
			{ etag: before.etag },
		);

		expect(before.paths[0]?.pathId).toBe("level-beginner");
		expect(result.paths[0]?.pathId).toBe("level-beginner");
	});

	it("turns a stale version into a conflict that carries the stored challenge", async () => {
		// "refuses a save based on an older version with 409 and the challenge
		// as stored now".
		const theirs = panelChallenge({
			title: "Ktoś inny zdążył",
			etag: tableEtag(1),
		});
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			conflictReply("Wyzwanie zostało zmienione w międzyczasie", theirs),
		);
		const { api } = challengesArea(backend.transport, OPEN);

		const error = await failure(api.save(edited, { etag: loaded.etag }));

		expect(error.kind).toBe("conflict");
		expect(error.status).toBe(409);
		expect(error.message).toBe("Wyzwanie zostało zmienione w międzyczasie");
		expect(error.current).toEqual(toChallenge(theirs, OPEN));
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
	});

	it("reads the stored challenge when the race was lost to a delete", async () => {
		// `current` is null when the row is gone by the time it is read back.
		const backend = fakeBackend()
			.on(
				"POST",
				"manageChallenges",
				conflictReply("Wyzwanie zostało zmienione w międzyczasie", null),
			)
			.on("GET", "manageChallenges/C12", {
				status: 404,
				body: { error: "Challenge C12 not found", errorCode: null },
			});
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("conflict");
		expect(error.current).toBeUndefined();
	});

	it("reports a challenge that is gone as not found", async () => {
		// "answers 404 when a version is named for a challenge that does not exist".
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			notFoundReply("Challenge C12 not found"),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("notFound");
		expect(error.status).toBe(404);
	});

	it("names the variants of a refused save by their ids", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply(
				[
					{
						path: "paths.0.days",
						code: "LENGTH_MISMATCH",
						message: "Poziom beginner ma 2 dni, a wyzwanie trwa 28",
					},
				],
				"Poziom beginner ma 2 dni, a wyzwanie trwa 28",
			),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...edited, lengthDays: 28 },
				{ etag: loaded.etag },
			),
		);
		expect(error.issues).toEqual([
			{
				path: "paths.p_0a1b2c3d4e5f.days",
				message: "Poziom beginner ma 2 dni, a wyzwanie trwa 28",
			},
		]);
		expect(error.message).toBe("Poziom beginner ma 2 dni, a wyzwanie trwa 28");
	});

	it("names the version on every change to a stored challenge, as the backend requires", async () => {
		const backend = fakeBackend()
			.on(
				"POST",
				"manageChallenges",
				json(panelChallenge({ etag: tableEtag(1) })),
			)
			.on(
				"POST",
				STATUS("C12"),
				json(
					panelChallenge({
						status: "deleted",
						hidden: true,
						etag: tableEtag(2),
					}),
				),
			);
		const { api } = challengesArea(backend.transport, OPEN);
		await api.save(edited, { etag: loaded.etag });
		await api.save({ ...loaded, status: "deleted" }, { etag: loaded.etag });
		for (const request of backend.requests) {
			expect(request.headers["if-match"], request.path).toBe(tableEtag(0));
		}
	});

	it("shows a refusal, not a conflict, should the backend say a save named no version", async () => {
		// 428 VERSION_REQUIRED (`versionRequired` of panelContract.ts). The
		// client names one on every save, so this is a fault of the panel.
		const backend = fakeBackend().on("POST", "manageChallenges", {
			status: 428,
			body: {
				error:
					"Challenge C12 exists already; name the version this change is based on (If-Match header or etag field)",
				errorCode: "VERSION_REQUIRED",
			},
		});
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(428);
		expect(error.message).toBe(
			"Challenge C12 exists already; name the version this change is based on (If-Match header or etag field)",
		);
		// Nothing read again and nothing merged.
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
	});

	it("cannot name a version it worked out itself, and reads the stored challenge instead", async () => {
		// A row the backend sent without an etag (the DTO allows null). Its
		// version here is the time of its last change; the comparison is made
		// by the panel, and the backend, which needs a version, will refuse.
		const row = panelChallenge({ etag: null });
		const unversioned = toChallenge(row, OPEN);
		const backend = fakeBackend()
			.on("GET", "manageChallenges/C12", json(row))
			.on("POST", "manageChallenges", {
				status: 428,
				body: { error: "x", errorCode: "VERSION_REQUIRED" },
			});
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...unversioned, title: "Nowy tytuł" },
				{ etag: unversioned.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(backend.calls()).toEqual([
			"GET manageChallenges/C12",
			"POST manageChallenges",
		]);
		expect(backend.only("POST", "manageChallenges").headers).not.toHaveProperty(
			"if-match",
		);
	});

	it("shows a badge that is taken at the badge's field, as the backend says it", async () => {
		const said =
			"Badge n_7 is assigned to workout 'Mobilność bioder' (W12) — cannot mix workouts and challenges";
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply([
				{ path: "badgeId", code: "BADGE_IN_USE", message: said },
			]),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...edited, badgeId: "n_7" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toHaveLength(1);
		expect(error.issues[0]?.path).toBe("badgeId");
		expect(error.issues[0]?.message).toBe(said);
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const error = await failure(
			challengesArea(backend.transport, production()).api.save(edited, {
				etag: loaded.etag,
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("tylko do odczytu");
		expect(backend.requests).toEqual([]);
	});

	it("reads the stored challenge first while only test items may be saved", async () => {
		const real = panelChallenge({ internalTitle: "wiosna 2026" });
		const backend = fakeBackend()
			.on("GET", "manageChallenges/C12", json(real))
			.on("POST", "manageChallenges", json(panelChallenge()));
		const { api } = challengesArea(backend.transport, OPEN_FOR_TESTS);

		// Marked here, not in the stored version: the mark alone opens nothing.
		const error = await failure(api.save(edited, { etag: loaded.etag }));

		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("internalTitle");
		expect(backend.calls()).toEqual(["GET manageChallenges/C12"]);
	});

	it("saves a test item in that mode, still with If-Match", async () => {
		const backend = fakeBackend()
			.on("GET", "manageChallenges/C12", json(stored))
			.on(
				"POST",
				"manageChallenges",
				json(panelChallenge({ title: "Nowy tytuł", etag: tableEtag(1) })),
			);
		const { api } = challengesArea(backend.transport, OPEN_FOR_TESTS);

		expect((await api.save(edited, { etag: loaded.etag })).etag).toBe(
			tableEtag(1),
		);
		expect(backend.calls()).toEqual([
			"GET manageChallenges/C12",
			"POST manageChallenges",
		]);
		expect(backend.only("POST", "manageChallenges").headers["if-match"]).toBe(
			tableEtag(0),
		);
	});
});

describe("challengesArea: a change of status has a call of its own", () => {
	const stored = panelChallenge({ status: "draft", hidden: true });

	/** The area after the list was read, as it is when a screen saves. */
	async function afterList(rows: unknown[] = [stored]) {
		const backend = fakeBackend().on("GET", "manageChallenges", json(rows));
		const { api } = challengesArea(backend.transport, OPEN);
		const list = await api.list();
		return { backend, api, list };
	}

	it("publishes with the status call when nothing else was changed", async () => {
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			json(panelChallenge({ etag: tableEtag(1), warnings: [] })),
		);

		const result = await api.save(
			{ ...loaded, status: "published" },
			{ etag: loaded.etag },
		);

		expect(result).toMatchObject({ status: "published", etag: tableEtag(1) });
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`POST ${STATUS("C12")}`,
		]);
		const post = backend.only("POST", STATUS("C12"));
		// The status and the version it is based on: not the challenge again.
		expect(bodyOf(post)).toEqual({ status: "published" });
		expect(post.headers["if-match"]).toBe(tableEtag(0));
	});

	it.each(["hidden", "deleted"] as const)(
		"moves a draft to %s the same way",
		async (status) => {
			const { backend, api, list } = await afterList();
			const [loaded] = list as [Challenge];
			backend.on(
				"POST",
				STATUS("C12"),
				json(panelChallenge({ status, hidden: true, etag: tableEtag(1) })),
			);
			const result = await api.save(
				{ ...loaded, status },
				{ etag: loaded.etag },
			);
			expect(result.status).toBe(status);
			expect(bodyOf(backend.only("POST", STATUS("C12")))).toEqual({ status });
		},
	);

	it("restores from the bin the same way, as a draft", async () => {
		const binned = panelChallenge({
			status: "deleted",
			hidden: true,
			deletedAtUtc: "2026-11-13T09:00:00.000Z",
			deletedBy: "admin-9",
		});
		const { backend, api, list } = await afterList([binned]);
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			json(
				panelChallenge({ status: "draft", hidden: true, etag: tableEtag(1) }),
			),
		);

		const result = await api.save(
			{ ...loaded, status: "draft" },
			{ etag: loaded.etag },
		);

		expect(result).toMatchObject({
			status: "draft",
			deletedAtUtc: null,
			deletedBy: null,
		});
		expect(bodyOf(backend.only("POST", STATUS("C12")))).toEqual({
			status: "draft",
		});
	});

	it("sends the whole challenge when anything else was changed with the status", async () => {
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			json(panelChallenge({ title: "Gotowe", etag: tableEtag(1) })),
		);

		await api.save(
			{ ...loaded, status: "published", title: "Gotowe" },
			{ etag: loaded.etag },
		);

		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"POST manageChallenges",
		]);
		expect(bodyOf(backend.only("POST", "manageChallenges"))).toMatchObject({
			status: "published",
			title: "Gotowe",
		});
	});

	it("sends the whole challenge when it cannot show nothing else changed", async () => {
		// Never read through this client: there is nothing to compare with.
		const loaded = toChallenge(stored, OPEN);
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(panelChallenge({ etag: tableEtag(1) })),
		);
		const { api } = challengesArea(backend.transport, OPEN);
		await api.save({ ...loaded, status: "published" }, { etag: loaded.etag });
		expect(backend.calls()).toEqual(["POST manageChallenges"]);
	});

	it("sends the whole challenge when the change is based on another version than the one seen", async () => {
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			json(panelChallenge({ etag: tableEtag(2) })),
		);
		await api.save({ ...loaded, status: "published" }, { etag: tableEtag(1) });
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"POST manageChallenges",
		]);
	});

	it("sends the whole challenge while a variant still has a made-up id, so the id is proposed", async () => {
		// The status call would give the variant an id of the backend's own,
		// and the planner would lose the one it has open.
		const { backend, api, list } = await afterList([
			fromBeforePathIds({ status: "draft", hidden: true }),
		]);
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			json(
				panelChallenge({ paths: [panelPath({ pathId: "level-beginner" })] }),
			),
		);

		const result = await api.save(
			{ ...loaded, status: "published" },
			{ etag: loaded.etag },
		);

		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"POST manageChallenges",
		]);
		expect(
			pathsOf(bodyOf(backend.only("POST", "manageChallenges")))[0]?.pathId,
		).toBe("level-beginner");
		expect(result.paths[0]?.pathId).toBe("level-beginner");
	});

	it("uses the status call for the next change once the answer carried real ids", async () => {
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			json(panelChallenge({ etag: tableEtag(1) })),
			json(
				panelChallenge({ status: "hidden", hidden: true, etag: tableEtag(2) }),
			),
		);
		const published = await api.save(
			{ ...loaded, status: "published" },
			{ etag: loaded.etag },
		);
		await api.save(
			{ ...published, status: "hidden" },
			{ etag: published.etag },
		);
		const posts = backend.all("POST", STATUS("C12"));
		expect(posts.map((post) => post.headers["if-match"])).toEqual([
			tableEtag(0),
			tableEtag(1),
		]);
	});

	it("deletes with the status call whatever else the save carries: the backend would ignore it", async () => {
		// "deletes when a save names the status, and keeps the challenge as it
		// was stored".
		const published = panelChallenge({ title: "Zapisany tytuł" });
		const loaded = toChallenge(published, OPEN);
		const backend = fakeBackend().on(
			"POST",
			STATUS("C12"),
			json(
				panelChallenge({
					title: "Zapisany tytuł",
					status: "deleted",
					hidden: true,
					deletedAtUtc: "2026-11-13T10:01:00.000Z",
					deletedBy: "uid-ada",
					etag: tableEtag(1),
				}),
			),
		);
		const { api } = challengesArea(backend.transport, OPEN);

		const result = await api.save(
			{ ...loaded, status: "deleted", title: "Zmiana razem z usunięciem" },
			{ etag: loaded.etag },
		);

		// What is stored, not what was typed.
		expect(result).toMatchObject({
			status: "deleted",
			title: "Zapisany tytuł",
			deletedBy: "uid-ada",
		});
		expect(backend.calls()).toEqual([`POST ${STATUS("C12")}`]);
		expect(bodyOf(backend.only("POST", STATUS("C12")))).toEqual({
			status: "deleted",
		});
	});

	it("lets the backend say that the bin is read-only", async () => {
		// An edit of a challenge that is in the bin and stays there.
		const binned = panelChallenge({ status: "deleted", hidden: true });
		const { backend, api, list } = await afterList([binned]);
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			validationReply([
				{
					path: "status",
					code: "DELETED_READ_ONLY",
					message: "Usunięte wyzwanie można tylko przywrócić (jako szkic)",
				},
			]),
		);

		const error = await failure(
			api.save({ ...loaded, title: "Edycja w koszu" }, { etag: loaded.etag }),
		);

		expect(error.kind).toBe("validation");
		expect(error.message).toBe(
			"Usunięte wyzwanie można tylko przywrócić (jako szkic)",
		);
		expect(error.issues[0]?.path).toBe("status");
	});

	it("names the variants of a refused publish by their ids", async () => {
		// "refuses to publish an incomplete draft, with every problem".
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			validationReply([
				{
					path: "imageRelativePath",
					code: "REQUIRED",
					message: "Wybierz miniaturkę",
				},
				{
					path: "paths.0.days.0.workoutIds",
					code: "UNKNOWN_ID",
					message: "Nieznany workoutId: W404",
				},
				{
					path: "paths.0.days",
					code: "LENGTH_MISMATCH",
					message: "Poziom beginner ma 2 dni, a wyzwanie trwa 5",
				},
			]),
		);

		const error = await failure(
			api.save({ ...loaded, status: "published" }, { etag: loaded.etag }),
		);

		expect(error.kind).toBe("validation");
		expect(error.issues.map((issue) => issue.path)).toEqual([
			"imageRelativePath",
			"paths.p_0a1b2c3d4e5f.days.0.workoutIds",
			"paths.p_0a1b2c3d4e5f.days",
		]);
	});

	it("reports the promoted challenge that cannot leave the app", async () => {
		const loaded = toChallenge(panelChallenge(), OPEN);
		const backend = fakeBackend().on(
			"POST",
			STATUS("C12"),
			validationReply([
				{
					path: "status",
					code: "PROMOTED",
					message:
						"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
				},
			]),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...loaded, status: "deleted" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("jest promowane");
	});

	it("turns a stale version into a conflict with the stored challenge", async () => {
		const { backend, api, list } = await afterList();
		const [loaded] = list as [Challenge];
		const theirs = panelChallenge({
			status: "draft",
			hidden: true,
			title: "Ktoś inny zdążył",
			etag: tableEtag(1),
		});
		backend.on(
			"POST",
			STATUS("C12"),
			conflictReply("Wyzwanie zostało zmienione w międzyczasie", theirs),
		);

		const error = await failure(
			api.save({ ...loaded, status: "published" }, { etag: loaded.etag }),
		);

		expect(error.kind).toBe("conflict");
		expect(error.current).toEqual(toChallenge(theirs, OPEN));
	});

	it("reports a challenge that is gone", async () => {
		const loaded = toChallenge(panelChallenge(), OPEN);
		const backend = fakeBackend().on(
			"POST",
			STATUS("C12"),
			notFoundReply("Challenge C12 not found"),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...loaded, status: "deleted" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("notFound");
	});

	it("keeps the warnings of a move back to a draft", async () => {
		const { backend, api, list } = await afterList([panelChallenge()]);
		const [loaded] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			json(
				panelChallenge({
					status: "draft",
					hidden: true,
					etag: tableEtag(1),
					warnings: [
						{
							path: "recommendedNext",
							code: "RECOMMENDATION_UNAVAILABLE",
							message:
								"recommendedNext zawiera wyzwania, które są szkicem albo zostały usunięte, i nie będą polecane: C3",
						},
					],
				}),
			),
		);
		const result = await api.save(
			{ ...loaded, status: "draft" },
			{ etag: loaded.etag },
		);
		expect(result.warnings).toHaveLength(1);
	});

	it("is not used while the backend has no statuses", async () => {
		const caps = production({ status: false, writes: { challenges: "on" } });
		const backend = fakeBackend().on(
			"GET",
			"manageChallenges",
			json([panelChallenge()]),
		);
		const { api } = challengesArea(backend.transport, caps);
		const [loaded] = (await api.list()) as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			json(
				panelChallenge({ status: "hidden", hidden: true, etag: tableEtag(1) }),
			),
		);

		await api.save({ ...loaded, status: "hidden" }, { etag: loaded.etag });

		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"POST manageChallenges",
		]);
		const body = bodyOf(backend.only("POST", "manageChallenges"));
		expect(body.hidden).toBe(true);
		expect(body).not.toHaveProperty("status");
		// And a delete is refused here, as before.
		const error = await failure(
			api.save({ ...loaded, status: "deleted" }, { etag: loaded.etag }),
		);
		expect(error.issues[0]?.path).toBe("status");
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────
//
// Outside a draft the backend trims, drops, sorts and fills in nothing any
// more: each such case is a 422 with a field and a code
// (tests/handlers/manageChallengesEditing.test.ts, "nothing is corrected,
// dropped or filled in on the quiet"). What can be put right without
// changing what was meant is put right before it is sent.

describe("fromChallenge: sent exactly as it is to be stored", () => {
	const NOW = "2026-11-13T10:00:00.000Z";
	const now = () => NOW;
	const loaded = toChallenge(panelChallenge(), OPEN);

	it("sends ids and the picture's path without the spaces around them", () => {
		const body = fromChallenge(
			{
				...loaded,
				categoryId: " strength ",
				badgeId: "b1 ",
				perfectCompletionBadgeId: "\tb2",
				offeringId: " offer_1",
				offeringDiscountedId: "offer_2 ",
				imageRelativePath: "challenges/c.png ",
			},
			OPEN,
			now,
		);
		expect(body).toMatchObject({
			categoryId: "strength",
			badgeId: "b1",
			perfectCompletionBadgeId: "b2",
			offeringId: "offer_1",
			offeringDiscountedId: "offer_2",
			imageRelativePath: "challenges/c.png",
		});
	});

	it("sends an id that is only spaces as none", () => {
		const body = fromChallenge(
			{ ...loaded, categoryId: "  ", badgeId: "" },
			OPEN,
			now,
		);
		expect(body.categoryId).toBeNull();
		expect(body.badgeId).toBeNull();
	});

	it("sends each id of a list once, and no empty one", () => {
		const body = fromChallenge(
			{
				...loaded,
				goalsIds: ["weightloss", "weightloss", ""],
				difficultyLevelsIds: [" easy", "easy"],
				unlockedByEntitlementIds: ["ent_a", "ent_b", "ent_a"],
				discountedForEntitlementIds: ["", "  "],
			},
			OPEN,
			now,
		);
		expect(body.goalsIds).toEqual(["weightloss"]);
		expect(body.difficultyLevelsIds).toEqual(["easy"]);
		// The first is the one a purchase grants: the order holds.
		expect(body.unlockedByEntitlementIds).toEqual(["ent_a", "ent_b"]);
		expect(body.discountedForEntitlementIds).toEqual([]);
	});

	it("suggests each challenge once, in the order given", () => {
		const body = fromChallenge(
			{
				...loaded,
				recommendedNext: [
					{ id: "C3" },
					{ id: " C5 " },
					{ id: "C3" },
					{ id: "" },
				],
			},
			OPEN,
			now,
		);
		expect(body.recommendedNext).toEqual([{ id: "C3" }, { id: "C5" }]);
	});

	it("keeps what else a recommendation carries", () => {
		const body = fromChallenge(
			{ ...loaded, recommendedNext: [{ id: "C3", since: "v2" }] },
			OPEN,
			now,
		);
		expect(body.recommendedNext).toEqual([{ id: "C3", since: "v2" }]);
	});

	it("sends a variant's description as it is to be stored: trimmed, or none", () => {
		const [first] = loaded.paths as [Challenge["paths"][number]];
		const withDescription = (description: string | null) =>
			pathsOf(
				fromChallenge(
					{ ...loaded, paths: [{ ...first, description }] },
					OPEN,
					now,
				),
			)[0]?.description;
		expect(withDescription("Opis poziomu\n")).toBe("Opis poziomu");
		expect(withDescription("Opis poziomu,\nw dwóch liniach")).toBe(
			"Opis poziomu,\nw dwóch liniach",
		);
		expect(withDescription("   ")).toBeNull();
		expect(withDescription("")).toBeNull();
		expect(withDescription(null)).toBeNull();
	});

	it("sends the days of a variant in the order of their numbers", () => {
		const [first] = loaded.paths as [Challenge["paths"][number]];
		const body = fromChallenge(
			{
				...loaded,
				paths: [
					{
						...first,
						difficultyLevelsIds: ["easy", "easy"],
						days: [
							{ dayIndex: 2, workoutIds: [] },
							{ dayIndex: 1, workoutIds: ["W1"] },
						],
					},
				],
			},
			OPEN,
			now,
		);
		expect(pathsOf(body)[0]).toMatchObject({
			difficultyLevelsIds: ["easy"],
			days: [
				{ dayIndex: 1, workoutIds: ["W1"] },
				{ dayIndex: 2, workoutIds: [] },
			],
		});
		// The challenge it was given is not changed.
		expect(loaded.paths[0]?.days.map((day) => day.dayIndex)).toEqual([1, 2]);
	});

	it("does not put right what is wrong in substance", () => {
		const [first] = loaded.paths as [Challenge["paths"][number]];
		const body = fromChallenge(
			{
				...loaded,
				title: "Ab",
				subtitle: "Abc",
				lengthDays: 2.5 as number,
				paths: [
					{
						...first,
						days: [
							// The same workout twice on a day, a day number missing.
							{ dayIndex: 1, workoutIds: ["W1", "W1"] },
							{ dayIndex: 3, workoutIds: [] },
						],
					},
				],
			},
			OPEN,
			now,
		);
		// Too short: not something a trim or a pad would make right.
		expect(body.title).toBe("Ab");
		expect(body.subtitle).toBe("Abc");
		expect(body.lengthDays).toBe(2.5);
		expect(pathsOf(body)[0]?.days).toEqual([
			{ dayIndex: 1, workoutIds: ["W1", "W1"] },
			{ dayIndex: 3, workoutIds: [] },
		]);
	});

	it("says when a new challenge was added, and keeps the stored date of one that does not say", () => {
		// "no date of adding, which used to become today" is refused now.
		const fresh = fromChallenge(
			{ ...blankChallenge(""), title: "Nowe", status: "published" },
			OPEN,
			now,
		);
		expect(fresh.addedAtUtc).toBe(NOW);
		const stored = fromChallenge({ ...loaded, addedAtUtc: "" }, OPEN, now);
		expect(stored).not.toHaveProperty("addedAtUtc");
		expect(fromChallenge(loaded, OPEN, now).addedAtUtc).toBe(
			"2026-03-01T08:00:00.000Z",
		);
	});

	it("always says what a new challenge is to be, and never two things", () => {
		// "a new challenge that does not say what it is to be" and "`hidden`
		// that says the opposite of the status" are both refused.
		for (const status of ["draft", "published", "hidden"] as const) {
			const body = fromChallenge({ ...blankChallenge(NOW), status }, OPEN, now);
			expect(body.status).toBe(status);
			expect(body.hidden).toBe(status !== "published");
		}
	});

	it("names no version in the body: the header is the one place for it", () => {
		// A body and a header that disagree are a refusal of their own.
		expect(fromChallenge(loaded, OPEN, now)).not.toHaveProperty("etag");
	});

	it("does none of this while the backend does not speak the editing contract", () => {
		const body = fromChallenge(
			{
				...loaded,
				categoryId: " strength ",
				goalsIds: ["a", "a"],
				addedAtUtc: "",
			},
			production({ etag: false }),
			now,
		);
		expect(body.categoryId).toBe(" strength ");
		expect(body.goalsIds).toEqual(["a", "a"]);
		expect(body.addedAtUtc).toBe("");
	});
});

describe("challengesArea: the stricter backend", () => {
	const stored = panelChallenge();
	const loaded = toChallenge(stored, OPEN);

	async function afterList(rows: unknown[] = [stored]) {
		const backend = fakeBackend().on("GET", "manageChallenges", json(rows));
		const { api } = challengesArea(backend.transport, OPEN);
		const list = await api.list();
		return { backend, api, list };
	}

	it("refuses, in the backend's words, to bin a challenge that others recommend", async () => {
		const said =
			"Wyzwanie jest polecane w opublikowanych wyzwaniach, więc nie może zostać usunięte: Plan A (C1)";
		const backend = fakeBackend().on(
			"POST",
			STATUS("C12"),
			conflictReply(said, stored, "IN_USE", {
				usedBy: [{ id: "C1", title: "Plan A", status: "published" }],
			}),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...loaded, status: "deleted" },
				{ etag: loaded.etag },
			),
		);
		// A refusal, not "someone changed it meanwhile".
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(409);
		expect(error.message).toBe(said);
		expect(error.issues).toEqual([{ path: "", message: said }]);
		expect(backend.calls()).toEqual([`POST ${STATUS("C12")}`]);
	});

	it("refuses the way back to a draft the same way, through a full save too", async () => {
		const said =
			"Wyzwanie jest polecane w opublikowanych wyzwaniach, więc nie może wrócić do szkicu: Plan A (C1)";
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			conflictReply(said, stored, "IN_USE", {
				usedBy: [{ id: "C1", title: "Plan A", status: "published" }],
			}),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...loaded, status: "draft", title: "Poprawki" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe(said);
	});

	it("takes a published challenge down with the status call even when a variant's id was made up", async () => {
		// A save that ends hidden is held to every rule; the status call hides
		// what is published as it is. Content from before the rules must not
		// stand in the way of taking a challenge down.
		const { backend, api, list } = await afterList([fromBeforePathIds()]);
		const [first] = list as [Challenge];
		backend.on(
			"POST",
			STATUS("C12"),
			json(
				panelChallenge({ status: "hidden", hidden: true, etag: tableEtag(1) }),
			),
		);

		const result = await api.save(
			{ ...first, status: "hidden" },
			{ etag: first.etag },
		);

		expect(result.status).toBe("hidden");
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			`POST ${STATUS("C12")}`,
		]);
		// The variant has the backend's own id from now on; the planning list
		// follows it (carryVariantKeys).
		expect(first.paths[0]?.pathId).toBe("level-beginner");
		expect(result.paths[0]?.pathId).toBe("p_0a1b2c3d4e5f");
	});

	it("still sends such a challenge whole to publish it, so the id is adopted", async () => {
		const { backend, api, list } = await afterList([
			fromBeforePathIds({ status: "hidden", hidden: true }),
		]);
		const [first] = list as [Challenge];
		backend.on(
			"POST",
			"manageChallenges",
			json(
				panelChallenge({ paths: [panelPath({ pathId: "level-beginner" })] }),
			),
		);
		await api.save({ ...first, status: "published" }, { etag: first.etag });
		expect(backend.calls()).toEqual([
			"GET manageChallenges",
			"POST manageChallenges",
		]);
	});

	it("passes on, field by field, what only the person can put right", async () => {
		// "the panel's own rules for publishing" and "nothing is corrected".
		const issues = [
			{
				path: "title",
				code: "TOO_SHORT",
				message: "Nazwa musi mieć co najmniej 4 znaki",
			},
			{
				path: "subtitle",
				code: "TOO_SHORT",
				message: "Podtytuł musi mieć co najmniej 4 znaki",
			},
			{
				path: "lengthDays",
				code: "OUT_OF_RANGE",
				message: "lengthDays musi być dodatnią liczbą całkowitą",
			},
			{
				path: "paths.0.days",
				code: "NO_TRAINING_DAY",
				message: "Poziom beginner nie ma żadnego treningu",
			},
			{
				path: "paths.0.days",
				code: "INVALID_DAY_INDEX",
				message: "Nieprawidłowy indeks dnia dla poziomu beginner: 3",
			},
			{
				path: "recommendedNext",
				code: "RECOMMENDATION_UNAVAILABLE",
				message:
					"recommendedNext zawiera wyzwania, które są szkicem albo zostały usunięte, więc nie mogą być polecane: CDraft, CDeleted",
			},
			{
				path: "status",
				code: "PROMOTED",
				message:
					"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
			},
		];
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			validationReply(issues, issues.map((issue) => issue.message).join("\n")),
		);
		const error = await failure(
			challengesArea(backend.transport, OPEN).api.save(
				{ ...loaded, title: "Abc", status: "hidden" },
				{ etag: loaded.etag },
			),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{ path: "title", message: "Nazwa musi mieć co najmniej 4 znaki" },
			{ path: "subtitle", message: "Podtytuł musi mieć co najmniej 4 znaki" },
			{
				path: "lengthDays",
				message: "lengthDays musi być dodatnią liczbą całkowitą",
			},
			{
				path: "paths.p_0a1b2c3d4e5f.days",
				message: "Poziom beginner nie ma żadnego treningu",
			},
			{
				path: "paths.p_0a1b2c3d4e5f.days",
				message: "Nieprawidłowy indeks dnia dla poziomu beginner: 3",
			},
			{
				path: "recommendedNext",
				message:
					"recommendedNext zawiera wyzwania, które są szkicem albo zostały usunięte, więc nie mogą być polecane: CDraft, CDeleted",
			},
			{
				path: "status",
				message:
					"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
			},
		]);
	});

	it("puts right on the way out what the backend would refuse for its spelling", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(panelChallenge({ etag: tableEtag(1) })),
		);
		await challengesArea(backend.transport, OPEN).api.save(
			{ ...loaded, categoryId: " main ", goalsIds: ["strength", "strength"] },
			{ etag: loaded.etag },
		);
		expect(bodyOf(backend.only("POST", "manageChallenges"))).toMatchObject({
			categoryId: "main",
			goalsIds: ["strength"],
		});
	});

	it("gets warnings only with a draft: a published save has none to keep", async () => {
		const backend = fakeBackend().on(
			"POST",
			"manageChallenges",
			json(panelChallenge({ etag: tableEtag(1), warnings: [] })),
		);
		const result = await challengesArea(backend.transport, OPEN).api.save(
			{ ...loaded, title: "Nowy tytuł" },
			{ etag: loaded.etag },
		);
		expect(result).not.toHaveProperty("warnings");
	});
});

// ─── The backend as tightened once more (third pass) ────────────────────────

describe("fromChallenge: titles, dates and nothing of the panel's own", () => {
	const now = () => "2026-11-13T10:00:00.000Z";
	const loaded = toChallenge(panelChallenge(), OPEN);

	it("sends the title and the subtitle without the spaces around them", () => {
		const body = fromChallenge(
			{ ...loaded, title: "  Wiosenne wyzwanie ", subtitle: "28 dni ruchu\n" },
			OPEN,
			now,
		);
		expect(body.title).toBe("Wiosenne wyzwanie");
		expect(body.subtitle).toBe("28 dni ruchu");
		// Nothing inside a title is touched.
		expect(
			fromChallenge({ ...loaded, title: "Dwa  słowa" }, OPEN, now).title,
		).toBe("Dwa  słowa");
	});

	it("takes out of a title what nobody can see, and leaves a line break for the backend to refuse", () => {
		// "title nie może zawierać znaków nowej linii ani znaków niewidocznych"
		const body = fromChallenge(
			{
				...loaded,
				title: "\ufeffWiosenne\u200b wyzwanie",
				subtitle: "28 dni\nruchu",
			},
			OPEN,
			now,
		);
		expect(body.title).toBe("Wiosenne wyzwanie");
		expect(body.subtitle).toBe("28 dni\nruchu");
		// The switch-off path sends a title as it was typed.
		expect(
			fromChallenge({ ...loaded, title: " Wiosna\u200b " }, SWITCHED_OFF, now)
				.title,
		).toBe(" Wiosna\u200b ");
	});

	it("sends every date as a full instant or as null, never as an empty text", () => {
		const body = fromChallenge(
			{
				...loaded,
				liveAtUtc: "2026-12-01T18:00:00.000Z",
				endsAtUtc: "",
				availableAtUtc: null,
			},
			OPEN,
			now,
		);
		expect(body.liveAtUtc).toBe("2026-12-01T18:00:00.000Z");
		expect(body.endsAtUtc).toBeNull();
		expect(body.availableAtUtc).toBeNull();
		expect(body.addedAtUtc).toBe("2026-03-01T08:00:00.000Z");
		expect(String(body.updatedAtUtc)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
	});

	it("writes a date out the way the routes of challenges take it, and never makes up a day", () => {
		const body = fromChallenge(
			{
				...loaded,
				// seven digits after the second: three are taken
				liveAtUtc: "2026-12-01T18:00:00.1234567Z",
				// 31 February: the backend's to refuse, not a day in March
				endsAtUtc: "2026-02-31T18:00Z",
			},
			OPEN,
			now,
		);
		expect(body.liveAtUtc).toBe("2026-12-01T18:00:00.123Z");
		expect(body.endsAtUtc).toBe("2026-02-31T18:00Z");
	});

	it("sends updatedAtUtc back only as a full instant: the backend ignores it but holds it to the rule", () => {
		const sent = (updatedAtUtc: string) =>
			fromChallenge({ ...loaded, updatedAtUtc }, OPEN, now);
		expect(sent("2026-11-13T09:00:00.000Z").updatedAtUtc).toBe(
			"2026-11-13T09:00:00.000Z",
		);
		expect(sent("2026-11-13T09:00:00.1234567Z").updatedAtUtc).toBe(
			"2026-11-13T09:00:00.123Z",
		);
		expect(sent("").updatedAtUtc).toBe(now());
		for (const odd of ["2026-11-13", "2026-11-13T09:00:00", "13.11.2026"]) {
			expect(sent(odd), odd).not.toHaveProperty("updatedAtUtc");
		}
		// The switch-off path sends it as it always did.
		expect(
			fromChallenge(
				{ ...loaded, updatedAtUtc: "2026-11-13" },
				SWITCHED_OFF,
				now,
			).updatedAtUtc,
		).toBe("2026-11-13");
	});

	it("does not guess a moment from a bare date or a local time, nor put dates in order", () => {
		const body = fromChallenge(
			{
				...loaded,
				liveAtUtc: "2026-12-01",
				endsAtUtc: "2026-11-01T18:00:00",
				availableAtUtc: "2026-11-20T08:00+01:00",
			},
			OPEN,
			now,
		);
		// Left as typed for the backend to refuse at their fields; the one
		// that names its zone is written out in full.
		expect(body.liveAtUtc).toBe("2026-12-01");
		expect(body.endsAtUtc).toBe("2026-11-01T18:00:00");
		expect(body.availableAtUtc).toBe("2026-11-20T07:00:00.000Z");
	});

	it("gives a new challenge no id of its own", () => {
		// "A new item never carries an id of its own": 404 for one not stored.
		const body = fromChallenge(
			{ ...blankChallenge(now()), title: "Nowe" },
			OPEN,
			now,
		);
		expect(body.id).toBeNull();
	});

	it("sends only fields the backend takes or itself returns for a challenge", () => {
		// ChallengeUpsertAdminDto and what `mapToAdminChallenge` answers
		// (src/models/dto/internal.ts, src/config/panelFields.ts of the backend).
		const CHALLENGE = [
			"id",
			"title",
			"subtitle",
			"addedAtUtc",
			"updatedAtUtc",
			"liveAtUtc",
			"endsAtUtc",
			"availableAtUtc",
			"imageRelativePath",
			"descriptionFancyContent",
			"lengthDays",
			"pro",
			"hidden",
			"internalTitle",
			"categoryId",
			"goalsIds",
			"difficultyLevelsIds",
			"visibleDaysUpFront",
			"offeringId",
			"offeringDiscountedId",
			"unlockedByEntitlementIds",
			"discountedForEntitlementIds",
			"paths",
			"badgeId",
			"perfectCompletionBadgeId",
			"recommendedNext",
			"status",
			"etag",
			"deletedAtUtc",
			"deletedBy",
			"warnings",
		];
		const PATH = [
			"pathId",
			"levelId",
			"equipmentIds",
			"difficultyLevelsIds",
			"difficultyLevelsLabels",
			"pro",
			"frequency",
			"workoutsCount",
			"description",
			"workoutsLength",
			"minimumDaysToComplete",
			"days",
		];
		const DAY = ["dayIndex", "workoutIds", "type"];
		const BLOCK = ["type", "content", "metadata"];
		const bodies = [
			// As loaded from the panel's route, with everything it returns.
			fromChallenge(
				toChallenge(
					panelChallenge({
						status: "draft",
						hidden: true,
						warnings: [{ path: "title", code: "TOO_SHORT", message: "x" }],
						descriptionFancyContent: [
							{ type: "Title", content: "Zaczynamy" },
							{
								type: "Image",
								content: "",
								metadata: {
									imageRelativePath: "challenges/plan.webp",
									heightToWidthRatio: 0.5,
								},
							},
						],
						paths: [
							panelPath({ frequency: "3-4" }),
							panelPath({ pathId: null, levelId: "advanced" }),
						],
					}),
					OPEN,
				),
				OPEN,
				now,
			),
			// As the panel makes a new one.
			fromChallenge(
				{
					...blankChallenge(now()),
					title: "Nowe",
					paths: [blankPath("p-1a2b3c4d5e", "beginner", 2)],
				},
				OPEN,
				now,
			),
		];
		const extra = (value: unknown, known: string[]) =>
			Object.keys(value as object).filter((key) => !known.includes(key));
		for (const body of bodies) {
			expect(extra(body, CHALLENGE)).toEqual([]);
			for (const path of pathsOf(body)) {
				expect(extra(path, PATH)).toEqual([]);
				for (const day of path.days as unknown[]) {
					expect(extra(day, DAY)).toEqual([]);
				}
			}
			for (const block of body.descriptionFancyContent as {
				metadata?: unknown;
			}[]) {
				expect(extra(block, BLOCK)).toEqual([]);
				if (block.metadata) {
					expect(
						extra(block.metadata, ["imageRelativePath", "heightToWidthRatio"]),
					).toEqual([]);
				}
			}
			for (const next of body.recommendedNext as unknown[]) {
				expect(extra(next, ["id"])).toEqual([]);
			}
		}
		// The panel's own bookkeeping stays in the panel: the text kept beside
		// the frequency, the warnings of the last save, an id it made up.
		const [first, second] = pathsOf(bodies[0] ?? {});
		expect(first).not.toHaveProperty("frequencyText");
		expect(first?.frequency).toBe("3-4");
		expect(second?.pathId).toBe("level-advanced");
		expect(bodies[0]).not.toHaveProperty("warnings");
	});
});

describe("challengesArea: the refusals of the third pass", () => {
	const loaded = toChallenge(panelChallenge(), OPEN);
	const refusedWith = async (
		path: string,
		issue: { path: string; code: string; message: string },
	) => {
		const backend = fakeBackend().on("POST", path, validationReply([issue]));
		return failure(
			challengesArea(backend.transport, OPEN).api.save(
				path === "manageChallenges"
					? { ...loaded, status: "hidden", title: "Inny tytuł" }
					: { ...loaded, status: "deleted" },
				{ etag: loaded.etag },
			),
		);
	};

	it.each(["manageChallenges", STATUS("C12")])(
		"shows the backend's refusal to take the promoted challenge out of the app (%s)",
		async (path) => {
			const error = await refusedWith(path, {
				path: "status",
				code: "PROMOTED",
				message:
					"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
			});
			expect(error.kind).toBe("validation");
			expect(error.issues).toEqual([
				{ path: "status", message: error.message },
			]);
			expect(error.message).toBe(
				"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
			);
		},
	);

	it("names the variant of a refused list by its id", async () => {
		const error = await refusedWith("manageChallenges", {
			path: "paths.0.days.2.workoutIds",
			code: "TOO_LONG",
			message:
				"paths.0.days.2.workoutIds może mieć najwyżej 10 pozycji (ma 11)",
		});
		expect(error.issues).toEqual([
			{
				path: "paths.p_0a1b2c3d4e5f.days.2.workoutIds",
				message:
					"paths.0.days.2.workoutIds może mieć najwyżej 10 pozycji (ma 11)",
			},
		]);
	});

	it("names the variant of a field the backend does not take by its id", async () => {
		const error = await refusedWith("manageChallenges", {
			path: "paths.0.frequencyText",
			code: "UNKNOWN_FIELD",
			message: "Nieznane pole: paths.0.frequencyText",
		});
		expect(error.kind).toBe("validation");
		expect(error.issues[0]?.path).toBe("paths.p_0a1b2c3d4e5f.frequencyText");
		expect(error.message).toBe("Nieznane pole: paths.0.frequencyText");
	});
});

describe("fromChallenge: what a variant always says", () => {
	it("says whether a variant is PRO and how many days complete it, also when the stored one never did", () => {
		const loaded = toChallenge(
			panelChallenge({
				paths: [panelPath({ pro: null, minimumDaysToComplete: null })],
			}),
			OPEN,
		);
		const [sent] = fromChallenge(loaded, OPEN).paths as Record<
			string,
			unknown
		>[];
		expect(sent?.pro).toBe(false);
		expect(sent?.minimumDaysToComplete).toBe(0);
		const body = fromChallenge(loaded, OPEN);
		expect(typeof body.pro).toBe("boolean");
	});
});
