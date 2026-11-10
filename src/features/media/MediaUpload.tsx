import { useRef, useState } from "react";
import { ApiError } from "@/data/api/errors";
import { uploadMedia } from "@/data/collections/media";
import {
	formatBytes,
	type MediaFolder,
	uploadProblem,
} from "@/domain/mediaRules";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";

interface MediaUploadProps {
	folder: MediaFolder;
	/** Called with the path the file was actually stored under. */
	onUploaded?: (path: string) => void;
}

/** Picks one file, checks it against the folder's rules, and sends it. */
export function MediaUpload({ folder, onUploaded }: MediaUploadProps) {
	const input = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	const send = async (file: File) => {
		const refused = uploadProblem(folder, file);
		setProblem(refused);
		if (refused) return;

		setProgress(0);
		try {
			const result = await uploadMedia(file, folder.id, setProgress);
			toast({
				title: "Plik dodany",
				description: result.renamedToAvoidOverwrite
					? `Taka nazwa już istniała, zapisano jako ${result.relativePath}`
					: result.relativePath,
				tone: "green",
			});
			onUploaded?.(result.relativePath);
		} catch (error) {
			setProblem(
				error instanceof ApiError || error instanceof Error
					? error.message
					: "Nie udało się wysłać pliku",
			);
		} finally {
			setProgress(null);
		}
	};

	const busy = progress !== null;

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-3">
				<input
					ref={input}
					type="file"
					accept={folder.extensions.map((e) => `.${e}`).join(",")}
					className="hidden"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void send(file);
					}}
				/>
				<Button
					variant="primary"
					disabled={busy}
					onClick={() => input.current?.click()}
				>
					{busy ? `Wysyłanie… ${Math.round(progress * 100)}%` : "Dodaj plik"}
				</Button>
				<span className="text-xs text-muted">
					{folder.extensions.join(", ")} · do {formatBytes(folder.maxBytes)}
				</span>
			</div>
			{busy && (
				<div
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(progress * 100)}
					className="h-1.5 overflow-hidden rounded-full bg-hover"
				>
					<div
						className="h-full rounded-full bg-primary transition-[width] duration-200"
						style={{ width: `${progress * 100}%` }}
					/>
				</div>
			)}
			{problem && (
				<p role="alert" className="text-xs text-danger">
					{problem}
				</p>
			)}
		</div>
	);
}
