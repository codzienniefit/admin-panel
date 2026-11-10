import type { ApiIssue } from "@/data/api/errors";
import type { ContentStatus, NewChallenge } from "@/data/schemas/challenge";
import type { WorkoutConfig } from "@/data/schemas/config";
import { contentErrors } from "./contentBlocks";

// What makes a challenge acceptable. One set of rules, used by the form before
// it submits and by the mock when it saves. They follow the backend's
// validateAdminChallenge (same conditions, same wording where it has any),
// plus the checks docs/BACKEND-SCOPE.md B2.6 says it is missing.
//
// A draft may be incomplete. Rules that keep the data coherent apply always;
// rules about completeness apply from "hidden" up.

export const TITLE_MIN = 4;

export type ChallengeKind =
	| "challenge"
	| "main"
	| "supplementary"
	| "archived"
	| "plan";

/** A challenge has a premiere date; everything else is a plan of some kind. */
export function challengeKind(challenge: {
	liveAtUtc: string | null;
	categoryId: string | null;
}): ChallengeKind {
	if (challenge.liveAtUtc) return "challenge";
	if (
		challenge.categoryId === "main" ||
		challenge.categoryId === "supplementary" ||
		challenge.categoryId === "archived"
	) {
		return challenge.categoryId;
	}
	return "plan";
}

export const KIND_LABELS: Record<ChallengeKind, string> = {
	challenge: "Wyzwanie",
	main: "Plan główny",
	supplementary: "Plan uzupełniający",
	archived: "Archiwalne",
	plan: "Plan",
};

export interface ChallengeContext {
	/** Status of every workout, by id. */
	workoutStatus: ReadonlyMap<string, ContentStatus>;
	/** Badges that can be awarded ("normal" ones). */
	badgeIds?: ReadonlySet<string>;
	/** Ids of the other challenges. */
	challengeIds?: ReadonlySet<string>;
	/** This challenge's own id, when it has one. */
	ownId?: string;
	promotedChallengeId?: string | null;
}

export function challengeIssues(
	challenge: NewChallenge,
	config: WorkoutConfig,
	context: ChallengeContext,
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });
	const known = (list: ReadonlyArray<{ id: string }>) =>
		new Set(list.map((item) => item.id));
	const unknownIn = (ids: readonly string[], set: ReadonlySet<string>) =>
		ids.filter((id) => !set.has(id));
	const title = challenge.title.trim();
	const complete =
		challenge.status === "published" || challenge.status === "hidden";

	// --- always ---------------------------------------------------------------
	if (!title) add("title", "Nazwa jest wymagana");

	if (
		challenge.categoryId &&
		!known(config.challengeCategories).has(challenge.categoryId)
	) {
		add("categoryId", `Nieznana categoryId: ${challenge.categoryId}`);
	}
	const badGoals = unknownIn(challenge.goalsIds, known(config.challengeGoals));
	if (badGoals.length) {
		add(
			"goalsIds",
			`Lista goalsIds zawiera nieznane wartości: ${badGoals.join(", ")}`,
		);
	}
	const badDifficulty = unknownIn(
		challenge.difficultyLevelsIds,
		known(config.difficultyLevels),
	);
	if (badDifficulty.length) {
		add(
			"difficultyLevelsIds",
			`Lista difficultyLevelsIds zawiera nieznane wartości: ${badDifficulty.join(", ")}`,
		);
	}

	const visible = challenge.visibleDaysUpFront;
	if (
		visible !== null &&
		(!Number.isInteger(visible) || visible < 0 || visible > 100)
	) {
		add(
			"visibleDaysUpFront",
			"Liczba widocznych dni musi być liczbą całkowitą od 0 do 100 albo pusta",
		);
	}

	// Paid access: each id only makes sense together with the one before it.
	const unlocks = challenge.unlockedByEntitlementIds;
	const discounts = challenge.discountedForEntitlementIds;
	if (challenge.offeringId && unlocks.length === 0) {
		add(
			"unlockedByEntitlementIds",
			"Offering wymaga podania entitlementu, który odblokowuje wyzwanie: zakup musi coś odblokowywać",
		);
	}
	if (challenge.offeringDiscountedId && !challenge.offeringId) {
		add(
			"offeringId",
			"Przeceniony offering wymaga podania offeringu w pełnej cenie",
		);
	}
	if (discounts.length > 0 && !challenge.offeringDiscountedId) {
		add(
			"offeringDiscountedId",
			"Lista entitlementów ze zniżką wymaga podania przecenionego offeringu",
		);
	}
	if (discounts.length > 0 && unlocks.length === 0) {
		add(
			"unlockedByEntitlementIds",
			"Zniżka wymaga entitlementu odblokowującego: wyzwanie bez niego jest darmowe",
		);
	}
	const both = discounts.filter((id) => unlocks.includes(id));
	if (both.length) {
		add(
			"discountedForEntitlementIds",
			`Te entitlementy dają już darmowy dostęp, więc cena ze zniżką nigdy się nie pokaże: ${both.join(", ")}`,
		);
	}

	const next = challenge.recommendedNext.map((item) => item.id);
	if (context.ownId && next.includes(context.ownId)) {
		add("recommendedNext", "Wyzwanie nie może polecać samego siebie");
	}
	if (context.challengeIds) {
		const missing = next.filter(
			(id) => id !== context.ownId && !context.challengeIds?.has(id),
		);
		if (missing.length) {
			add(
				"recommendedNext",
				`Polecane dalej zawiera nieznane wyzwania: ${missing.join(", ")}`,
			);
		}
	}

	for (const field of ["badgeId", "perfectCompletionBadgeId"] as const) {
		const id = challenge[field];
		if (id && context.badgeIds && !context.badgeIds.has(id)) {
			add(
				field,
				"Ta odznaka nie istnieje albo nie jest typu „Trening/Wyzwanie”",
			);
		}
	}

	const levels = known(config.challengeLevels);
	// A variant is named by what people see, not by the id of its level.
	const variantName = (levelId: string) =>
		`„${config.challengeLevels.find((level) => level.id === levelId)?.title ?? levelId}”`;
	const seenLevels = new Set<string>();
	for (const path of challenge.paths) {
		const where = `paths.${path.pathId}`;
		const variant = variantName(path.levelId);
		if (!levels.has(path.levelId)) {
			add(where, `Nieznany levelId: ${path.levelId}`);
		}
		if (seenLevels.has(path.levelId)) {
			add(where, `Dwa warianty mają ten sam poziom: ${variant}`);
		}
		seenLevels.add(path.levelId);

		const badPathDifficulty = unknownIn(
			path.difficultyLevelsIds,
			known(config.difficultyLevels),
		);
		if (badPathDifficulty.length) {
			add(
				where,
				`Wariant ${variant} ma nieznane poziomy trudności: ${badPathDifficulty.join(", ")}`,
			);
		}

		path.days.forEach((day, position) => {
			if (day.dayIndex !== position + 1) {
				add(
					where,
					`Wariant ${variant}: nieprawidłowy numer dnia ${day.dayIndex}`,
				);
			}
			if (new Set(day.workoutIds).size !== day.workoutIds.length) {
				add(
					where,
					`Wariant ${variant}, dzień ${day.dayIndex}: ten sam trening jest dodany dwa razy`,
				);
			}
			for (const id of day.workoutIds) {
				if (!context.workoutStatus.has(id)) {
					add(where, `Nieznany workoutId: ${id}`);
				}
			}
		});
	}

	if (
		context.ownId &&
		context.promotedChallengeId === context.ownId &&
		challenge.status !== "published"
	) {
		add(
			"status",
			"To wyzwanie jest promowane. Najpierw wybierz inne promowane wyzwanie",
		);
	}

	if (!complete) return issues;

	// --- from "hidden" up: complete content -----------------------------------
	if (title && title.length < TITLE_MIN) {
		add("title", `Nazwa musi mieć co najmniej ${TITLE_MIN} znaki`);
	}
	if ((challenge.subtitle ?? "").trim().length < TITLE_MIN) {
		add("subtitle", `Podtytuł musi mieć co najmniej ${TITLE_MIN} znaki`);
	}
	if (!challenge.imageRelativePath) {
		add("imageRelativePath", "Wybierz miniaturkę");
	}
	const broken = contentErrors(challenge.descriptionFancyContent).length;
	if (broken > 0) {
		add(
			"descriptionFancyContent",
			`Opis ma błędy (${broken}), przez które źle wyświetli się w aplikacji. Otwórz edytor treści`,
		);
	}
	if (challenge.paths.length === 0) {
		add("paths", "Dodaj przynajmniej jeden wariant do wyzwania");
	}

	for (const path of challenge.paths) {
		const where = `paths.${path.pathId}`;
		const variant = variantName(path.levelId);
		if (path.days.length === 0) {
			add(where, `Wariant ${variant} nie ma żadnego dnia`);
			continue;
		}
		if (path.days.length !== challenge.lengthDays) {
			add(
				where,
				`Wariant ${variant} ma ${path.days.length} dni, a wyzwanie trwa ${challenge.lengthDays}`,
			);
		}
		const training = path.days.filter((d) => d.workoutIds.length > 0).length;
		if (training === 0) {
			add(where, `Wariant ${variant} nie ma żadnego treningu`);
		}
		if (
			path.minimumDaysToComplete < 0 ||
			path.minimumDaysToComplete > training
		) {
			add(
				where,
				`Wariant ${variant}: minimalna liczba dni do ukończenia to ${path.minimumDaysToComplete}, a dni z treningami jest ${training}`,
			);
		}
		if (!(path.frequency >= 1)) {
			add(
				where,
				`Wariant ${variant}: treningów na tydzień musi być co najmniej 1`,
			);
		}
		const unfinished = new Set<string>();
		for (const day of path.days) {
			for (const id of day.workoutIds) {
				const status = context.workoutStatus.get(id);
				if (status === "draft" || status === "deleted") unfinished.add(id);
			}
		}
		if (unfinished.size) {
			add(
				where,
				`Wariant ${variant} zawiera treningi, które są szkicem albo w koszu: ${[...unfinished].join(", ")}`,
			);
		}
	}
	return issues;
}

/**
 * Days of a variant brought to a new challenge length: empty days appended,
 * or days cut from the end.
 */
export function resizeDays<
	T extends { dayIndex: number; workoutIds: string[] },
>(
	days: readonly T[],
	lengthDays: number,
): Array<T | { dayIndex: number; workoutIds: string[] }> {
	const kept = days.slice(0, lengthDays);
	const added = Array.from(
		{ length: Math.max(0, lengthDays - kept.length) },
		(_, i) => ({ dayIndex: kept.length + i + 1, workoutIds: [] }),
	);
	return [...kept, ...added];
}

/** How many scheduled workouts shortening to `lengthDays` would drop. */
export function workoutsLostByResize(
	paths: ReadonlyArray<{
		days: ReadonlyArray<{ workoutIds: readonly string[] }>;
	}>,
	lengthDays: number,
): number {
	return paths.reduce(
		(total, path) =>
			total +
			path.days
				.slice(lengthDays)
				.reduce((sum, day) => sum + day.workoutIds.length, 0),
		0,
	);
}
