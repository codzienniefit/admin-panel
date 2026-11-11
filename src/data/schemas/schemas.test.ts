import { describe, expect, it } from "vitest";
import { badgeSchema, blankBadge, newBadgeSchema } from "@/data/schemas/badge";
import {
	blankChallenge,
	blankPath,
	challengeSchema,
	daySchema,
	newChallengeSchema,
	pathSchema,
} from "@/data/schemas/challenge";
import {
	contentBlockSchema,
	contentStatusSchema,
	idList,
	optionalText,
} from "@/data/schemas/common";
import {
	configOptionSchema,
	internalConfigSchema,
	workoutConfigSchema,
} from "@/data/schemas/config";
import {
	mediaFileSchema,
	mediaTypeSchema,
	mediaUploadResultSchema,
} from "@/data/schemas/media";
import {
	blankMessage,
	messageSchema,
	messageStatusSchema,
	newMessageSchema,
} from "@/data/schemas/message";
import {
	blankPlanning,
	blankVariantPlanning,
	CONDITION_TYPES,
	cardKey,
	conditionSchema,
	PREP_STATUSES,
	planningSchema,
	planTypeSchema,
	UNSAVED_ETAG,
	variantPlanningSchema,
} from "@/data/schemas/planning";
import {
	folderSchema,
	PLANNER_SETTINGS_ID,
	plannerSettingsSchema,
	trainingTypeStyleSchema,
} from "@/data/schemas/settings";
import {
	userAccountSchema,
	userBadgeSchema,
	userChallengeAttemptSchema,
	userProgressSchema,
	userSearchResultSchema,
	userSummarySchema,
	userWorkoutCompletionSchema,
} from "@/data/schemas/user";
import {
	blankWorkout,
	newWorkoutSchema,
	workoutSchema,
} from "@/data/schemas/workout";

// Rule 4 of the guidelines: every object schema is loose. A field this build
// has no schema for must come out of a parse as it went in, at every level,
// or the next save would wipe it on the server.

const UNKNOWN = "x_addedByNewerBackend";
const NOW = "2026-11-11T09:00:00.000Z";

/** Where the unknown fields of a document are, with their values. */
function unknownFields(
	value: unknown,
	where = "$",
	found: Record<string, unknown> = {},
): Record<string, unknown> {
	if (Array.isArray(value)) {
		value.forEach((inner, index) => {
			unknownFields(inner, `${where}[${index}]`, found);
		});
	} else if (typeof value === "object" && value !== null) {
		for (const [key, inner] of Object.entries(value)) {
			if (key === UNKNOWN) found[where] = inner;
			else unknownFields(inner, `${where}.${key}`, found);
		}
	}
	return found;
}

interface Parser {
	parse(input: unknown): unknown;
	safeParse(input: unknown): { success: boolean };
}

/**
 * The sample is complete, so nothing is defaulted: what comes out must be
 * what went in, unknown fields included, at exactly the listed places.
 */
function expectKept(schema: Parser, sample: unknown, places: string[]) {
	expect(Object.keys(unknownFields(sample)).toSorted()).toEqual(
		places.toSorted(),
	);
	const parsed = schema.parse(sample);
	expect(unknownFields(parsed)).toEqual(unknownFields(sample));
	expect(parsed).toEqual(sample);
}

const accepts = (schema: Parser, input: unknown) =>
	schema.safeParse(input).success;

const pictureBlock = {
	type: "image",
	content: "",
	metadata: {
		imageRelativePath: "challenges/wiosna-rozgrzewka.webp",
		heightToWidthRatio: 0.5625,
		[UNKNOWN]: "metadata",
	},
	[UNKNOWN]: "block",
};

const textBlock = {
	type: "paragraph",
	content: "Zaczynamy spokojnie: trzy treningi w tygodniu.",
	metadata: null,
	[UNKNOWN]: { od: "wersji 2.4" },
};

describe("shared pieces", () => {
	it("keeps unknown fields of a content block and its metadata", () => {
		expectKept(contentBlockSchema, pictureBlock, ["$", "$.metadata"]);
		expectKept(contentBlockSchema, textBlock, ["$"]);
	});

	it("lets the metadata of a content block be absent or null", () => {
		expect(
			contentBlockSchema.parse({ type: "header", content: "Tydzień 1" }),
		).toEqual({ type: "header", content: "Tydzień 1" });
		expect(contentBlockSchema.parse(textBlock).metadata).toBeNull();
	});

	it("refuses a content block of the wrong shape", () => {
		expect(accepts(contentBlockSchema, { type: "paragraph" })).toBe(false);
		expect(accepts(contentBlockSchema, { type: 1, content: "x" })).toBe(false);
		expect(
			accepts(contentBlockSchema, {
				type: "image",
				content: "",
				metadata: { imageRelativePath: "a.webp", heightToWidthRatio: "1" },
			}),
		).toBe(false);
		expect(
			accepts(contentBlockSchema, {
				type: "image",
				content: "",
				metadata: { heightToWidthRatio: 1 },
			}),
		).toBe(false);
	});

	it("reads an absent or null optional text as null", () => {
		expect(optionalText.parse(undefined)).toBeNull();
		expect(optionalText.parse(null)).toBeNull();
		expect(optionalText.parse("Notatka zespołu")).toBe("Notatka zespołu");
		expect(optionalText.parse("")).toBe("");
		expect(optionalText.safeParse(7).success).toBe(false);
	});

	it("reads an absent or null id list as an empty one", () => {
		expect(idList.parse(undefined)).toEqual([]);
		expect(idList.parse(null)).toEqual([]);
		expect(idList.parse(["kondycja", "siła"])).toEqual(["kondycja", "siła"]);
		expect(idList.safeParse("kondycja").success).toBe(false);
		expect(idList.safeParse([1, 2]).success).toBe(false);
	});

	it("knows the four content statuses and no other", () => {
		expect(contentStatusSchema.options).toEqual([
			"draft",
			"published",
			"hidden",
			"deleted",
		]);
		expect(contentStatusSchema.safeParse("archived").success).toBe(false);
	});
});

describe("challenge", () => {
	const day = { dayIndex: 1, workoutIds: ["W1", "W3"], [UNKNOWN]: "day" };
	const path = {
		pathId: "p-easy",
		levelId: "beginner",
		frequency: 3,
		minimumDaysToComplete: 20,
		description: "Dla osób, które dopiero zaczynają biegać.",
		pro: false,
		difficultyLevelsIds: ["latwy"],
		days: [day, { dayIndex: 2, workoutIds: [], [UNKNOWN]: "rest day" }],
		[UNKNOWN]: "path",
	};
	const challenge = {
		id: "C1",
		etag: "12",
		title: "Wiosenne wyzwanie biegowe",
		subtitle: "Cztery tygodnie do pierwszych 5 km",
		internalTitle: "Wiosna 2026, wersja po poprawkach Patryka",
		status: "published",
		pro: true,
		lengthDays: 28,
		visibleDaysUpFront: 7,
		imageRelativePath: "challenges/wiosenne-wyzwanie-biegowe.webp",
		descriptionFancyContent: [textBlock, pictureBlock],
		categoryId: "bieganie",
		goalsIds: ["kondycja", "redukcja"],
		difficultyLevelsIds: ["latwy", "sredni"],
		addedAtUtc: "2026-02-01T10:00:00.000Z",
		liveAtUtc: "2026-03-02T05:00:00.000Z",
		endsAtUtc: "2026-04-30T21:59:00.000Z",
		availableAtUtc: "2026-02-20T08:00:00.000Z",
		updatedAtUtc: NOW,
		unlockedByEntitlementIds: ["pro"],
		offeringId: "wiosna-2026",
		discountedForEntitlementIds: ["pro-roczny"],
		offeringDiscountedId: "wiosna-2026-znizka",
		badgeId: "B7",
		perfectCompletionBadgeId: "B8",
		recommendedNext: [{ id: "C2", [UNKNOWN]: "recommendation" }],
		paths: [path],
		[UNKNOWN]: "challenge",
	};
	const minimal = {
		id: "C9",
		etag: "1",
		title: "Szkic bez niczego",
		status: "draft",
		lengthDays: 7,
		updatedAtUtc: NOW,
		paths: [],
	};

	it("keeps unknown fields at every level", () => {
		expectKept(challengeSchema, challenge, [
			"$",
			"$.descriptionFancyContent[0]",
			"$.descriptionFancyContent[1]",
			"$.descriptionFancyContent[1].metadata",
			"$.recommendedNext[0]",
			"$.paths[0]",
			"$.paths[0].days[0]",
			"$.paths[0].days[1]",
		]);
	});

	it("keeps unknown fields of a variant and of a day on their own", () => {
		expectKept(pathSchema, path, ["$", "$.days[0]", "$.days[1]"]);
		expectKept(daySchema, day, ["$"]);
	});

	it("fills in everything the backend may leave out", () => {
		expect(challengeSchema.parse(minimal)).toEqual({
			...minimal,
			subtitle: "",
			internalTitle: null,
			pro: false,
			visibleDaysUpFront: null,
			imageRelativePath: null,
			descriptionFancyContent: [],
			categoryId: null,
			goalsIds: [],
			difficultyLevelsIds: [],
			addedAtUtc: "",
			liveAtUtc: null,
			endsAtUtc: null,
			availableAtUtc: null,
			unlockedByEntitlementIds: [],
			offeringId: null,
			discountedForEntitlementIds: [],
			offeringDiscountedId: null,
			badgeId: null,
			perfectCompletionBadgeId: null,
			recommendedNext: [],
		});
	});

	it("reads null the same way as a missing value", () => {
		expect(
			challengeSchema.parse({
				...minimal,
				internalTitle: null,
				imageRelativePath: null,
				liveAtUtc: null,
				badgeId: null,
				goalsIds: null,
				unlockedByEntitlementIds: null,
				recommendedNext: null,
				visibleDaysUpFront: null,
			}),
		).toMatchObject({
			internalTitle: null,
			imageRelativePath: null,
			liveAtUtc: null,
			badgeId: null,
			goalsIds: [],
			unlockedByEntitlementIds: [],
			recommendedNext: [],
			visibleDaysUpFront: null,
		});
	});

	it("fills in the optional parts of a variant", () => {
		expect(
			pathSchema.parse({ pathId: "p-hard", levelId: "advanced", days: [] }),
		).toEqual({
			pathId: "p-hard",
			levelId: "advanced",
			frequency: 1,
			minimumDaysToComplete: 0,
			description: null,
			pro: false,
			difficultyLevelsIds: [],
			days: [],
		});
	});

	it("reads a frequency sent as text", () => {
		expect(pathSchema.parse({ ...path, frequency: "4" }).frequency).toBe(4);
		expect(accepts(pathSchema, { ...path, frequency: "często" })).toBe(false);
	});

	it.each([
		["a title that is a number", { title: 2026 }],
		["a status nobody knows", { status: "archived" }],
		["no id", { id: undefined }],
		["no etag", { etag: undefined }],
		["a length of zero days", { lengthDays: 0 }],
		["a length of half a day", { lengthDays: 27.5 }],
		["a length sent as text", { lengthDays: "28" }],
		["variants that are not a list", { paths: { "p-easy": path } }],
		["no variants at all", { paths: undefined }],
		["goals that are not texts", { goalsIds: [1, 2] }],
		["a pro flag sent as text", { pro: "tak" }],
		["a recommendation without an id", { recommendedNext: [{ title: "C2" }] }],
		[
			"a description block without content",
			{
				descriptionFancyContent: [{ type: "paragraph" }],
			},
		],
		["a variant without its id", { paths: [{ ...path, pathId: undefined }] }],
		[
			"a day numbered from zero",
			{
				paths: [{ ...path, days: [{ dayIndex: 0, workoutIds: [] }] }],
			},
		],
		[
			"a day whose workouts are not ids",
			{
				paths: [{ ...path, days: [{ dayIndex: 1, workoutIds: [7] }] }],
			},
		],
	])("refuses %s", (_what, patch) => {
		expect(accepts(challengeSchema, { ...challenge, ...patch })).toBe(false);
	});

	it("refuses a day without a number or a list of workouts", () => {
		expect(accepts(daySchema, { workoutIds: [] })).toBe(false);
		expect(accepts(daySchema, { dayIndex: 1 })).toBe(false);
		expect(accepts(daySchema, { dayIndex: 1.5, workoutIds: [] })).toBe(false);
	});

	it("accepts a blank challenge as a create request, unchanged", () => {
		const blank = blankChallenge(NOW);
		expect(newChallengeSchema.parse(blank)).toEqual(blank);
		expect(blank).toMatchObject({
			status: "draft",
			lengthDays: 28,
			addedAtUtc: NOW,
			paths: [],
		});
		expect(
			challengeSchema.parse({
				...blank,
				id: "C10",
				etag: "1",
				updatedAtUtc: NOW,
			}),
		).toEqual({ ...blank, id: "C10", etag: "1", updatedAtUtc: NOW });
	});

	it("keeps unknown fields in a create request too", () => {
		const parsed = newChallengeSchema.parse({
			...blankChallenge(NOW),
			[UNKNOWN]: "nowe pole",
		});
		expect(parsed).toHaveProperty(UNKNOWN, "nowe pole");
	});

	it("makes a blank variant with one empty day per day of the challenge", () => {
		const blank = blankPath("p-easy", "beginner", 28);
		expect(blank.days).toHaveLength(28);
		expect(blank.days.map((d) => d.dayIndex)).toEqual(
			Array.from({ length: 28 }, (_, i) => i + 1),
		);
		expect(blank.days.every((d) => d.workoutIds.length === 0)).toBe(true);
		expect(pathSchema.parse(blank)).toEqual(blank);
		expect(blank).toMatchObject({ pathId: "p-easy", levelId: "beginner" });
	});

	it("gives a blank variant at least one day", () => {
		expect(blankPath("p-easy", "beginner", 0).days).toEqual([
			{ dayIndex: 1, workoutIds: [] },
		]);
		expect(blankPath("p-easy", "beginner", -3).days).toHaveLength(1);
	});
});

describe("workout", () => {
	const workout = {
		id: "W1",
		etag: "4",
		title: "Poranna joga na dobry początek dnia",
		internalTitle: "Joga 01 – nagranie z lutego",
		status: "published",
		pro: false,
		durationMinutes: 20,
		levelId: "beginner",
		equipmentIds: ["mata"],
		trainingTypeIds: ["yoga", "stretching"],
		imageRelativePath: "workouts/poranna-joga.webp",
		audioRelativePath: "workouts/poranna-joga.mp3",
		videoUrl: "https://video.example/poranna-joga",
		descriptionFancyContent: [textBlock, pictureBlock],
		badgeId: "B3",
		addedAtUtc: "2026-02-10T07:30:00.000Z",
		liveAtUtc: "2026-02-12T05:00:00.000Z",
		availableAtUtc: "2026-02-11T05:00:00.000Z",
		updatedAtUtc: NOW,
		[UNKNOWN]: "workout",
	};
	const minimal = {
		id: "W9",
		etag: "1",
		title: "Szkic treningu",
		status: "draft",
		durationMinutes: 0,
		trainingTypeIds: [],
		addedAtUtc: NOW,
		updatedAtUtc: NOW,
	};

	it("keeps unknown fields at every level", () => {
		expectKept(workoutSchema, workout, [
			"$",
			"$.descriptionFancyContent[0]",
			"$.descriptionFancyContent[1]",
			"$.descriptionFancyContent[1].metadata",
		]);
	});

	it("fills in everything the backend may leave out", () => {
		expect(workoutSchema.parse(minimal)).toEqual({
			...minimal,
			internalTitle: null,
			pro: false,
			levelId: null,
			equipmentIds: [],
			imageRelativePath: null,
			audioRelativePath: null,
			videoUrl: null,
			descriptionFancyContent: [],
			badgeId: null,
			liveAtUtc: null,
			availableAtUtc: null,
		});
		expect(
			workoutSchema.parse({ ...minimal, equipmentIds: null, levelId: null }),
		).toMatchObject({ equipmentIds: [], levelId: null });
	});

	it.each([
		["a duration sent as text", { durationMinutes: "20" }],
		["a negative duration", { durationMinutes: -5 }],
		["a duration with a fraction", { durationMinutes: 12.5 }],
		["no training types", { trainingTypeIds: undefined }],
		["training types that are null", { trainingTypeIds: null }],
		["a status nobody knows", { status: "sent" }],
		["a title that is null", { title: null }],
		["no date of adding", { addedAtUtc: undefined }],
		["no modification date", { updatedAtUtc: undefined }],
		["equipment that is one text", { equipmentIds: "mata" }],
	])("refuses %s", (_what, patch) => {
		expect(accepts(workoutSchema, { ...workout, ...patch })).toBe(false);
	});

	it("accepts a blank workout as a create request, unchanged", () => {
		const blank = blankWorkout(NOW);
		expect(newWorkoutSchema.parse(blank)).toEqual(blank);
		expect(blank).toMatchObject({
			status: "draft",
			durationMinutes: 20,
			addedAtUtc: NOW,
		});
		expect(
			newWorkoutSchema.parse({ ...blank, [UNKNOWN]: "nowe pole" }),
		).toHaveProperty(UNKNOWN, "nowe pole");
	});
});

describe("badge", () => {
	const badge = {
		id: "B7",
		etag: "3",
		name: "Wiosenny biegacz",
		type: "manual",
		imageRelativePath: "badges/wiosenny-biegacz.webp",
		comment: "Rozdawana na wydarzeniu w Łodzi",
		isHidden: false,
		sectionId: "wydarzenia",
		subsectionId: "wiosna-2026",
		specialCategory: "event",
		repeatCategory: null,
		milestoneCount: null,
		activeFromUtc: "2026-03-20T07:00:00.000Z",
		activeTillUtc: "2026-03-22T21:00:00.000Z",
		claimToken: "LODZ-2026",
		isClaimLinkActive: true,
		createdAtUtc: "2026-03-01T10:00:00.000Z",
		updatedAtUtc: NOW,
		[UNKNOWN]: { level: "badge", list: [1, 2] },
	};
	const minimal = {
		id: "B1",
		etag: "1",
		name: "Pierwszy trening",
		type: "normal",
		imageRelativePath: "badges/pierwszy-trening.webp",
	};

	it("keeps unknown fields", () => {
		expectKept(badgeSchema, badge, ["$"]);
	});

	it("keeps a milestone count", () => {
		expect(
			badgeSchema.parse({
				...minimal,
				type: "milestone",
				repeatCategory: "workouts",
				milestoneCount: 50,
			}),
		).toMatchObject({ repeatCategory: "workouts", milestoneCount: 50 });
	});

	it("fills in everything the backend may leave out", () => {
		expect(badgeSchema.parse(minimal)).toEqual({
			...minimal,
			comment: null,
			isHidden: false,
			sectionId: null,
			subsectionId: null,
			specialCategory: null,
			repeatCategory: null,
			milestoneCount: null,
			activeFromUtc: null,
			activeTillUtc: null,
			claimToken: null,
			isClaimLinkActive: false,
			createdAtUtc: "",
			updatedAtUtc: "",
		});
	});

	it.each([
		["no name", { name: undefined }],
		["no type", { type: undefined }],
		["no picture", { imageRelativePath: undefined }],
		["a picture that is null", { imageRelativePath: null }],
		["a milestone count sent as text", { milestoneCount: "50" }],
		["a hidden flag sent as text", { isHidden: "nie" }],
		["a claim code that is a number", { claimToken: 2026 }],
	])("refuses %s", (_what, patch) => {
		expect(accepts(badgeSchema, { ...badge, ...patch })).toBe(false);
	});

	it("accepts a blank badge as a create request, unchanged", () => {
		const blank = blankBadge();
		expect(newBadgeSchema.parse(blank)).toEqual(blank);
		expect(blank).toMatchObject({ type: "normal", isHidden: false });
		expect(
			newBadgeSchema.parse({ ...blank, [UNKNOWN]: "nowe pole" }),
		).toHaveProperty(UNKNOWN, "nowe pole");
	});
});

describe("message", () => {
	const message = {
		id: "M1",
		etag: "2",
		title: "Start wiosennego wyzwania – przypomnienie",
		from: "Zespół treningowy",
		status: "sent",
		targetGroup: "challengeParticipants",
		targetGroupValue: "C1",
		fancyContent: [textBlock, pictureBlock],
		createdAtUtc: "2026-02-27T12:00:00.000Z",
		sentAtUtc: "2026-03-01T17:00:00.000Z",
		archivedAtUtc: null,
		updatedAtUtc: NOW,
		[UNKNOWN]: "message",
	};
	const minimal = {
		id: "M9",
		etag: "1",
		title: "Szkic wiadomości",
		status: "draft",
		createdAtUtc: NOW,
		updatedAtUtc: NOW,
	};

	it("keeps unknown fields at every level", () => {
		expectKept(messageSchema, message, [
			"$",
			"$.fancyContent[0]",
			"$.fancyContent[1]",
			"$.fancyContent[1].metadata",
		]);
	});

	it("fills in everything the backend may leave out", () => {
		expect(messageSchema.parse(minimal)).toEqual({
			...minimal,
			from: "",
			targetGroup: null,
			targetGroupValue: null,
			fancyContent: [],
			sentAtUtc: null,
			archivedAtUtc: null,
		});
	});

	it("knows the three message statuses and no other", () => {
		expect(messageStatusSchema.options).toEqual(["draft", "sent", "archived"]);
		expect(accepts(messageSchema, { ...message, status: "published" })).toBe(
			false,
		);
	});

	it.each([
		["no title", { title: undefined }],
		["no creation date", { createdAtUtc: undefined }],
		["a sender that is null", { from: null }],
		["a body that is one text", { fancyContent: "Cześć!" }],
		["a target group that is a list", { targetGroup: ["all"] }],
	])("refuses %s", (_what, patch) => {
		expect(accepts(messageSchema, { ...message, ...patch })).toBe(false);
	});

	it("accepts a blank message as a create request, unchanged", () => {
		const blank = blankMessage(NOW);
		expect(newMessageSchema.parse(blank)).toEqual(blank);
		expect(blank).toMatchObject({ title: "", createdAtUtc: NOW });
		expect(blank).not.toHaveProperty("status");
		expect(
			newMessageSchema.parse({ ...blank, [UNKNOWN]: "nowe pole" }),
		).toHaveProperty(UNKNOWN, "nowe pole");
	});
});

describe("planning", () => {
	const condition = {
		type: "limit",
		scope: "strength",
		countMode: "days",
		value: 3,
		[UNKNOWN]: "condition",
	};
	const planType = {
		id: "pt-3x",
		name: "Trzy treningi w tygodniu",
		description: "Siła, cardio i rozciąganie, z dniem przerwy między nimi.",
		conditions: [
			condition,
			{ type: "zakres", scope: "all", valueMin: 2, valueMax: 4 },
			{ type: "odstep", scope: "cardio", valueDays: 2 },
		],
		[UNKNOWN]: "plan type",
	};
	const variant = {
		planTypeId: "pt-3x",
		prepStatus: "in_progress",
		prepNote: "Brakuje nagrań do trzeciego tygodnia",
		notes: "Tydzień 2 lżejszy – święta.",
		days: {
			"3": { note: "Dzień regeneracji", tint: "#fde68a", [UNKNOWN]: "day" },
		},
		cards: {
			[cardKey(1, "W1")]: {
				note: "Nagrać ponownie wstęp",
				color: "#fecaca",
				[UNKNOWN]: "card",
			},
		},
		[UNKNOWN]: "variant",
	};
	const planning = {
		id: "C1",
		etag: "5",
		updatedAtUtc: NOW,
		calendarColor: "#3b82f6",
		note: "Premiera razem z kampanią wiosenną.",
		folderId: "f-wiosna",
		scratchpad: ["W7", "W9"],
		customPlanTypes: [planType],
		conditionOverrides: {
			"pt-3x": [
				{ type: "minimum", scope: "all", value: 2, [UNKNOWN]: "override" },
			],
		},
		variants: { "p-easy": variant },
		[UNKNOWN]: "planning",
	};

	it("keeps unknown fields at every level", () => {
		expectKept(planningSchema, planning, [
			"$",
			"$.customPlanTypes[0]",
			"$.customPlanTypes[0].conditions[0]",
			"$.conditionOverrides.pt-3x[0]",
			"$.variants.p-easy",
			"$.variants.p-easy.days.3",
			"$.variants.p-easy.cards.1:W1",
		]);
	});

	it("keeps unknown fields of its parts on their own", () => {
		expectKept(conditionSchema, condition, ["$"]);
		expectKept(planTypeSchema, planType, ["$", "$.conditions[0]"]);
		expectKept(variantPlanningSchema, variant, [
			"$",
			"$.days.3",
			"$.cards.1:W1",
		]);
	});

	it("needs only the id and the etag", () => {
		expect(planningSchema.parse({ id: "C1", etag: "0" })).toEqual({
			id: "C1",
			etag: "0",
			updatedAtUtc: "",
			calendarColor: null,
			note: "",
			folderId: null,
			scratchpad: [],
			customPlanTypes: [],
			conditionOverrides: {},
			variants: {},
		});
	});

	it("fills in an empty variant", () => {
		expect(variantPlanningSchema.parse({})).toEqual({
			planTypeId: null,
			prepStatus: "not_started",
			prepNote: "",
			notes: "",
			days: {},
			cards: {},
		});
		expect(variantPlanningSchema.parse({ planTypeId: null })).toMatchObject({
			planTypeId: null,
		});
	});

	it("reads a preparation status it does not know as not started", () => {
		expect(
			variantPlanningSchema.parse({ prepStatus: "w recenzji" }).prepStatus,
		).toBe("not_started");
		for (const prepStatus of PREP_STATUSES) {
			expect(variantPlanningSchema.parse({ prepStatus }).prepStatus).toBe(
				prepStatus,
			);
		}
	});

	it("fills in a rule and lets a kind it does not know through", () => {
		expect(conditionSchema.parse({ type: "limit", value: 3 })).toEqual({
			type: "limit",
			scope: "all",
			value: 3,
		});
		expect(
			conditionSchema.parse({ type: "co_drugi_dzien", scope: "yoga" }),
		).toEqual({ type: "co_drugi_dzien", scope: "yoga" });
	});

	it("drops a way of counting it does not know", () => {
		expect(
			conditionSchema.parse({ type: "limit", countMode: "tygodnie" }),
		).not.toHaveProperty("countMode", "tygodnie");
		expect(
			conditionSchema.parse({ type: "limit", countMode: "trainings" })
				.countMode,
		).toBe("trainings");
	});

	it("fills in a plan type", () => {
		expect(planTypeSchema.parse({ id: "pt-1", name: "Dowolny" })).toEqual({
			id: "pt-1",
			name: "Dowolny",
			description: "",
			conditions: [],
		});
	});

	it.each([
		["no id", { id: undefined }],
		["no etag", { etag: undefined }],
		["a note that is null", { note: null }],
		["a scratchpad of numbers", { scratchpad: [7, 9] }],
		["variants that are a list", { variants: [variant] }],
		[
			"a variant whose notes are a number",
			{
				variants: { "p-easy": { ...variant, notes: 3 } },
			},
		],
		[
			"a day note that is a number",
			{
				variants: { "p-easy": { ...variant, days: { "3": { note: 3 } } } },
			},
		],
		["a plan type without a name", { customPlanTypes: [{ id: "pt-1" }] }],
		[
			"a rule without a kind",
			{ conditionOverrides: { "pt-3x": [{ value: 2 }] } },
		],
		[
			"a rule whose value is text",
			{
				conditionOverrides: { "pt-3x": [{ type: "limit", value: "3" }] },
			},
		],
		["a calendar colour that is a number", { calendarColor: 3368601 }],
	])("refuses %s", (_what, patch) => {
		expect(accepts(planningSchema, { ...planning, ...patch })).toBe(false);
	});

	it("starts a challenge with a blank, unsaved document", () => {
		const blank = blankPlanning("C7");
		expect(blank).toMatchObject({ id: "C7", etag: UNSAVED_ETAG });
		expect(UNSAVED_ETAG).toBe("0");
		expect(planningSchema.parse(blank)).toEqual(blank);
		expect(planningSchema.parse({ id: "C7", etag: UNSAVED_ETAG })).toEqual(
			blank,
		);
	});

	it("starts a variant with blank planning", () => {
		const blank = blankVariantPlanning();
		expect(variantPlanningSchema.parse(blank)).toEqual(blank);
		expect(variantPlanningSchema.parse({})).toEqual(blank);
	});

	it("hands out separate blank documents", () => {
		const first = blankPlanning("C7");
		first.scratchpad.push("W1");
		first.variants["p-easy"] = blankVariantPlanning();
		expect(blankPlanning("C7")).toMatchObject({ scratchpad: [], variants: {} });
	});

	it("keys a card by its day and workout", () => {
		expect(cardKey(3, "W12")).toBe("3:W12");
		expect(cardKey(28, "W1")).not.toBe(cardKey(2, "8W1"));
	});

	it("lists the kinds of rule and the preparation statuses", () => {
		expect(PREP_STATUSES).toEqual(["not_started", "in_progress", "ready"]);
		expect(new Set(CONDITION_TYPES).size).toBe(CONDITION_TYPES.length);
		expect(CONDITION_TYPES).toContain("limit");
		expect(CONDITION_TYPES).toContain("min_dni_odpoczynku");
	});
});

describe("planner settings", () => {
	const settings = {
		id: PLANNER_SETTINGS_ID,
		etag: "8",
		updatedAtUtc: NOW,
		planTypes: [
			{
				id: "pt-3x",
				name: "Trzy treningi w tygodniu",
				description: "",
				conditions: [
					{ type: "limit", scope: "all", value: 3, [UNKNOWN]: "condition" },
				],
				[UNKNOWN]: "plan type",
			},
		],
		trainingTypeStyles: {
			yoga: { tone: "purple", emoji: "🧘", [UNKNOWN]: "style" },
		},
		folders: [{ id: "f-wiosna", name: "Wiosna 2026", [UNKNOWN]: "folder" }],
		[UNKNOWN]: "settings",
	};

	it("keeps unknown fields at every level", () => {
		expectKept(plannerSettingsSchema, settings, [
			"$",
			"$.planTypes[0]",
			"$.planTypes[0].conditions[0]",
			"$.trainingTypeStyles.yoga",
			"$.folders[0]",
		]);
	});

	it("keeps unknown fields of its parts on their own", () => {
		expectKept(trainingTypeStyleSchema, settings.trainingTypeStyles.yoga, [
			"$",
		]);
		expectKept(folderSchema, settings.folders[0], ["$"]);
	});

	it("needs only the etag", () => {
		expect(plannerSettingsSchema.parse({ etag: "0" })).toEqual({
			id: "planner",
			etag: "0",
			updatedAtUtc: "",
			planTypes: [],
			trainingTypeStyles: {},
			folders: [],
		});
		expect(PLANNER_SETTINGS_ID).toBe("planner");
	});

	it("gives a style without an emoji an empty one", () => {
		expect(trainingTypeStyleSchema.parse({ tone: "blue" })).toEqual({
			tone: "blue",
			emoji: "",
		});
	});

	it.each([
		["no etag", { etag: undefined }],
		["a folder without a name", { folders: [{ id: "f-1" }] }],
		["a folder whose id is a number", { folders: [{ id: 1, name: "Wiosna" }] }],
		[
			"a style without a tone",
			{ trainingTypeStyles: { yoga: { emoji: "🧘" } } },
		],
		["styles that are a list", { trainingTypeStyles: [{ tone: "blue" }] }],
		["plan types that are null", { planTypes: null }],
	])("refuses %s", (_what, patch) => {
		expect(accepts(plannerSettingsSchema, { ...settings, ...patch })).toBe(
			false,
		);
	});
});

describe("user", () => {
	const summary = {
		uid: "u-anna",
		email: "anna.kowalska@example.com",
		displayName: "Anna Kowalska",
		emailVerified: true,
		disabled: false,
		providers: ["password", "google.com"],
		createdAtUtc: "2025-01-15T18:20:00.000Z",
		lastSignInAtUtc: "2026-11-10T06:45:00.000Z",
		[UNKNOWN]: "user",
	};
	const account = { ...summary, hasProSubscription: true };
	const badge = {
		badgeId: "B7",
		earnedAtUtc: "2026-03-21T10:00:00.000Z",
		grantId: "g-17",
		[UNKNOWN]: "user badge",
	};
	const completion = {
		workoutId: "W1",
		completedAtUtc: "2026-11-10T06:50:00.000Z",
		[UNKNOWN]: "completion",
	};
	const attempt = {
		challengeId: "C1",
		levelId: "beginner",
		startedAtUtc: "2026-03-02T06:00:00.000Z",
		completedAtUtc: null,
		abortedAtUtc: "2026-03-20T19:00:00.000Z",
		completedDays: 14,
		[UNKNOWN]: "attempt",
	};

	it("keeps unknown fields of a search result and of every row in it", () => {
		expectKept(userSummarySchema, summary, ["$"]);
		expectKept(
			userSearchResultSchema,
			{
				users: [summary, { ...summary, uid: "u-jan", [UNKNOWN]: "second row" }],
				totalMatches: 134,
				truncated: true,
				[UNKNOWN]: "search result",
			},
			["$", "$.users[0]", "$.users[1]"],
		);
	});

	it("keeps unknown fields of an account and of what the user did", () => {
		expectKept(userAccountSchema, account, ["$"]);
		expectKept(userBadgeSchema, badge, ["$"]);
		expectKept(userWorkoutCompletionSchema, completion, ["$"]);
		expectKept(userChallengeAttemptSchema, attempt, ["$"]);
		expectKept(
			userProgressSchema,
			{ workouts: [completion], challenges: [attempt], [UNKNOWN]: "progress" },
			["$", "$.workouts[0]", "$.challenges[0]"],
		);
	});

	it("needs only the uid of an account", () => {
		const bare = {
			uid: "u-nowy",
			email: null,
			displayName: null,
			emailVerified: false,
			disabled: false,
			providers: [],
			createdAtUtc: null,
			lastSignInAtUtc: null,
		};
		expect(userSummarySchema.parse({ uid: "u-nowy" })).toEqual(bare);
		expect(userAccountSchema.parse({ uid: "u-nowy" })).toEqual({
			...bare,
			hasProSubscription: false,
		});
	});

	it("fills in the rest of what the backend may leave out", () => {
		expect(
			userSearchResultSchema.parse({ users: [], totalMatches: 0 }),
		).toEqual({ users: [], totalMatches: 0, truncated: false });
		expect(userBadgeSchema.parse({ badgeId: "B1", earnedAtUtc: NOW })).toEqual({
			badgeId: "B1",
			earnedAtUtc: NOW,
			grantId: null,
		});
		expect(
			userChallengeAttemptSchema.parse({
				challengeId: "C1",
				startedAtUtc: NOW,
			}),
		).toEqual({
			challengeId: "C1",
			startedAtUtc: NOW,
			levelId: null,
			completedAtUtc: null,
			abortedAtUtc: null,
			completedDays: 0,
		});
		expect(userProgressSchema.parse({})).toEqual({
			workouts: [],
			challenges: [],
		});
	});

	it("refuses the wrong shapes", () => {
		expect(accepts(userSummarySchema, { email: "anna@example.com" })).toBe(
			false,
		);
		expect(accepts(userSummarySchema, { ...summary, uid: 17 })).toBe(false);
		expect(
			accepts(userSummarySchema, { ...summary, providers: "password" }),
		).toBe(false);
		expect(accepts(userSummarySchema, { ...summary, disabled: "nie" })).toBe(
			false,
		);
		expect(
			accepts(userAccountSchema, { ...account, hasProSubscription: 1 }),
		).toBe(false);
		expect(accepts(userSearchResultSchema, { users: [summary] })).toBe(false);
		expect(
			accepts(userSearchResultSchema, { users: [{}], totalMatches: 1 }),
		).toBe(false);
		expect(accepts(userBadgeSchema, { badgeId: "B1" })).toBe(false);
		expect(accepts(userWorkoutCompletionSchema, { workoutId: "W1" })).toBe(
			false,
		);
		expect(
			accepts(userChallengeAttemptSchema, { ...attempt, completedDays: "14" }),
		).toBe(false);
		expect(accepts(userProgressSchema, { workouts: [{}] })).toBe(false);
	});
});

describe("configuration", () => {
	const option = (id: string, title: string) => ({
		id,
		title,
		visible: true,
		[UNKNOWN]: `option ${id}`,
	});
	const workoutConfig = {
		equipmentTypes: [option("mata", "Mata"), option("hantle", "Hantle")],
		trainingTypes: [option("yoga", "Joga"), option("strength", "Siłowy")],
		trainingLevels: [option("beginner", "Początkujący")],
		challengeLevels: [option("advanced", "Zaawansowany")],
		challengeCategories: [option("bieganie", "Bieganie")],
		challengeGoals: [option("kondycja", "Lepsza kondycja")],
		difficultyLevels: [option("latwy", "Łatwy")],
		duration: { fromSeconds: 300, toSeconds: 3600, [UNKNOWN]: "duration" },
		[UNKNOWN]: "workout config",
	};
	const internalConfig = {
		draftMessageStates: [
			{ state: "draft", label: "Szkic", [UNKNOWN]: "message state" },
		],
		draftMessageTargetGroups: [
			{
				state: "all",
				label: "Wszyscy",
				requiresTargetGroupValue: null,
				[UNKNOWN]: "target group",
			},
			{
				state: "challengeParticipants",
				label: "Uczestnicy wyzwania",
				requiresTargetGroupValue: "challengeId",
			},
		],
		badgeTypes: [{ value: "normal", label: "Zwykła", [UNKNOWN]: "badge type" }],
		badgeSections: [
			{
				id: "wydarzenia",
				label: "Wydarzenia",
				subsections: [
					{ id: "wiosna-2026", label: "Wiosna 2026", [UNKNOWN]: "subsection" },
				],
				[UNKNOWN]: "section",
			},
		],
		promotedChallengeId: "C1",
		[UNKNOWN]: "internal config",
	};

	it("keeps unknown fields of the workout configuration at every level", () => {
		expectKept(workoutConfigSchema, workoutConfig, [
			"$",
			"$.equipmentTypes[0]",
			"$.equipmentTypes[1]",
			"$.trainingTypes[0]",
			"$.trainingTypes[1]",
			"$.trainingLevels[0]",
			"$.challengeLevels[0]",
			"$.challengeCategories[0]",
			"$.challengeGoals[0]",
			"$.difficultyLevels[0]",
			"$.duration",
		]);
		expectKept(configOptionSchema, option("mata", "Mata"), ["$"]);
	});

	it("keeps unknown fields of the internal configuration at every level", () => {
		expectKept(internalConfigSchema, internalConfig, [
			"$",
			"$.draftMessageStates[0]",
			"$.draftMessageTargetGroups[0]",
			"$.badgeTypes[0]",
			"$.badgeSections[0]",
			"$.badgeSections[0].subsections[0]",
		]);
	});

	it("leaves the visibility of an option out when the backend does", () => {
		expect(configOptionSchema.parse({ id: "mata", title: "Mata" })).toEqual({
			id: "mata",
			title: "Mata",
		});
	});

	it("accepts a panel with no promoted challenge", () => {
		expect(
			internalConfigSchema.parse({
				...internalConfig,
				promotedChallengeId: null,
			}).promotedChallengeId,
		).toBeNull();
	});

	it.each([
		["no equipment list", { equipmentTypes: undefined }],
		["an option without a title", { trainingTypes: [{ id: "yoga" }] }],
		[
			"an option whose visibility is text",
			{
				challengeGoals: [{ id: "kondycja", title: "Kondycja", visible: "tak" }],
			},
		],
		["no duration range", { duration: undefined }],
		[
			"a duration range in text",
			{
				duration: { fromSeconds: "300", toSeconds: "3600" },
			},
		],
	])("refuses a workout configuration with %s", (_what, patch) => {
		expect(accepts(workoutConfigSchema, { ...workoutConfig, ...patch })).toBe(
			false,
		);
	});

	it.each([
		["no promoted challenge field", { promotedChallengeId: undefined }],
		[
			"a target group that does not say whether it needs a value",
			{
				draftMessageTargetGroups: [{ state: "all", label: "Wszyscy" }],
			},
		],
		["a badge type without a label", { badgeTypes: [{ value: "normal" }] }],
		[
			"a section without subsections",
			{
				badgeSections: [{ id: "wydarzenia", label: "Wydarzenia" }],
			},
		],
		["message states that are texts", { draftMessageStates: ["draft"] }],
	])("refuses an internal configuration with %s", (_what, patch) => {
		expect(accepts(internalConfigSchema, { ...internalConfig, ...patch })).toBe(
			false,
		);
	});
});

describe("media", () => {
	const file = {
		path: "workouts/poranna-joga.webp",
		type: "image",
		createdAtUtc: "2026-02-10T07:30:00.000Z",
		sizeBytes: 184_320,
		[UNKNOWN]: "file",
	};
	const upload = {
		requestedRelativePath: "workouts/Poranna Joga.webp",
		relativePath: "workouts/poranna-joga-2.webp",
		type: "image",
		pathSanitized: true,
		renamedToAvoidOverwrite: true,
		[UNKNOWN]: "upload",
	};

	it("keeps unknown fields", () => {
		expectKept(mediaFileSchema, file, ["$"]);
		expectKept(mediaUploadResultSchema, upload, ["$"]);
	});

	it("leaves the size out when the backend does", () => {
		expect(
			mediaFileSchema.parse({
				path: "workouts/wstep.mp3",
				type: "audio",
				createdAtUtc: NOW,
			}),
		).toEqual({ path: "workouts/wstep.mp3", type: "audio", createdAtUtc: NOW });
	});

	it("knows four kinds of file and no other", () => {
		expect(mediaTypeSchema.options).toEqual([
			"image",
			"audio",
			"video",
			"other",
		]);
		expect(accepts(mediaFileSchema, { ...file, type: "pdf" })).toBe(false);
		expect(accepts(mediaUploadResultSchema, { ...upload, type: "pdf" })).toBe(
			false,
		);
	});

	it("refuses the wrong shapes", () => {
		expect(accepts(mediaFileSchema, { ...file, path: undefined })).toBe(false);
		expect(accepts(mediaFileSchema, { ...file, sizeBytes: "184320" })).toBe(
			false,
		);
		expect(accepts(mediaFileSchema, { ...file, createdAtUtc: null })).toBe(
			false,
		);
		expect(
			accepts(mediaUploadResultSchema, { ...upload, relativePath: undefined }),
		).toBe(false);
		expect(
			accepts(mediaUploadResultSchema, { ...upload, pathSanitized: "tak" }),
		).toBe(false);
		expect(
			accepts(mediaUploadResultSchema, {
				...upload,
				renamedToAvoidOverwrite: undefined,
			}),
		).toBe(false);
	});
});
