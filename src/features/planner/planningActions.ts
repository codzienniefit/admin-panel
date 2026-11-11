import { planningTarget } from "@/data/collections/planning";
import { plannerSettingsTarget } from "@/data/collections/settings";
import type { Planning } from "@/data/schemas/planning";
import type { PlannerSettings } from "@/data/schemas/settings";
import { plannerSettingsIssues, planningIssues } from "@/domain/planningRules";
import { applyChange, type ChangeResult } from "@/features/saving/applyChange";
import { TONES } from "@/ui/tones";

/** Changes a challenge's planning document, checked by the planning rules. */
export function applyPlanningChange(
	planning: Planning,
	change: (draft: Planning) => void,
	trainingTypeIds: ReadonlySet<string>,
	done?: string,
): Promise<ChangeResult> {
	return applyChange(planningTarget, planning, change, {
		issuesOf: (candidate) => planningIssues(candidate, trainingTypeIds),
		done,
	});
}

/** Changes the planner's shared settings, checked by their rules. */
export function applySettingsChange(
	settings: PlannerSettings,
	change: (draft: PlannerSettings) => void,
	trainingTypeIds: ReadonlySet<string>,
	done?: string,
): Promise<ChangeResult> {
	return applyChange(plannerSettingsTarget, settings, change, {
		issuesOf: (candidate) =>
			plannerSettingsIssues(candidate, trainingTypeIds, TONES),
		done,
	});
}
