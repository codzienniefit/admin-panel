import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable, TEST_MARK } from "@/data/api/capabilities";
import type { ApiClient } from "@/data/api/types";
import {
	type MediaFile,
	mediaFileSchema,
	mediaTypeSchema,
	mediaUploadResultSchema,
} from "@/data/schemas/media";
import { cleanUploadPath } from "@/domain/mediaRules";
import { conform } from "./shared";
import type { Transport } from "./transport";

// Files in the public container: `manageMedia/files` of the backend
// (src/handlers/admin/mediaManagementHandler.ts), and the public
// `files?path=` for showing one.
//
// The list is asked for whole, newest first, as the ApiClient's `list()`
// promises. The backend can also filter (`?prefix=`) and page (`?pageSize=`,
// `?pageToken=`, then ordered by path); the panel has no call that takes
// either yet.

const listSchema = z.looseObject({ files: z.array(z.unknown()) });

/** A type this build does not know is still a file: "other". */
export function toMediaFile(raw: unknown): MediaFile {
	const { sizeBytes, ...wire } = conform(
		z.looseObject({
			path: z.string(),
			type: z.string().nullish(),
			// The panel's route sends the size, and null where the storage
			// did not say: a file without a known size, not a broken row.
			sizeBytes: z.number().nullish(),
		}),
		raw,
		"Plik",
	);
	const type = mediaTypeSchema.safeParse(wire.type);
	return conform(
		mediaFileSchema,
		{
			...wire,
			...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
			type: type.success ? type.data : "other",
		},
		`Plik ${wire.path}`,
	);
}

/**
 * How an upload shows it is a test file: a `test/` folder anywhere in the
 * path, or a file name that starts with "test-". Files have no comment
 * field to carry the mark.
 */
export function isTestUpload(relativePath: string): boolean {
	const parts = relativePath.split("/").filter((part) => part !== "");
	const name = parts.at(-1) ?? "";
	return (
		parts.slice(0, -1).some((part) => part.toLowerCase() === "test") ||
		name.toLowerCase().startsWith("test-")
	);
}

export function mediaArea(
	transport: Transport,
	capabilities: Capabilities,
): ApiClient["media"] {
	return {
		async list() {
			const answer = await transport.request({
				path: ["manageMedia", "files"],
				schema: listSchema,
				what: "Lista plików",
			});
			return answer.files.map(toMediaFile);
		},
		async upload(file, options) {
			// With the editing contract the backend stores a file only under a
			// path that is already clean, and refuses any other instead of
			// cleaning it. So the path is put in that form here (the backend's
			// own rule, domain/mediaRules.ts), whoever built it. The answer
			// names the path that was stored.
			const relativePath = capabilities.etag
				? cleanUploadPath(options.relativePath)
				: options.relativePath;
			assertWritable(capabilities, "media", {
				// The guard looks for the mark at the start of a text.
				texts: [isTestUpload(relativePath) ? TEST_MARK : ""],
				field: "Nazwa pliku (test-…) albo folder test/",
				path: "relativePath",
			});
			const raw = await transport.request({
				method: "POST",
				path: ["manageMedia", "files"],
				query: { relativePath },
				file,
				// Without a listener the request would not report progress at all.
				onProgress: options.onProgress ?? (() => {}),
			});
			const wire = conform(
				z.looseObject({ type: z.string().nullish() }),
				raw,
				"Wynik wysyłania pliku",
			);
			const type = mediaTypeSchema.safeParse(wire.type);
			return conform(
				mediaUploadResultSchema,
				{ ...wire, type: type.success ? type.data : "other" },
				"Wynik wysyłania pliku",
			);
		},
		// Public and without a token: an <img> cannot send one. The Worker
		// follows the backend's redirect to the file, so the browser only
		// ever loads from the panel's own address.
		urlFor: (path) => transport.url(["files"], { path }),
	};
}
