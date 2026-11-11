import { useState } from "react";
import { Button } from "@/ui/Button";
import { ColorPalette } from "@/ui/ColorPalette";
import { Dialog } from "@/ui/Dialog";
import { TextAreaField } from "@/ui/Field";

interface DetailsDialogProps {
	title: string;
	description?: string;
	note: string;
	color: string | null;
	colorLabel: string;
	onSave: (values: { note: string; color: string | null }) => void;
	onClose: () => void;
}

const NOTE_MAX = 2000;

/** The note and colour of a day or of a placed workout. */
export function DetailsDialog({
	title,
	description,
	note: initialNote,
	color: initialColor,
	colorLabel,
	onSave,
	onClose,
}: DetailsDialogProps) {
	const [note, setNote] = useState(initialNote);
	const [color, setColor] = useState(initialColor);
	const changed = note.trim() !== initialNote.trim() || color !== initialColor;

	return (
		<Dialog
			open
			onClose={onClose}
			title={title}
			description={description}
			size="sm"
			footer={
				<>
					<Button size="md" onClick={onClose}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={!changed}
						onClick={() => {
							onSave({ note: note.trim(), color });
							onClose();
						}}
					>
						Zapisz
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<TextAreaField
					label="Notatka"
					rows={4}
					maxLength={NOTE_MAX}
					hint="Tylko dla zespołu. Pusta notatka znika."
					value={note}
					onChange={(event) => setNote(event.target.value)}
				/>
				<ColorPalette label={colorLabel} value={color} onChange={setColor} />
			</div>
		</Dialog>
	);
}
