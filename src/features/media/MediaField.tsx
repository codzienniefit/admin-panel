import { useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { nowPlaying, togglePlayback } from "./audioPlayer";
import { MediaPicker } from "./MediaPicker";

interface MediaFieldProps {
	label: string;
	kind: "image" | "audio";
	folderId: string;
	value: string | null;
	onChange: (path: string | null) => void;
	error?: string;
	hint?: string;
	disabled?: boolean;
}

/** A form field holding one file from the media library. */
export function MediaField({
	label,
	kind,
	folderId,
	value,
	onChange,
	error,
	hint,
	disabled,
}: MediaFieldProps) {
	const [open, setOpen] = useState(false);
	const playing = useStore(nowPlaying);

	return (
		<Field label={label} error={error} hint={hint}>
			{({ id }) => (
				<div className="flex flex-wrap items-center gap-3">
					{kind === "image" &&
						(value ? (
							<img
								src={mediaUrl(value)}
								alt=""
								className="h-20 w-30 rounded-control border border-line object-cover"
							/>
						) : (
							<div className="flex h-20 w-30 items-center justify-center rounded-control border border-line-input border-dashed text-xs text-muted">
								brak grafiki
							</div>
						))}
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<span
							className={`truncate font-mono text-xs ${value ? "text-subtle" : "text-muted"}`}
							title={value ?? undefined}
						>
							{value ?? "nie wybrano"}
						</span>
						<div className="flex flex-wrap gap-2">
							<Button id={id} disabled={disabled} onClick={() => setOpen(true)}>
								{value ? "Zmień" : "Wybierz z biblioteki"}
							</Button>
							{value && kind === "audio" && (
								<Button onClick={() => togglePlayback(value)}>
									{playing === value ? "Zatrzymaj" : "Odtwórz"}
								</Button>
							)}
							{value && !disabled && (
								<Button variant="ghost" onClick={() => onChange(null)}>
									Usuń
								</Button>
							)}
						</div>
					</div>
					<MediaPicker
						open={open}
						onOpenChange={setOpen}
						kind={kind}
						folderId={folderId}
						value={value}
						onPick={onChange}
					/>
				</div>
			)}
		</Field>
	);
}
