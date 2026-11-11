import type { ContentStatus } from "@/data/schemas/challenge";
import type { PrepStatus } from "@/data/schemas/planning";
import { TONES, type Tone, toneForId } from "./tones";

// How each enum value is shown: one label and one tone, decided here and
// nowhere else. A component that needs to show a status, a training type or
// a level asks this file, so the same value looks the same on every screen.
//
// Tones are fixed here. Labels for training types and levels come from the
// backend configuration once it has loaded (applyConfigLabels); the built-in
// ones below are only what shows before that, and on the components page.

export interface EnumMeta {
	label: string;
	tone: Tone;
	/** Set for training types that have one in the planner's settings. */
	emoji?: string;
}

export const STATUS_META: Record<ContentStatus, EnumMeta> = {
	draft: { label: "Szkic", tone: "amber" },
	published: { label: "Opublikowane", tone: "green" },
	hidden: { label: "Ukryte", tone: "grey" },
	deleted: { label: "Usunięte", tone: "red" },
};

/** How far the preparation of a variant is; the colours of Patryk's planner. */
export const PREP_TONES: Record<PrepStatus, Tone> = {
	not_started: "red",
	in_progress: "amber",
	ready: "green",
};

// Colours match the defaults in Patryk's planner app.
const TRAINING_TYPES: Record<string, EnumMeta> = {
	strength: { label: "Siłowy", tone: "blue" },
	cardio: { label: "Cardio", tone: "red" },
	stretching: { label: "Rozciąganie", tone: "green" },
	yoga: { label: "Joga", tone: "purple" },
	pilates: { label: "Pilates", tone: "orange" },
	hiit: { label: "HIIT", tone: "pink" },
};

const LEVELS: Record<string, EnumMeta> = {
	beginner: { label: "Początkujący", tone: "teal" },
	intermediate: { label: "Średniozaawansowany", tone: "indigo" },
	advanced: { label: "Zaawansowany", tone: "purple" },
};

const trainingTypeLabels = new Map<string, string>();
const trainingTypeStyles = new Map<string, { tone: Tone; emoji: string }>();

/**
 * Takes training-type colours and emoji from the planner's settings. Called
 * when the panel loads; the settings page reloads the panel after a change,
 * because every screen that shows a training type depends on this.
 */
export function applyTypeStyles(
	styles: Readonly<Record<string, { tone: string; emoji?: string }>>,
): void {
	trainingTypeStyles.clear();
	for (const [id, style] of Object.entries(styles)) {
		if (!(TONES as readonly string[]).includes(style.tone)) continue;
		trainingTypeStyles.set(id, {
			tone: style.tone as Tone,
			emoji: style.emoji ?? "",
		});
	}
}
const levelLabels = new Map<string, string>();

interface LabelSource {
	trainingTypes: ReadonlyArray<{ id: string; title: string }>;
	trainingLevels: ReadonlyArray<{ id: string; title: string }>;
	challengeLevels: ReadonlyArray<{ id: string; title: string }>;
}

/** Takes labels from the backend configuration. Called once it has loaded. */
export function applyConfigLabels(config: LabelSource): void {
	trainingTypeLabels.clear();
	levelLabels.clear();
	for (const type of config.trainingTypes) {
		trainingTypeLabels.set(type.id, type.title);
	}
	for (const level of [...config.trainingLevels, ...config.challengeLevels]) {
		levelLabels.set(level.id, level.title);
	}
}

function meta(
	id: string,
	builtIn: Record<string, EnumMeta>,
	labels: ReadonlyMap<string, string>,
): EnumMeta {
	const known = builtIn[id];
	return {
		// An id nobody knows still shows, as itself, in a stable colour.
		label: labels.get(id) ?? known?.label ?? id,
		tone: known?.tone ?? toneForId(id),
	};
}

export function trainingTypeMeta(id: string): EnumMeta {
	const base = meta(id, TRAINING_TYPES, trainingTypeLabels);
	const style = trainingTypeStyles.get(id);
	return style
		? { ...base, tone: style.tone, emoji: style.emoji || undefined }
		: base;
}

export const levelMeta = (id: string): EnumMeta =>
	meta(id, LEVELS, levelLabels);

export const KNOWN_TRAINING_TYPE_IDS = Object.keys(TRAINING_TYPES);
export const KNOWN_LEVEL_IDS = Object.keys(LEVELS);
