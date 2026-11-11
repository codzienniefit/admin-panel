import { useState } from "react";
import {
	type CallEntry,
	callLog,
	clearCallLog,
	markCallsSeen,
	severityOf,
} from "@/data/api/callLog";
import { plural } from "@/domain/text";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { JsonView } from "@/ui/JsonView";
import { Switch } from "@/ui/Switch";
import { Tag } from "@/ui/Tag";
import type { Tone } from "@/ui/tones";
import { devMode } from "./devMode";

// The register of backend calls, for whoever is building or debugging the
// panel: every call with what it was given, what came back, its status and
// how long it took. The button in the top bar turns red when a call failed
// and nobody has looked yet.

const KIND_LABELS: Record<NonNullable<CallEntry["kind"]>, string> = {
	validation: "odrzucone przez reguły",
	conflict: "konflikt wersji",
	unauthorized: "brak logowania",
	forbidden: "brak uprawnień",
	notFound: "nie znaleziono",
	server: "błąd serwera",
	network: "brak odpowiedzi",
	unknown: "błąd w panelu",
};

const TONES: Record<ReturnType<typeof severityOf>, Tone> = {
	pending: "grey",
	ok: "green",
	refused: "amber",
	broken: "red",
};

function statusText(entry: CallEntry): string {
	if (entry.state === "pending") return "w toku";
	const code = entry.status === null ? "" : `${entry.status} `;
	return entry.state === "ok"
		? `${code}OK`
		: `${code}${KIND_LABELS[entry.kind ?? "unknown"]}`;
}

const timeFormat = new Intl.DateTimeFormat("pl-PL", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

/** The button in the top bar; nothing when developer mode is off. */
export function CallLogButton() {
	const on = useStore(devMode);
	const { entries, unseenFailures } = useStore(callLog);
	const [open, setOpen] = useState(false);
	if (!on) return null;

	const failed = unseenFailures > 0;
	return (
		<>
			<button
				type="button"
				aria-label={
					failed
						? `Rejestr wywołań: ${plural(unseenFailures, "nieudane", "nieudane", "nieudanych")}`
						: "Rejestr wywołań"
				}
				title="Rejestr wywołań do backendu"
				onClick={() => {
					setOpen(true);
					markCallsSeen();
				}}
				className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border px-2 font-mono text-xs outline-none transition-colors focus-visible:shadow-focus ${
					failed
						? "border-danger bg-danger text-white"
						: "border-line-input text-subtle hover:border-primary hover:text-ink"
				}`}
			>
				<span aria-hidden="true">{"</>"}</span>
				<span className="tabular-nums">
					{failed ? unseenFailures : entries.length}
				</span>
			</button>
			{open && (
				<CallLogDialog
					onClose={() => {
						setOpen(false);
						// What failed while it was open has been seen too.
						markCallsSeen();
					}}
				/>
			)}
		</>
	);
}

function CallLogDialog({ onClose }: { onClose: () => void }) {
	const { entries } = useStore(callLog);
	const [onlyFailed, setOnlyFailed] = useState(false);
	const shown = onlyFailed
		? entries.filter((entry) => entry.state === "failed")
		: entries;
	const failures = entries.filter((entry) => entry.state === "failed").length;

	return (
		<Dialog
			open
			onClose={onClose}
			title="Rejestr wywołań"
			description="Każde zapytanie panelu do backendu od otwarcia strony: parametry, odpowiedź, status i czas. Tylko w pamięci tej karty; znika po odświeżeniu."
			size="lg"
			footer={
				<>
					<Button size="md" onClick={() => clearCallLog()}>
						Wyczyść
					</Button>
					<Button size="md" variant="primary" onClick={onClose}>
						Zamknij
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-muted">
						{plural(entries.length, "wywołanie", "wywołania", "wywołań")}
						{failures > 0 && `, w tym nieudane: ${failures}`}
					</p>
					<Switch
						label="Tylko nieudane"
						checked={onlyFailed}
						onChange={setOnlyFailed}
					/>
				</div>

				{shown.length === 0 ? (
					<EmptyState title="Brak">
						{onlyFailed
							? "Brak nieudanych wywołań."
							: "Brak wywołań od otwarcia strony."}
					</EmptyState>
				) : (
					<ul aria-label="Wywołania" className="flex flex-col gap-1.5">
						{shown.map((entry) => (
							<CallRow key={entry.id} entry={entry} />
						))}
					</ul>
				)}
			</div>
		</Dialog>
	);
}

function CallRow({ entry }: { entry: CallEntry }) {
	const [open, setOpen] = useState(false);
	const severity = severityOf(entry);
	return (
		<li
			data-tone={TONES[severity]}
			className={`rounded-cell border ${
				severity === "ok" || severity === "pending"
					? "border-line"
					: "border-(--tone) bg-(--tone-soft)"
			}`}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-cell px-3 py-2 text-left outline-none focus-visible:shadow-focus"
			>
				<span className="font-mono text-xs text-muted tabular-nums">
					{timeFormat.format(entry.at)}
				</span>
				<span className="min-w-0 flex-1 font-mono text-sm [overflow-wrap:anywhere]">
					{entry.name}
				</span>
				<Tag tone={TONES[severity]}>{statusText(entry)}</Tag>
				<span className="w-16 text-right font-mono text-xs text-muted tabular-nums">
					{entry.durationMs === null ? "…" : `${entry.durationMs} ms`}
				</span>
			</button>
			{open && (
				<div className="grid gap-3 border-line border-t p-3 md:grid-cols-2">
					<section className="flex min-w-0 flex-col gap-1.5">
						<h3 className="text-xs font-semibold">Parametry</h3>
						<JsonView
							value={entry.args}
							label={`Parametry: ${entry.name}`}
							height="h-56"
						/>
					</section>
					<section className="flex min-w-0 flex-col gap-1.5">
						<h3 className="text-xs font-semibold">
							{entry.state === "failed" ? "Błąd" : "Odpowiedź"}
						</h3>
						<JsonView
							// A call with no answer yet, or one that returns nothing.
							value={entry.result ?? null}
							label={`Odpowiedź: ${entry.name}`}
							height="h-56"
						/>
					</section>
				</div>
			)}
		</li>
	);
}
