import type { ApiIssue } from "@/data/api/errors";
import type { WorkoutConfig } from "@/data/schemas/config";
import type { NewWorkout } from "@/data/schemas/workout";
import { contentErrors } from "./contentBlocks";

// What makes a workout acceptable. One set of rules, used by the form before
// it submits and by the mock when it saves, so they cannot disagree.
//
// A draft may be incomplete: only what would make it unusable is an error.
// Publishing (or hiding, which keeps it one click from published) needs the
// full set. See docs/PLAN.md §6.7.

export const TITLE_MIN = 4;

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
	context: { badgeIds?: ReadonlySet<string> } = {},
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
	const min = Math.round(config.duration.fromSeconds / 60);
	const max = Math.round(config.duration.toSeconds / 60);
	if (workout.durationMinutes < min || workout.durationMinutes > max) {
		add("durationMinutes", `Czas musi być między ${min} a ${max} minut`);
	}
	return issues;
}
