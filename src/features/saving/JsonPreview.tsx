import { useState } from "react";
import { jsonDiff } from "@/domain/jsonDiff";
import { plural } from "@/domain/text";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { JsonView } from "@/ui/JsonView";
import type { MenuAction } from "@/ui/Menu";
import { Notice } from "@/ui/Notice";
import { Segmented } from "@/ui/Segmented";

// "What exactly goes to the backend?", answered the same way for every
// entity: the JSON on the server now, the JSON a save would send, and only
// what differs between the two.

export interface JsonVersions {
	/** The version on the server now; undefined for something not saved yet. */
	before: unknown;
	/** What a save would send. */
	after: unknown;
}

type View = "diff" | "before" | "after";

interface JsonPreviewDialogProps extends JsonVersions {
	/** What it is, in the genitive: "treningu", "wyzwania", "odznaki". */
	of: string;
	onClose: () => void;
}

export function JsonPreviewDialog({
	of,
	before,
	after,
	onClose,
}: JsonPreviewDialogProps) {
	const [view, setView] = useState<View>("diff");
	const isNew = before === undefined;
	const diff = jsonDiff(before, after);

	return (
		<Dialog
			open
			onClose={onClose}
			title={`JSON ${of}`}
			description="Dokładnie to, co jest na serwerze, i to, co zostanie wysłane przy zapisie."
			size="lg"
			footer={
				<Button size="md" onClick={onClose}>
					Zamknij
				</Button>
			}
		>
			<div className="flex flex-col gap-4">
				<Segmented<View>
					label="Która wersja"
					options={[
						{ value: "diff", label: "Różnice" },
						{ value: "before", label: "Przed" },
						{ value: "after", label: "Po" },
					]}
					value={view}
					onChange={setView}
				/>

				{view === "diff" && isNew && (
					<>
						<Notice tone="blue" title="Tego jeszcze nie ma na serwerze">
							Zapis utworzy nowy element. Wszystko poniżej zostanie wysłane;
							identyfikator i wersję nada serwer.
						</Notice>
						<JsonView value={after} label="Nowy JSON" />
					</>
				)}

				{view === "diff" && !isNew && diff.changes.length === 0 && (
					<Notice tone="grey" title="Brak różnic">
						To, co zostałoby wysłane, jest takie samo jak na serwerze.
					</Notice>
				)}

				{view === "diff" && !isNew && diff.changes.length > 0 && (
					<>
						<div>
							<p className="text-sm font-semibold">
								{plural(
									diff.changes.length,
									"zmienione miejsce",
									"zmienione miejsca",
									"zmienionych miejsc",
								)}
							</p>
							<ul
								aria-label="Zmienione właściwości"
								className="mt-1 flex flex-wrap gap-1.5"
							>
								{diff.changes.map((change) => (
									<li
										key={change.path}
										className="rounded-chip bg-hover px-2 py-0.5 font-mono text-xs"
									>
										{change.path}
									</li>
								))}
							</ul>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<section className="flex min-w-0 flex-col gap-1.5">
								<h3 className="text-sm font-semibold">Było</h3>
								<JsonView value={diff.before} label="Zmienione: było" />
							</section>
							<section className="flex min-w-0 flex-col gap-1.5">
								<h3 className="text-sm font-semibold">Będzie</h3>
								<JsonView value={diff.after} label="Zmienione: będzie" />
							</section>
						</div>
						<p className="text-xs text-muted">
							Tylko właściwości, które się różnią. Wariant i dzień są podane po
							to, żeby było wiadomo, czego dotyczy zmiana.
						</p>
					</>
				)}

				{view === "before" && (
					<JsonView
						value={before}
						label="JSON przed zapisem"
						empty="Tego jeszcze nie ma na serwerze."
						height="h-[55vh]"
					/>
				)}

				{view === "after" && (
					<>
						<JsonView value={after} label="JSON po zapisie" height="h-[55vh]" />
						<p className="text-xs text-muted">
							Tak zostanie wysłane. Serwer nada nową wersję (etag) i datę
							zmiany; reszta wróci bez zmian.
						</p>
					</>
				)}
			</div>
		</Dialog>
	);
}

/**
 * The "Podgląd JSON…" entry of an editor's menu, with its dialog. `versions`
 * is asked at the moment of the click, so it sees what is typed right then.
 */
export function useJsonPreview(of: string, versions: () => JsonVersions) {
	const [shown, setShown] = useState<JsonVersions | null>(null);
	const action: MenuAction = {
		label: "Podgląd JSON…",
		onSelect: () => setShown(versions()),
	};
	return {
		action,
		dialog: shown ? (
			<JsonPreviewDialog of={of} {...shown} onClose={() => setShown(null)} />
		) : null,
	};
}
