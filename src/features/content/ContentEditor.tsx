import { useId, useRef, useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import type { ContentBlock } from "@/data/schemas/workout";
import {
	BLOCK_LABELS,
	type BlockType,
	type ContentIssue,
	contentIssues,
	DEFAULT_TITLE_MAX,
	looksLikeJson,
	newBlock,
	parseContentJson,
	textToBlocks,
} from "@/domain/contentBlocks";
import { deepEqual } from "@/domain/rebase";
import { plural } from "@/domain/text";
import { MediaSlot } from "@/features/media/MediaSlot";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { JsonView } from "@/ui/JsonView";
import { Segmented } from "@/ui/Segmented";
import { toast } from "@/ui/toast";
import { blockField as field } from "./blockField";
import { ContentPreview } from "./ContentPreview";
import { PhoneFrame } from "./PhoneFrame";
import { RichTextEditor } from "./RichTextEditor";

// The editor for "fancy content": descriptions of workouts and challenges,
// and message bodies. It is one container that sits inside the form it
// belongs to (ContentField puts it there): no window of its own, and no
// "accept" step, so every change is the form's change at once and the form's
// own save and "unsaved changes" question cover it.
//
// Inside: the blocks, each an open editor, with the buttons that add one;
// a preview of what the app will draw, or of the JSON that will be saved;
// and a list of what is wrong that jumps to the block. Text prepared
// elsewhere (or JSON from the old panel) can be pasted and turned into
// blocks, from a panel that stays folded away until asked for.
//
// Where the container is wide, blocks and preview sit side by side; where it
// is narrow (a dialog, a phone) one of them shows at a time. That is decided
// by the container's own width, not the window's, because the same editor
// lives in a narrow dialog and on a wide page.

/** A block plus an id that exists only while editing (for keys and focus). */
interface Row {
	key: string;
	block: ContentBlock;
}

let nextKey = 0;
const toRows = (blocks: readonly ContentBlock[]): Row[] =>
	blocks.map((block) => ({ key: `row-${nextKey++}`, block }));

interface ContentEditorProps {
	/** Names the editor for screen readers: the field's label, e.g. "Opis". */
	label: string;
	value: readonly ContentBlock[];
	/** Called with the whole list on every change, as it is typed. */
	onChange: (blocks: ContentBlock[]) => void;
	/** Media folder image blocks pick from and upload to. */
	imageFolderId: string;
	/** Id of the container, so the field's label has something to point at. */
	id?: string;
	/**
	 * Nothing can be changed; the preview and the JSON still work. The blocks
	 * stay where they are, locked, so a form that disables its fields for the
	 * moment of saving does not make the editor jump.
	 */
	disabled?: boolean;
}

type Pane = "blocks" | "preview";

const PANES: Array<{ id: Pane; label: string }> = [
	{ id: "blocks", label: "Bloki" },
	{ id: "preview", label: "Podgląd" },
];

/** The preview as the app draws it, or as it is stored. */
type PreviewKind = "look" | "json";

const PREVIEW_KINDS: Array<{ value: PreviewKind; label: string }> = [
	{ value: "look", label: "Wygląd" },
	{ value: "json", label: "JSON" },
];

// One height for both, so the two titles sit on the same line whatever is
// beside them.
const paneHead =
	"h-12 items-center gap-3 border-line border-b px-3 text-sm font-semibold";

export function ContentEditor({
	label,
	value,
	onChange,
	imageFolderId,
	id,
	disabled = false,
}: ContentEditorProps) {
	// The editor owns its rows and reports every change upwards. The rows are
	// not rebuilt from what comes back down: their keys must stay the same
	// while someone types, or every keystroke would remount the block and
	// drop the cursor.
	const [rows, setRowsState] = useState<Row[]>(() => toRows(value));
	const [selectedKey, setSelectedKey] = useState<string | null>(
		() => rows[0]?.key ?? null,
	);
	// The value the rows were last known to match. A different one that also
	// says something else did not come from here (the form was reset, or took
	// a colleague's change): then the rows start again from it.
	const [inStep, setInStep] = useState(value);
	if (value !== inStep) {
		setInStep(value);
		if (
			!deepEqual(
				value,
				rows.map((row) => row.block),
			)
		) {
			const fresh = toRows(value);
			setRowsState(fresh);
			setSelectedKey(fresh[0]?.key ?? null);
		}
	}
	// Read-only content is there to be looked at, so it opens on the preview.
	const [pane, setPane] = useState<Pane>(disabled ? "preview" : "blocks");
	const [source, setSource] = useState("");
	const [titleMax, setTitleMax] = useState(DEFAULT_TITLE_MAX);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [previewKind, setPreviewKind] = useState<PreviewKind>("look");
	const [dragKey, setDragKey] = useState<string | null>(null);
	const [dropAt, setDropAt] = useState<{ key: string; before: boolean } | null>(
		null,
	);
	const elements = useRef(new Map<string, HTMLElement>());
	const sourceBox = useRef<HTMLTextAreaElement>(null);
	const pasteToggleId = useId();
	const pastePanelId = useId();

	const setRows = (next: Row[]) => {
		const reported = next.map((row) => row.block);
		setRowsState(next);
		setInStep(reported);
		onChange(reported);
	};

	const blocks = rows.map((row) => row.block);
	const issues = contentIssues(blocks);
	const issuesByIndex = new Map<number, ContentIssue[]>();
	for (const issue of issues) {
		issuesByIndex.set(issue.index, [
			...(issuesByIndex.get(issue.index) ?? []),
			issue,
		]);
	}
	const errorCount = issues.filter((i) => i.severity === "error").length;
	const warningCount = issues.length - errorCount;

	const focusRow = (key: string) => {
		setSelectedKey(key);
		setPane("blocks");
		// After the row is on screen (it may be newly added or on another pane).
		setTimeout(() => {
			const element = elements.current.get(key);
			element?.scrollIntoView({ block: "center", behavior: "smooth" });
			element
				// Not the hidden file chooser of an image block: it cannot be focused.
				// A text block's field is not an input but an editable element.
				?.querySelector<HTMLElement>(
					"input:not([type='file']), textarea, [contenteditable='true'], button[data-primary]",
				)
				?.focus();
		}, 0);
	};

	const update = (key: string, change: (block: ContentBlock) => ContentBlock) =>
		setRows(
			rows.map((row) =>
				row.key === key ? { ...row, block: change(row.block) } : row,
			),
		);

	const move = (from: number, to: number) => {
		if (to < 0 || to >= rows.length || from === to) return;
		const next = [...rows];
		const [row] = next.splice(from, 1);
		if (!row) return;
		next.splice(to, 0, row);
		setRows(next);
	};

	const add = (type: BlockType) => {
		const row: Row = { key: `row-${nextKey++}`, block: newBlock(type) };
		const selected = rows.findIndex((r) => r.key === selectedKey);
		const at = selected >= 0 ? selected + 1 : rows.length;
		setRows([...rows.slice(0, at), row, ...rows.slice(at)]);
		focusRow(row.key);
	};

	const duplicate = (index: number) => {
		const original = rows[index];
		if (!original) return;
		const row: Row = {
			key: `row-${nextKey++}`,
			block: structuredClone(original.block),
		};
		setRows([...rows.slice(0, index + 1), row, ...rows.slice(index + 1)]);
		focusRow(row.key);
	};

	const remove = (index: number) => {
		const next = rows.filter((_, i) => i !== index);
		setRows(next);
		setSelectedKey(next[Math.min(index, next.length - 1)]?.key ?? null);
	};

	const switchType = (key: string, type: BlockType) =>
		update(key, (block) => ({
			...block,
			type,
			metadata: null,
			// A title cannot carry tags or line breaks.
			content:
				type === "Title"
					? block.content
							.replace(/<[^>]+>/g, "")
							.replace(/\s+/g, " ")
							.trim()
					: block.content,
		}));

	const pickImage = (key: string, path: string) => {
		const image = new Image();
		const apply = (ratio: number) =>
			update(key, (block) => ({
				...block,
				metadata: {
					...block.metadata,
					imageRelativePath: path,
					heightToWidthRatio: ratio,
				},
			}));
		image.onload = () =>
			apply(
				image.naturalWidth > 0
					? Math.round((image.naturalHeight / image.naturalWidth) * 10000) /
							10000
					: 0,
			);
		// Without a measured size the block is flagged, not silently wrong.
		image.onerror = () => apply(0);
		image.src = mediaUrl(path);
	};

	// --- pasted text or JSON -------------------------------------------------
	const asJson = looksLikeJson(source) ? parseContentJson(source) : null;
	const incoming: ContentBlock[] = asJson
		? asJson.ok
			? asJson.blocks
			: []
		: textToBlocks(source, titleMax);
	const incomingTitles = incoming.filter((b) => b.type === "Title").length;

	const applyIncoming = async (mode: "replace" | "append") => {
		if (incoming.length === 0) return;
		if (mode === "replace" && rows.length > 0) {
			const sure = await confirm({
				title: "Zastąpić obecne bloki?",
				description: `Obecna treść (${plural(rows.length, "blok", "bloki", "bloków")}) zostanie zastąpiona wklejoną.`,
				confirmLabel: "Zastąp",
				destructive: true,
			});
			if (!sure) return;
		}
		const added = toRows(incoming);
		const next = mode === "replace" ? added : [...rows, ...added];
		setRows(next);
		setSource("");
		setPasteOpen(false);
		toast({
			title:
				mode === "replace"
					? `Utworzono: ${plural(added.length, "blok", "bloki", "bloków")}`
					: `Dopisano: ${plural(added.length, "blok", "bloki", "bloków")}`,
			tone: "green",
		});
		const target = mode === "replace" ? added[0] : added.at(-1);
		if (target) focusRow(target.key);
	};

	const showPaste = () => {
		setPasteOpen(true);
		// Once the panel is on screen: typing or Ctrl+V is the next thing done.
		setTimeout(() => sourceBox.current?.focus(), 0);
	};

	const hidePaste = () => {
		setPasteOpen(false);
		// The button that hid the panel is gone with it; the keyboard goes back
		// to the one that opens it.
		document.getElementById(pasteToggleId)?.focus();
	};

	const hiddenUnless = (which: Pane) =>
		pane === which ? "" : "hidden @4xl:block";

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would add a legend and its own layout; the group only gives the editor its name
		<div
			id={id}
			role="group"
			aria-label={label}
			// The editor sits inside a form now, and Enter in a one-line input
			// would submit it: a title typed, Enter pressed, the workout saved.
			onKeyDown={(event) => {
				if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
					event.preventDefault();
				}
			}}
			className="@container min-w-0 rounded-control border border-line bg-surface"
		>
			{/* A narrow container shows one pane at a time. */}
			<div className="border-line border-b p-2 @4xl:hidden">
				<Segmented
					label="Część edytora"
					stretch
					options={PANES.map((item) => ({
						value: item.id,
						label: (
							<>
								{item.label}
								{item.id === "blocks" && errorCount > 0 && (
									<span className="ml-1.5 text-danger">({errorCount})</span>
								)}
							</>
						),
					}))}
					value={pane}
					onChange={setPane}
				/>
			</div>

			<div className="grid @4xl:grid-cols-2">
				{/* 1. Blocks */}
				<section
					aria-label="Bloki"
					className={`min-w-0 ${hiddenUnless("blocks")}`}
				>
					<div className={`hidden @4xl:flex ${paneHead}`}>
						Bloki
						<span className="ml-auto text-xs font-normal text-muted">
							zmiany widać od razu w podglądzie
						</span>
					</div>
					{/* One switch locks every control inside, the browser's own way. */}
					<fieldset
						disabled={disabled}
						className="flex min-w-0 flex-col gap-3 p-3"
					>
						{rows.map((row, index) => {
							const rowIssues = issuesByIndex.get(index) ?? [];
							const hasError = rowIssues.some((i) => i.severity === "error");
							const selected = row.key === selectedKey;
							const type = row.block.type;
							const drop = dropAt?.key === row.key ? dropAt : null;
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: selecting a block is a convenience for the mouse; every control inside is reachable by keyboard and selects it on focus
								<div
									key={row.key}
									ref={(element) => {
										if (element) elements.current.set(row.key, element);
										else elements.current.delete(row.key);
									}}
									onFocus={() => setSelectedKey(row.key)}
									onMouseDown={() => setSelectedKey(row.key)}
									onDragOver={(event) => {
										if (!dragKey || dragKey === row.key) return;
										event.preventDefault();
										const box = event.currentTarget.getBoundingClientRect();
										setDropAt({
											key: row.key,
											before: event.clientY < box.top + box.height / 2,
										});
									}}
									onDrop={(event) => {
										if (!dragKey || !drop) return;
										event.preventDefault();
										const from = rows.findIndex((r) => r.key === dragKey);
										let to = drop.before ? index : index + 1;
										if (from < to) to -= 1;
										move(from, to);
										setDragKey(null);
										setDropAt(null);
									}}
									className={`relative flex flex-col gap-2.5 rounded-control border bg-surface p-2.5 ${
										hasError
											? "border-danger"
											: selected
												? "border-primary shadow-focus"
												: "border-line hover:border-line-input"
									} ${dragKey === row.key ? "opacity-40" : ""}`}
								>
									{drop && (
										<span
											aria-hidden="true"
											className={`absolute inset-x-1.5 h-[3px] rounded-full bg-primary ${drop.before ? "-top-[7px]" : "-bottom-[7px]"}`}
										/>
									)}
									<div className="flex items-center gap-2">
										{/* biome-ignore lint/a11y/useSemanticElements: a draggable handle; a real button cannot be dragged in every browser */}
										<span
											role="button"
											tabIndex={disabled ? -1 : 0}
											draggable={!disabled}
											aria-disabled={disabled || undefined}
											aria-label={`Przenieś blok ${index + 1}. Alt i strzałki zmieniają kolejność`}
											onDragStart={(event) => {
												setDragKey(row.key);
												event.dataTransfer.effectAllowed = "move";
												event.dataTransfer.setData("text/plain", row.key);
											}}
											onDragEnd={() => {
												setDragKey(null);
												setDropAt(null);
											}}
											onKeyDown={(event) => {
												if (!event.altKey || disabled) return;
												if (event.key === "ArrowUp") {
													event.preventDefault();
													move(index, index - 1);
												}
												if (event.key === "ArrowDown") {
													event.preventDefault();
													move(index, index + 1);
												}
											}}
											className="cursor-grab rounded-chip px-1 text-base leading-none tracking-[-2px] text-muted select-none hover:text-ink active:cursor-grabbing"
										>
											⋮⋮
										</span>
										{/* The number first: it is what the problems list refers to. */}
										<span className="w-4 text-center text-xs font-semibold text-muted tabular-nums">
											{index + 1}
										</span>
										{type === "Title" || type === "Text" ? (
											<div className="inline-flex overflow-hidden rounded-chip border border-line-input">
												{(["Title", "Text"] as const).map((option) => (
													<button
														key={option}
														type="button"
														aria-pressed={type === option}
														onClick={() => {
															if (type !== option) switchType(row.key, option);
														}}
														className={`px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${type === option ? "bg-primary text-white" : "text-muted hover:bg-bg hover:text-ink"}`}
													>
														{BLOCK_LABELS[option]}
													</button>
												))}
											</div>
										) : (
											<span className="text-[11px] font-semibold tracking-wide text-primary uppercase">
												{BLOCK_LABELS[type as BlockType] ?? type}
											</span>
										)}
										<div className="ml-auto flex gap-0.5">
											{(
												[
													[
														"↑",
														"Przesuń wyżej",
														() => move(index, index - 1),
														index === 0,
													],
													[
														"↓",
														"Przesuń niżej",
														() => move(index, index + 1),
														index === rows.length - 1,
													],
													["⧉", "Duplikuj", () => duplicate(index), false],
													["✕", "Usuń blok", () => remove(index), false],
												] as const
											).map(([glyph, label, action, disabled]) => (
												<button
													key={label}
													type="button"
													title={label}
													aria-label={`${label}: blok ${index + 1}`}
													disabled={disabled}
													onClick={action}
													className={`flex size-7 items-center justify-center rounded-chip text-xs text-subtle hover:bg-bg disabled:opacity-25 ${glyph === "✕" ? "hover:text-danger" : "hover:text-ink"}`}
												>
													{glyph}
												</button>
											))}
										</div>
									</div>

									{type === "Title" && (
										<input
											aria-label={`Tytuł, blok ${index + 1}`}
											placeholder="Wpisz tytuł"
											maxLength={120}
											value={row.block.content}
											onChange={(event) =>
												update(row.key, (block) => ({
													...block,
													content: event.target.value,
												}))
											}
											className={`${field} h-10`}
										/>
									)}

									{type === "Text" && (
										<RichTextEditor
											index={index}
											value={row.block.content}
											onChange={(content) =>
												update(row.key, (block) => ({ ...block, content }))
											}
											disabled={disabled}
										/>
									)}

									{type === "Image" && (
										<MediaSlot
											label={`Obraz, blok ${index + 1}`}
											kind="image"
											folderId={imageFolderId}
											disabled={disabled}
											value={row.block.metadata?.imageRelativePath || null}
											onChange={(path) => {
												if (path) pickImage(row.key, path);
											}}
											thumbnailClassName="h-24 w-36"
											// A block without a picture is an error; the way to
											// drop the picture is to remove the block.
											clearable={false}
											primary
										/>
									)}

									{rowIssues.length > 0 && (
										<ul className="flex flex-col gap-0.5 text-xs">
											{rowIssues.map((issue) => (
												<li
													key={issue.message}
													className={
														issue.severity === "error"
															? "text-danger"
															: "text-(--tone-ink)"
													}
													data-tone="amber"
												>
													{issue.message}
												</li>
											))}
										</ul>
									)}
								</div>
							);
						})}

						{/* How content is made: one block at a time. With no blocks yet
						    this box is also the empty state, so its buttons stand out. */}
						<div
							className={`flex flex-col gap-2 rounded-control border border-line-input border-dashed ${rows.length === 0 ? "p-5" : "p-2.5"}`}
						>
							{rows.length === 0 ? (
								<p className="text-center text-sm text-subtle">
									<b className="block font-semibold text-ink">
										Treść jest pusta
									</b>
									Zacznij od pierwszego bloku: tytułu, tekstu albo obrazu.
								</p>
							) : (
								<span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
									Dodaj blok
								</span>
							)}
							<div className="flex flex-wrap gap-1.5">
								{(["Title", "Text", "Image"] as const).map((type) => (
									<Button
										key={type}
										variant={rows.length === 0 ? "primary" : "secondary"}
										className="min-w-20 flex-1"
										onClick={() => add(type)}
									>
										+ {BLOCK_LABELS[type]}
									</Button>
								))}
							</div>
							<div className={rows.length === 0 ? "text-center" : ""}>
								<Button
									id={pasteToggleId}
									variant="ghost"
									aria-expanded={pasteOpen}
									aria-controls={pasteOpen ? pastePanelId : undefined}
									onClick={() =>
										pasteOpen ? setPasteOpen(false) : showPaste()
									}
								>
									Wklej gotowy tekst…
								</Button>
							</div>
						</div>

						{/* The other way: paste ready text or JSON. Folded until asked for. */}
						{pasteOpen && (
							<section
								id={pastePanelId}
								aria-label="Wklej tekst"
								className="rounded-control border border-line"
							>
								<div className="flex flex-wrap items-center gap-x-3 border-line border-b py-1.5 pr-1.5 pl-3 text-sm font-semibold">
									Wklej tekst
									<span className="text-xs font-normal text-muted">
										zwykły tekst albo JSON, zamienimy go na bloki
									</span>
									<Button
										variant="ghost"
										className="ml-auto"
										onClick={hidePaste}
									>
										Ukryj
									</Button>
								</div>
								<div className="flex flex-col gap-3 p-3">
									<textarea
										ref={sourceBox}
										aria-label="Tekst źródłowy"
										value={source}
										onChange={(event) => setSource(event.target.value)}
										placeholder="Wklej tutaj gotowy tekst. Pusta linia oddziela bloki. Można też wkleić JSON ze starego panelu."
										className={`${field} min-h-40 resize-y py-2 leading-relaxed`}
									/>
									{!asJson && (
										<label className="flex flex-wrap items-center gap-2 text-xs text-subtle">
											Tytuł: linia do
											<input
												type="number"
												min={1}
												max={200}
												value={titleMax}
												onChange={(event) =>
													setTitleMax(
														Math.max(
															1,
															Number.parseInt(event.target.value, 10) || 1,
														),
													)
												}
												style={{ width: "4.5rem" }}
												className={`${field} h-8 text-center`}
											/>
											znaków
										</label>
									)}
									<div className="flex flex-wrap gap-1.5 text-xs text-subtle">
										{asJson && !asJson.ok ? (
											<span role="alert" className="text-danger">
												{asJson.problem}
											</span>
										) : incoming.length === 0 ? (
											<span className="rounded-full border border-line px-2.5 py-0.5">
												nic do zamiany
											</span>
										) : asJson ? (
											<span className="rounded-full border border-line px-2.5 py-0.5">
												JSON:{" "}
												<b className="text-ink">
													{plural(incoming.length, "blok", "bloki", "bloków")}
												</b>
											</span>
										) : (
											<>
												<span className="rounded-full border border-line px-2.5 py-0.5">
													<b className="text-primary">
														{plural(
															incomingTitles,
															"tytuł",
															"tytuły",
															"tytułów",
														)}
													</b>
												</span>
												<span className="rounded-full border border-line px-2.5 py-0.5">
													<b className="text-ink">
														{plural(
															incoming.length - incomingTitles,
															"tekst",
															"teksty",
															"tekstów",
														)}
													</b>
												</span>
											</>
										)}
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											variant="primary"
											className="flex-1"
											disabled={incoming.length === 0}
											onClick={() => void applyIncoming("replace")}
										>
											Utwórz bloki
										</Button>
										<Button
											className="flex-1"
											disabled={incoming.length === 0}
											onClick={() => void applyIncoming("append")}
										>
											Dopisz na końcu
										</Button>
									</div>
									<p className="text-xs text-muted">
										Bloki oddzielasz pustą linią. Jednolinijkowy akapit do
										podanej liczby znaków staje się tytułem, pozostałe blokami
										tekstu. Pojedynczy enter zostaje w tekście, a tagi{" "}
										<code>&lt;b&gt;</code> i <code>&lt;a&gt;</code> zostają.
										JSON skopiowany ze starego panelu (albo z podglądu „JSON”)
										też można wkleić: rozpoznamy go sami.
									</p>
								</div>
							</section>
						)}
						{rows.length > 0 && (
							<p className="text-xs text-muted">
								Kolejność: strzałki ↑ ↓ przy bloku, przeciągnięcie za uchwyt ⋮⋮
								albo Alt + strzałki na uchwycie. Nowy blok trafia pod
								zaznaczony.
							</p>
						)}
					</fieldset>
				</section>

				{/* 2. Preview */}
				<section
					aria-label="Podgląd"
					className={`min-w-0 border-line @4xl:border-l ${hiddenUnless("preview")}`}
				>
					{/* Beside a long list of blocks the preview stays in view, below
					    the panel's top bar when the page itself is what scrolls. */}
					<div className="@4xl:sticky @4xl:top-16">
						<div className={`flex ${paneHead}`}>
							Podgląd
							<Segmented
								label="Rodzaj podglądu"
								className="ml-auto font-normal"
								options={PREVIEW_KINDS}
								value={previewKind}
								onChange={setPreviewKind}
							/>
						</div>
						<div className="flex flex-col gap-2 p-3">
							{previewKind === "look" ? (
								<>
									<PhoneFrame>
										<ContentPreview blocks={blocks} />
									</PhoneFrame>
									<p className="text-center text-xs text-muted">
										widok poglądowy
									</p>
								</>
							) : (
								<>
									{/* The very list handed to onChange: what the form saves. */}
									<JsonView
										value={blocks}
										label="Treść jako JSON"
										height="h-72"
									/>
									<p className="text-xs text-muted">
										Dokładnie w tej postaci treść zapisze się razem z
										formularzem.
									</p>
								</>
							)}
						</div>
					</div>
				</section>
			</div>

			{/* Validation */}
			<section aria-label="Walidacja" className="border-line border-t">
				<div className="p-3 text-sm">
					{issues.length === 0 ? (
						<p className="font-semibold text-(--tone-ink)" data-tone="green">
							{rows.length === 0
								? "Brak treści"
								: `Wszystkie bloki są poprawne (${rows.length})`}
						</p>
					) : (
						<>
							<p className="mb-2 font-semibold">
								{errorCount > 0 && (
									<span className="text-danger">Błędy: {errorCount}</span>
								)}
								{errorCount > 0 && warningCount > 0 && " · "}
								{warningCount > 0 && (
									<span className="text-(--tone-ink)" data-tone="amber">
										Uwagi: {warningCount}
									</span>
								)}
							</p>
							<ul className="flex flex-col gap-1.5">
								{issues.map((issue) => {
									const row = rows[issue.index];
									if (!row) return null;
									return (
										<li
											key={`${row.key}-${issue.message}`}
											className="flex flex-wrap items-baseline gap-2"
										>
											<button
												type="button"
												onClick={() => focusRow(row.key)}
												className={`shrink-0 rounded-chip border px-1.5 py-0.5 text-[11px] font-semibold hover:bg-bg ${issue.severity === "error" ? "border-danger text-danger" : "border-line-input text-subtle"}`}
											>
												{BLOCK_LABELS[row.block.type as BlockType] ??
													row.block.type}{" "}
												· {issue.index + 1}
											</button>
											<span className="min-w-0 flex-1">{issue.message}</span>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</div>
			</section>
		</div>
	);
}
