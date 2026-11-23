import { describe, expect, it } from "vitest";
import {
	ALL_CAPABILITIES,
	assertWritable,
	type Capabilities,
	capabilitiesFor,
	isReadOnly,
	isTestMarked,
	needsStoredCopy,
	PRODUCTION_CAPABILITIES,
	refuse,
	TEST_MARK,
	type TestMark,
	type WriteArea,
	type WriteMode,
} from "./capabilities";
import { ApiError, isApiError } from "./errors";

/** The areas that change data. */
const AREAS: WriteArea[] = [
	"workouts",
	"challenges",
	"badges",
	"messages",
	"media",
	"sendMessage",
	"promotedChallenge",
	"users",
	"userBadges",
	"planning",
	"offers",
];
/** Every area: the ones above and clearing the app's cache, which changes no data. */
const EVERY_AREA: WriteArea[] = [...AREAS, "cache"];

const withMode = (
	area: WriteArea,
	mode: WriteMode,
	base: Capabilities = PRODUCTION_CAPABILITIES,
): Capabilities => ({ ...base, writes: { ...base.writes, [area]: mode } });

const mark = (...texts: (string | null | undefined)[]): TestMark => ({
	texts,
	field: "Komentarz wewnętrzny",
	path: "internalTitle",
});

function refusal(run: () => void): ApiError {
	try {
		run();
	} catch (error) {
		if (isApiError(error)) return error;
		throw error;
	}
	throw new Error("expected a refusal");
}

describe("PRODUCTION_CAPABILITIES", () => {
	it("has every write to data switched off", () => {
		expect(Object.keys(PRODUCTION_CAPABILITIES.writes).toSorted()).toEqual(
			EVERY_AREA.toSorted(),
		);
		for (const area of AREAS) {
			expect(PRODUCTION_CAPABILITIES.writes[area], area).toBe("off");
		}
	});

	it("lets the app's cache be cleared: that changes no data", () => {
		expect(PRODUCTION_CAPABILITIES.writes.cache).toBe("on");
		expect(() =>
			assertWritable(PRODUCTION_CAPABILITIES, "cache", null),
		).not.toThrow();
	});

	it("says what the backend has had since 2026-11-13", () => {
		expect(PRODUCTION_CAPABILITIES).toMatchObject({
			etag: true,
			status: true,
			planning: true,
			badgeDelete: true,
			messageUnarchive: true,
		});
	});

	it("is read-only, whatever the backend can do", () => {
		expect(isReadOnly(PRODUCTION_CAPABILITIES)).toBe(true);
	});

	it("differs from Test only in what may be written", () => {
		expect({ ...PRODUCTION_CAPABILITIES, writes: null }).toEqual({
			...ALL_CAPABILITIES,
			writes: null,
		});
	});
});

describe("ALL_CAPABILITIES", () => {
	it("has every write on and every feature", () => {
		expect(Object.keys(ALL_CAPABILITIES.writes).toSorted()).toEqual(
			EVERY_AREA.toSorted(),
		);
		for (const area of EVERY_AREA) {
			expect(ALL_CAPABILITIES.writes[area], area).toBe("on");
		}
		expect(ALL_CAPABILITIES).toMatchObject({
			etag: true,
			status: true,
			planning: true,
			badgeDelete: true,
			messageUnarchive: true,
		});
	});

	it("is not read-only", () => {
		expect(isReadOnly(ALL_CAPABILITIES)).toBe(false);
	});
});

describe("capabilitiesFor", () => {
	it("gives Produkcja the switched-off set", () => {
		expect(capabilitiesFor("production")).toBe(PRODUCTION_CAPABILITIES);
	});

	it("gives Test everything", () => {
		expect(capabilitiesFor("test")).toBe(ALL_CAPABILITIES);
	});
});

describe("isReadOnly", () => {
	it.each(AREAS)("is false once %s can be written to test items", (area) => {
		expect(isReadOnly(withMode(area, "test-only"))).toBe(false);
	});

	it.each(AREAS)("is false once %s is on", (area) => {
		expect(isReadOnly(withMode(area, "on"))).toBe(false);
	});

	it("does not count clearing the app's cache, which changes no data", () => {
		expect(isReadOnly(withMode("cache", "on"))).toBe(true);
		expect(isReadOnly(withMode("cache", "off"))).toBe(true);
		expect(
			isReadOnly(withMode("workouts", "on", withMode("cache", "off"))),
		).toBe(false);
	});

	it("is false when only planning documents can be saved", () => {
		expect(isReadOnly(withMode("planning", "on"))).toBe(false);
		expect(isReadOnly(withMode("planning", "test-only"))).toBe(false);
	});

	it("does not count features that are not writes of their own", () => {
		const everyWriteOff = PRODUCTION_CAPABILITIES.writes;
		for (const on of [true, false]) {
			expect(
				isReadOnly({
					writes: everyWriteOff,
					etag: on,
					status: on,
					planning: on,
					badgeDelete: on,
					messageUnarchive: on,
				}),
			).toBe(true);
		}
	});

	it("does not take the planning store being there for leave to save in it", () => {
		// Until 2026-11-13 `planning` was both; saving is `writes.planning` now.
		expect(isReadOnly({ ...PRODUCTION_CAPABILITIES, planning: true })).toBe(
			true,
		);
	});
});

describe("isTestMarked", () => {
	it("has [TEST] as the mark", () => {
		expect(TEST_MARK).toBe("[TEST]");
	});

	it.each([
		"[TEST]",
		"[TEST] wiosna",
		"[TEST]wiosna",
		"  [TEST] wiosna",
		"\n\t[TEST] wiosna",
		"[test] wiosna",
		"[Test] wiosna",
	])("accepts %j", (text) => {
		expect(isTestMarked(text)).toBe(true);
	});

	it.each([
		"",
		"   ",
		"wiosna [TEST]",
		"TEST wiosna",
		"[ TEST] wiosna",
		"[TESTY] wiosna",
		"(TEST) wiosna",
		"x[TEST]",
		null,
		undefined,
	])("refuses %j", (text) => {
		expect(isTestMarked(text)).toBe(false);
	});
});

describe("refuse", () => {
	it("throws a validation error that carries its text as an issue", () => {
		const error = refusal(() => refuse("Nie można", "videoUrl"));
		expect(error).toBeInstanceOf(ApiError);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Nie można");
		expect(error.issues).toEqual([{ path: "videoUrl", message: "Nie można" }]);
		// The panel refused it; no backend answered.
		expect(error.status).toBeUndefined();
	});

	it("is about the form as a whole when no field is named", () => {
		expect(refusal(() => refuse("Nie można")).issues).toEqual([
			{ path: "", message: "Nie można" },
		]);
	});
});

describe("assertWritable", () => {
	describe("on", () => {
		it.each(AREAS)("lets any %s write through", (area) => {
			const capabilities = withMode(area, "on");
			expect(() => assertWritable(capabilities, area, null)).not.toThrow();
			expect(() =>
				assertWritable(capabilities, area, mark("zwykły element")),
			).not.toThrow();
			expect(() =>
				assertWritable(capabilities, area, mark(null)),
			).not.toThrow();
		});
	});

	describe("off", () => {
		it.each(AREAS)("refuses every %s write, test item or not", (area) => {
			for (const how of [null, mark("[TEST] element"), mark()]) {
				const error = refusal(() =>
					assertWritable(PRODUCTION_CAPABILITIES, area, how),
				);
				expect(error.kind).toBe("validation");
				expect(error.message).toContain("tylko do odczytu");
				expect(error.message).not.toContain("undefined");
				expect(error.issues).toEqual([{ path: "", message: error.message }]);
			}
		});

		it("names the section in words the person knows", () => {
			const label = (area: WriteArea) =>
				refusal(() => assertWritable(PRODUCTION_CAPABILITIES, area, null))
					.message;
			expect(label("workouts")).toContain("„Treningi”");
			expect(label("challenges")).toContain("„Wyzwania”");
			expect(label("badges")).toContain("„Odznaki”");
			expect(label("messages")).toContain("„Wiadomości”");
			expect(label("media")).toContain("„Media”");
			expect(label("sendMessage")).toContain("„Wysyłanie wiadomości”");
			expect(label("promotedChallenge")).toContain("„Promowane wyzwanie”");
			expect(label("users")).toContain("„Użytkownicy”");
			expect(label("userBadges")).toContain("„Odznaki użytkowników”");
			expect(label("planning")).toContain("„Planowanie”");
			expect(
				refusal(() => assertWritable(withMode("cache", "off"), "cache", null))
					.message,
			).toContain("„Pamięć podręczna backendu”");
		});

		it("is not affected by another section being open", () => {
			const capabilities = withMode("workouts", "on");
			expect(() =>
				assertWritable(capabilities, "challenges", mark("[TEST] x")),
			).toThrow(ApiError);
		});
	});

	describe("test-only", () => {
		const capabilities = withMode("challenges", "test-only");

		it("lets a marked item through", () => {
			expect(() =>
				assertWritable(capabilities, "challenges", mark("[TEST] wiosna")),
			).not.toThrow();
		});

		it("needs the mark on every version it is shown", () => {
			expect(() =>
				assertWritable(
					capabilities,
					"challenges",
					mark("[TEST] zapisane", "[test] nowe"),
				),
			).not.toThrow();
			for (const texts of [
				["zapisane bez znaku", "[TEST] nowe"],
				["[TEST] zapisane", "nowe bez znaku"],
				["[TEST] zapisane", null],
				[undefined, "[TEST] nowe"],
			]) {
				expect(() =>
					assertWritable(capabilities, "challenges", mark(...texts)),
				).toThrow(ApiError);
			}
		});

		it("puts the refusal next to the field that carries the mark", () => {
			const error = refusal(() =>
				assertWritable(capabilities, "challenges", mark("wiosna")),
			);
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("„Komentarz wewnętrzny”");
			expect(error.message).toContain("[TEST]");
			expect(error.issues).toEqual([
				{ path: "internalTitle", message: error.message },
			]);
		});

		it("refuses an action that cannot be limited to a test item", () => {
			const sending = withMode("sendMessage", "test-only");
			const error = refusal(() => assertWritable(sending, "sendMessage", null));
			expect(error.kind).toBe("validation");
			expect(error.message).toContain("„Wysyłanie wiadomości”");
			expect(error.message).toContain("nie da się wypróbować");
			expect(error.issues).toEqual([{ path: "", message: error.message }]);
		});

		it("has nothing to object to before any version is known", () => {
			// The first check of an action on a stored item: the item is read next.
			expect(() =>
				assertWritable(capabilities, "challenges", mark()),
			).not.toThrow();
		});
	});
});

describe("needsStoredCopy", () => {
	it.each([true, false])(
		"always reads the stored item in test-only mode (etag: %s)",
		(etag) => {
			const capabilities = {
				...withMode("workouts", "test-only"),
				etag,
			};
			expect(needsStoredCopy(capabilities, "workouts")).toBe(true);
		},
	);

	it("reads it when the backend cannot refuse a stale save itself", () => {
		expect(
			needsStoredCopy(
				{ ...withMode("workouts", "on"), etag: false },
				"workouts",
			),
		).toBe(true);
	});

	it("leaves the check to the backend once it has etags", () => {
		expect(
			needsStoredCopy(
				{ ...withMode("workouts", "on"), etag: true },
				"workouts",
			),
		).toBe(false);
		expect(needsStoredCopy(ALL_CAPABILITIES, "challenges")).toBe(false);
	});

	it("looks at the area asked about, not at its neighbours", () => {
		const capabilities = {
			...withMode("workouts", "test-only", ALL_CAPABILITIES),
		};
		expect(needsStoredCopy(capabilities, "workouts")).toBe(true);
		expect(needsStoredCopy(capabilities, "challenges")).toBe(false);
	});
});
