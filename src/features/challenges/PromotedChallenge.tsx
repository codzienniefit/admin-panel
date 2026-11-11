import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "@/data/api/errors";
import { setPromotedChallenge } from "@/data/config";
import type { Challenge } from "@/data/schemas/challenge";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Select";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";

/**
 * The challenge shown first in the app. Only a published challenge with a
 * premiere date can be chosen; leaving it empty promotes nothing.
 */
export function PromotedChallenge({
	challenges,
}: {
	challenges: readonly Challenge[];
}) {
	const router = useRouter();
	const current = useConfig().internal.promotedChallengeId;
	const [choice, setChoice] = useState<string | null>(current);
	const [busy, setBusy] = useState(false);

	const options = challenges
		.filter((c) => c.status === "published" && c.liveAtUtc)
		.sort((a, b) => (b.liveAtUtc ?? "").localeCompare(a.liveAtUtc ?? ""))
		.map((c) => ({ value: c.id, label: c.title, hint: c.id }));

	const save = async () => {
		const saved = await whileBusy(setBusy, () =>
			attempt(async () => {
				await setPromotedChallenge(choice);
				// Every screen reads the configuration from the route; reload it.
				await router.invalidate();
			}),
		);
		if (saved.ok) {
			toast({
				title: choice
					? "Promowane wyzwanie zapisane"
					: "Nic nie jest promowane",
				tone: "green",
			});
			return;
		}
		toast({
			title: "Nie udało się zapisać",
			description: errorMessage(saved.error, "") || undefined,
			tone: "red",
		});
	};

	return (
		<div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-4 py-3">
			<span className="text-sm font-semibold">Promowane wyzwanie</span>
			<Select
				label="Promowane wyzwanie"
				placeholder="Wybierz lub zostaw puste"
				options={options}
				value={choice}
				onChange={setChoice}
				clearable
				size="sm"
				// Wide enough for a long title, and no wider.
				className="w-[70ch] max-w-full"
			/>
			<Button
				variant="primary"
				disabled={busy || choice === current}
				onClick={() => void save()}
			>
				{busy ? "Zapisywanie…" : "Zapisz"}
			</Button>
		</div>
	);
}
