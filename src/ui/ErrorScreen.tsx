import { useState } from "react";
import { Button } from "./Button";

interface ErrorScreenProps {
	error: unknown;
	/** Tries to render the failed part again without leaving the page. */
	onRetry?: () => void;
}

function technicalDetails(error: unknown): string {
	const lines = [
		`Czas: ${new Date().toISOString()}`,
		`Adres: ${window.location.href}`,
	];
	if (error instanceof Error) {
		lines.push(`Błąd: ${error.name}: ${error.message}`);
		if (error.stack) lines.push("", error.stack);
	} else {
		lines.push(`Błąd: ${String(error)}`);
	}
	return lines.join("\n");
}

/**
 * What a user sees when a screen fails to render. Calm wording first; the raw
 * error is one click away, in small print, for whoever has to debug it.
 */
export function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
	const [copied, setCopied] = useState(false);
	const details = technicalDetails(error);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(details);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="mx-auto max-w-xl py-10">
			<div
				data-tone="amber"
				role="alert"
				className="rounded-card border border-(--tone) bg-(--tone-soft) p-6"
			>
				<h1 className="text-xl font-semibold text-(--tone-ink)">
					Coś poszło nie tak
				</h1>
				<p className="mt-2 text-sm text-subtle">
					Ten widok nie mógł się wyświetlić. To błąd po naszej stronie, a
					zapisane dane są bezpieczne. Spróbuj ponownie; jeśli to nie pomoże,
					odśwież stronę.
				</p>
				<div className="mt-4 flex flex-wrap gap-2">
					{onRetry && (
						<Button variant="primary" size="md" onClick={onRetry}>
							Spróbuj ponownie
						</Button>
					)}
					<Button size="md" onClick={() => window.location.reload()}>
						Odśwież stronę
					</Button>
				</div>
			</div>

			<details className="mt-3 px-1 text-xs text-muted">
				<summary className="cursor-pointer select-none py-1 hover:text-subtle">
					Szczegóły techniczne
				</summary>
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface p-3 font-mono text-[11px] leading-relaxed text-subtle">
					{details}
				</pre>
				<Button variant="ghost" className="mt-2" onClick={copy}>
					{copied ? "Skopiowano" : "Skopiuj szczegóły"}
				</Button>
			</details>
		</div>
	);
}
