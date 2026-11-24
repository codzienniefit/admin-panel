import { mediaCollection } from "@/data/collections/media";
import { Page } from "@/ui/Page";
import { refreshing } from "@/ui/RefreshButton";
import { MediaBrowser } from "./MediaBrowser";

interface MediaPageProps {
	folderId: string;
	query: string;
	onChange: (patch: { folder?: string; q?: string }) => void;
}

export function MediaPage({ folderId, query, onChange }: MediaPageProps) {
	return (
		<Page title="Media" onRefresh={refreshing(mediaCollection)}>
			<MediaBrowser
				folderId={folderId}
				onFolderChange={(folder) => onChange({ folder, q: undefined })}
				query={query}
				onQueryChange={(q) => onChange({ q: q || undefined })}
			/>
		</Page>
	);
}
