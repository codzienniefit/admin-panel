import { Field } from "@/ui/Field";
import { MediaSlot } from "./MediaSlot";

interface MediaFieldProps {
	label: string;
	kind: "image" | "audio";
	folderId: string;
	value: string | null;
	onChange: (path: string | null) => void;
	error?: string;
	hint?: string;
	disabled?: boolean;
	/** Size of the thumbnail, e.g. a square for a badge. */
	thumbnailClassName?: string;
}

/**
 * A form field holding one file from the media library: picked there,
 * uploaded in place ("Wybierz z komputera") or dropped onto the field.
 */
export function MediaField({
	label,
	kind,
	folderId,
	value,
	onChange,
	error,
	hint,
	disabled,
	thumbnailClassName,
}: MediaFieldProps) {
	return (
		<Field label={label} error={error} hint={hint}>
			{({ id }) => (
				<MediaSlot
					id={id}
					label={label}
					kind={kind}
					folderId={folderId}
					value={value}
					onChange={onChange}
					disabled={disabled}
					thumbnailClassName={thumbnailClassName}
				/>
			)}
		</Field>
	);
}
