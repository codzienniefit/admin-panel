import { useState } from "react";
import type { Folder } from "@/data/schemas/settings";
import { plural } from "@/domain/text";
import { trainingTypeIdsOf, useConfig } from "@/features/config/useConfig";
import { applySettingsChange } from "@/features/planner/planningActions";
import { usePlanningById } from "@/features/planner/usePlanning";
import { saveOrToast } from "@/features/saving/applyChange";
import { newId } from "@/lib/ids";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { TextField } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { whileBusy } from "@/ui/tasks";
import { usePlannerSettings } from "./usePlannerSettings";

/** Folders group challenges on the list. A challenge is in one folder or none. */
export function FoldersSettings() {
	const settings = usePlannerSettings();
	const config = useConfig().workouts;
	const planningById = usePlanningById();
	const [added, setAdded] = useState("");
	const [renamed, setRenamed] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);

	if (!settings) return <Loading />;
	const trainingTypeIds = trainingTypeIdsOf(config);
	const inFolder = (folderId: string) =>
		[...planningById.values()].filter((p) => p.folderId === folderId).length;

	const run = async (
		change: Parameters<typeof applySettingsChange>[1],
		done: string,
	): Promise<boolean> =>
		whileBusy(setBusy, () =>
			saveOrToast("Nie można zapisać", () =>
				applySettingsChange(settings, change, trainingTypeIds, done),
			),
		);

	const add = async () => {
		const label = added.trim();
		if (!label) return;
		const ok = await run((draft) => {
			draft.folders.push({ id: newId("f"), name: label });
		}, "Folder dodany");
		if (ok) setAdded("");
	};

	const rename = async (folder: Folder) => {
		const label = (renamed[folder.id] ?? folder.name).trim();
		const ok = await run((draft) => {
			const target = draft.folders.find((f) => f.id === folder.id);
			if (target) target.name = label;
		}, "Nazwa zmieniona");
		if (ok) {
			const { [folder.id]: _done, ...rest } = renamed;
			setRenamed(rest);
		}
	};

	const remove = async (folder: Folder) => {
		const count = inFolder(folder.id);
		const sure = await confirm({
			title: `Usunąć folder „${folder.name}”?`,
			description:
				count > 0
					? `${plural(count, "wyzwanie wróci", "wyzwania wrócą", "wyzwań wróci")} do „Bez folderu”. Same wyzwania zostają.`
					: "Folder jest pusty.",
			confirmLabel: "Usuń folder",
			destructive: true,
		});
		if (sure) {
			await run((draft) => {
				draft.folders = draft.folders.filter((f) => f.id !== folder.id);
			}, "Folder usunięty");
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<Card>
				<form
					noValidate
					className="flex flex-wrap items-end gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void add();
					}}
				>
					<div className="min-w-56 flex-1">
						<TextField
							label="Nowy folder"
							placeholder="np. Archiwum"
							value={added}
							onChange={(event) => setAdded(event.target.value)}
						/>
					</div>
					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={busy || !added.trim()}
					>
						Dodaj folder
					</Button>
				</form>
			</Card>
			{settings.folders.length === 0 ? (
				<EmptyState title="Brak folderów">
					Foldery porządkują listę wyzwań. Dodaj pierwszy powyżej.
				</EmptyState>
			) : (
				<Card className="flex flex-col divide-y divide-line">
					{settings.folders.map((folder) => {
						const value = renamed[folder.id] ?? folder.name;
						const count = inFolder(folder.id);
						return (
							<div
								key={folder.id}
								className="flex flex-wrap items-end gap-3 py-3 first:pt-0 last:pb-0"
							>
								<div className="min-w-56 flex-1">
									<TextField
										label="Nazwa folderu"
										value={value}
										onChange={(event) =>
											setRenamed({
												...renamed,
												[folder.id]: event.target.value,
											})
										}
									/>
								</div>
								<span className="pb-2 text-sm text-muted">
									{plural(count, "wyzwanie", "wyzwania", "wyzwań")}
								</span>
								<Button
									size="md"
									disabled={
										busy || value.trim() === folder.name || !value.trim()
									}
									onClick={() => void rename(folder)}
								>
									Zmień nazwę
								</Button>
								<Button
									size="md"
									variant="ghost"
									disabled={busy}
									onClick={() => void remove(folder)}
								>
									Usuń
								</Button>
							</div>
						);
					})}
				</Card>
			)}
		</div>
	);
}
