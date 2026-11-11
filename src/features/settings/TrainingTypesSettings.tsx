import { useState } from "react";
import type { TrainingTypeStyle } from "@/data/schemas/settings";
import { trainingTypeIdsOf, useConfig } from "@/features/config/useConfig";
import { applySettingsChange } from "@/features/planner/planningActions";
import { settleChange } from "@/features/saving/applyChange";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { trainingTypeMeta } from "@/ui/enums";
import { TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice } from "@/ui/formIssues";
import { Loading } from "@/ui/Loading";
import { Select } from "@/ui/Select";
import { Tag } from "@/ui/Tag";
import { whileBusy } from "@/ui/tasks";
import { TONE_LABELS, TONES, type Tone } from "@/ui/tones";
import { usePlannerSettings } from "./usePlannerSettings";

/**
 * Colour and emoji of each training type. The types themselves come from the
 * backend configuration; here the team only decides how they look.
 */
export function TrainingTypesSettings() {
	const settings = usePlannerSettings();
	const config = useConfig().workouts;
	const [edited, setEdited] = useState<Record<string, TrainingTypeStyle>>({});
	const [problems, setProblems] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);

	if (!settings) return <Loading />;

	const styleOf = (typeId: string): TrainingTypeStyle =>
		edited[typeId] ??
		settings.trainingTypeStyles[typeId] ?? {
			tone: trainingTypeMeta(typeId).tone,
			emoji: "",
		};
	const change = (typeId: string, patch: Partial<TrainingTypeStyle>) =>
		setEdited({ ...edited, [typeId]: { ...styleOf(typeId), ...patch } });
	const dirty = Object.keys(edited).length > 0;

	const save = async () => {
		setProblems([]);
		const result = await whileBusy(setBusy, () =>
			settleChange(() =>
				applySettingsChange(
					settings,
					(draft) => {
						draft.trainingTypeStyles = {
							...draft.trainingTypeStyles,
							...edited,
						};
					},
					trainingTypeIdsOf(config),
				),
			),
		);
		// Null: held by the saver; the notice above explains.
		if (!result) return;
		if (!result.ok) {
			setProblems(result.issues.map((issue) => issue.message));
			return;
		}
		// Every screen that shows a training type reads these once, when the
		// panel loads, so the panel is loaded again.
		window.location.reload();
	};

	return (
		<div className="flex flex-col gap-3">
			<IssuesNotice
				title="Nie można zapisać"
				issues={problems.map(generalIssue)}
			/>
			<Card className="flex flex-col divide-y divide-line">
				{config.trainingTypes.map((type) => {
					const style = styleOf(type.id);
					const tone = (TONES as readonly string[]).includes(style.tone)
						? (style.tone as Tone)
						: "grey";
					return (
						<div
							key={type.id}
							className="flex flex-wrap items-end gap-3 py-3 first:pt-0 last:pb-0"
						>
							<div className="min-w-40 flex-1">
								<p className="font-semibold">{type.title}</p>
								<div className="mt-1">
									<Tag tone={tone}>
										{style.emoji ? `${style.emoji} ` : ""}
										{type.title}
									</Tag>
								</div>
							</div>
							<div className="flex w-48 flex-col gap-1.5">
								<span className="text-sm font-semibold">Kolor</span>
								<Select
									label={`Kolor: ${type.title}`}
									options={TONES.map((value) => ({
										value,
										label: TONE_LABELS[value],
										tone: value,
									}))}
									value={tone}
									onChange={(value) => {
										if (value) change(type.id, { tone: value });
									}}
									className="w-full"
								/>
							</div>
							<div className="w-28">
								<TextField
									label="Emoji"
									value={style.emoji ?? ""}
									maxLength={8}
									onChange={(event) =>
										change(type.id, { emoji: event.target.value.trim() })
									}
								/>
							</div>
						</div>
					);
				})}
			</Card>
			<div className="flex flex-wrap items-center justify-end gap-3">
				<span className="text-sm text-muted">
					Po zapisaniu panel wczyta się ponownie, żeby nowe kolory były
					wszędzie.
				</span>
				<Button disabled={!dirty || busy} onClick={() => setEdited({})}>
					Cofnij zmiany
				</Button>
				<Button
					variant="primary"
					disabled={!dirty || busy}
					onClick={() => void save()}
				>
					{busy ? "Zapisywanie…" : "Zapisz"}
				</Button>
			</div>
		</div>
	);
}
