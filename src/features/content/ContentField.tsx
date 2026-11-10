import { useState } from "react";
import type { ContentBlock } from "@/data/schemas/workout";
import { contentExcerpt, contentIssues } from "@/domain/contentBlocks";
import { plural } from "@/domain/text";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { ContentEditorDialog } from "./ContentEditorDialog";
import { ContentPreview } from "./ContentPreview";

interface ContentFieldProps {
	label: string;
	/** Title of the editor dialog, e.g. "Opis treningu". */
	editorTitle: string;
	value: readonly ContentBlock[];
	onChange: (blocks: ContentBlock[]) => void;
	imageFolderId: string;
	error?: string;
	disabled?: boolean;
}

/**
 * A form field holding block content: a small preview, a count of problems,
 * and a button that opens the editor.
 */
export function ContentField({
	label,
	editorTitle,
	value,
	onChange,
	imageFolderId,
	error,
	disabled,
}: ContentFieldProps) {
	const [open, setOpen] = useState(false);
	const issues = contentIssues(value);
	const errors = issues.filter((issue) => issue.severity === "error").length;
	const warnings = issues.length - errors;

	return (
		<Field label={label} error={error}>
			{({ id }) => (
				<div className="flex flex-col gap-3 rounded-control border border-line p-3 md:flex-row md:items-start">
					<div className="max-h-44 w-full shrink-0 overflow-hidden rounded-chip border border-line bg-white py-3 md:w-64">
						<ContentPreview blocks={value} compact />
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
						<p className="text-subtle">
							{value.length === 0
								? "Brak treści."
								: contentExcerpt(value) || "Sama grafika."}
						</p>
						<p className="text-xs text-muted">
							{plural(value.length, "blok", "bloki", "bloków")}
							{errors > 0 && (
								<span className="text-danger"> · błędy: {errors}</span>
							)}
							{warnings > 0 && (
								<span className="text-(--tone-ink)" data-tone="amber">
									{" "}
									· uwagi: {warnings}
								</span>
							)}
						</p>
						<div>
							<Button id={id} disabled={disabled} onClick={() => setOpen(true)}>
								{value.length === 0 ? "Dodaj treść" : "Edytuj treść"}
							</Button>
						</div>
					</div>
					<ContentEditorDialog
						open={open}
						onOpenChange={setOpen}
						title={editorTitle}
						value={value}
						onApply={onChange}
						imageFolderId={imageFolderId}
					/>
				</div>
			)}
		</Field>
	);
}
