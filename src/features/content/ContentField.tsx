import type { ContentBlock } from "@/data/schemas/workout";
import { Field } from "@/ui/Field";
import { ContentEditor } from "./ContentEditor";

interface ContentFieldProps {
	label: string;
	/**
	 * Not shown any more: the editor used to open in a window with this
	 * title. Still accepted, so forms written for that keep compiling.
	 */
	editorTitle?: string;
	value: readonly ContentBlock[];
	onChange: (blocks: ContentBlock[]) => void;
	imageFolderId: string;
	error?: string;
	/** Read-only: the preview and the JSON, nothing to change. */
	disabled?: boolean;
}

/**
 * A form field holding block content. The editor is right here in the form
 * (blocks, pasted text, preview, JSON), and every change goes to `onChange`
 * as it is made: the form's own save and "unsaved changes" cover it.
 */
export function ContentField({
	label,
	value,
	onChange,
	imageFolderId,
	error,
	disabled,
}: ContentFieldProps) {
	return (
		<Field label={label} error={error}>
			{({ id }) => (
				<ContentEditor
					id={id}
					label={label}
					value={value}
					onChange={onChange}
					imageFolderId={imageFolderId}
					disabled={disabled}
				/>
			)}
		</Field>
	);
}
