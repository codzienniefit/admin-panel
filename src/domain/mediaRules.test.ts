import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./dates";
import {
	acceptedTypes,
	cleanUploadPath,
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
			uploadProblem(folder("audio"), { name: "trening.m4a", size: 30_000_000 }),
		).toBeNull();
		expect(
			uploadProblem(folder("workouts"), { name: "trening.m4a", size: 1000 }),
		).not.toBeNull();
	});

	it("takes for audio what the backend takes: m4a, mp3 and wav, up to 32 MB", () => {
		const MB = 1024 * 1024;
		for (const name of ["a.m4a", "a.mp3", "a.wav", "A.MP3"]) {
			expect(
				uploadProblem(folder("audio"), { name, size: 32 * MB }),
			).toBeNull();
		}
		// The backend has no content type for m4v, and stores ogg and mp4 only
		// for Retool.
		for (const name of ["a.m4v", "a.ogg", "a.mp4", "a.webp", "a"]) {
			expect(uploadProblem(folder("audio"), { name, size: 1000 })).toContain(
				"m4a, mp3, wav",
			);
		}
		// More than the panel's Worker forwards.
		expect(
			uploadProblem(folder("audio"), { name: "a.m4a", size: 32 * MB + 1 }),
		).toContain("limit to 32 MB");
		expect(
			uploadProblem(folder("audio"), { name: "a.m4a", size: 50_000_000 }),
		).toContain("limit");
	});

	it("has the backend's five folders, pictures as webp only, with its limits", () => {
		// src/config/mediaUpload.ts of the backend, PANEL_UPLOAD_FOLDERS.
		const KB = 1024;
		expect(
			MEDIA_FOLDERS.map((item) => [
				item.id,
				item.kind,
				[...item.extensions],
				item.maxBytes,
			]),
		).toEqual([
			["workouts", "image", ["webp"], 250 * KB],
			["challenges", "image", ["webp"], 300 * KB],
			["messages", "image", ["webp"], 300 * KB],
			["badges", "image", ["webp"], 50 * KB],
			["audio", "audio", ["m4a", "mp3", "wav"], 32 * 1024 * KB],
		]);
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

	it("builds the path the backend would store, so it is never asked to change it", () => {
		// The cases of the backend's own tests (tests/services/mediaService.test.ts).
		const cases: [string, string][] = [
			["audio/start płmaraton_128.m4a", "audio/start-plmaraton_128.m4a"],
			["audio/ŁÓDŹ ĄĆĘŃŚŻŹ.m4a", "audio/lodz-acenszz.m4a"],
			["audio/marszobieg 20 B_128 (1).m4a", "audio/marszobieg-20-b_128-1.m4a"],
			["audio/TEMPO A_poprawione.m4a", "audio/tempo-a_poprawione.m4a"],
			["audio/ZONE 2 C_128.m4a", "audio/zone-2-c_128.m4a"],
			["audio/tempo-5x5_128.m4a", "audio/tempo-5x5_128.m4a"],
			["messages/image.webp", "messages/image.webp"],
			["audio/../../etc/passwd.png", "audio/etc/passwd.png"],
			["./audio//nested///file.m4a", "audio/nested/file.m4a"],
			// Where the panel's own slug used to differ: dots in a row, and a
			// dash left next to a dot.
			["audio/weird...name.m4a", "audio/weird.name.m4a"],
			["audio/ spaced name .m4a", "audio/spaced-name.m4a"],
			["audio/файл.m4a", "audio/file.m4a"],
			["audio/你好.m4a", "audio/file.m4a"],
			["audio/.m4a", "audio/file.m4a"],
			["audio/....m4a", "audio/file.m4a"],
			["audio/---.m4a", "audio/file.m4a"],
			["audio/名前 test.m4a", "audio/test.m4a"],
			["audio/Track.M4A", "audio/track.m4a"],
			["audio/noextension", "audio/noextension"],
			["workouts/Moje Zdjęcie.webp", "workouts/moje-zdjecie.webp"],
		];
		for (const [given, stored] of cases) {
			expect(cleanUploadPath(given), given).toBe(stored);
			// Clean once is clean for good.
			expect(cleanUploadPath(stored), stored).toBe(stored);
		}
		// The two spellings of one letter end as the same name.
		expect(cleanUploadPath("audio/zone2 przebiez\u0307ki_128.m4a")).toBe(
			cleanUploadPath("audio/zone2 przebie\u017cki_128.m4a"),
		);
		expect(cleanUploadPath("")).toBe("");
		expect(cleanUploadPath("///")).toBe("");
	});

	it("gives a file the same path whichever way its name is cleaned", () => {
		expect(uploadPath("audio", "weird...name (2) .m4a")).toBe(
			cleanUploadPath("audio/weird...name (2) .m4a"),
		);
		expect(uploadPath("workouts", "a - .b.webp")).toBe("workouts/a.b.webp");
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
		expect(acceptedTypes(folder("audio"))).toBe(".m4a,.mp3,.wav");
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
