import { formatBytes, type MediaFolder } from "@/domain/mediaRules";
import { MediaUploadButton, MediaUploadStatus } from "./MediaUploadParts";
import { useMediaUpload } from "./useMediaUpload";

interface MediaUploadProps {
	folder: MediaFolder;
	/** Called with the path the file was actually stored under. */
	onUploaded?: (path: string) => void;
}

/** The library's "add a file" button, with the folder's limits next to it. */
export function MediaUpload({ folder, onUploaded }: MediaUploadProps) {
	const upload = useMediaUpload(folder, onUploaded);

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			{/* As tall as the folder select and the search box beside it, so the
			    button and the limits sit on their centre line; the progress bar
			    and the problem go underneath without moving them. */}
			<div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
				<MediaUploadButton upload={upload} variant="primary" className="h-10">
					Dodaj plik
				</MediaUploadButton>
				<span className="text-xs text-muted">
					{folder.extensions.join(", ")} · do {formatBytes(folder.maxBytes)}
				</span>
			</div>
			<MediaUploadStatus upload={upload} />
		</div>
	);
}
