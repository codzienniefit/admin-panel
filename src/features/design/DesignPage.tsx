import { type ReactNode, useState } from "react";
import type { SaveStatus } from "@/data/collections/saver";
import {
	blankChallenge,
	blankPath,
	type Challenge,
	type ContentStatus,
} from "@/data/schemas/challenge";
import {
	blankWorkout,
	type ContentBlock,
	type Workout,
} from "@/data/schemas/workout";
import type { DaySlot } from "@/domain/schedule";
import { ChallengeCard } from "@/features/challenges/ChallengeCard";
import { ContentField } from "@/features/content/ContentField";
import { DayCell } from "@/features/spike/DayCell";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { DateTimeField } from "@/ui/DateTimeField";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorScreen } from "@/ui/ErrorScreen";
import {
	KNOWN_LEVEL_IDS,
	KNOWN_TRAINING_TYPE_IDS,
	levelMeta,
	STATUS_META,
	trainingTypeMeta,
} from "@/ui/enums";
import { TextAreaField, TextField } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { MultiSelect } from "@/ui/MultiSelect";
import { Notice } from "@/ui/Notice";
import { SaveStatusText } from "@/ui/SaveStatusText";
import { Select, type SelectOption } from "@/ui/Select";
import { Skeleton } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { Switch } from "@/ui/Switch";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import { toast } from "@/ui/toast";
import { TONES } from "@/ui/tones";
import { WorkoutChip } from "@/ui/WorkoutChip";

// Every shared component in every state, on one page. A change to a
// component is checked here first, on desktop and phone width, before it is
// looked at inside a real screen. Uses its own sample data; nothing here
// reads or writes a collection.

const SURFACES: Array<[string, string]> = [
	["bg", "bg-bg"],
	["surface", "bg-surface"],
	["surface-alt", "bg-surface-alt"],
	["hover", "bg-hover"],
	["line", "bg-line"],
	["line-input", "bg-line-input"],
	["muted", "bg-muted"],
	["subtle", "bg-subtle"],
	["ink", "bg-ink"],
	["primary", "bg-primary"],
	["success", "bg-success"],
	["warning", "bg-warning"],
	["danger", "bg-danger"],
];

const STATUSES = Object.keys(STATUS_META) as ContentStatus[];

const sampleWorkouts: Workout[] = [
	["W1", "Poranna mobilność bioder", 15, ["stretching"]],
	["W2", "Siła całego ciała z hantlami", 35, ["strength"]],
	["W3", "Cardio bez skakania", 25, ["cardio"]],
	["W5", "Joga na dobry sen", 30, ["yoga", "stretching"]],
	["W6", "Interwały HIIT", 22, ["hiit", "cardio"]],
	["W9", "Pilates dla początkujących", 32, ["pilates"]],
].map(([id, title, durationMinutes, trainingTypeIds]) => ({
	...blankWorkout("2026-11-10T09:00:00.000Z"),
	id: id as string,
	etag: "1",
	title: title as string,
	status: "published" as const,
	durationMinutes: durationMinutes as number,
	trainingTypeIds: trainingTypeIds as string[],
	updatedAtUtc: "2026-11-10T09:00:00.000Z",
}));
const workoutById = new Map(sampleWorkouts.map((w) => [w.id, w]));

const sampleChallenges: Challenge[] = STATUSES.map((status, i) => ({
	...blankChallenge("2026-11-10T09:00:00.000Z"),
	id: `S${i}`,
	etag: "1",
	title:
		i === 1
			? "Bardzo długi tytuł wyzwania, który musi się zawinąć do drugiej linii"
			: "Wiosenny start",
	status,
	lengthDays: [14, 7, 28, 56][i] ?? 7,
	updatedAtUtc: "2026-11-10T09:00:00.000Z",
	paths: KNOWN_LEVEL_IDS.slice(0, (i % 3) + 1).map((levelId) =>
		blankPath(levelId, levelId, 7),
	),
}));

const SAVE_STATES: SaveStatus[] = [
	{ phase: "idle" },
	{ phase: "dirty" },
	{ phase: "saving" },
	{
		phase: "saved",
		at: Date.UTC(2026, 10, 10, 11, 41),
		mergedWithOthers: false,
	},
	{
		phase: "saved",
		at: Date.UTC(2026, 10, 10, 11, 41),
		mergedWithOthers: true,
	},
	{ phase: "error", message: "Serwer nie odpowiada" },
	{ phase: "conflict" },
];

const workoutOptions: SelectOption[] = sampleWorkouts.map((w) => ({
	value: w.id,
	label: w.title,
	hint: `${w.durationMinutes} min`,
	tone: trainingTypeMeta(w.trainingTypeIds[0] ?? "").tone,
}));

const manyOptions: SelectOption[] = Array.from({ length: 60 }, (_, i) => ({
	value: `opt-${i}`,
	label: `Trening numer ${i + 1}`,
	hint: `${10 + (i % 6) * 5} min`,
	tone: TONES[i % TONES.length],
}));

const levelOptions: SelectOption[] = KNOWN_LEVEL_IDS.map((id) => ({
	value: id,
	...levelMeta(id),
}));

const sampleContent: ContentBlock[] = [
	{ type: "Title", content: "Co Cię dzisiaj czeka", metadata: null },
	{
		type: "Text",
		content:
			"Krótki, spokojny start dnia. Skupimy się na <b>biodrach i kręgosłupie</b>, bez skoków.\nZabierz matę i butelkę wody.",
		metadata: null,
	},
	{
		type: "Image",
		content: "",
		metadata: {
			imageRelativePath: "workouts/poranna-mobilnosc-bioder-w1.webp",
			heightToWidthRatio: 0.6667,
		},
	},
	{ type: "Title", content: "Sprzęt", metadata: null },
	{
		type: "Text",
		content:
			'Mata i opcjonalnie poduszka pod kolana [AUDIO]. Więcej w <a href="https://codzienniefitapp.com/faq">FAQ</a>. <b>Nowy plan 🎧</b>',
		metadata: null,
	},
];

const challengeColumns: Column<Challenge>[] = [
	{ key: "title", header: "Nazwa", primary: true, cell: (c) => c.title },
	{
		key: "status",
		header: "Status",
		cell: (c) => <StatusBadge status={c.status} />,
	},
	{
		key: "levels",
		header: "Poziomy",
		cell: (c) => (
			<span className="flex flex-wrap gap-1">
				{c.paths.map((path) => {
					const meta = levelMeta(path.levelId);
					return (
						<Tag key={path.pathId} tone={meta.tone}>
							{meta.label}
						</Tag>
					);
				})}
			</span>
		),
	},
	{ key: "days", header: "Dni", align: "end", cell: (c) => c.lengthDays },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-card border border-line bg-surface p-4 md:p-5">
			<h2 className="mb-4 text-lg font-semibold">{title}</h2>
			{children}
		</section>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-2 border-line border-t py-3 first:border-t-0 first:pt-0 last:pb-0 md:flex-row md:items-center">
			<div className="w-44 shrink-0 text-xs text-muted">{label}</div>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				{children}
			</div>
		</div>
	);
}

function Bomb(): ReactNode {
	throw new Error("Przykładowy błąd wywołany na stronie komponentów");
}

export function DesignPage() {
	const [workout, setWorkout] = useState<string | null>(null);
	const [level, setLevel] = useState<string | null>("beginner");
	const [many, setMany] = useState<string | null>(null);
	const [selected, setSelected] = useState<DaySlot | null>(null);
	const [exploded, setExploded] = useState(false);
	const [name, setName] = useState("Wiosenny start");
	const [hidden, setHidden] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [content, setContent] = useState<ContentBlock[]>(sampleContent);
	const [types, setTypes] = useState<string[]>(["strength", "stretching"]);
	const [when, setWhen] = useState<string | null>("2026-11-10T12:00:00.000Z");
	const [answer, setAnswer] = useState<string | null>(null);

	if (exploded) return <Bomb />;

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-4">
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">Komponenty</h1>
				<p className="mt-1 text-sm text-muted">
					Wszystkie wspólne elementy panelu we wszystkich stanach. Zmiany w
					wyglądzie sprawdzamy najpierw tutaj.
				</p>
			</header>

			<Section title="Kolory podstawowe">
				<div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
					{SURFACES.map(([name, className]) => (
						<div key={name}>
							<div
								className={`h-12 rounded-control border border-line ${className}`}
							/>
							<div className="mt-1 text-xs text-muted">{name}</div>
						</div>
					))}
				</div>
			</Section>

			<Section title="Tony">
				<p className="mb-3 text-sm text-muted">
					Jedna rodzina koloru na jedno znaczenie. Każdy ton ma kolor pełny,
					jasne tło i ciemny tekst.
				</p>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
					{TONES.map((tone) => (
						<div
							key={tone}
							data-tone={tone}
							className="overflow-hidden rounded-control border border-line"
						>
							<div className="h-8 bg-(--tone)" />
							<div className="bg-(--tone-soft) px-2 py-1.5 text-xs font-semibold text-(--tone-ink)">
								{tone}
							</div>
						</div>
					))}
				</div>
			</Section>

			<Section title="Znaczniki i kategorie">
				<Row label="Status">
					{STATUSES.map((status) => (
						<StatusBadge key={status} status={status} />
					))}
				</Row>
				<Row label="Typ treningu">
					{KNOWN_TRAINING_TYPE_IDS.map((id) => {
						const meta = trainingTypeMeta(id);
						return (
							<Tag key={id} tone={meta.tone}>
								{meta.label}
							</Tag>
						);
					})}
				</Row>
				<Row label="Typ treningu, kropka">
					{KNOWN_TRAINING_TYPE_IDS.map((id) => {
						const meta = trainingTypeMeta(id);
						return (
							<Tag key={id} tone={meta.tone} variant="dot">
								{meta.label}
							</Tag>
						);
					})}
				</Row>
				<Row label="Poziom">
					{KNOWN_LEVEL_IDS.map((id) => {
						const meta = levelMeta(id);
						return (
							<Tag key={id} tone={meta.tone}>
								{meta.label}
							</Tag>
						);
					})}
				</Row>
				<Row label="Nieznana wartość">
					{["boks", "taniec", "nordic-walking"].map((id) => {
						const meta = trainingTypeMeta(id);
						return (
							<Tag key={id} tone={meta.tone}>
								{meta.label}
							</Tag>
						);
					})}
					<span className="text-xs text-muted">
						kolor przydzielany stale na podstawie identyfikatora
					</span>
				</Row>
			</Section>

			<Section title="Typografia">
				<div className="flex flex-col gap-2">
					<div className="text-3xl font-semibold tracking-tight">
						Tytuł strony
					</div>
					<div className="text-2xl font-semibold tracking-tight">
						Tytuł widoku
					</div>
					<div className="text-lg font-semibold">Tytuł sekcji</div>
					<div>Tekst podstawowy, 15 px, waga 500.</div>
					<div className="text-sm text-subtle">Tekst pomocniczy, 14 px.</div>
					<div className="text-xs text-muted">Opis i podpis, 12 px.</div>
				</div>
			</Section>

			<Section title="Przyciski">
				{(["primary", "secondary", "ghost", "danger"] as const).map(
					(variant) => (
						<Row key={variant} label={variant}>
							<Button variant={variant} size="md">
								Zapisz zmiany
							</Button>
							<Button variant={variant}>Mały</Button>
							<Button variant={variant} size="md" disabled>
								Niedostępny
							</Button>
						</Row>
					),
				)}
			</Section>

			<Section title="Lista wyboru">
				<p className="mb-3 text-sm text-muted">
					Jedna lista w całym panelu: po kliknięciu pokazuje wszystkie opcje, a
					wpisywanie je filtruje (także bez polskich znaków).
				</p>
				<Row label="Pusta">
					<Select
						label="Trening"
						options={workoutOptions}
						value={workout}
						onChange={setWorkout}
						placeholder="Wybierz trening"
						className="w-64"
					/>
				</Row>
				<Row label="Z wybraną wartością">
					<Select
						label="Poziom"
						options={levelOptions}
						value={level}
						onChange={setLevel}
						className="w-64"
					/>
				</Row>
				<Row label="Dużo opcji (60)">
					<Select
						label="Długa lista"
						options={manyOptions}
						value={many}
						onChange={setMany}
						placeholder="Przewiń albo wpisz numer"
						className="w-64"
					/>
				</Row>
				<Row label="Mała">
					<Select
						label="Poziom, mała"
						options={levelOptions}
						value={level}
						onChange={setLevel}
						size="sm"
						className="w-48"
					/>
				</Row>
				<Row label="Cicha (akcja w komórce)">
					<Select
						label="Dodaj trening"
						options={workoutOptions}
						value={null}
						onChange={() => undefined}
						placeholder="+ Dodaj"
						variant="quiet"
						size="sm"
						className="w-40"
					/>
				</Row>
				<Row label="Z opcją niedostępną">
					<Select
						label="Środowisko"
						options={[
							{
								value: "test",
								label: "Test",
								hint: "dane przykładowe",
								tone: "amber",
							},
							{
								value: "production",
								label: "Produkcja",
								hint: "wkrótce",
								tone: "green",
								disabled: true,
							},
						]}
						value="test"
						onChange={() => undefined}
						className="w-48"
					/>
				</Row>
				<Row label="Bez opcji">
					<Select
						label="Pusta lista"
						options={[]}
						value={null}
						onChange={() => undefined}
						emptyText="Brak treningów do dodania"
						className="w-64"
					/>
				</Row>
				<Row label="Wyłączona">
					<Select
						label="Wyłączona"
						options={levelOptions}
						value={level}
						onChange={setLevel}
						disabled
						className="w-64"
					/>
				</Row>
			</Section>

			<Section title="Trening w dniu">
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<WorkoutChip
						title="Poranna mobilność bioder"
						durationMinutes={15}
						trainingTypeIds={["stretching"]}
						onSelect={() => undefined}
						onRemove={() => undefined}
					/>
					<WorkoutChip
						title="Interwały HIIT"
						durationMinutes={22}
						trainingTypeIds={["hiit", "cardio"]}
						selected
						onSelect={() => undefined}
						onRemove={() => undefined}
					/>
					<WorkoutChip
						title="Bardzo długa nazwa treningu, która zajmuje więcej niż dwie linie w wąskiej komórce"
						durationMinutes={45}
						trainingTypeIds={["strength", "stretching", "yoga"]}
						onSelect={() => undefined}
						onRemove={() => undefined}
					/>
					<WorkoutChip title="Bez typu i czasu" />
				</div>
			</Section>

			<Section title="Dzień w planie">
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{(
						[
							[1, ["W1"]],
							[2, []],
							[3, ["W2", "W5", "W6"]],
							[4, ["W3"]],
						] as Array<[number, string[]]>
					).map(([dayIndex, workoutIds]) => (
						<DayCell
							key={dayIndex}
							pathId="sample"
							dayIndex={dayIndex}
							workoutIds={workoutIds}
							workoutById={workoutById}
							allWorkouts={sampleWorkouts}
							selected={selected}
							onSelect={setSelected}
							onEdit={() => setSelected(null)}
						/>
					))}
				</div>
				<p className="mt-3 text-xs text-muted">
					Kliknij trening, żeby zobaczyć stan „cel przeniesienia” w pozostałych
					dniach.
				</p>
			</Section>

			<Section title="Karta wyzwania">
				<div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
					{sampleChallenges.map((challenge) => (
						<ChallengeCard key={challenge.id} challenge={challenge} />
					))}
				</div>
			</Section>

			<Section title="Stan zapisu">
				{SAVE_STATES.map((status, i) => (
					<Row
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
						key={i}
						label={
							status.phase === "saved" && status.mergedWithOthers
								? "saved + merge"
								: status.phase
						}
					>
						<SaveStatusText status={status} />
					</Row>
				))}
			</Section>

			<Section title="Komunikaty">
				<div className="flex flex-col gap-3">
					<Notice
						tone="amber"
						title="Ktoś inny zmienił to samo w międzyczasie"
						actions={
							<>
								<Button variant="primary" size="md">
									Nadpisz moimi zmianami
								</Button>
								<Button size="md">Zostaw wersję z serwera</Button>
							</>
						}
					>
						Widzisz teraz wersję z serwera. Twoje zmiany nie przepadły. Różnice:
						dzień 4.
					</Notice>
					<Notice
						tone="red"
						title="Nie udało się zapisać zmian"
						actions={
							<>
								<Button variant="primary" size="md">
									Spróbuj ponownie
								</Button>
								<Button size="md">Odrzuć moje zmiany</Button>
							</>
						}
					>
						Serwer nie odpowiada. Twoje zmiany nie przepadły.
					</Notice>
					<Notice tone="amber" title="Ten trening jest już w tym dniu" />
					<Notice tone="blue" title="Informacja">
						Spokojny komunikat bez akcji.
					</Notice>
					<Notice tone="green" title="Opublikowano">
						Wyzwanie jest widoczne w aplikacji.
					</Notice>
				</div>
			</Section>

			<Section title="Formularz">
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<TextField
						label="Nazwa"
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
						error={
							name.trim().length < 4
								? "Nazwa musi mieć co najmniej 4 znaki"
								: ""
						}
						hint="Widoczna w aplikacji."
					/>
					<TextField
						label="Komentarz"
						placeholder="Niewidoczny w aplikacji"
						hint="Tylko dla zespołu."
					/>
					<TextField
						label="Z błędem"
						defaultValue="abc"
						error="Nazwa jest wymagana"
					/>
					<TextField label="Wyłączone" defaultValue="C12" disabled />
					<TextAreaField
						label="Opis"
						placeholder="Kilka zdań o wyzwaniu"
						hint="Pole rozciąga się w pionie."
					/>
					<div className="flex flex-col gap-4">
						<Switch
							label="Ukryj"
							hint="Ukryte wyzwanie nie pojawia się na listach w aplikacji."
							checked={hidden}
							onChange={setHidden}
						/>
						<Switch
							label="Niedostępny przełącznik"
							checked
							onChange={() => undefined}
							disabled
						/>
					</div>
				</div>
			</Section>

			<Section title="Wybór wielu wartości i data">
				<Row label="Kilka wartości">
					<div className="w-80 max-w-full">
						<MultiSelect
							label="Typ treningu"
							options={KNOWN_TRAINING_TYPE_IDS.map((id) => ({
								value: id,
								...trainingTypeMeta(id),
							}))}
							value={types}
							onChange={setTypes}
						/>
					</div>
				</Row>
				<Row label="Lista z czyszczeniem">
					<Select
						label="Poziom"
						placeholder="Poziom: wszystkie"
						options={levelOptions}
						value={level}
						onChange={setLevel}
						clearable
						className="w-64"
					/>
				</Row>
				<Row label="Data i godzina">
					<div className="w-72 max-w-full">
						<DateTimeField
							label="Data premiery"
							value={when}
							onChange={setWhen}
							hint="Edytowana w czasie lokalnym, zapisywana w UTC."
						/>
					</div>
				</Row>
			</Section>

			<Section title="Treść blokowa">
				<p className="mb-3 text-sm text-muted">
					Opisy treningów i wyzwań oraz treść wiadomości. Podgląd pokazuje to,
					co wyświetli aplikacja; przykład ma celowo jeden błąd i jedną uwagę.
				</p>
				<ContentField
					label="Opis"
					editorTitle="Opis (przykład)"
					value={content}
					onChange={setContent}
					imageFolderId="workouts"
				/>
			</Section>

			<Section title="Okna dialogowe">
				<p className="mb-3 text-sm text-muted">
					Na komputerze okno jest wyśrodkowane, na telefonie wysuwa się od dołu.
					Pytania o potwierdzenie zastępują systemowe okienka przeglądarki.
				</p>
				<Row label="Okno z treścią">
					<Button onClick={() => setDialogOpen(true)}>Otwórz okno</Button>
				</Row>
				<Row label="Potwierdzenie">
					<Button
						onClick={async () =>
							setAnswer(
								(await confirm({
									title: "Opublikować wyzwanie?",
									description:
										"Wyzwanie stanie się widoczne w aplikacji dla wszystkich.",
									confirmLabel: "Opublikuj",
								}))
									? "potwierdzono"
									: "anulowano",
							)
						}
					>
						Zapytaj
					</Button>
					<Button
						onClick={async () =>
							setAnswer(
								(await confirm({
									title: "Usunąć trening?",
									description:
										"Trening trafi do kosza. Można go stamtąd przywrócić.",
									confirmLabel: "Usuń",
									destructive: true,
								}))
									? "potwierdzono"
									: "anulowano",
							)
						}
					>
						Zapytaj o usunięcie
					</Button>
					{answer && (
						<span className="text-xs text-muted">Odpowiedź: {answer}</span>
					)}
				</Row>
				<Dialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					title="Nowy wariant"
					description="Wariant to osobna ścieżka wyzwania dla jednego poziomu."
					footer={
						<>
							<Button size="md" onClick={() => setDialogOpen(false)}>
								Anuluj
							</Button>
							<Button
								size="md"
								variant="primary"
								onClick={() => setDialogOpen(false)}
							>
								Dodaj wariant
							</Button>
						</>
					}
				>
					<div className="flex flex-col gap-4">
						<TextField label="Nazwa wariantu" placeholder="np. Spokojny" />
						<div>
							<div className="mb-1.5 text-sm font-semibold">Poziom</div>
							<Select
								label="Poziom"
								options={levelOptions}
								value={level}
								onChange={setLevel}
								className="w-full"
							/>
						</div>
					</div>
				</Dialog>
			</Section>

			<Section title="Menu i powiadomienia">
				<Row label="Menu akcji">
					<Menu
						label="Akcje wyzwania"
						triggerClassName="rounded-control border border-line-input bg-surface px-3 py-1.5 text-sm hover:border-primary"
						trigger="Akcje ▾"
						align="start"
						actions={[
							{
								label: "Duplikuj",
								onSelect: () => toast({ title: "Zduplikowano" }),
							},
							{ label: "Ukryj", onSelect: () => toast({ title: "Ukryto" }) },
							{
								label: "Niedostępna akcja",
								onSelect: () => undefined,
								disabled: true,
							},
							{
								label: "Usuń",
								destructive: true,
								onSelect: () => toast({ title: "Usunięto", tone: "red" }),
							},
						]}
					/>
				</Row>
				<Row label="Powiadomienia">
					<Button
						onClick={() => toast({ title: "Trening zapisany", tone: "green" })}
					>
						Sukces
					</Button>
					<Button
						onClick={() =>
							toast({
								title: "Połączono ze zmianami innej osoby",
								description: "Ktoś zmienił tytuł, gdy edytowałaś plan.",
								tone: "blue",
							})
						}
					>
						Informacja
					</Button>
					<Button
						onClick={() =>
							toast({
								title: "Nie udało się zapisać",
								description: "Serwer nie odpowiada. Spróbuj ponownie.",
								tone: "red",
							})
						}
					>
						Błąd
					</Button>
				</Row>
			</Section>

			<Section title="Tabela">
				<p className="mb-3 text-sm text-muted">
					Na telefonie każdy wiersz staje się kartą, a pierwsza kolumna jej
					tytułem.
				</p>
				<Table
					columns={challengeColumns}
					rows={sampleChallenges}
					rowKey={(challenge) => challenge.id}
					onRowClick={(challenge) => toast({ title: challenge.title })}
				/>
			</Section>

			<Section title="Karta i pusty stan">
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<Card>
						<h3 className="font-semibold">Karta</h3>
						<p className="mt-1 text-sm text-muted">
							Biała powierzchnia z ramką, na której leży treść.
						</p>
					</Card>
					<EmptyState
						title="Brak treningów"
						action={<Button variant="primary">Stwórz nowy trening</Button>}
					>
						Katalog jest pusty. Dodaj pierwszy trening, żeby móc układać plany.
					</EmptyState>
				</div>
			</Section>

			<Section title="Ładowanie">
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					<div className="rounded-card border border-line p-4">
						<Skeleton className="h-6 w-3/4" />
						<Skeleton className="mt-4 h-5 w-24" />
						<Skeleton className="mt-4 h-4 w-1/2" />
					</div>
					<div className="flex flex-col gap-2">
						<Skeleton className="h-9" />
						<Skeleton className="h-9" />
						<Skeleton className="h-9" />
					</div>
					<Skeleton className="h-40" />
				</div>
			</Section>

			<Section title="Błąd widoku">
				<p className="mb-3 text-sm text-muted">
					Tak wygląda każdy nieoczekiwany błąd: spokojny komunikat, a szczegóły
					techniczne małym drukiem po rozwinięciu.
				</p>
				<div className="rounded-control border border-line border-dashed">
					<ErrorScreen
						error={new Error("Przykładowy błąd do podglądu")}
						onRetry={() => undefined}
					/>
				</div>
				<Button className="mt-3" onClick={() => setExploded(true)}>
					Wywołaj prawdziwy błąd na tej stronie
				</Button>
			</Section>
		</div>
	);
}
