import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./dates";
import {
	acceptedTypes,
	dropProblem,
	MEDIA_FOLDERS,
	mediaFolder,
	uploadPath,
	uploadProblem,
} from "./mediaRules";
import { matchesQuery, plural, slugify } from "./text";

const folder = (id: string) => {
	const found = MEDIA_FOLDERS.find((f) => f.id === id);
	if (!found) throw new Error(id);
	return found;
};

describe("media upload rules", () => {
	it("accepts a small webp picture for workouts", () => {
		expect(
			uploadProblem(folder("workouts"), {
				name: "Mobilność.webp",
				size: 120_000,
			}),
		).toBeNull();
	});

	it("refuses another picture format", () => {
		expect(
			uploadProblem(folder("workouts"), { name: "zdjecie.png", size: 10_000 }),
		).toContain("webp");
	});

	it("refuses a picture over the folder's limit", () => {
		expect(
			uploadProblem(folder("badges"), { name: "odznaka.webp", size: 80_000 }),
		).toContain("limit");
		expect(
			uploadProblem(folder("challenges"), { name: "tlo.webp", size: 280_000 }),
		).toBeNull();
	});

	it("accepts audio only in the audio folder", () => {
		expect(
			uploadProblem(folder("audio"), { name: "trening.m4a", size: 50_000_000 }),
		).toBeNull();
		expect(
			uploadProblem(folder("workouts"), { name: "trening.m4a", size: 1000 }),
		).not.toBeNull();
	});

	it("refuses a name with nothing usable in it", () => {
		expect(
			uploadProblem(folder("workouts"), { name: "!!!.webp", size: 1000 }),
		).not.toBeNull();
	});

	it("builds a storage-safe path", () => {
		expect(uploadPath("workouts", "Poranna Mobilność (1).WEBP")).toBe(
			"workouts/poranna-mobilnosc-1.webp",
		);
		expect(uploadPath("audio", "Żółć łąka.m4a")).toBe("audio/zolc-laka.m4a");
	});
});

describe("a file dropped onto a field", () => {
	const cover = { name: "Okładka wyzwania.webp", size: 120_000 };

	it("is accepted when it is the one file the folder takes", () => {
		expect(dropProblem(folder("challenges"), [cover])).toBeNull();
	});

	it("is refused by the same rules as a chosen file", () => {
		const photo = { name: "zdjecie.png", size: 10_000 };
		expect(dropProblem(folder("workouts"), [photo])).toBe(
			uploadProblem(folder("workouts"), photo),
		);
		const heavy = { name: "odznaka.webp", size: 80_000 };
		expect(dropProblem(folder("badges"), [heavy])).toContain("limit");
	});

	it("refuses several files at once, even when each would do", () => {
		expect(
			dropProblem(folder("challenges"), [
				cover,
				{ name: "druga.webp", size: 1000 },
			]),
		).toBe("Upuść jeden plik naraz.");
	});

	it("refuses a drop that carries no file", () => {
		expect(dropProblem(folder("audio"), [])).toBe("Upuść tutaj plik z dysku.");
	});
});

describe("media folders", () => {
	it("finds a folder by its id and nothing for an unknown one", () => {
		expect(mediaFolder("badges")?.label).toBe("Odznaki");
		expect(mediaFolder("nieznany")).toBeUndefined();
	});

	it("lists the types a file chooser should offer", () => {
		expect(acceptedTypes(folder("workouts"))).toBe(".webp");
		expect(acceptedTypes(folder("audio"))).toBe(".m4a,.m4v,.mp3,.wav");
	});
});

describe("text helpers", () => {
	it("matches every word, in any order, without diacritics", () => {
		expect(matchesQuery("Siła całego ciała z hantlami", "ciala sila")).toBe(
			true,
		);
		expect(matchesQuery("Siła całego ciała z hantlami", "ciala joga")).toBe(
			false,
		);
		expect(matchesQuery("cokolwiek", "  ")).toBe(true);
	});

	it("counts in Polish", () => {
		const blocks = (n: number) => plural(n, "blok", "bloki", "bloków");
		expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 112].map(blocks)).toEqual([
			"0 bloków",
			"1 blok",
			"2 bloki",
			"4 bloki",
			"5 bloków",
			"11 bloków",
			"12 bloków",
			"14 bloków",
			"21 bloków",
			"22 bloki",
			"25 bloków",
			"112 bloków",
		]);
	});

	it("slugifies Polish text", () => {
		expect(slugify("Zażółć Gęślą Jaźń")).toBe("zazolc-gesla-jazn");
	});
});

describe("date fields", () => {
	it("round-trips a time through the local input format", () => {
		const iso = "2026-11-10T12:30:00.000Z";
		expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
	});

	it("treats empty as null", () => {
		expect(toLocalInput(null)).toBe("");
		expect(fromLocalInput("")).toBeNull();
		expect(toLocalInput("nonsense")).toBe("");
	});
});
