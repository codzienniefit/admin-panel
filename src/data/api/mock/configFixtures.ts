import type { InternalConfig, WorkoutConfig } from "@/data/schemas/config";

// Sample configuration in the shape of the backend's two config endpoints.
// Ids match the sample workouts and challenges in fixtures.ts.

const visible = (id: string, title: string) => ({ id, title, visible: true });

export const workoutConfigFixture: WorkoutConfig = {
	equipmentTypes: [
		visible("noeq", "Bez sprzętu"),
		visible("mat", "Mata"),
		visible("dumbbells", "Hantle"),
		visible("band", "Guma oporowa"),
		visible("chair", "Krzesło"),
	],
	trainingTypes: [
		visible("strength", "Siłowy"),
		visible("cardio", "Cardio"),
		visible("stretching", "Rozciąganie"),
		visible("yoga", "Joga"),
		visible("pilates", "Pilates"),
		visible("hiit", "HIIT"),
	],
	trainingLevels: [
		visible("beginner", "Początkujący"),
		visible("intermediate", "Średniozaawansowany"),
		visible("advanced", "Zaawansowany"),
	],
	challengeLevels: [
		visible("beginner", "Początkujący"),
		visible("intermediate", "Średniozaawansowany"),
		visible("advanced", "Zaawansowany"),
	],
	challengeCategories: [
		visible("main", "Plan główny"),
		visible("supplementary", "Plan uzupełniający"),
		visible("archived", "Archiwalne"),
	],
	challengeGoals: [
		visible("strength", "Siła"),
		visible("condition", "Kondycja"),
		visible("mobility", "Mobilność"),
		visible("weight", "Redukcja"),
		visible("calm", "Wyciszenie"),
	],
	difficultyLevels: [
		visible("easy", "Łatwy"),
		visible("medium", "Średni"),
		visible("hard", "Trudny"),
	],
	duration: { fromSeconds: 600, toSeconds: 5400 },
};

export const internalConfigFixture: InternalConfig = {
	draftMessageStates: [
		{ state: "draft", label: "Robocza" },
		{ state: "sent", label: "Wysłana" },
		{ state: "archived", label: "Zarchiwizowana" },
	],
	draftMessageTargetGroups: [
		{ state: "all", label: "Wszyscy", requiresTargetGroupValue: null },
		{ state: "subscribers", label: "Pro", requiresTargetGroupValue: null },
		{
			state: "nonSubscribers",
			label: "Darmowi",
			requiresTargetGroupValue: null,
		},
	],
	badgeTypes: [
		{ value: "normal", label: "Trening/Wyzwanie" },
		{ value: "milestone", label: "Powtórzenia" },
		{ value: "manual", label: "Ręczne" },
		{ value: "perfections", label: "Ukończone na 100%" },
	],
	badgeSections: [
		{
			id: "challenges",
			label: "Wyzwania",
			subsections: [{ id: "completed", label: "Ukończone" }],
		},
	],
	promotedChallengeId: "C2",
};
