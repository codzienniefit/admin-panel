import { type ForcedConflict, mockControls } from "@/data/api/mock/controls";
import type { DatasetSize } from "@/data/api/mock/fixtures";
import { resetSampleData } from "@/data/api/mock/persistence";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { confirm } from "@/ui/confirm";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";

const DATASETS: Array<{ value: DatasetSize; label: string; hint: string }> = [
	{ value: "normal", label: "Zwykły", hint: "150 treningów" },
	{ value: "stress", label: "Duży", hint: "2000 treningów" },
];

const CONFLICTS: Array<{ value: ForcedConflict; label: string }> = [
	{ value: "otherField", label: "Ktoś zmienia inne pole" },
	{ value: "sameFields", label: "Ktoś zmienia to samo" },
];

/**
 * Controls of the Test environment's sample data: how the pretend server
 * behaves, how much data there is, and starting over.
 */
export function SampleDataDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const controls = useStore(mockControls);
	const slow = controls.minLatencyMs >= 1000;

	const reset = async (dataset?: DatasetSize) => {
		const sure = await confirm({
			title: dataset
				? "Wczytać inny zestaw danych?"
				: "Przywrócić dane początkowe?",
			description:
				"Wszystkie zmiany zrobione w danych przykładowych przepadną. Strona się przeładuje.",
			confirmLabel: dataset ? "Wczytaj" : "Przywróć",
			destructive: true,
		});
		if (sure) resetSampleData(dataset);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title="Dane testowe"
			description="Dane przykładowe żyją w tej przeglądarce. Zmiany zostają po odświeżeniu strony, dopóki ich nie przywrócisz."
			footer={
				<Button size="md" onClick={() => onOpenChange(false)}>
					Zamknij
				</Button>
			}
		>
			<div className="flex flex-col gap-5">
				<Switch
					label="Wolny serwer"
					hint="Każda odpowiedź trwa 1,5–2,5 s. Do oglądania stanów ładowania."
					checked={slow}
					onChange={(next) =>
						mockControls.set((c) => ({
							...c,
							minLatencyMs: next ? 1500 : 150,
							maxLatencyMs: next ? 2500 : 400,
						}))
					}
				/>
				<Switch
					label="Następny zapis się nie uda"
					hint="Działa na jeden zapis, potem wyłącza się samo."
					checked={controls.failNextSave}
					onChange={(next) =>
						mockControls.set((c) => ({ ...c, failNextSave: next }))
					}
				/>
				<Field
					label="Następny zapis trafia na cudzą zmianę"
					hint="Działa na jeden zapis."
				>
					{() => (
						<Select
							label="Konflikt przy następnym zapisie"
							placeholder="Bez konfliktu"
							options={CONFLICTS}
							value={controls.conflictNextSave}
							onChange={(next) =>
								mockControls.set((c) => ({ ...c, conflictNextSave: next }))
							}
							clearable
							className="w-full"
						/>
					)}
				</Field>
				<Field
					label="Zestaw danych"
					hint="Duży zestaw służy do sprawdzania szybkości list."
				>
					{() => (
						<Select
							label="Zestaw danych"
							options={DATASETS}
							value={controls.dataset}
							onChange={(next) => {
								if (next && next !== controls.dataset) void reset(next);
							}}
							className="w-full"
						/>
					)}
				</Field>
				<div>
					<Button variant="danger" onClick={() => void reset()}>
						Przywróć dane początkowe
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
