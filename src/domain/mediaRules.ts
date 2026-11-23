// Which files may go where. The limits are the ones the Retool panel
// enforced; they keep the app's downloads small. The backend holds an upload
// from the panel to the same list (its src/config/mediaUpload.ts) and stores
// a file only under a path that is already clean (its `sanitizeRelativePath`,
// repeated here as `cleanUploadPath`), so the two have to stay in step.

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
		// No m4v: the backend has never stored one (it has no content type for
		// it). And no more than 32 MB: an upload goes through the panel's
		// Worker, which forwards at most that. A longer recording needs an
		// upload straight to storage, which is not built.
		extensions: ["m4a", "mp3", "wav"],
		maxBytes: 32 * MB,
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
	if (!cleanSegment(file.name.slice(0, -extension.length - 1))) {
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

const TRANSLITERATED: Record<string, string> = {
	ł: "l",
	Ł: "l",
	ß: "ss",
	æ: "ae",
	Æ: "ae",
	ø: "o",
	Ø: "o",
	đ: "d",
	Đ: "d",
	ð: "d",
	þ: "th",
};

/**
 * One folder or file name the way the backend stores it: lower-case ASCII
 * letters, digits, ".", "_" and "-"; no run of dots or dashes, no dash next
 * to a dot, neither at either end. Step for step the backend's
 * `sanitizePathSegment`, so that what the panel asks for is what is stored.
 */
function cleanSegment(segment: string): string {
	return (
		segment
			.normalize("NFC")
			// Letters with no decomposed form need a mapping of their own.
			.replace(/[łŁßæÆøØđĐðþ]/g, (letter) => TRANSLITERATED[letter] ?? "")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/\.{2,}/g, ".")
			.replace(/-{2,}/g, "-")
			.replace(/-*\.-*/g, ".")
			.replace(/^[-.]+|[-.]+$/g, "")
	);
}

/**
 * A whole path in the form the backend accepts from the panel without
 * changing it: each folder cleaned, the file name cleaned apart from its
 * extension, a name with nothing usable in it called "file". The same as
 * the backend's `sanitizeRelativePath`; a path that is already clean comes
 * back as it is. Empty when the path names nothing at all.
 */
export function cleanUploadPath(relativePath: string): string {
	const raw = relativePath
		.split("/")
		.filter((segment) => segment !== "" && segment !== "." && segment !== "..");
	const fileName = raw.pop();
	if (fileName === undefined) return "";
	const folders = raw.map(cleanSegment).filter((segment) => segment !== "");
	const dot = fileName.lastIndexOf(".");
	const stem = cleanSegment(dot >= 0 ? fileName.slice(0, dot) : fileName);
	const extension = dot >= 0 ? cleanSegment(fileName.slice(dot + 1)) : "";
	const name = `${stem || "file"}${extension ? `.${extension}` : ""}`;
	return [...folders, name].join("/");
}

/** The path a file gets: folder plus a storage-safe version of its name. */
export function uploadPath(folderId: string, fileName: string): string {
	return cleanUploadPath(`${folderId}/${fileName}`);
}
