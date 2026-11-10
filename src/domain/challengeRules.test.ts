import { describe, expect, it } from "vitest";
import { workoutConfigFixture as config } from "@/data/api/mock/configFixtures";
import { buildFixtures } from "@/data/api/mock/fixtures";
import {
	blankChallenge,
	blankPath,
	type ContentStatus,
	type NewChallenge,
} from "@/data/schemas/challenge";
import {
	type ChallengeContext,
	challengeIssues,
	challengeKind,
	resizeDays,
	workoutsLostByResize,
} from "./challengeRules";

const context: ChallengeContext = {
	workoutStatus: new Map<string, ContentStatus>([
		["W1", "published"],
		["W2", "published"],
		["W3", "hidden"],
		["WD", "draft"],
		["WX", "deleted"],
	]),
	badgeIds: new Set(["n_1"]),
	challengeIds: new Set(["C1", "C2"]),
	ownId: "C1",
	promotedChallengeId: null,
};

const week = (days: string[][]) => ({
	...blankPath("p1", "beginner", days.length),
	minimumDaysToComplete: 1,
	days: days.map((workoutIds, i) => ({ dayIndex: i + 1, workoutIds })),
});

const complete: NewChallenge = {
	...blankChallenge(),
	title: "Mocne plecy",
	subtitle: "Siedem dni",
	status: "published",
	lengthDays: 3,
	imageRelativePath: "challenges/plecy.webp",
	paths: [week([["W1"], [], ["W2", "W3"]])],
};

const issuesOf = (challenge: NewChallenge, ctx = context) =>
	challengeIssues(challenge, config, ctx);
const paths = (challenge: NewChallenge, ctx = context) =>
	issuesOf(challenge, ctx).map((issue) => issue.path);

describe("challenge rules", () => {
	it("accepts a complete published challenge", () => {
		expect(issuesOf(complete)).toEqual([]);
	});

	it("lets a draft be saved with only a name", () => {
		expect(paths({ ...blankChallenge(), title: "Pomysł" })).toEqual([]);
		expect(paths({ ...blankChallenge(), title: " " })).toEqual(["title"]);
	});

	it("asks for the full set when publishing or hiding", () => {
		for (const status of ["published", "hidden"] as const) {
			expect(paths({ ...blankChallenge(), title: "Abc", status })).toEqual([
				"title",
				"subtitle",
				"imageRelativePath",
				"paths",
			]);
		}
	});

	it("refuses ids the configuration does not know", () => {
		expect(paths({ ...complete, categoryId: "inna" })).toEqual(["categoryId"]);
		expect(paths({ ...complete, goalsIds: ["sila", "latanie"] })).toEqual([
			"goalsIds",
		]);
		expect(
			paths({ ...complete, difficultyLevelsIds: ["ekstremalny"] }),
		).toEqual(["difficultyLevelsIds"]);
	});

	it("keeps visible days between 0 and 100, or empty", () => {
		expect(paths({ ...complete, visibleDaysUpFront: null })).toEqual([]);
		expect(paths({ ...complete, visibleDaysUpFront: 0 })).toEqual([]);
		expect(paths({ ...complete, visibleDaysUpFront: 101 })).toEqual([
			"visibleDaysUpFront",
		]);
		expect(paths({ ...complete, visibleDaysUpFront: 2.5 })).toEqual([
			"visibleDaysUpFront",
		]);
	});

	describe("paid access", () => {
		const paid = {
			...complete,
			pro: true,
			unlockedByEntitlementIds: ["wyzwanie-plecy"],
			offeringId: "plecy-full",
		};
		it("accepts an offering with an entitlement", () => {
			expect(paths(paid)).toEqual([]);
			expect(
				paths({
					...paid,
					offeringDiscountedId: "plecy-promo",
					discountedForEntitlementIds: ["pro"],
				}),
			).toEqual([]);
		});
		it("needs an entitlement for an offering", () => {
			expect(paths({ ...paid, unlockedByEntitlementIds: [] })).toEqual([
				"unlockedByEntitlementIds",
			]);
		});
		it("needs the full-price offering for a discounted one", () => {
			expect(
				paths({ ...paid, offeringId: null, offeringDiscountedId: "promo" }),
			).toEqual(["offeringId"]);
		});
		it("needs a discounted offering for discount entitlements", () => {
			expect(paths({ ...paid, discountedForEntitlementIds: ["pro"] })).toEqual([
				"offeringDiscountedId",
			]);
		});
		it("refuses an entitlement that both unlocks and discounts", () => {
			expect(
				paths({
					...paid,
					offeringDiscountedId: "promo",
					discountedForEntitlementIds: ["wyzwanie-plecy"],
				}),
			).toEqual(["discountedForEntitlementIds"]);
		});
	});

	it("checks what is recommended next", () => {
		expect(paths({ ...complete, recommendedNext: [{ id: "C2" }] })).toEqual([]);
		expect(paths({ ...complete, recommendedNext: [{ id: "C1" }] })).toEqual([
			"recommendedNext",
		]);
		expect(paths({ ...complete, recommendedNext: [{ id: "C9" }] })).toEqual([
			"recommendedNext",
		]);
	});

	it("checks badges", () => {
		expect(paths({ ...complete, badgeId: "n_1" })).toEqual([]);
		expect(paths({ ...complete, perfectCompletionBadgeId: "brak" })).toEqual([
			"perfectCompletionBadgeId",
		]);
	});

	describe("variants", () => {
		const withPath = (change: (path: ReturnType<typeof week>) => void) => {
			const path = week([["W1"], [], ["W2", "W3"]]);
			change(path);
			return { ...complete, paths: [path] };
		};
		const messages = (challenge: NewChallenge) =>
			issuesOf(challenge).map((issue) => issue.message);

		it("refuses an unknown level", () => {
			expect(
				messages(
					withPath((p) => {
						p.levelId = "ekspert";
					}),
				),
			).toEqual(["Nieznany levelId: ekspert"]);
		});

		it("refuses two variants at the same level", () => {
			const twice = {
				...complete,
				paths: [
					week([["W1"], [], ["W2"]]),
					{ ...week([["W1"], [], ["W2"]]), pathId: "p2" },
				],
			};
			expect(messages(twice).join(" ")).toContain("ten sam poziom");
		});

		it("refuses the same workout twice in a day, even in a draft", () => {
			const twice = withPath((p) => {
				p.days[0]?.workoutIds.push("W1");
			});
			expect(messages({ ...twice, status: "draft" }).join(" ")).toContain(
				"dodany dwa razy",
			);
		});

		it("refuses a workout that does not exist", () => {
			expect(
				messages(
					withPath((p) => {
						p.days[1]?.workoutIds.push("W99");
					}),
				),
			).toContain("Nieznany workoutId: W99");
		});

		it("refuses day numbers that are not 1, 2, 3…", () => {
			expect(
				messages(
					withPath((p) => {
						const last = p.days[2];
						if (last) last.dayIndex = 5;
					}),
				).join(" "),
			).toContain("nieprawidłowy numer dnia");
		});

		it("needs as many days as the challenge lasts, to publish", () => {
			const short = { ...complete, lengthDays: 7 };
			expect(messages(short).join(" ")).toContain(
				"ma 3 dni, a wyzwanie trwa 7",
			);
			expect(paths({ ...short, status: "draft" })).toEqual([]);
		});

		it("keeps the minimum days within the days that have a workout", () => {
			expect(
				messages(
					withPath((p) => {
						p.minimumDaysToComplete = 3;
					}),
				).join(" "),
			).toContain("dni z treningami jest 2");
		});

		it("will not publish with a draft or deleted workout inside", () => {
			const unfinished = withPath((p) => {
				p.days[1]?.workoutIds.push("WD", "WX");
			});
			expect(messages(unfinished).join(" ")).toContain("WD, WX");
			expect(paths({ ...unfinished, status: "draft" })).toEqual([]);
		});

		it("needs at least one workout in a published variant", () => {
			const empty = {
				...complete,
				paths: [{ ...week([[], [], []]), minimumDaysToComplete: 0 }],
			};
			expect(messages(empty).join(" ")).toContain("nie ma żadnego treningu");
		});
	});

	it("keeps the promoted challenge published", () => {
		const promoted = { ...context, promotedChallengeId: "C1" };
		expect(paths(complete, promoted)).toEqual([]);
		expect(paths({ ...complete, status: "hidden" }, promoted)).toEqual([
			"status",
		]);
		expect(paths({ ...complete, status: "deleted" }, promoted)).toEqual([
			"status",
		]);
	});

	it("finds nothing wrong with any published or hidden sample challenge", () => {
		const { challenges, workouts, badges } = buildFixtures("normal");
		const ctx: ChallengeContext = {
			workoutStatus: new Map(workouts.map((w) => [w.id, w.status])),
			badgeIds: new Set(
				badges.filter((b) => b.type === "normal").map((b) => b.id),
			),
			challengeIds: new Set(challenges.map((c) => c.id)),
			promotedChallengeId: "C2",
		};
		for (const challenge of challenges) {
			if (challenge.status === "deleted") continue;
			expect(
				challengeIssues(challenge, config, { ...ctx, ownId: challenge.id }),
				`${challenge.id} ${challenge.title}`,
			).toEqual([]);
		}
	});
});

describe("kind of challenge", () => {
	it("is a challenge when it has a premiere date, else a plan by category", () => {
		const at = "2026-03-01T12:00:00.000Z";
		expect(challengeKind({ liveAtUtc: at, categoryId: "main" })).toBe(
			"challenge",
		);
		expect(challengeKind({ liveAtUtc: null, categoryId: "main" })).toBe("main");
		expect(challengeKind({ liveAtUtc: null, categoryId: "archived" })).toBe(
			"archived",
		);
		expect(challengeKind({ liveAtUtc: null, categoryId: null })).toBe("plan");
	});
});

describe("changing the length", () => {
	const days = [
		{ dayIndex: 1, workoutIds: ["W1"] },
		{ dayIndex: 2, workoutIds: [] },
		{ dayIndex: 3, workoutIds: ["W2", "W3"] },
	];
	it("appends empty days", () => {
		expect(resizeDays(days, 5)).toEqual([
			...days,
			{ dayIndex: 4, workoutIds: [] },
			{ dayIndex: 5, workoutIds: [] },
		]);
	});
	it("cuts days from the end", () => {
		expect(resizeDays(days, 2)).toEqual(days.slice(0, 2));
	});
	it("counts what a cut would drop", () => {
		expect(workoutsLostByResize([{ days }, { days }], 2)).toBe(4);
		expect(workoutsLostByResize([{ days }], 3)).toBe(0);
	});
});
