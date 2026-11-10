import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { api } from "@/data/api";
import type { MediaFile, MediaUploadResult } from "@/data/schemas/media";
import { uploadPath } from "@/domain/mediaRules";
import { queryClient } from "./queryClient";

/** Every file in the public media container. */
export const mediaCollection = createCollection(
	queryCollectionOptions<MediaFile>({
		id: "media",
		queryKey: ["media"],
		queryClient,
		queryFn: () => api.media.list(),
		getKey: (file) => file.path,
	}),
);

/** The address a browser can load a media file from. */
export const mediaUrl = (path: string): string => api.media.urlFor(path);

/**
 * Sends a file to a folder and adds it to the library. The stored path can
 * differ from the requested one (cleaned up, or renamed so that nothing is
 * overwritten), so callers must use the path in the result.
 */
export async function uploadMedia(
	file: File,
	folderId: string,
	onProgress?: (fraction: number) => void,
): Promise<MediaUploadResult> {
	const result = await api.media.upload(file, {
		relativePath: uploadPath(folderId, file.name),
		onProgress,
	});
	await mediaCollection.utils.writeInsert({
		path: result.relativePath,
		type: result.type,
		createdAtUtc: new Date().toISOString(),
		sizeBytes: file.size,
	});
	return result;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
