import { describe, expect, it } from "vitest";
import { type Badge, blankBadge } from "@/data/schemas/badge";
import { filterBadges } from "./badgeFilters";

const make = (id: string, patch: Partial<Badge>): Badge => ({
	...blankBadge(),
	id,
	etag: "1",
	imageRelativePath: `badges/${id}.webp`,
	sectionId: null,
	subsectionId: null,
	createdAtUtc: "2026-01-01T00:00:00.000Z",
	updatedAtUtc: "2026-01-01T00:00:00.000Z",
	...patch,
});

const badges = [
	make("n_1", {
		name: "Żelazna wola",
		sectionId: "challenges",
		updatedAtUtc: "2026-03-01T00:00:00.000Z",
	}),
	make("n_2", {
		name: "Pierwszy trening",
		comment: "stara grafika",
		isHidden: true,
	}),
	make("s_1", {
		name: "Spotkanie na żywo",
		type: "manual",
		updatedAtUtc: "2026-05-01T00:00:00.000Z",
	}),
	make("m_10", { name: "10 treningów", type: "milestone", isHidden: null }),
];

const ids = (list: Badge[]) => list.map((badge) => badge.id);

describe("badge filters", () => {
	it("shows everything by name when nothing is chosen", () => {
		expect(ids(filterBadges(badges, {}))).toEqual([
			"m_10",
			"n_2",
			"s_1",
			"n_1",
		]);
	});

	it("filters by type and by section", () => {
		expect(ids(filterBadges(badges, { type: "manual" }))).toEqual(["s_1"]);
		expect(ids(filterBadges(badges, { section: "challenges" }))).toEqual([
			"n_1",
		]);
		expect(
			ids(filterBadges(badges, { type: "manual", section: "challenges" })),
		).toEqual([]);
	});

	it("tells hidden from visible, treating an unset flag as visible", () => {
		expect(ids(filterBadges(badges, { visibility: "hidden" }))).toEqual([
			"n_2",
		]);
		expect(ids(filterBadges(badges, { visibility: "visible" }))).toEqual([
			"m_10",
			"s_1",
			"n_1",
		]);
	});

	it("searches the name, the note and the id, without diacritics", () => {
		expect(ids(filterBadges(badges, { q: "zelazna" }))).toEqual(["n_1"]);
		expect(ids(filterBadges(badges, { q: "grafika" }))).toEqual(["n_2"]);
		expect(ids(filterBadges(badges, { q: "s_1" }))).toEqual(["s_1"]);
		expect(ids(filterBadges(badges, { q: "nic takiego" }))).toEqual([]);
	});

	it("sorts by the last change when asked", () => {
		expect(ids(filterBadges(badges, { sort: "updated" }))).toEqual([
			"s_1",
			"n_1",
			"m_10",
			"n_2",
		]);
	});
});
