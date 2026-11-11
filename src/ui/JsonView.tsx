import { copyText } from "@/lib/clipboard";
import { Button } from "./Button";
import { toast } from "./toast";

interface JsonViewProps {
	/** Anything that can be written as JSON; `undefined` shows the empty text. */
	value: unknown;
	/** What it is, for screen readers and the copy message: "Treść jako JSON". */
	label: string;
	/** Shown instead of the code when there is no value. */
	empty?: string;
	/** Tailwind height class of the box. */
	height?: string;
}

/** JSON exactly as it is sent, two-space indented. */
export const formatJson = (value: unknown): string =>
	JSON.stringify(value, null, 2) ?? "";

/**
 * Read-only JSON with a copy button: the one way the panel shows "what goes
 * to the backend". Text only, never HTML.
 */
export function JsonView({
	value,
	label,
	empty = "Brak danych",
	height = "h-72",
}: JsonViewProps) {
	if (value === undefined) {
		return <p className="text-sm text-muted">{empty}</p>;
	}
	const text = formatJson(value);
	const copy = async () => {
		const copied = await copyText(text);
		toast(
			copied
				? { title: "Skopiowano JSON", tone: "green" }
				: { title: "Nie udało się skopiować", tone: "red" },
		);
	};
	return (
		<div className="flex min-w-0 flex-col gap-2">
			{/* A read-only text area: it has a name, scrolls, takes the keyboard
			    and lets the text be selected, with no extra wiring. */}
			<textarea
				readOnly
				aria-label={label}
				value={text}
				spellCheck={false}
				className={`${height} w-full resize-y rounded-cell border border-line bg-surface-alt p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-primary focus:shadow-focus`}
			/>
			<div>
				<Button onClick={() => void copy()}>Kopiuj JSON</Button>
			</div>
		</div>
	);
}
