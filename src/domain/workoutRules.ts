import type { ApiIssue } from "@/data/api/errors";
import type { ContentStatus } from "@/data/schemas/common";
import type { WorkoutConfig } from "@/data/schemas/config";
import type { NewWorkout } from "@/data/schemas/workout";
import { contentErrors } from "./contentBlocks";
import { deepEqual } from "./rebase";

// What makes a workout acceptable. One set of rules, used by the form before
// it submits and by the mock when it saves, so they cannot disagree.
//
// A draft may be incomplete: only what would make it unusable is an error.
// Publishing (or hiding, which keeps it one click from published) needs the
// full set. See docs/PLAN.md §6.7.

export const TITLE_MIN = 4;
/**
 * How long a workout may be, in whole minutes. Not the range in the
 * configuration (`duration`): that one is what the app's filter by length
 * offers, and a workout outside it is still a workout.
 */
export const DURATION_MIN = 1;
export const DURATION_MAX = 600;

/** The backend's words for MEDIA_REQUIRED, the same here. */
export const MEDIA_REQUIRED =
	"Dodaj film albo nagranie, żeby opublikować trening";

export interface WorkoutContext {
	/** Badges that can be awarded ("normal" ones). */
	badgeIds?: ReadonlySet<string>;
	/**
	 * The stored status, when the save changes nothing but the status (see
	 * `statusChangeFrom`). Taking a published workout down to hidden is
	 * allowed without a film or a recording, as the backend's status route
	 * allows it.
	 */
	statusChangeFrom?: ContentStatus;
}

/** Fields the server sets on every save; they do not make a save an edit. */
const SERVER_FIELDS = new Set(["etag", "updatedAtUtc", "status"]);

/**
 * The stored status when `incoming` differs from `stored` only in its status
 * (what the backend's status route does), otherwise undefined.
 */
export function statusChangeFrom(
	stored: NewWorkout | null | undefined,
	incoming: NewWorkout,
): ContentStatus | undefined {
	if (!stored) return undefined;
	const before = stored as Record<string, unknown>;
	const after = incoming as Record<string, unknown>;
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of keys) {
		// A collection row's own bookkeeping ($key, $origin…) is not data.
		if (SERVER_FIELDS.has(key) || key.startsWith("$")) continue;
		if (!deepEqual(before[key], after[key])) return undefined;
	}
	return stored.status;
}

const isHttpUrl = (value: string) => {
	try {
		const { protocol } = new URL(value);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
};

export function workoutIssues(
	workout: NewWorkout,
	config: WorkoutConfig,
	context: WorkoutContext = {},
): ApiIssue[] {
	const issues: ApiIssue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });
	const title = workout.title.trim();

	if (!title) add("title", "Nazwa jest wymagana");
	if (workout.audioRelativePath && workout.videoUrl) {
		add(
			"videoUrl",
			"Trening może mieć albo film, albo plik audio, nie oba naraz",
		);
	}
	if (workout.videoUrl && !isHttpUrl(workout.videoUrl)) {
		add("videoUrl", "Link musi zaczynać się od https://");
	}

	const known = (list: ReadonlyArray<{ id: string }>) =>
		new Set(list.map((item) => item.id));
	const unknownTypes = workout.trainingTypeIds.filter(
		(id) => !known(config.trainingTypes).has(id),
	);
	if (unknownTypes.length) {
		add("trainingTypeIds", `Nieznany typ treningu: ${unknownTypes.join(", ")}`);
	}
	const unknownEquipment = workout.equipmentIds.filter(
		(id) => !known(config.equipmentTypes).has(id),
	);
	if (unknownEquipment.length) {
		add("equipmentIds", `Nieznany sprzęt: ${unknownEquipment.join(", ")}`);
	}
	if (workout.levelId && !known(config.trainingLevels).has(workout.levelId)) {
		add("levelId", `Nieznany poziom: ${workout.levelId}`);
	}
	if (
		workout.badgeId &&
		context.badgeIds &&
		!context.badgeIds.has(workout.badgeId)
	) {
		add(
			"badgeId",
			"Ta odznaka nie istnieje albo nie jest typu „Trening/Wyzwanie”",
		);
	}

	// A draft may be incomplete, a film or a recording included.
	if (workout.status === "draft" || workout.status === "deleted") return issues;

	// Complete content, required from "hidden" up.
	if (title && title.length < TITLE_MIN) {
		add("title", `Nazwa musi mieć co najmniej ${TITLE_MIN} znaki`);
	}
	if (!workout.levelId) add("levelId", "Wybierz poziom");
	if (workout.trainingTypeIds.length === 0) {
		add("trainingTypeIds", "Wybierz przynajmniej jeden typ treningu");
	}
	if (!workout.imageRelativePath) {
		add("imageRelativePath", "Wybierz miniaturkę");
	}
	const broken = contentErrors(workout.descriptionFancyContent).length;
	if (broken > 0) {
		add(
			"descriptionFancyContent",
			`Opis ma błędy (${broken}), przez które źle wyświetli się w aplikacji. Otwórz edytor treści`,
		);
	}
	if (!Number.isInteger(workout.durationMinutes)) {
		add("durationMinutes", "Czas trwania musi być podany w pełnych minutach");
	} else if (
		workout.durationMinutes < DURATION_MIN ||
		workout.durationMinutes > DURATION_MAX
	) {
		add(
			"durationMinutes",
			`Czas musi być między ${DURATION_MIN} a ${DURATION_MAX} minut`,
		);
	}
	// Published or hidden needs a film or a recording; a path made only of
	// spaces is neither.
	const hasVideo = (workout.videoUrl ?? "").trim() !== "";
	const hasAudio = (workout.audioRelativePath ?? "").trim() !== "";
	const takingDown =
		workout.status === "hidden" && context.statusChangeFrom === "published";
	if (!hasVideo && !hasAudio && !takingDown) {
		add("videoUrl", MEDIA_REQUIRED);
	}
	return issues;
}
