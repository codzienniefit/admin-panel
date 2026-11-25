import { errorMessage } from "@/data/api/errors";
import { Button } from "@/ui/Button";
import { JsonView } from "@/ui/JsonView";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { useUserProgress } from "./useUsers";

/**
 * What a person has done in the app, exactly as the backend sends it: one
 * big JSON to read, search with the browser and copy. Read-only.
 */
export function UserProgressTab({ uid }: { uid: string }) {
	const progress = useUserProgress(uid);
	const showLoading = useDelayedLoading(progress.isLoading);

	if (progress.isLoading) {
		return showLoading ? <Loading /> : null;
	}
	if (!progress.data) {
		return (
			<Notice
				tone="red"
				role="alert"
				title="Nie udało się wczytać wykonań"
				actions={
					<Button onClick={() => void progress.refetch()}>
						Spróbuj ponownie
					</Button>
				}
			>
				{errorMessage(
					progress.error,
					"Sprawdź połączenie i spróbuj jeszcze raz.",
				)}
			</Notice>
		);
	}

	return (
		<section aria-label="Wykonania" className="flex flex-col gap-2">
			<p className="text-sm text-muted">
				Odpowiedź backendu bez zmian: ukończone treningi i rozpoczęte wyzwania.
			</p>
			<JsonView
				// the answer as it came; the mock has no raw answer, only its data
				value={progress.data.raw ?? progress.data}
				label="Wykonania jako JSON"
				height="h-[70vh]"
			/>
		</section>
	);
}
