// The colour families defined in src/styles/app.css.
export const TONES = [
	"blue",
	"red",
	"green",
	"purple",
	"orange",
	"pink",
	"amber",
	"teal",
	"indigo",
	"grey",
] as const;

export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
	blue: "Niebieski",
	red: "Czerwony",
	green: "Zielony",
	purple: "Fioletowy",
	orange: "Pomarańczowy",
	pink: "Różowy",
	amber: "Bursztynowy",
	teal: "Morski",
	indigo: "Indygo",
	grey: "Szary",
};

const ASSIGNABLE: readonly Tone[] = TONES.filter((tone) => tone !== "grey");

/**
 * A stable tone for an id nobody assigned a colour to (a training type added
 * in the backend config, a folder, a tag). The same id always gets the same
 * tone.
 */
export function toneForId(id: string): Tone {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}
	return ASSIGNABLE[Math.abs(hash) % ASSIGNABLE.length] ?? "grey";
}
