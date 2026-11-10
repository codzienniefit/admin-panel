import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { isApiError } from "@/data/api/errors";
import { createChallenge } from "@/data/collections/challenges";
import { blankChallenge } from "@/data/schemas/challenge";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { TextField } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { toast } from "@/ui/toast";

/** Starts a challenge as a draft: a name and a length are enough. */
export function NewChallengePage({
	onCreated,
}: {
	onCreated: (challengeId: string) => void;
}) {
	const [title, setTitle] = useState("");
	const [weeks, setWeeks] = useState("4");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const create = async () => {
		if (!title.trim()) {
			setProblem("Nazwa jest wymagana");
			return;
		}
		setBusy(true);
		setProblem(null);
		try {
			const created = await createChallenge({
				...blankChallenge(),
				title: title.trim(),
				lengthDays: Math.max(1, Number.parseInt(weeks, 10) || 1) * 7,
			});
			toast({ title: "Szkic wyzwania utworzony", tone: "green" });
			onCreated(created.id);
		} catch (error) {
			setProblem(
				isApiError(error) || error instanceof Error
					? error.message
					: "Nie udało się utworzyć wyzwania",
			);
			setBusy(false);
		}
	};

	return (
		<div className="mx-auto flex max-w-xl flex-col gap-4">
			<Link
				to="/challenges"
				className="self-start text-sm text-muted hover:text-primary"
			>
				← Wyzwania
			</Link>
			<h1 className="text-3xl font-semibold tracking-tight">Nowe wyzwanie</h1>
			<Card>
				<form
					// Our own messages, next to the fields, instead of the browser's.
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					{problem && (
						<Notice tone="red" role="alert" title="Nie można utworzyć">
							{problem}
						</Notice>
					)}
					<TextField
						label="Nazwa"
						required
						autoFocus
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
					<TextField
						label="Liczba tygodni"
						type="number"
						min={1}
						max={52}
						hint="Czas trwania można potem zmienić co do dnia."
						value={weeks}
						onChange={(event) => setWeeks(event.target.value)}
					/>
					<p className="text-sm text-muted">
						Powstanie szkic, którego nie widać w aplikacji. Warianty, plan, opis
						i datę premiery dodasz w kolejnym kroku.
					</p>
					<div className="flex justify-end gap-2">
						<Button type="submit" variant="primary" size="md" disabled={busy}>
							{busy ? "Tworzenie…" : "Utwórz szkic"}
						</Button>
					</div>
				</form>
			</Card>
		</div>
	);
}
