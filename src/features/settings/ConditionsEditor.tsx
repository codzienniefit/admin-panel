import { CONDITION_TYPES, type Condition } from "@/data/schemas/planning";
import {
	ALL_SCOPE,
	blankCondition,
	CONDITION_SPECS,
	isConditionType,
	normalizeCondition,
} from "@/domain/conditions";
import { formatConditionLabel } from "@/domain/weekValidation";
import { Button } from "@/ui/Button";
import { trainingTypeMeta } from "@/ui/enums";
import { borderFor, controlClass } from "@/ui/Field";
import { Select } from "@/ui/Select";

interface TrainingTypeOption {
	id: string;
	title: string;
}

const DAYS = "__days__";
const DEFAULT_RULE =
	"Brak wymagań. Planer użyje domyślnego: 2–3 treningi w tygodniu.";

export const scopeLabel = (scope: string): string =>
	scope === ALL_SCOPE ? "wszystkie treningi" : trainingTypeMeta(scope).label;

/** The rules of a week as short sentences, the way the planner shows them. */
export function ConditionList({
	conditions,
}: {
	conditions: readonly Condition[];
}) {
	if (conditions.length === 0) {
		return <p className="text-sm text-muted">{DEFAULT_RULE}</p>;
	}
	return (
		<ul className="flex flex-wrap gap-1.5">
			{conditions.map((condition, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: two rules may read the same
					key={index}
					className="rounded-full bg-hover px-2.5 py-0.5 text-xs text-ink"
				>
					{formatConditionLabel(condition, scopeLabel)}
				</li>
			))}
		</ul>
	);
}

interface ConditionsEditorProps {
	conditions: readonly Condition[];
	onChange: (conditions: Condition[]) => void;
	trainingTypes: readonly TrainingTypeOption[];
}

/** Edits the list of rules a week has to meet. */
export function ConditionsEditor({
	conditions,
	onChange,
	trainingTypes,
}: ConditionsEditorProps) {
	const replace = (index: number, next: Condition) =>
		onChange(
			conditions.map((condition, i) =>
				i === index ? normalizeCondition(next) : condition,
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{conditions.length === 0 && (
				<p className="text-sm text-muted">{DEFAULT_RULE}</p>
			)}
			{conditions.map((condition, index) => {
				if (!isConditionType(condition.type)) {
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; their place is their identity
							key={index}
							className="rounded-cell border border-line bg-bg p-2.5 text-sm text-muted"
						>
							Wymaganie „{condition.type}” pochodzi z nowszej wersji panelu.
							Zostaje bez zmian.
						</div>
					);
				}
				const spec = CONDITION_SPECS[condition.type];
				const scopeOptions = [
					{ value: ALL_SCOPE, label: "Wszystkie treningi" },
					...(spec.countsDays
						? [{ value: DAYS, label: "Dni treningowe" }]
						: []),
					...trainingTypes.map((type) => ({
						value: type.id,
						label: type.title,
						tone: trainingTypeMeta(type.id).tone,
					})),
				];
				const scopeValue =
					condition.countMode === "days" && condition.scope === ALL_SCOPE
						? DAYS
						: condition.scope;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; their place is their identity
						key={index}
						className="flex flex-wrap items-end gap-2 rounded-cell border border-line bg-surface p-2.5"
					>
						<div className="w-56">
							<Select
								label="Rodzaj wymagania"
								size="sm"
								options={CONDITION_TYPES.map((type) => ({
									value: type,
									label: CONDITION_SPECS[type].label,
								}))}
								value={condition.type}
								onChange={(type) => {
									if (type) {
										replace(index, {
											...blankCondition(type),
											scope: condition.scope,
										});
									}
								}}
								className="w-full"
							/>
						</div>
						{spec.scoped && (
							<div className="w-48">
								<Select
									label="Czego dotyczy"
									size="sm"
									options={scopeOptions}
									value={scopeValue}
									onChange={(scope) => {
										if (!scope) return;
										replace(
											index,
											scope === DAYS
												? { ...condition, scope: ALL_SCOPE, countMode: "days" }
												: { ...condition, scope, countMode: undefined },
										);
									}}
									className="w-full"
								/>
							</div>
						)}
						{spec.fields.map((field) => (
							<label key={field.key} className="flex flex-col gap-1 text-xs">
								<span className="text-muted">{field.label}</span>
								<input
									type="number"
									min={0}
									max={field.max}
									value={condition[field.key] ?? 0}
									onChange={(event) =>
										replace(index, {
											...condition,
											[field.key]: Number(event.target.value),
										})
									}
									className={`${controlClass} ${borderFor(false)} h-8 w-20`}
								/>
							</label>
						))}
						<Button
							variant="ghost"
							className="ml-auto"
							aria-label={`Usuń wymaganie: ${spec.label}`}
							onClick={() => onChange(conditions.filter((_, i) => i !== index))}
						>
							Usuń
						</Button>
					</div>
				);
			})}
			<Button
				className="self-start"
				onClick={() => onChange([...conditions, blankCondition()])}
			>
				Dodaj wymaganie
			</Button>
		</div>
	);
}
