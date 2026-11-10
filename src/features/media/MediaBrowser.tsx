import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { mediaCollection, mediaUrl } from "@/data/collections/media";
import type { MediaFile } from "@/data/schemas/media";
import { formatDate } from "@/domain/dates";
import { folderOf, formatBytes, MEDIA_FOLDERS } from "@/domain/mediaRules";
import { matchesQuery, plural } from "@/domain/text";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Select } from "@/ui/Select";
import { Skeleton, useDelayedLoading } from "@/ui/Skeleton";
import { nowPlaying, togglePlayback } from "./audioPlayer";
import { MediaUpload } from "./MediaUpload";

const PAGE = 60;

const FOLDER_OPTIONS = MEDIA_FOLDERS.map((folder) => ({
	value: folder.id,
	label: folder.label,
	hint: folder.kind === "audio" ? "audio" : "grafiki",
}));

interface MediaBrowserProps {
	folderId: string;
	onFolderChange: (folderId: string) => void;
	query: string;
	onQueryChange: (query: string) => void;
	/** Restricts the folder list, e.g. to image folders in an image picker. */
	kind?: "image" | "audio";
	/** With a handler, files are chosen; without, the browser only shows them. */
	onPick?: (path: string) => void;
	selectedPath?: string | null;
}

/** One folder of the media library: search, upload, and the files. */
export function MediaBrowser({
	folderId,
	onFolderChange,
	query,
	onQueryChange,
	kind,
	onPick,
	selectedPath,
}: MediaBrowserProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ file: mediaCollection }),
	});
	const showSkeleton = useDelayedLoading(isLoading);
	const [limit, setLimit] = useState(PAGE);

	const folders = kind
		? FOLDER_OPTIONS.filter(
				(option) =>
					MEDIA_FOLDERS.find((f) => f.id === option.value)?.kind === kind,
			)
		: FOLDER_OPTIONS;
	const folder =
		MEDIA_FOLDERS.find((f) => f.id === folderId) ??
		MEDIA_FOLDERS.find((f) => !kind || f.kind === kind);
	if (!folder) return null;

	const files = (data ?? [])
		.filter(
			(file) =>
				folderOf(file.path) === folder.id && matchesQuery(file.path, query),
		)
		.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
	const shown = files.slice(0, limit);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start gap-3">
				{folders.length > 1 && (
					<Select
						label="Folder"
						options={folders}
						value={folder.id}
						onChange={(next) => {
							if (!next) return;
							setLimit(PAGE);
							onFolderChange(next);
						}}
						className="w-44"
					/>
				)}
				<input
					type="search"
					aria-label="Szukaj pliku"
					placeholder="Szukaj po nazwie pliku…"
					value={query}
					onChange={(event) => {
						setLimit(PAGE);
						onQueryChange(event.target.value);
					}}
					className="h-10 min-w-48 flex-1 rounded-control border border-line-input bg-surface px-3 text-sm outline-none placeholder:text-muted hover:border-primary focus:border-primary focus:shadow-focus any-pointer-coarse:text-base"
				/>
				<MediaUpload folder={folder} onUploaded={onPick} />
			</div>

			<p className="text-xs text-muted">
				{isLoading
					? "Wczytywanie…"
					: plural(files.length, "plik", "pliki", "plików")}
				{folder.kind === "image" && (
					<>
						{" · "}
						<a
							href="https://compress-or-die.com/webp"
							target="_blank"
							rel="noreferrer"
							className="text-primary hover:underline"
						>
							Narzędzie do kompresji
						</a>
					</>
				)}
			</p>

			{isLoading ? (
				showSkeleton && (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<Skeleton key={n} className="aspect-[3/2]" />
						))}
					</div>
				)
			) : files.length === 0 ? (
				<EmptyState title="Brak plików">
					{query
						? "Żaden plik w tym folderze nie pasuje do wyszukiwania."
						: "Ten folder jest pusty. Dodaj pierwszy plik."}
				</EmptyState>
			) : folder.kind === "audio" ? (
				<AudioList files={shown} onPick={onPick} selectedPath={selectedPath} />
			) : (
				<ImageGrid files={shown} onPick={onPick} selectedPath={selectedPath} />
			)}

			{files.length > shown.length && (
				<div className="flex justify-center">
					<Button onClick={() => setLimit(limit + PAGE)}>
						Pokaż kolejne ({files.length - shown.length} pozostało)
					</Button>
				</div>
			)}
		</div>
	);
}

interface FilesProps {
	files: readonly MediaFile[];
	onPick?: (path: string) => void;
	selectedPath?: string | null;
}

const fileName = (path: string) => path.split("/").pop() ?? path;

function ImageGrid({ files, onPick, selectedPath }: FilesProps) {
	return (
		<ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
			{files.map((file) => {
				const selected = file.path === selectedPath;
				const body = (
					<>
						<img
							src={mediaUrl(file.path)}
							alt=""
							loading="lazy"
							className="aspect-[3/2] w-full bg-hover object-cover"
						/>
						<span className="block truncate px-2 py-1.5 text-xs text-subtle">
							{fileName(file.path)}
						</span>
					</>
				);
				const frame = `block w-full overflow-hidden rounded-cell border bg-surface text-left ${selected ? "border-primary shadow-focus" : "border-line"}`;
				return (
					<li key={file.path} title={file.path}>
						{onPick ? (
							<button
								type="button"
								aria-pressed={selected}
								onClick={() => onPick(file.path)}
								className={`${frame} hover:border-primary`}
							>
								{body}
							</button>
						) : (
							<div className={frame}>{body}</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function AudioList({ files, onPick, selectedPath }: FilesProps) {
	const playing = useStore(nowPlaying);
	return (
		<ul className="flex flex-col gap-2">
			{files.map((file) => (
				<li
					key={file.path}
					className={`flex flex-wrap items-center gap-3 rounded-cell border bg-surface px-3 py-2 ${file.path === selectedPath ? "border-primary shadow-focus" : "border-line"}`}
				>
					<Button
						aria-pressed={playing === file.path}
						onClick={() => togglePlayback(file.path)}
					>
						{playing === file.path ? "Zatrzymaj" : "Odtwórz"}
					</Button>
					<span className="min-w-0 flex-1 truncate text-sm" title={file.path}>
						{fileName(file.path)}
					</span>
					<span className="text-xs text-muted">
						{file.sizeBytes ? `${formatBytes(file.sizeBytes)} · ` : ""}
						{formatDate(file.createdAtUtc)}
					</span>
					{onPick && (
						<Button variant="primary" onClick={() => onPick(file.path)}>
							Wybierz
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}
