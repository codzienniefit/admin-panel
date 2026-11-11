import { describe, expect, it } from "vitest";
import { type Badge, blankBadge } from "@/data/schemas/badge";
import type { UserBadge, UserProgress } from "@/data/schemas/user";
import {
	attemptState,
	emailIssues,
	grantableBadges,
	grantIssues,
	groupUserBadges,
	isRevocable,
	isSearchable,
	normalizeEmail,
	progressSummary,
	revokeIssues,
	searchQueryProblem,
	USER_QUERY_MIN,
	userMatches,
} from "./userRules";

const person = {
	uid: "test-abc123",
	email: "anna.testowa@example.test",
	displayName: "Anna Testowa",
};

const badge = (id: string, patch: Partial<Badge> = {}): Badge => ({
	...blankBadge(),
	id,
	etag: "1",
	name: id,
	imageRelativePath: `badges/${id}.webp`,
	sectionId: null,
	subsectionId: null,
	createdAtUtc: "",
	updatedAtUtc: "",
	...patch,
});

const held = (
	badgeId: string,
	earnedAtUtc: string,
	grantId: string | null = null,
): UserBadge => ({ badgeId, earnedAtUtc, grantId });

describe("user search", () => {
	it("does not search for fewer than three characters", () => {
		expect(USER_QUERY_MIN).toBe(3);
		expect(isSearchable("an")).toBe(false);
		expect(isSearchable("  an  ")).toBe(false);
		expect(isSearchable("ann")).toBe(true);
		expect(searchQueryProblem("")).toContain("Wpisz");
		expect(searchQueryProblem("an")).toBe("Wpisz co najmniej 3 znaki");
		expect(searchQueryProblem("ann")).toBeNull();
	});

	it("matches the e-mail, the name or the id", () => {
		expect(userMatches(person, "anna.testowa@")).toBe(true);
		expect(userMatches(person, "TESTOWA")).toBe(true);
		expect(userMatches(person, "abc123")).toBe(true);
		expect(userMatches(person, "testowa anna")).toBe(true);
		expect(userMatches(person, "maria")).toBe(false);
	});

	it("copes with an account that has no name or address", () => {
		const bare = { uid: "test-xyz", email: null, displayName: null };
		expect(userMatches(bare, "xyz")).toBe(true);
		expect(userMatches(bare, "null")).toBe(false);
	});
});

describe("e-mail change", () => {
	const messages = (next: string, current: string | null = person.email) =>
		emailIssues(next, current).map((issue) => issue.message);

	it("accepts a new, well-formed address", () => {
		expect(emailIssues("anna.nowa@example.test", person.email)).toEqual([]);
		expect(emailIssues("  Anna.Nowa@Example.Test ", person.email)).toEqual([]);
		expect(emailIssues("a@b.example.test", null)).toEqual([]);
	});

	it("stores an address trimmed and in lower case", () => {
		expect(normalizeEmail("  Anna.Nowa@Example.Test ")).toBe(
			"anna.nowa@example.test",
		);
	});

	it("needs an address", () => {
		expect(messages("   ")).toEqual(["Podaj nowy adres e-mail"]);
	});

	it("refuses what does not look like an address", () => {
		for (const wrong of [
			"anna",
			"anna@",
			"@example.test",
			"anna@example",
			"anna@@example.test",
			"anna testowa@example.test",
			"anna@example..test",
			"anna@.example.test",
		]) {
			expect(messages(wrong), wrong).toEqual([
				"To nie wygląda na poprawny adres e-mail",
			]);
		}
	});

	it("refuses an address that is too long", () => {
		expect(messages(`${"a".repeat(250)}@example.test`)).toEqual([
			"Ten adres jest za długi",
		]);
	});

	it("refuses the address the person already has", () => {
		expect(messages("ANNA.testowa@example.test")).toEqual([
			"To jest obecny adres tej osoby",
		]);
	});

	it("reports the problem on the e-mail field", () => {
		expect(emailIssues("", null)[0]?.path).toBe("email");
	});
});

describe("granting and revoking badges", () => {
	it("gives only manual badges, and only once", () => {
		expect(grantIssues(badge("s_1", { type: "manual" }), false)).toEqual([]);
		expect(grantIssues(undefined, false)).toHaveLength(1);
		expect(grantIssues(badge("n_1"), false)).toHaveLength(1);
		expect(grantIssues(badge("s_1", { type: "manual" }), true)).toEqual([
			{ path: "badgeId", message: "Ta osoba ma już tę odznakę" },
		]);
	});

	it("offers the manual badges a person does not hold yet", () => {
		const all = [
			badge("n_1"),
			badge("s_1", { type: "manual" }),
			badge("s_2", { type: "manual" }),
			badge("m_10", { type: "milestone" }),
		];
		expect(
			grantableBadges(all, [held("s_1", "2026-01-01T00:00:00.000Z", "g1")]).map(
				(item) => item.id,
			),
		).toEqual(["s_2"]);
	});

	it("takes back only what was handed out", () => {
		const earned = held("n_1", "2026-01-01T00:00:00.000Z");
		const granted = held("s_1", "2026-01-01T00:00:00.000Z", "g1");
		expect(isRevocable(granted)).toBe(true);
		expect(revokeIssues(granted)).toEqual([]);
		expect(isRevocable(earned)).toBe(false);
		expect(revokeIssues(earned).map((issue) => issue.path)).toEqual([
			"badgeId",
		]);
	});
});

describe("a person's badges by section", () => {
	const sections = [
		{
			id: "challenges",
			label: "Wyzwania",
			subsections: [
				{ id: "completed", label: "Ukończone" },
				{ id: "perfect", label: "Na 100%" },
			],
		},
		{
			id: "special",
			label: "Specjalne",
			subsections: [{ id: "events", label: "Wydarzenia" }],
		},
	];
	const definitions = [
		badge("n_3", { sectionId: "challenges", subsectionId: "completed" }),
		badge("n_5", { sectionId: "challenges", subsectionId: "completed" }),
		badge("p_1", { sectionId: "challenges", subsectionId: "perfect" }),
		badge("s_1", { sectionId: "special", subsectionId: "events" }),
		badge("n_1"),
		badge("x_1", { sectionId: "challenges", subsectionId: "nieznana" }),
		badge("x_2", { sectionId: "nieznana", subsectionId: "completed" }),
	];

	it("follows the configured order and puts the newest first", () => {
		const groups = groupUserBadges(
			[
				held("s_1", "2026-02-01T00:00:00.000Z", "g1"),
				held("n_3", "2026-01-01T00:00:00.000Z"),
				held("n_5", "2026-03-01T00:00:00.000Z"),
			],
			definitions,
			sections,
		);
		expect(groups.map((group) => group.label)).toEqual([
			"Wyzwania",
			"Specjalne",
		]);
		expect(groups[0]?.subsections.map((s) => s.label)).toEqual(["Ukończone"]);
		expect(
			groups[0]?.subsections[0]?.badges.map((b) => b.held.badgeId),
		).toEqual(["n_5", "n_3"]);
	});

	it("leaves out sections and subsections with nothing in them", () => {
		const groups = groupUserBadges(
			[held("p_1", "2026-01-01T00:00:00.000Z")],
			definitions,
			sections,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.subsections.map((s) => s.id)).toEqual(["perfect"]);
		expect(groupUserBadges([], definitions, sections)).toEqual([]);
	});

	it("keeps badges without a known place, under „Pozostałe”", () => {
		const groups = groupUserBadges(
			[
				held("n_1", "2026-01-01T00:00:00.000Z"),
				held("x_1", "2026-01-02T00:00:00.000Z"),
				held("x_2", "2026-01-03T00:00:00.000Z"),
				held("usunieta", "2026-01-04T00:00:00.000Z"),
			],
			definitions,
			sections,
		);
		expect(groups.map((group) => group.label)).toEqual([
			"Wyzwania",
			"Pozostałe",
		]);
		// A known section with an unknown subsection stays under that section.
		expect(
			groups[0]?.subsections[0]?.badges.map((b) => b.held.badgeId),
		).toEqual(["x_1"]);
		const other = groups[1]?.subsections[0]?.badges ?? [];
		expect(other.map((b) => b.held.badgeId)).toEqual([
			"usunieta",
			"x_2",
			"n_1",
		]);
		// The definition of a deleted badge is gone; the person still holds it.
		expect(other[0]?.badge).toBeNull();
	});
});

describe("progress", () => {
	const progress: UserProgress = {
		workouts: [
			{ workoutId: "W2", completedAtUtc: "2026-11-09T07:00:00.000Z" },
			{ workoutId: "W1", completedAtUtc: "2026-11-01T07:00:00.000Z" },
		],
		challenges: [
			{
				challengeId: "C1",
				levelId: "beginner",
				startedAtUtc: "2026-10-01T00:00:00.000Z",
				completedAtUtc: null,
				abortedAtUtc: null,
				completedDays: 4,
			},
			{
				challengeId: "C2",
				levelId: null,
				startedAtUtc: "2026-08-01T00:00:00.000Z",
				completedAtUtc: "2026-08-08T00:00:00.000Z",
				abortedAtUtc: null,
				completedDays: 7,
			},
			{
				challengeId: "C3",
				levelId: null,
				startedAtUtc: "2026-06-01T00:00:00.000Z",
				completedAtUtc: null,
				abortedAtUtc: "2026-06-04T00:00:00.000Z",
				completedDays: 2,
			},
		],
	};

	it("tells an attempt that is running from a finished or abandoned one", () => {
		expect(progress.challenges.map(attemptState)).toEqual([
			"active",
			"completed",
			"aborted",
		]);
	});

	it("adds up what a person has done", () => {
		expect(progressSummary(progress)).toEqual({
			workoutsDone: 2,
			challengesStarted: 3,
			challengesCompleted: 1,
			challengesActive: 1,
			lastWorkoutAtUtc: "2026-11-09T07:00:00.000Z",
		});
	});

	it("copes with someone who has done nothing yet", () => {
		expect(progressSummary({ workouts: [], challenges: [] })).toEqual({
			workoutsDone: 0,
			challengesStarted: 0,
			challengesCompleted: 0,
			challengesActive: 0,
			lastWorkoutAtUtc: null,
		});
	});
});
