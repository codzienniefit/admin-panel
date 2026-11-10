import type { SaveStatus } from "@/data/collections/saver";
import type { Tone } from "./tones";

function describe(status: SaveStatus | undefined): {
	text: string;
	tone: Tone;
} {
	switch (status?.phase) {
		case "dirty":
			return { text: "Niezapisane zmiany", tone: "amber" };
		case "saving":
			return { text: "Zapisywanie…", tone: "blue" };
		case "saved": {
			const time = new Date(status.at).toLocaleTimeString("pl-PL");
			return {
				text: status.mergedWithOthers
					? `Zapisano ${time} · połączono ze zmianami innej osoby`
					: `Zapisano ${time}`,
				tone: "green",
			};
		}
		case "error":
			return { text: "Błąd zapisu", tone: "red" };
		case "conflict":
			return { text: "Konflikt zmian", tone: "red" };
		default:
			return { text: "Brak zmian", tone: "grey" };
	}
}

/** Where a document stands: unsaved, saving, saved at a time, or stopped. */
export function SaveStatusText({ status }: { status: SaveStatus | undefined }) {
	const { text, tone } = describe(status);
	return (
		<span
			role="status"
			data-tone={tone}
			className="inline-flex items-center gap-1.5 text-sm text-(--tone-ink)"
		>
			<span
				className={`size-2 shrink-0 rounded-full bg-(--tone) ${status?.phase === "saving" ? "animate-pulse" : ""}`}
			/>
			{text}
		</span>
	);
}
