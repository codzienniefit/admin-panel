import { slugify } from "./text";

// Which files may go where. The limits are the ones the Retool panel
// enforced; they keep the app's downloads small.

export interface MediaFolder {
	id: string;
	label: string;
	kind: "image" | "audio";
	extensions: readonly string[];
	maxBytes: number;
}

const KB = 1024;
const MB = 1024 * KB;

export const MEDIA_FOLDERS: readonly MediaFolder[] = [
	{
		id: "workouts",
		label: "Treningi",
		kind: "image",
		extensions: ["webp"],
		maxBytes: 250 * KB,
	},
	{
		id: "challenges",
		label: "Wyzwania",
		kind: "image",
		extensions: ["webp"],
		maxBytes: 300 * KB,
	},
	{
		id: "messages",
		label: "Wiadomości",
		kind: "image",
		extensions: ["webp"],
		maxBytes: 300 * KB,
	},
	{
		id: "badges",
		label: "Odznaki",
		kind: "image",
		extensions: ["webp"],
		maxBytes: 50 * KB,
	},
	{
		id: "audio",
		label: "Audio",
		kind: "audio",
		extensions: ["m4a", "m4v", "mp3", "wav"],
		maxBytes: 200 * MB,
	},
];

export const folderOf = (path: string): string => path.split("/")[0] ?? "";

export const mediaFolder = (id: string): MediaFolder | undefined =>
	MEDIA_FOLDERS.find((folder) => folder.id === id);

/** The folder's file types in the form a file chooser's `accept` takes. */
export const acceptedTypes = (folder: MediaFolder): string =>
	folder.extensions.map((extension) => `.${extension}`).join(",");

export const extensionOf = (name: string): string =>
	name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";

export function formatBytes(bytes: number): string {
	if (bytes >= MB) return `${Math.round((bytes / MB) * 10) / 10} MB`;
	return `${Math.max(1, Math.round(bytes / KB))} kB`;
}

/** Why this file cannot be uploaded to this folder, or null when it can. */
export function uploadProblem(
	folder: MediaFolder,
	file: { name: string; size: number },
): string | null {
	const extension = extensionOf(file.name);
	if (!folder.extensions.includes(extension)) {
		return `Do folderu „${folder.label}” można dodać tylko pliki: ${folder.extensions.join(", ")}.`;
	}
	if (file.size > folder.maxBytes) {
		return `Plik ma ${formatBytes(file.size)}, a limit to ${formatBytes(folder.maxBytes)}.`;
	}
	if (!slugify(file.name.slice(0, -extension.length - 1))) {
		return "Nazwa pliku musi zawierać litery lub cyfry.";
	}
	return null;
}

/**
 * Why what was dropped onto a field cannot be uploaded, or null when it can.
 * A field holds one file, so a handful dropped at once is refused rather than
 * one of them being picked without the person knowing which.
 */
export function dropProblem(
	folder: MediaFolder,
	files: ReadonlyArray<{ name: string; size: number }>,
): string | null {
	const [file, ...others] = files;
	if (!file) return "Upuść tutaj plik z dysku.";
	if (others.length > 0) return "Upuść jeden plik naraz.";
	return uploadProblem(folder, file);
}

/** The path a file gets: folder plus a storage-safe version of its name. */
export function uploadPath(folderId: string, fileName: string): string {
	const extension = extensionOf(fileName);
	const stem = slugify(fileName.slice(0, -extension.length - 1));
	return `${folderId}/${stem}.${extension}`;
}
