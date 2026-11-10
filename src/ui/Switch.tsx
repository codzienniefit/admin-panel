import { Switch as BaseSwitch } from "@base-ui/react/switch";

interface SwitchProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	hint?: string;
	disabled?: boolean;
}

/** An on/off setting that takes effect as soon as it is flipped. */
export function Switch({
	label,
	checked,
	onChange,
	hint,
	disabled = false,
}: SwitchProps) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
		<label
			className={`flex items-start gap-3 text-sm ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
		>
			<BaseSwitch.Root
				checked={checked}
				onCheckedChange={onChange}
				disabled={disabled}
				className="mt-0.5 flex h-6 w-10 shrink-0 rounded-full bg-line-input p-0.5 transition-colors data-checked:bg-primary"
			>
				<BaseSwitch.Thumb className="size-5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-4" />
			</BaseSwitch.Root>
			<span className="flex flex-col">
				<span className="font-semibold">{label}</span>
				{hint && <span className="text-xs text-muted">{hint}</span>}
			</span>
		</label>
	);
}
