import { useState } from "react";
import { errorMessage } from "@/data/api/errors";
import { lastAppCachePurge, purgeAppCache } from "@/data/collections/appCache";
import { formatDateTime } from "@/domain/dates";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { Notice } from "@/ui/Notice";
import { attempt, whileBusy } from "@/ui/tasks";

/**
 * "Wyczyść cache backendu": asks the CDN in front of the app's catalogue to
 * drop its copy. It changes no data, so it works in Produkcja too, where
 * everything else is read-only (capabilities.ts, the Worker's
 * OPEN_FOR_WRITING).
 */
export function AppCacheSettings() {
	const last = useStore(lastAppCachePurge);
	const [busy, setBusy] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);

	const purge = async () => {
		const sure = await confirm({
			title: "Wyczyścić cache backendu?",
			description:
				"Aplikacja od razu pobierze najnowsze treści. Dane się nie zmienią; przez chwilę aplikacja może ładować się wolniej.",
			confirmLabel: "Wyczyść cache",
		});
		if (!sure) return;
		setRefused(null);
		const done = await whileBusy(setBusy, () => attempt(purgeAppCache));
		if (!done.ok) {
			setRefused(
				errorMessage(done.error, "Nie udało się wyczyścić cache backendu."),
			);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<Card className="flex flex-col gap-3">
				<div>
					<h2 className="text-lg font-semibold">Pamięć podręczna backendu</h2>
					<p className="text-sm text-subtle">
						Odpowiedzi backendu idą do aplikacji przez Cloudflare, który trzyma
						ich kopię. Po wyczyszczeniu aplikacja od razu dostaje najnowsze
						treści z backendu, zamiast czekać, aż ta kopia wygaśnie. Backend
						robi to też sam po każdym zapisie w panelu i w Retoolu.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variant="primary"
						size="md"
						disabled={busy}
						onClick={() => void purge()}
					>
						{busy ? "Czyszczenie…" : "Wyczyść cache backendu"}
					</Button>
					<p role="status" className="text-sm text-muted">
						{busy
							? "Czyszczenie cache backendu…"
							: last
								? `Ostatnio wyczyszczono: ${formatDateTime(last.purgedAtUtc)}`
								: null}
					</p>
				</div>
				{last?.simulated && !busy && (
					<p className="text-sm text-muted">
						W środowisku Test nie ma Cloudflare, więc nic nie zostało
						wyczyszczone: to tylko próba.
					</p>
				)}
			</Card>
			{refused && (
				<Notice tone="red" role="alert" title="Nie udało się wyczyścić cache">
					{refused}
				</Notice>
			)}
		</div>
	);
}
