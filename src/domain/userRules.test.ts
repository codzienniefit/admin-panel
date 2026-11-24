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
	parseUserQuery,
	progressSummary,
	revokeIssues,
	searchQueryProblem,
	USER_SEARCH_LIMIT,
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
	it("searches by a whole e-mail address", () => {
		expect(parseUserQuery("  anna.testowa@example.test ")).toEqual({
			kind: "email",
			email: "anna.testowa@example.test",
		});
		expect(searchQueryProblem("anna@example.test")).toBeNull();
		expect(isSearchable("anna+pl@mail.example.co.uk")).toBe(true);
	});

	it("searches by a Firebase id", () => {
		const uid = "a4bHlAZCVtX9iJQeIHe702r5jhd2";
		expect(parseUserQuery(uid)).toEqual({ kind: "uid", uid });
		expect(searchQueryProblem(uid)).toBeNull();
	});

	it("never searches by name or part of an address", () => {
		for (const query of [
			"Michał",
			"anna nowak",
			"Nowak",
			"abc123",
			"testowa@",
			"@example.test",
			"anna@example",
			"anna @example.test",
			"anna@example.test, jan@example.test",
		]) {
			expect(isSearchable(query), query).toBe(false);
			expect(parseUserQuery(query), query).toBeNull();
		}
		expect(searchQueryProblem("")).toBe(
			"Wpisz adres e-mail albo identyfikator użytkownika",
		);
		expect(searchQueryProblem("Michał")).toContain("nie po imieniu");
		expect(searchQueryProblem("anna@example")).toBe(
			"Wpisz cały adres e-mail, np. jan.kowalski@example.com",
		);
	});

	it("never asks for more rows than the backend lets the panel have", () => {
		expect(USER_SEARCH_LIMIT).toBe(20);
	});

	it("matches the one account with that address or id", () => {
		const byEmail = parseUserQuery(" Anna.Testowa@Example.test ");
		const byUid = parseUserQuery("test-abc123defghijklmnopq");
		if (!byEmail || !byUid) throw new Error("test: queries not parsed");
		expect(userMatches(person, byEmail)).toBe(true);
		expect(
			userMatches({ ...person, uid: "test-abc123defghijklmnopq" }, byUid),
		).toBe(true);
		expect(userMatches(person, byUid)).toBe(false);
		expect(
			userMatches(
				{ ...person, email: "anna.testowa@example.test.pl" },
				byEmail,
			),
		).toBe(false);
		// an account with no address is found by its id only
		expect(userMatches({ ...person, email: null }, byEmail)).toBe(false);
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
