import {
	currentEnvironment,
	ENVIRONMENTS,
	type Environment,
	switchEnvironment,
} from "@/data/environment";
import { Select } from "./Select";

const OPTIONS = ENVIRONMENTS.map((environment) => ({
	value: environment.value,
	label: environment.label,
	hint: environment.hint,
	tone: environment.tone,
	disabled: !environment.available,
}));

/** The backend the panel works on. Switching reloads the page. */
export function EnvironmentSelect() {
	return (
		<Select<Environment>
			label="Środowisko"
			options={OPTIONS}
			value={currentEnvironment()}
			onChange={(next) => next && switchEnvironment(next)}
			searchPlaceholder="Szukaj środowiska…"
			size="sm"
			className="w-36"
		/>
	);
}
