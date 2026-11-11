import type { ReactNode } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import type { ApiIssue } from "@/data/api/errors";
import { Notice } from "./Notice";

// Problems come from the rule functions and from the server in one shape:
// { path, message }. These two put them on screen: next to the field they
// are about, or in a notice when no field of the form is.

/**
 * Sets each problem as the error of the form field named by its path and
 * returns the problems that have no field in this form.
 */
export function placeIssues<T extends FieldValues>(
	form: UseFormReturn<T>,
	fields: ReadonlyArray<Path<T>>,
	issues: readonly ApiIssue[],
): ApiIssue[] {
	const known = fields as readonly string[];
	const elsewhere: ApiIssue[] = [];
	let focused = false;
	for (const issue of issues) {
		if (!known.includes(issue.path)) {
			elsewhere.push(issue);
			continue;
		}
		form.setError(
			issue.path as Path<T>,
			{ message: issue.message },
			// The first problem gets the cursor, where the field can take it.
			{ shouldFocus: !focused },
		);
		focused = true;
	}
	return elsewhere;
}

interface IssuesNoticeProps {
	/** "Nie można zapisać", "Nie można wysłać". */
	title: string;
	issues: readonly ApiIssue[];
	/** Buttons under the list, e.g. "Zamknij". */
	actions?: ReactNode;
}

/** The problems that belong to no field, as a list at the top of a form. */
export function IssuesNotice({ title, issues, actions }: IssuesNoticeProps) {
	if (issues.length === 0) return null;
	return (
		<Notice tone="red" role="alert" title={title} actions={actions}>
			{issues.length === 1 ? (
				issues[0]?.message
			) : (
				<ul className="list-disc pl-5">
					{issues.map((issue) => (
						<li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
					))}
				</ul>
			)}
		</Notice>
	);
}

/** A problem with no field of its own, e.g. "the connection failed". */
export const generalIssue = (message: string): ApiIssue => ({
	path: "",
	message,
});
