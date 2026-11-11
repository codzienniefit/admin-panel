import { afterEach, describe, expect, it } from "vitest";
import { contentStatusSchema } from "@/data/schemas/common";
import { PREP_STATUSES } from "@/data/schemas/planning";
import {
	applyConfigLabels,
	applyTypeStyles,
	KNOWN_LEVEL_IDS,
	KNOWN_TRAINING_TYPE_IDS,
	levelMeta,
	PREP_TONES,
	STATUS_META,
	trainingTypeMeta,
} from "./enums";
import { TONE_LABELS, TONES, toneForId } from "./tones";

const tones: readonly string[] = TONES;

// Labels and styles are kept in the module; put it back as it starts.
afterEach(() => {
	applyTypeStyles({});
	applyConfigLabels({
		trainingTypes: [],
		trainingLevels: [],
		challengeLevels: [],
	});
});

describe("tones", () => {
	it("are all different and each has a Polish name", () => {
		expect(new Set(TONES).size).toBe(TONES.length);
		expect(Object.keys(TONE_LABELS).toSorted()).toEqual([...TONES].toSorted());
		for (const tone of TONES) expect(TONE_LABELS[tone]).not.toBe("");
		expect(new Set(Object.values(TONE_LABELS)).size).toBe(TONES.length);
	});

	it("gives the same id the same tone every time", () => {
		for (const id of ["mobility", "f-wiosna", "Łódź", "42"]) {
			expect(toneForId(id)).toBe(toneForId(id));
			expect(tones).toContain(toneForId(id));
		}
	});

	it("never hands out grey, which means 'no colour'", () => {
		const handedOut = new Set(
			Array.from({ length: 500 }, (_, i) => toneForId(`typ-${i}`)),
		);
		expect(handedOut.has("grey")).toBe(false);
		// Every other tone is in use, so ids spread over the whole palette.
		expect(handedOut.size).toBe(TONES.length - 1);
	});

	it("copes with an empty and a very long id", () => {
		expect(tones).toContain(toneForId(""));
		expect(tones).toContain(toneForId("x".repeat(10_000)));
	});
});

describe("content status", () => {
	it("has a label and a tone for every status the schema knows", () => {
		expect(Object.keys(STATUS_META).toSorted()).toEqual(
			[...contentStatusSchema.options].toSorted(),
		);
		for (const value of contentStatusSchema.options) {
			expect(STATUS_META[value].label).not.toBe("");
			expect(tones).toContain(STATUS_META[value].tone);
		}
	});

	it("shows each status under a different Polish label", () => {
		expect(STATUS_META.draft.label).toBe("Szkic");
		expect(STATUS_META.published.label).toBe("Opublikowane");
		expect(STATUS_META.hidden.label).toBe("Ukryte");
		expect(STATUS_META.deleted.label).toBe("Usunięte");
	});

	it("keeps published green and deleted red", () => {
		expect(STATUS_META.published.tone).toBe("green");
		expect(STATUS_META.deleted.tone).toBe("red");
	});
});

describe("preparation status", () => {
	it("has a tone for every status the schema knows", () => {
		expect(Object.keys(PREP_TONES).toSorted()).toEqual(
			[...PREP_STATUSES].toSorted(),
		);
		for (const value of PREP_STATUSES) {
			expect(tones).toContain(PREP_TONES[value]);
		}
	});

	it("goes from red through amber to green", () => {
		expect(PREP_STATUSES.map((value) => PREP_TONES[value])).toEqual([
			"red",
			"amber",
			"green",
		]);
	});
});

describe("levels", () => {
	it("have a label and a tone for every built-in id", () => {
		expect(KNOWN_LEVEL_IDS).toEqual(["beginner", "intermediate", "advanced"]);
		for (const id of KNOWN_LEVEL_IDS) {
			const meta = levelMeta(id);
			expect(meta.label).not.toBe("");
			expect(meta.label).not.toBe(id);
			expect(tones).toContain(meta.tone);
		}
		expect(levelMeta("beginner")).toEqual({
			label: "Początkujący",
			tone: "teal",
		});
	});

	it("show an id nobody knows as itself, in a stable colour", () => {
		const meta = levelMeta("ekspert");
		expect(meta).toEqual({ label: "ekspert", tone: toneForId("ekspert") });
		expect(tones).toContain(meta.tone);
		expect(levelMeta("ekspert")).toEqual(meta);
		expect(() => levelMeta("")).not.toThrow();
	});

	it("is not fooled by ids that are also names of object members", () => {
		for (const id of ["toString", "constructor", "__proto__"]) {
			expect(levelMeta(id)).toEqual({ label: id, tone: toneForId(id) });
			expect(trainingTypeMeta(id)).toEqual({ label: id, tone: toneForId(id) });
		}
	});

	it("take their labels from the backend configuration, not their tones", () => {
		applyConfigLabels({
			trainingTypes: [],
			trainingLevels: [{ id: "beginner", title: "Na start" }],
			challengeLevels: [{ id: "ekspert", title: "Ekspert" }],
		});
		expect(levelMeta("beginner")).toEqual({ label: "Na start", tone: "teal" });
		expect(levelMeta("ekspert")).toEqual({
			label: "Ekspert",
			tone: toneForId("ekspert"),
		});
		expect(levelMeta("advanced").label).toBe("Zaawansowany");
	});
});

describe("training types", () => {
	it("have a label and a tone for every built-in id", () => {
		expect(KNOWN_TRAINING_TYPE_IDS.toSorted()).toEqual([
			"cardio",
			"hiit",
			"pilates",
			"strength",
			"stretching",
			"yoga",
		]);
		for (const id of KNOWN_TRAINING_TYPE_IDS) {
			const meta = trainingTypeMeta(id);
			expect(meta.label).not.toBe("");
			expect(tones).toContain(meta.tone);
			expect(meta.emoji).toBeUndefined();
		}
		expect(trainingTypeMeta("yoga")).toEqual({ label: "Joga", tone: "purple" });
	});

	it("give every built-in type a colour of its own", () => {
		const used = KNOWN_TRAINING_TYPE_IDS.map((id) => trainingTypeMeta(id).tone);
		expect(new Set(used).size).toBe(used.length);
	});

	it("show an id nobody knows as itself, in a stable colour", () => {
		expect(trainingTypeMeta("mobility")).toEqual({
			label: "mobility",
			tone: toneForId("mobility"),
		});
		expect(() => trainingTypeMeta("")).not.toThrow();
	});

	it("take their labels from the backend configuration", () => {
		applyConfigLabels({
			trainingTypes: [
				{ id: "yoga", title: "Joga i oddech" },
				{ id: "mobility", title: "Mobilność" },
			],
			trainingLevels: [],
			challengeLevels: [],
		});
		expect(trainingTypeMeta("yoga")).toEqual({
			label: "Joga i oddech",
			tone: "purple",
		});
		expect(trainingTypeMeta("mobility").label).toBe("Mobilność");
		// Level labels and type labels do not mix.
		expect(levelMeta("yoga").label).toBe("yoga");
	});

	it("forget the labels of an earlier configuration", () => {
		const empty = {
			trainingTypes: [],
			trainingLevels: [],
			challengeLevels: [],
		};
		applyConfigLabels({
			...empty,
			trainingTypes: [{ id: "yoga", title: "Joga i oddech" }],
		});
		applyConfigLabels(empty);
		expect(trainingTypeMeta("yoga").label).toBe("Joga");
	});
});

describe("training type styles from the planner's settings", () => {
	it("change the tone and add the emoji of a known type", () => {
		applyTypeStyles({ yoga: { tone: "teal", emoji: "🧘" } });
		expect(trainingTypeMeta("yoga")).toEqual({
			label: "Joga",
			tone: "teal",
			emoji: "🧘",
		});
		// The others keep their built-in look.
		expect(trainingTypeMeta("cardio")).toEqual({
			label: "Cardio",
			tone: "red",
		});
	});

	it("style a type that is not built in", () => {
		applyTypeStyles({ mobility: { tone: "indigo", emoji: "🤸" } });
		expect(trainingTypeMeta("mobility")).toEqual({
			label: "mobility",
			tone: "indigo",
			emoji: "🤸",
		});
	});

	it("leave the emoji out when the style has none", () => {
		applyTypeStyles({
			strength: { tone: "grey" },
			cardio: { tone: "pink", emoji: "" },
		});
		expect(trainingTypeMeta("strength")).toEqual({
			label: "Siłowy",
			tone: "grey",
			emoji: undefined,
		});
		expect(trainingTypeMeta("cardio").emoji).toBeUndefined();
	});

	it("ignore a tone the panel does not have", () => {
		applyTypeStyles({
			yoga: { tone: "turkusowy", emoji: "🧘" },
			hiit: { tone: "", emoji: "🔥" },
			cardio: { tone: "Blue" },
		});
		expect(trainingTypeMeta("yoga")).toEqual({ label: "Joga", tone: "purple" });
		expect(trainingTypeMeta("hiit")).toEqual({ label: "HIIT", tone: "pink" });
		expect(trainingTypeMeta("cardio")).toEqual({
			label: "Cardio",
			tone: "red",
		});
	});

	it("replace the styles applied before", () => {
		applyTypeStyles({ yoga: { tone: "teal", emoji: "🧘" } });
		applyTypeStyles({ cardio: { tone: "orange" } });
		expect(trainingTypeMeta("yoga")).toEqual({ label: "Joga", tone: "purple" });
		expect(trainingTypeMeta("cardio").tone).toBe("orange");
	});

	it("do not touch levels", () => {
		applyTypeStyles({ beginner: { tone: "red", emoji: "🌱" } });
		expect(levelMeta("beginner")).toEqual({
			label: "Początkujący",
			tone: "teal",
		});
	});

	it("go together with labels from the configuration", () => {
		applyConfigLabels({
			trainingTypes: [{ id: "yoga", title: "Joga i oddech" }],
			trainingLevels: [],
			challengeLevels: [],
		});
		applyTypeStyles({ yoga: { tone: "teal", emoji: "🧘" } });
		expect(trainingTypeMeta("yoga")).toEqual({
			label: "Joga i oddech",
			tone: "teal",
			emoji: "🧘",
		});
	});
});
