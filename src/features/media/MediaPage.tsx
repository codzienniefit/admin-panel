import { Page } from "@/ui/Page";
import { MediaBrowser } from "./MediaBrowser";

interface MediaPageProps {
	folderId: string;
	query: string;
	onChange: (patch: { folder?: string; q?: string }) => void;
}

export function MediaPage({ folderId, query, onChange }: MediaPageProps) {
	return (
		<Page title="Media">
			<MediaBrowser
				folderId={folderId}
				onFolderChange={(folder) => onChange({ folder, q: undefined })}
				query={query}
				onQueryChange={(q) => onChange({ q: q || undefined })}
			/>
		</Page>
	);
}
