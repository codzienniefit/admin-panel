import { useState } from "react";
import { mediaFolder } from "@/domain/mediaRules";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { nowPlaying, togglePlayback } from "./audioPlayer";
import { MediaImage } from "./MediaImage";
import { MediaPicker } from "./MediaPicker";
import { MediaUploadButton, MediaUploadStatus } from "./MediaUploadParts";
import { useMediaUpload } from "./useMediaUpload";

interface MediaSlotProps {
	/** Names the slot for screen readers, e.g. "Miniaturka". */
	label: string;
	kind: "image" | "audio";
	/** The folder new files go to, and the one the library opens in. */
	folderId: string;
	value: string | null;
	onChange: (path: string | null) => void;
	disabled?: boolean;
	/** Id of the library button, for a `<label>` that points at the slot. */
	id?: string;
	/** Size of the thumbnail, where the default is too small or too big. */
	thumbnailClassName?: string;
	/** False where an empty slot makes no sense and "Usuń" would only harm. */
	clearable?: boolean;
	/**
	 * Marks the library button with `data-primary`: the content editor moves
	 * the keyboard there when it jumps to an image block.
	 */
	primary?: boolean;
}

/**
 * One file from the media library, with every way of filling it: picked in
 * the library, uploaded on the spot, or dropped here. MediaField is this
 * with a form label; the content editor's image block uses it bare.
 */
export function MediaSlot({
	label,
	kind,
	folderId,
	value,
	onChange,
	disabled = false,
	id,
	thumbnailClassName = "h-20 w-30",
	clearable = true,
	primary = false,
}: MediaSlotProps) {
	const [open, setOpen] = useState(false);
	const [over, setOver] = useState(false);
	const playing = useStore(nowPlaying);
	const upload = useMediaUpload(
		disabled ? undefined : mediaFolder(folderId),
		onChange,
	);
	const canUpload = Boolean(upload.folder);

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a legend and its own layout; the group only names the buttons inside
		<div
			role="group"
			aria-label={label}
			// Dropping is a shortcut for "Wybierz z komputera", which stays the way that
			// works from the keyboard and on a phone.
			onDragOver={(event) => {
				if (!canUpload || !event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setOver(true);
			}}
			onDragLeave={(event) => {
				// Moving onto a child also "leaves"; only leaving the slot counts.
				if (event.relatedTarget instanceof Node) {
					if (event.currentTarget.contains(event.relatedTarget)) return;
				}
				setOver(false);
			}}
			onDrop={(event) => {
				if (!canUpload || !event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setOver(false);
				upload.drop([...event.dataTransfer.files]);
			}}
			className={`@container rounded-control ${over ? "outline-2 outline-offset-4 outline-primary outline-dashed" : ""}`}
		>
			{/* Picture, path and buttons. With room, the buttons sit beside the
			    picture, under the path; in a narrow column they get a row of their
			    own, so they stay on one line. */}
			<div
				className={`grid items-center gap-x-3 gap-y-2 ${kind === "image" ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}
			>
				{kind === "image" && (
					<MediaImage
						path={value}
						placeholder="brak grafiki"
						className={`${thumbnailClassName} rounded-control @md:row-span-2`}
						imageClassName="border border-line object-cover"
					/>
				)}
				<span
					className={`min-w-0 truncate font-mono text-xs ${value ? "text-subtle" : "text-muted"}`}
					title={value ?? undefined}
				>
					{value ?? "nie wybrano"}
				</span>
				<div
					className={`flex flex-wrap gap-2 ${kind === "image" ? "col-span-2 @md:col-span-1 @md:col-start-2" : ""}`}
				>
					<Button
						id={id}
						data-primary={primary || undefined}
						disabled={disabled}
						onClick={() => setOpen(true)}
					>
						{value ? "Zmień" : "Wybierz z biblioteki"}
					</Button>
					<MediaUploadButton upload={upload}>
						Wybierz z komputera
					</MediaUploadButton>
					{value && kind === "audio" && (
						<Button onClick={() => togglePlayback(value)}>
							{playing === value ? "Zatrzymaj" : "Odtwórz"}
						</Button>
					)}
					{value && clearable && !disabled && (
						<Button
							variant="ghost"
							onClick={() => {
								upload.dismiss();
								onChange(null);
							}}
						>
							Usuń
						</Button>
					)}
				</div>
				<div className={`empty:hidden ${kind === "image" ? "col-span-2" : ""}`}>
					<MediaUploadStatus upload={upload} />
				</div>
			</div>
			<MediaPicker
				open={open}
				onOpenChange={setOpen}
				kind={kind}
				folderId={folderId}
				value={value}
				onPick={(path) => {
					upload.dismiss();
					onChange(path);
				}}
			/>
		</div>
	);
}
