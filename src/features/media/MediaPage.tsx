import { MediaBrowser } from "./MediaBrowser";

interface MediaPageProps {
	folderId: string;
	query: string;
	onChange: (patch: { folder?: string; q?: string }) => void;
}

export function MediaPage({ folderId, query, onChange }: MediaPageProps) {
	return (
		<div className="mx-auto max-w-6xl">
			<h1 className="mb-6 text-3xl font-semibold tracking-tight">Media</h1>
			<MediaBrowser
				folderId={folderId}
				onFolderChange={(folder) => onChange({ folder, q: undefined })}
				query={query}
				onQueryChange={(q) => onChange({ q: q || undefined })}
			/>
		</div>
	);
}
