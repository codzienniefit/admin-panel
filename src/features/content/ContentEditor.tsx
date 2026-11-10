import { useRef, useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import type { ContentBlock } from "@/data/schemas/workout";
import {
	BLOCK_LABELS,
	type BlockType,
	blocksToJson,
	type ContentIssue,
	contentIssues,
	DEFAULT_TITLE_MAX,
	looksLikeJson,
	newBlock,
	parseContentJson,
	textToBlocks,
} from "@/domain/contentBlocks";
import { plural } from "@/domain/text";
import { MediaPicker } from "@/features/media/MediaPicker";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { toast } from "@/ui/toast";
import { ContentPreview } from "./ContentPreview";

// The editor for "fancy content": descriptions of workouts and challenges,
// and message bodies. Every block is an open editor; a preview shows what the
// app will draw; a panel lists what is wrong and jumps to it. Text prepared
// elsewhere can be pasted and turned into blocks, and so can the JSON the old
// panel used.

/** A block plus an id that exists only while editing (for keys and focus). */
interface Row {
	key: string;
	block: ContentBlock;
}

let nextKey = 0;
const toRows = (blocks: readonly ContentBlock[]): Row[] =>
	blocks.map((block) => ({ key: `row-${nextKey++}`, block }));

interface ContentEditorProps {
	value: readonly ContentBlock[];
	onChange: (blocks: ContentBlock[]) => void;
	/** Media folder the image picker opens in. */
	imageFolderId: string;
}

type Pane = "blocks" | "preview" | "source";

const PANES: Array<{ id: Pane; label: string }> = [
	{ id: "blocks", label: "Bloki" },
	{ id: "preview", label: "Podgląd" },
	{ id: "source", label: "Wklej" },
];

const panel = "min-w-0 rounded-card border border-line bg-surface";
const panelHead =
	"flex items-center gap-3 border-line border-b px-4 py-3 text-sm font-semibold";
const field =
	"w-full rounded-control border border-transparent bg-bg px-3 text-sm outline-none transition-colors placeholder:text-muted hover:border-line-input focus:border-primary focus:bg-surface focus:shadow-focus any-pointer-coarse:text-base";

export function ContentEditor({
	value,
	onChange,
	imageFolderId,
}: ContentEditorProps) {
	// Rows are created once from the incoming blocks; after that the editor
	// owns them and reports every change upwards.
	const [rows, setRowsState] = useState<Row[]>(() => toRows(value));
	const [selectedKey, setSelectedKey] = useState<string | null>(
		() => rows[0]?.key ?? null,
	);
	const [pane, setPane] = useState<Pane>("blocks");
	const [source, setSource] = useState("");
	const [titleMax, setTitleMax] = useState(DEFAULT_TITLE_MAX);
	const [pickerFor, setPickerFor] = useState<string | null>(null);
	const [dragKey, setDragKey] = useState<string | null>(null);
	const [dropAt, setDropAt] = useState<{ key: string; before: boolean } | null>(
		null,
	);
	const elements = useRef(new Map<string, HTMLElement>());

	const setRows = (next: Row[]) => {
		setRowsState(next);
		onChange(next.map((row) => row.block));
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
				?.querySelector<HTMLElement>("input, textarea, button[data-primary]")
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

	const copyJson = async () => {
		try {
			await navigator.clipboard.writeText(blocksToJson(blocks));
			toast({ title: "Skopiowano JSON", tone: "green" });
		} catch {
			toast({ title: "Nie udało się skopiować", tone: "red" });
		}
	};

	const hiddenUnless = (id: Pane) => (pane === id ? "" : "hidden lg:block");

	return (
		<div className="flex flex-col gap-4">
			{/* Narrow screens show one pane at a time. */}
			<div className="flex gap-1 rounded-control bg-hover p-1 lg:hidden">
				{PANES.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-pressed={pane === item.id}
						onClick={() => setPane(item.id)}
						className={`flex-1 rounded-chip px-3 py-1.5 text-sm ${pane === item.id ? "bg-surface font-semibold shadow-sm" : "text-subtle"}`}
					>
						{item.label}
						{item.id === "blocks" && errorCount > 0 && (
							<span className="ml-1.5 text-danger">({errorCount})</span>
						)}
					</button>
				))}
			</div>

			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)_400px]">
				{/* 1. Paste text or JSON */}
				<section
					aria-label="Wklej tekst"
					className={`${panel} ${hiddenUnless("source")} lg:col-span-2 2xl:col-span-1`}
				>
					<div className={panelHead}>
						Wklej tekst
						<span className="ml-auto text-xs font-normal text-muted">
							zamienimy go na bloki
						</span>
					</div>
					<div className="flex flex-col gap-3 p-4">
						<textarea
							aria-label="Tekst źródłowy"
							value={source}
							onChange={(event) => setSource(event.target.value)}
							placeholder="Wklej tutaj gotowy tekst. Pusta linia oddziela bloki. Można też wkleić JSON ze starego panelu."
							className={`${field} min-h-40 resize-y py-2 leading-relaxed 2xl:min-h-80`}
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
											Math.max(1, Number.parseInt(event.target.value, 10) || 1),
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
											{plural(incomingTitles, "tytuł", "tytuły", "tytułów")}
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
							Bloki oddzielasz pustą linią. Jednolinijkowy akapit do podanej
							liczby znaków staje się tytułem, pozostałe blokami tekstu.
							Pojedynczy enter zostaje w tekście, a tagi <code>&lt;b&gt;</code>{" "}
							i <code>&lt;a&gt;</code> zostają.
						</p>
						<div className="border-line border-t pt-3">
							<Button
								variant="ghost"
								disabled={rows.length === 0}
								onClick={() => void copyJson()}
							>
								Skopiuj obecną treść jako JSON
							</Button>
						</div>
					</div>
				</section>

				{/* 2. Blocks */}
				<section
					aria-label="Bloki"
					className={`${panel} ${hiddenUnless("blocks")}`}
				>
					<div className={panelHead}>
						Bloki
						<span className="ml-auto text-xs font-normal text-muted">
							zmiany widać od razu w podglądzie
						</span>
					</div>
					<div className="flex flex-col gap-3 p-4">
						{rows.length === 0 && (
							<div className="rounded-control border border-line-input border-dashed p-5 text-center text-sm text-muted">
								Brak bloków. Dodaj pierwszy poniżej albo wklej gotowy tekst.
							</div>
						)}
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
											tabIndex={0}
											draggable
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
												if (!event.altKey) return;
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
										<span className="text-[11px] font-semibold text-muted">
											{index + 1}
										</span>
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
										<TextBlockEditor
											index={index}
											value={row.block.content}
											onChange={(content) =>
												update(row.key, (block) => ({ ...block, content }))
											}
										/>
									)}

									{type === "Image" && (
										<div className="flex flex-wrap items-center gap-3">
											{row.block.metadata?.imageRelativePath ? (
												<img
													src={mediaUrl(row.block.metadata.imageRelativePath)}
													alt=""
													className="h-24 w-36 rounded-control border border-line object-cover"
												/>
											) : (
												<div className="flex h-24 w-36 items-center justify-center rounded-control border border-line-input border-dashed text-xs text-muted">
													brak zdjęcia
												</div>
											)}
											<div className="flex min-w-0 flex-1 flex-col gap-2">
												<span className="truncate font-mono text-xs text-subtle">
													{row.block.metadata?.imageRelativePath ||
														"nie wybrano"}
												</span>
												<div>
													<Button
														data-primary
														onClick={() => setPickerFor(row.key)}
													>
														{row.block.metadata?.imageRelativePath
															? "Zmień obraz"
															: "Wybierz lub dodaj obraz"}
													</Button>
												</div>
											</div>
										</div>
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

						<div className="flex flex-col gap-2 rounded-control border border-line-input border-dashed p-2.5">
							<span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
								Dodaj blok
							</span>
							<div className="flex flex-wrap gap-1.5">
								{(["Title", "Text", "Image"] as const).map((type) => (
									<Button
										key={type}
										className="min-w-20 flex-1"
										onClick={() => add(type)}
									>
										+ {BLOCK_LABELS[type]}
									</Button>
								))}
							</div>
						</div>
						<p className="text-xs text-muted">
							Kolejność: strzałki ↑ ↓ przy bloku, przeciągnięcie za uchwyt ⋮⋮
							albo Alt + strzałki na uchwycie. Nowy blok trafia pod zaznaczony.
						</p>
					</div>
				</section>

				{/* 3. Preview */}
				<section
					aria-label="Podgląd"
					className={`${panel} ${hiddenUnless("preview")} lg:sticky lg:top-0`}
				>
					<div className={panelHead}>
						Podgląd
						<span className="ml-auto text-xs font-normal text-muted">
							widok poglądowy
						</span>
					</div>
					<div className="p-4">
						<div className="mx-auto min-h-96 w-full max-w-[375px] rounded-chip border border-line-input bg-white py-5">
							<ContentPreview blocks={blocks} />
						</div>
					</div>
				</section>
			</div>

			{/* Validation */}
			<section aria-label="Walidacja" className={panel}>
				<div className={panelHead}>Walidacja</div>
				<div className="p-4 text-sm">
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

			<MediaPicker
				open={pickerFor !== null}
				onOpenChange={(open) => {
					if (!open) setPickerFor(null);
				}}
				kind="image"
				folderId={imageFolderId}
				value={
					rows.find((row) => row.key === pickerFor)?.block.metadata
						?.imageRelativePath ?? null
				}
				onPick={(path) => {
					if (pickerFor) pickImage(pickerFor, path);
				}}
			/>
		</div>
	);
}

function TextBlockEditor({
	index,
	value,
	onChange,
}: {
	index: number;
	value: string;
	onChange: (content: string) => void;
}) {
	const textarea = useRef<HTMLTextAreaElement>(null);

	/** Wraps the selection in a tag, or inserts a placeholder to type over. */
	const wrap = (open: string, close: string) => {
		const element = textarea.current;
		if (!element) return;
		const start = element.selectionStart;
		const end = element.selectionEnd;
		const middle = value.slice(start, end) || "tekst";
		onChange(value.slice(0, start) + open + middle + close + value.slice(end));
		setTimeout(() => {
			element.focus();
			element.setSelectionRange(
				start + open.length,
				start + open.length + middle.length,
			);
		}, 0);
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-1.5">
				<button
					type="button"
					title="Pogrub zaznaczenie"
					onClick={() => wrap("<b>", "</b>")}
					className="rounded-chip border border-line-input px-2.5 py-0.5 text-xs font-bold hover:border-primary"
				>
					B
				</button>
				<button
					type="button"
					title="Zamień zaznaczenie w link"
					onClick={() => wrap('<a href="https://">', "</a>")}
					className="rounded-chip border border-line-input px-2.5 py-0.5 text-xs hover:border-primary"
				>
					Link
				</button>
			</div>
			<textarea
				ref={textarea}
				aria-label={`Tekst, blok ${index + 1}`}
				placeholder="Wpisz tekst"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={`${field} min-h-28 resize-y py-2 leading-normal`}
			/>
		</div>
	);
}
