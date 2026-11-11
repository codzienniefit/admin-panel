import type { ReactNode } from "react";
import { acceptedTypes } from "@/domain/mediaRules";
import { Button, type ButtonVariant } from "@/ui/Button";
import type { MediaUploadState } from "./useMediaUpload";

// What an upload looks like wherever it happens: the button that opens the
// file chooser, then the progress bar and the reason a file was refused.
// The logic is in useMediaUpload.

interface MediaUploadButtonProps {
	upload: MediaUploadState;
	variant?: ButtonVariant;
	/** Extra classes for the button, e.g. a height that matches its row. */
	className?: string;
	/** The label while nothing is being sent, e.g. "Dodaj plik". */
	children: ReactNode;
}

/** Opens the file chooser; while a file is on its way, shows how far it is. */
export function MediaUploadButton({
	upload,
	variant,
	className,
	children,
}: MediaUploadButtonProps) {
	const { folder, busy, progress } = upload;
	if (!folder) return null;
	return (
		<>
			<input
				ref={upload.input}
				type="file"
				accept={acceptedTypes(folder)}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					// Emptied so that choosing the same file again is a change too.
					event.target.value = "";
					if (file) void upload.send(file);
				}}
			/>
			<Button
				variant={variant}
				className={className}
				disabled={busy}
				onClick={upload.choose}
			>
				{busy ? `Wysyłanie… ${Math.round((progress ?? 0) * 100)}%` : children}
			</Button>
		</>
	);
}

/** The progress bar while sending, and the problem with the last file. */
export function MediaUploadStatus({ upload }: { upload: MediaUploadState }) {
	const { progress, problem } = upload;
	return (
		<>
			{progress !== null && (
				<div
					role="progressbar"
					aria-label="Wysyłanie pliku"
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
		</>
	);
}
